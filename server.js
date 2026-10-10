require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_NAME_LENGTH = 40;
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE) || 30;

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.warn('LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET faltando: ninguém consegue entrar numa sala.');
}
// a API REST do LiveKit usa https no mesmo host do wss
const roomService = LIVEKIT_URL
  ? new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

const app = express();
// Atrás de um proxy (o do Render, ou o Caddy na VPS): sem isso o rate limit
// enxerga todo mundo com o IP do proxy e bloqueia a sala inteira junta.
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

// Cabeçalhos de segurança básicos (CSP desligada: o front carrega o LiveKit e
// o Socket.io de CDN e usa inline <style>/<script type="module"> — travar isso
// pediria uma reescrita maior do front que não vale a pena agora).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Alguém';
  return name.trim().slice(0, MAX_NAME_LENGTH) || 'Alguém';
}

async function roomSize(roomId) {
  try {
    return (await roomService.listParticipants(roomId)).length;
  } catch (e) {
    return 0; // sala ainda não existe no LiveKit
  }
}

// Áudio e vídeo vão pelo LiveKit (SFU): cada pessoa manda a câmera UMA vez
// pro servidor deles, que distribui pra sala. Aqui só emitimos o token de
// entrada — a identidade é sorteada no servidor pra ninguém se passar por outro.
app.post('/api/livekit-token', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { roomId, name } = req.body || {};
  if (!isValidRoomId(roomId)) return res.status(400).json({ message: 'Sala ou peerId inválido.' });
  if (!roomService) return res.status(503).json({ message: 'Servidor de mídia não configurado.' });

  if ((await roomSize(roomId)) >= MAX_ROOM_SIZE) {
    return res.status(403).json({ message: `Sala cheia (máx. ${MAX_ROOM_SIZE} pessoas).` });
  }

  const identity = crypto.randomUUID();
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: sanitizeName(name),
    ttl: '6h',
  });
  token.addGrant({ room: roomId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  res.json({ url: LIVEKIT_URL, token: await token.toJwt(), identity });
});

// Socket.io fica só com o que não é mídia: chat, reações e apontador.
// Quem entra/sai e o estado de mic/câmera/tela vêm do próprio LiveKit.
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, peerId, name } = {}) => {
    if (!isValidRoomId(roomId) || typeof peerId !== 'string' || !peerId) return;
    socket.data.roomId = roomId;
    socket.data.peerId = peerId.slice(0, 64);
    socket.data.name = sanitizeName(name);
    socket.join(roomId);
  });

  // reacao rapida (emoji flutuante) — limitada a um conjunto fixo pra evitar spam de texto arbitrário
  const ALLOWED_REACTIONS = new Set(['❤️', '😂', '😱', '👏']);
  socket.on('reaction', ({ emoji } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId || !ALLOWED_REACTIONS.has(emoji)) return;
    socket.to(roomId).emit('reaction', { peerId, emoji });
  });

  // apontador ao vivo — só repassa a posição (0-100, em %) pra sala; sem
  // guardar nada nem validar demais, é só um ping visual passageiro.
  // `sharer` = de quem é a tela apontada (pode haver mais de uma transmissão)
  socket.on('pointer', ({ x, y, sharer } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId || typeof x !== 'number' || typeof y !== 'number') return;
    socket.to(roomId).emit('pointer', { peerId, x, y, sharer: typeof sharer === 'string' ? sharer.slice(0, 64) : undefined });
  });

  // chat de texto — sem histórico nenhum guardado no servidor (nem aqui,
  // nem em disco): só repassa pra sala, igual reaction/pointer. Quem manda
  // já desenha a própria mensagem na hora (ver app.js), então aqui só
  // repassa pros OUTROS (socket.to, não io.to).
  const MAX_CHAT_LENGTH = 500;
  socket.on('chat-message', ({ text } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId || typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed) return;
    socket.to(roomId).emit('chat-message', { peerId, name: socket.data.name, text: trimmed });
  });
});

server.listen(PORT, () => {
  console.log(`GoLive Mini rodando em http://localhost:${PORT}`);
});

// encerramento gracioso (Render/Docker mandam SIGTERM em redeploy)
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido, fechando servidor...');
  server.close(() => process.exit(0));
});
