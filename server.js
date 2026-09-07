require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_NAME_LENGTH = 40;
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE) || 8;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cabeçalhos de segurança básicos (CSP desligada: o front carrega PeerJS/Socket.io
// de CDN e usa inline <style>/<script type="module"> — travar isso pediria uma
// reescrita maior do front que não vale a pena pra esse projeto agora).
app.use(helmet({ contentSecurityPolicy: false }));

// Limita quantas vezes um IP pode bater no signaling HTTP do PeerJS por minuto.
// Não protege o WebSocket em si (Socket.io), mas cobre o handshake HTTP inicial.
app.use('/peerjs', rateLimit({ windowMs: 60_000, max: 120 }));

app.use(express.static(path.join(__dirname, 'public')));

// broker do WebRTC (troca as "cartas de endereco" dos peers)
const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

// Config de ICE (STUN/TURN) pro front montar o Peer(). Sem TURN configurado,
// cai no STUN público padrão do PeerJS (funciona pra maioria das redes, mas
// falha atrás de NAT simétrico / wifi corporativo — ver README).
app.get('/api/ice-config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (process.env.TURN_URLS) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  res.json({ iceServers });
});

// quem esta em cada sala: { roomId: Set(peerId) }
const rooms = {};

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Alguém';
  return name.trim().slice(0, MAX_NAME_LENGTH) || 'Alguém';
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, peerId, name } = {}) => {
    if (!isValidRoomId(roomId) || typeof peerId !== 'string' || !peerId) {
      socket.emit('join-error', { message: 'Sala ou peerId inválido.' });
      return;
    }

    const existing = rooms[roomId];
    if (existing && existing.size >= MAX_ROOM_SIZE && !existing.has(peerId)) {
      socket.emit('join-error', { message: `Sala cheia (máx. ${MAX_ROOM_SIZE} pessoas).` });
      return;
    }

    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
    socket.data.name = sanitizeName(name);
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = new Set();

    // avisa a quem ja esta na sala que chegou gente nova
    // (quem ja esta na sala que vai ligar pro novato -> monta o mesh sem duplicar chamada)
    socket.to(roomId).emit('user-joined', { peerId, name: socket.data.name });

    rooms[roomId].add(peerId);

    io.to(roomId).emit('room-size', rooms[roomId].size);
  });

  // repassa mudanca de "estou compartilhando tela" pra sala (pra decidir o que vai pro palco)
  socket.on('screen-share', ({ sharing } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    socket.to(roomId).emit('screen-share', { peerId, sharing: !!sharing });
  });

  // repassa toggle de mic/camera (pra sala saber se mostra a bolha do participante)
  socket.on('media-state', ({ cam, mic } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    socket.to(roomId).emit('media-state', { peerId, cam: !!cam, mic: !!mic });
  });

  // reacao rapida (emoji flutuante) — limitada a um conjunto fixo pra evitar spam de texto arbitrário
  const ALLOWED_REACTIONS = new Set(['❤️', '😂', '😱', '👏']);
  socket.on('reaction', ({ emoji } = {}) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId || !ALLOWED_REACTIONS.has(emoji)) return;
    socket.to(roomId).emit('reaction', { peerId, emoji });
  });

  socket.on('disconnect', () => {
    const { roomId, peerId } = socket.data || {};
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(peerId);
      socket.to(roomId).emit('user-left', peerId);
      io.to(roomId).emit('room-size', rooms[roomId].size);
      if (rooms[roomId].size === 0) delete rooms[roomId];
    }
  });
});

server.listen(PORT, () => {
  console.log(`GoLive Mini rodando em http://localhost:${PORT}`);
});

// encerramento gracioso (Railway manda SIGTERM em redeploy)
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido, fechando servidor...');
  server.close(() => process.exit(0));
});
