// Entrar/sair da sala, conexão com o signaling (Socket.io) e o mesh WebRTC (PeerJS).

import { dom, state } from './state.js';
import { ensureParticipant, attachStream, removeParticipant, markConnectionLost, setSharingScreen, updateBubbleVisibility } from './participants.js';
import { spawnReaction, showEchoBanner } from './controls.js';

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

// ---------- pre-fill: link de convite (?room=) tem prioridade, senao ultima sala usada ----------
(function prefillRoom() {
  const params = new URLSearchParams(location.search);
  const fromLink = params.get('room');
  const lastRoom = localStorage.getItem('golive-last-room');
  dom.roomInput.value = fromLink || lastRoom || '';
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

async function joinRoom() {
  const roomId = dom.roomInput.value.trim();
  if (!roomId) return alert('Digita um ID de sala, mano.');
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return alert('ID de sala inválido. Use só letras, números, "-" ou "_" (até 40 caracteres).');
  }
  state.roomId = roomId;
  state.myName = dom.nameInput.value.trim().slice(0, 40) || 'Alguém';

  localStorage.setItem('golive-last-room', state.roomId);

  dom.statusEl.textContent = 'Pedindo acesso à câmera/mic...';
  state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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

  state.peer.on('open', (peerId) => {
    dom.statusEl.textContent = `Conectado (sala: ${state.roomId})`;
    dom.onlineDot.classList.add('on');
    dom.joinSection.style.display = 'none';
    dom.appEl.classList.add('active');
    dom.shareRoomBtn.style.display = 'inline-block';
    showEchoBanner();
    state.socket.emit('join-room', { roomId: state.roomId, peerId, name: state.myName });
  });

  // alguem chegou depois de mim -> eu ligo pra ele, mandando meu estado atual
  state.socket.on('user-joined', ({ peerId: newPeerId, name }) => {
    ensureParticipant(newPeerId, { name });
    const call = state.peer.call(newPeerId, state.localStream, {
      metadata: { name: state.myName, cam: state.camEnabled, mic: state.micEnabled, sharingScreen: state.isScreenSharing }
    });
    registerCall(newPeerId, call);
  });

  state.socket.on('user-left', (goneId) => {
    state.leftPeers.add(goneId);
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
  });

  state.socket.on('reaction', ({ emoji }) => spawnReaction(emoji));

  state.socket.on('join-error', ({ message }) => {
    alert(message || 'Não foi possível entrar na sala.');
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
  Object.values(state.calls).forEach(c => { try { c.close(); } catch (e) {} });
  state.calls = {};
  if (state.peer) { state.peer.destroy(); state.peer = null; }
  if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
  state.socket.removeAllListeners('user-joined');
  state.socket.removeAllListeners('user-left');
  state.socket.removeAllListeners('screen-share');
  state.socket.removeAllListeners('media-state');
  state.socket.removeAllListeners('reaction');
  state.socket.disconnect();

  state.participants.forEach(p => p.bubbleEl.remove());
  state.participants.clear();
  state.leftPeers.clear();
  state.nextColorIndex = 0;
  state.activeSharerId = null;
  state.micEnabled = false;
  state.camEnabled = false;
  state.isScreenSharing = false;

  dom.stageMain.hidden = true;
  dom.stageMain.innerHTML = '';
  dom.stageEmpty.hidden = false;
  dom.stageBubbles.classList.remove('merged');
  dom.micBtn.classList.add('off'); dom.micBtn.textContent = '🎤';
  dom.camBtn.classList.add('off'); dom.camBtn.disabled = false;
  dom.reactionPicker.hidden = true;

  dom.appEl.classList.remove('active');
  dom.joinSection.style.display = 'flex';
  dom.statusEl.textContent = 'Não conectado';
  dom.onlineDot.classList.remove('on');
  dom.shareRoomBtn.style.display = 'none';

  state.socket.connect();
}

export function initRoom() {
  state.socket = io();

  dom.joinSection.style.display = 'flex';

  document.getElementById('join-btn').onclick = joinRoom;
  document.getElementById('leave-btn').onclick = leaveRoom;

  dom.shareRoomBtn.onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      dom.shareRoomBtn.textContent = '✅ Link copiado!';
    } catch (e) {
      dom.shareRoomBtn.textContent = '⚠️ Copia manual: ' + url;
    }
    setTimeout(() => dom.shareRoomBtn.textContent = '🔗 Compartilhar sala', 2500);
  };
}
