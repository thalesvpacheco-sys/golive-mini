// Entrar/sair da sala, conexão com o signaling (Socket.io) e o mesh WebRTC (PeerJS).

import { dom, state } from './state.js';
import { ensureParticipant, attachStream, removeParticipant, markConnectionLost, setSharingScreen, updateBubbleVisibility, renderParticipantsList, stopAllLevelMeters } from './participants.js';
import { spawnReaction, spawnPointerPing, showToast, toggleCinemaMode } from './controls.js';
import { t, translateServerMessage } from './i18n.js';

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

// ---------- pre-fill: link de convite (?room=) tem prioridade, senao ultima sala usada ----------
// nome também fica salvo (vocês são sempre as mesmas duas pessoas entrando,
// não faz sentido digitar o nome de novo toda vez).
(function prefillJoinForm() {
  const params = new URLSearchParams(location.search);
  const fromLink = params.get('room');
  const lastRoom = localStorage.getItem('golive-last-room');
  dom.roomInput.value = fromLink || lastRoom || '';
  dom.nameInput.value = localStorage.getItem('golive-last-name') || '';
  (dom.nameInput.value ? dom.roomInput : dom.nameInput).focus();
})();

// Busca a config de ICE (STUN/TURN) do backend antes de abrir qualquer Peer.
// Sem isso o app funciona igual antes (só STUN público), mas se você configurar
// um TURN via variáveis de ambiente no servidor, ele passa a ser usado aqui.
async function fetchIceConfig() {
  try {
    const res = await fetch('/api/ice-config');
    if (!res.ok) throw new Error('bad status');
    return await res.json();
  } catch (e) {
    console.warn('Não deu pra buscar ice-config do servidor, seguindo só com STUN padrão.', e);
    return {};
  }
}

// ---------- reconexão ----------
// Atualiza o statusinho do cabeçalho + a bolinha de "online" conforme o
// estado da conexão. Centralizado aqui pra socket.js e o Peer não ficarem
// cada um mexendo direto no DOM do jeito que der.
function setConnectionState(kind) {
  if (kind === 'reconnecting') {
    dom.statusEl.textContent = t('status.reconnecting');
    dom.onlineDot.classList.add('reconnecting');
  } else if (kind === 'lost') {
    dom.statusEl.textContent = t('status.lost');
    dom.onlineDot.classList.remove('on', 'reconnecting');
  } else {
    dom.statusEl.textContent = t('status.connected', { room: state.roomId });
    dom.onlineDot.classList.remove('reconnecting');
    dom.onlineDot.classList.add('on');
  }
}

let lastRejoinAt = 0;
// Reentra na sala do lado do servidor (que esqueceu a gente assim que o
// socket caiu). Chamada tanto quando o SOCKET reconecta quanto quando o
// PEER reconecta — numa queda de internet real os dois costumam cair
// junto, então o debounce evita mandar 'join-room' duplicado em sequência.
function rejoinIfNeeded() {
  if (!state.roomId || !state.peer || state.peer.destroyed || !state.peer.id) return;
  const now = Date.now();
  if (now - lastRejoinAt < 2000) return;
  lastRejoinAt = now;
  state.socket.emit('join-room', { roomId: state.roomId, peerId: state.peer.id, name: state.myName });
  setConnectionState('ok');
}

async function joinRoom() {
  const joinBtn = document.getElementById('join-btn');
  if (joinBtn.disabled) return; // já tem um "Entrando..." em andamento (ex: Enter apertado 2x)

  const roomId = dom.roomInput.value.trim();
  if (!roomId) return alert(t('alert.noRoom'));
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return alert(t('alert.invalidRoom'));
  }

  joinBtn.disabled = true;
  joinBtn.textContent = t('join.loading');

  state.roomId = roomId;
  const typedName = dom.nameInput.value.trim();
  state.myName = typedName.slice(0, 40) || 'Alguém';

  localStorage.setItem('golive-last-room', state.roomId);
  if (typedName) localStorage.setItem('golive-last-name', typedName);

  dom.statusEl.textContent = t('status.requestingMedia');
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    // sem isso aqui, negar a permissão da câmera/mic deixava a tela de
    // "Pedindo acesso..." travada pra sempre, sem nenhum aviso — pior tipo
    // de loading state, o que nunca termina e nunca explica por quê.
    console.error('getUserMedia falhou:', e);
    alert(t('alert.mediaDenied'));
    state.roomId = '';
    dom.statusEl.textContent = t('status.disconnected');
    joinBtn.disabled = false;
    joinBtn.textContent = t('join.button');
    return;
  }
  // comeca desligado - o uso tipico e ter audio/video rolando em paralelo (Discord etc)
  state.localStream.getAudioTracks().forEach(t => t.enabled = false);
  state.localStream.getVideoTracks().forEach(t => t.enabled = false);

  ensureParticipant('local', { name: `${state.myName} (você)`, isLocal: true });
  attachStream('local', state.localStream);

  const iceConfig = await fetchIceConfig();

  state.peer = new Peer(undefined, {
    host: location.hostname,
    port: location.port || (location.protocol === 'https:' ? 443 : 80),
    path: '/peerjs',
    secure: location.protocol === 'https:',
    config: iceConfig.iceServers ? { iceServers: iceConfig.iceServers } : undefined,
  });

  state.peer.on('error', (err) => {
    console.error('Peer error:', err);
    dom.statusEl.textContent = `Erro de conexão: ${err.type || err.message}`;
  });

  // A rede caiu um instante (wifi oscilando, celular trocando de rede etc):
  // o Peer perde só a conexão de SINALIZAÇÃO com o servidor, mas o objeto
  // continua de pé com o mesmo id — .reconnect() tenta recuperar sem
  // precisar destruir e recriar tudo do zero.
  state.peer.on('disconnected', () => {
    if (state.peer.destroyed) return;
    setConnectionState('reconnecting');
    state.peer.reconnect();
  });
  // já isso aqui é o Peer morrendo de vez (não dá pra só reconectar) — o
  // caminho mais simples e confiável nesse caso é pedir pra recarregar.
  state.peer.on('close', () => setConnectionState('lost'));

  state.peer.on('open', () => {
    dom.joinSection.style.display = 'none';
    dom.appEl.classList.add('active');
    dom.shareRoomBtn.style.display = 'inline-flex';
    dom.participantsBtn.style.display = 'inline-flex';
    rejoinIfNeeded(); // primeira entrada OU peer voltando de uma reconexão
  });

  // alguem chegou depois de mim -> eu ligo pra ele, mandando meu estado atual
  // (isRejoin=true quando é alguém que já estava na sala e só reconectou —
  // ver server.js — pra não mostrar "entrou na sala" numa reconexão)
  state.socket.on('user-joined', ({ peerId: newPeerId, name, isRejoin }) => {
    ensureParticipant(newPeerId, { name });
    if (!isRejoin) showToast(t('toast.joined', { name }));
    const call = state.peer.call(newPeerId, state.localStream, {
      metadata: { name: state.myName, cam: state.camEnabled, mic: state.micEnabled, sharingScreen: state.isScreenSharing }
    });
    registerCall(newPeerId, call);
  });

  state.socket.on('user-left', (goneId) => {
    state.leftPeers.add(goneId);
    const leaving = state.participants.get(goneId);
    if (leaving) showToast(t('toast.left', { name: leaving.name }));
    removeParticipant(goneId);
  });

  state.socket.on('screen-share', ({ peerId: fromId, sharing }) => {
    setSharingScreen(fromId, sharing);
  });

  state.socket.on('media-state', ({ peerId: fromId, cam, mic }) => {
    const p = state.participants.get(fromId);
    if (!p) return;
    p.cam = cam; p.mic = mic;
    updateBubbleVisibility(p);
    renderParticipantsList();
  });

  state.socket.on('reaction', ({ peerId: fromId, emoji }) => {
    const sender = state.participants.get(fromId);
    spawnReaction(emoji, sender?.name);
  });

  // apontador ao vivo do outro lado — a posição já vem em % (ver app.js),
  // então funciona igual dos dois lados independente do tamanho de tela.
  state.socket.on('pointer', ({ peerId: fromId, x, y }) => {
    const sender = state.participants.get(fromId);
    spawnPointerPing(x, y, sender?.name);
  });

  state.socket.on('join-error', ({ message }) => {
    alert(message ? translateServerMessage(message) : t('alert.joinErrorDefault'));
    leaveRoom();
  });

  // alguem me ligando -> eu atendo (recebo o estado dele via metadata)
  state.peer.on('call', (call) => {
    call.answer(state.localStream);
    const meta = call.metadata || {};
    const p = ensureParticipant(call.peer, { name: meta.name });
    p.cam = !!meta.cam;
    p.mic = !!meta.mic;
    updateBubbleVisibility(p);
    registerCall(call.peer, call);
    if (meta.sharingScreen) setSharingScreen(call.peer, true);
  });
}

function registerCall(peerId, call) {
  state.calls[peerId] = call;
  call.on('stream', (remoteStream) => attachStream(peerId, remoteStream));
  call.on('close', () => {
    // pode ser saida normal (user-left ja chegou/vai chegar) ou queda de conexao
    setTimeout(() => {
      if (!state.participants.has(peerId)) return; // ja removido normalmente
      if (state.leftPeers.has(peerId)) { removeParticipant(peerId); return; }
      markConnectionLost(peerId);
    }, 600);
  });
}

function leaveRoom() {
  state.roomId = ''; // limpa ANTES de desconectar o socket, senão o handler
                      // de 'disconnect' acha que é uma queda de conexão de
                      // verdade e mostra "Reconectando..." numa saída normal.
  Object.values(state.calls).forEach(c => { try { c.close(); } catch (e) {} });
  state.calls = {};
  if (state.peer) { state.peer.destroy(); state.peer = null; }
  if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
  stopAllLevelMeters();
  state.socket.removeAllListeners('user-joined');
  state.socket.removeAllListeners('user-left');
  state.socket.removeAllListeners('screen-share');
  state.socket.removeAllListeners('media-state');
  state.socket.removeAllListeners('reaction');
  state.socket.removeAllListeners('pointer');
  state.socket.disconnect();

  state.participants.forEach(p => p.bubbleEl.remove());
  state.participants.clear();
  state.leftPeers.clear();
  state.nextColorIndex = 0;
  state.activeSharerId = null;
  state.micEnabled = false;
  state.camEnabled = false;
  state.isScreenSharing = false;
  toggleCinemaMode(false); // não faz sentido sair da sala e a próxima ficar no escuro

  dom.stageMain.hidden = true;
  dom.stageMain.innerHTML = '';
  dom.stageEmpty.hidden = false;
  dom.stageBubbles.classList.remove('merged');
  dom.fullscreenBtn.hidden = true;
  if (document.fullscreenElement === dom.stage) document.exitFullscreen?.();
  dom.micBtn.classList.add('off');
  dom.camBtn.classList.add('off'); dom.camBtn.disabled = false;
  dom.qualityPicker.hidden = true;
  dom.participantsList.innerHTML = '';
  dom.participantsCount.textContent = '0';
  dom.participantsPanel.hidden = true;

  dom.appEl.classList.remove('active');
  dom.joinSection.style.display = 'flex';
  dom.statusEl.textContent = t('status.disconnected');
  dom.onlineDot.classList.remove('on', 'reconnecting');
  dom.shareRoomBtn.style.display = 'none';
  dom.participantsBtn.style.display = 'none';

  const joinBtn = document.getElementById('join-btn');
  joinBtn.disabled = false;
  joinBtn.textContent = t('join.button');

  state.socket.connect();
}

export function initRoom() {
  state.socket = io();

  // O Socket.io já tenta reconectar sozinho por padrão (é só a conexão de
  // sinalização caindo e voltando) — o trabalho aqui é só: quando ele voltar
  // DEPOIS de já estarmos numa sala, o servidor esqueceu a gente (o
  // server.js tira da sala assim que o socket desconecta), então reentra.
  let hasEverConnected = false;
  state.socket.on('connect', () => {
    if (hasEverConnected) rejoinIfNeeded();
    hasEverConnected = true;
  });
  state.socket.on('disconnect', () => {
    if (state.roomId && state.peer && !state.peer.destroyed) setConnectionState('reconnecting');
  });

  dom.joinSection.style.display = 'flex';

  document.getElementById('join-btn').onclick = joinRoom;
  document.getElementById('leave-btn').onclick = leaveRoom;
  // Enter em qualquer um dos dois campos já entra na sala, sem precisar
  // clicar no botão — detalhe pequeno, mas some com uma fricção boba.
  [dom.nameInput, dom.roomInput].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  });

  dom.shareRoomBtn.onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('share.copied'));
    } catch (e) {
      showToast(t('share.manualCopy', { url }));
    }
  };
}
