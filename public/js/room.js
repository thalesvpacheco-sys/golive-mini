// Entrar/sair da sala. Áudio, vídeo, tela e quem está na sala vêm do LiveKit
// (SFU: cada um manda a câmera uma vez pro servidor, que distribui); chat,
// reações e apontador continuam pelo Socket.io.

import { dom, state } from './state.js';
import { ensureParticipant, attachCamera, attachVoice, attachScreen, removeParticipant, removeElements, setSharingScreen, setSpeaking, updateTile, renderParticipantsList } from './participants.js';
import { resetLayout } from './layout.js';
import { spawnReaction, spawnPointerPing, showToast, toggleCinemaMode } from './controls.js';
import { t, translateServerMessage } from './i18n.js';
import { appendChatMessage, clearChat } from './chat.js';
import { isPanelOpen, resetPanels } from './panels.js';
import { startNetworkMonitor, stopNetworkMonitor } from './network-stats.js';
import { screenShareEnded, resetScreenShare } from './screen-share.js';
import { closeUserMenuFor } from './user-menu.js';
import { closePopovers } from './popovers.js';
import { closePopout } from './popout.js';

const { Room, RoomEvent, Track, VideoPresets, ConnectionQuality } = window.LivekitClient;

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

function joinSocketRoom() {
  if (!state.roomId || !state.myId) return;
  state.socket.emit('join-room', { roomId: state.roomId, peerId: state.myId, name: state.myName });
}

async function fetchToken() {
  const res = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: state.roomId, name: state.myName }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.message || '');
  return body;
}

// 'local' é a chave do meu bloco; os outros são conhecidos pela identity
function keyOf(participant) {
  return participant.isLocal ? 'local' : participant.identity;
}

function ensureRemote(participant) {
  return ensureParticipant(participant.identity, { name: participant.name || participant.identity.slice(0, 6) });
}

// Mic, câmera e tela de cada um saem direto das publicações do LiveKit —
// não tem mais aviso separado pelo socket que possa se perder numa queda.
function syncParticipant(participant) {
  const key = keyOf(participant);
  const p = state.participants.get(key);
  if (!p) return;
  const live = (source) => {
    const pub = participant.getTrackPublication(source);
    return !!pub && !pub.isMuted;
  };
  p.mic = live(Track.Source.Microphone);
  p.cam = live(Track.Source.Camera);
  const sharing = !!participant.getTrackPublication(Track.Source.ScreenShare);
  if (sharing !== p.sharingScreen) setSharingScreen(key, sharing);
  updateTile(p);
  renderParticipantsList();
}

function routeTrack(key, source, track) {
  if (source === Track.Source.Camera) attachCamera(key, track);
  else if (source === Track.Source.Microphone) attachVoice(key, track);
  else if (source === Track.Source.ScreenShare) attachScreen(key, 'video', track);
  else if (source === Track.Source.ScreenShareAudio) attachScreen(key, 'audio', track);
}

// "Ocultar vídeo" no menu do botão direito: além de esconder, para de receber
// a câmera dessa pessoa (o LiveKit deixa de mandar pra mim).
export function applyVideoHidden(p) {
  state.room?.remoteParticipants.get(p.peerId)
    ?.getTrackPublication(Track.Source.Camera)
    ?.setEnabled(!p.videoHidden);
}

// O navegador pode bloquear som antes de um clique na página; o LiveKit
// avisa e a gente libera no próximo clique.
function unlockAudioOnNextClick(room) {
  if (room.canPlaybackAudio) return;
  document.addEventListener('pointerdown', () => room.startAudio().catch(() => {}), { once: true });
}

function wireRoom(room) {
  room
    .on(RoomEvent.ParticipantConnected, (participant) => {
      const p = ensureRemote(participant);
      showToast(t('toast.joined', { name: p.name }));
      syncParticipant(participant);
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      const p = state.participants.get(participant.identity);
      if (p) showToast(t('toast.left', { name: p.name }));
      closeUserMenuFor(participant.identity);
      removeParticipant(participant.identity);
    })
    .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const p = ensureRemote(participant);
      routeTrack(participant.identity, track.source, track);
      if (track.source === Track.Source.Camera) applyVideoHidden(p);
      syncParticipant(participant);
    })
    .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      routeTrack(participant.identity, track.source, null);
      syncParticipant(participant);
    })
    .on(RoomEvent.TrackPublished, (publication, participant) => {
      ensureRemote(participant);
      syncParticipant(participant);
    })
    .on(RoomEvent.TrackUnpublished, (publication, participant) => syncParticipant(participant))
    .on(RoomEvent.TrackMuted, (publication, participant) => syncParticipant(participant))
    .on(RoomEvent.TrackUnmuted, (publication, participant) => syncParticipant(participant))
    .on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      if (publication.source === Track.Source.Camera) attachCamera('local', publication.track);
      if (publication.source === Track.Source.ScreenShare) attachScreen('local', 'video', publication.track);
      syncParticipant(participant);
    })
    .on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
      if (publication.source === Track.Source.Camera) attachCamera('local', null);
      // inclusive pelo botão nativo "Parar de compartilhar" do navegador
      if (publication.source === Track.Source.ScreenShare) screenShareEnded();
      syncParticipant(participant);
    })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const talking = new Set(speakers.map(keyOf));
      state.participants.forEach((p, key) => {
        if (p.speaking !== talking.has(key)) setSpeaking(key, talking.has(key));
      });
    })
    .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant.isLocal) return;
      const p = state.participants.get(participant.identity);
      const lost = quality === ConnectionQuality.Lost;
      if (p && p.lost !== lost) { p.lost = lost; updateTile(p); }
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => unlockAudioOnNextClick(room))
    // quedas de rede: o LiveKit reconecta sozinho, sem refazer a sala
    .on(RoomEvent.Reconnecting, () => setConnectionState('reconnecting'))
    .on(RoomEvent.Reconnected, () => setConnectionState('ok'))
    .on(RoomEvent.Disconnected, () => {
      if (state.room === room) setConnectionState('lost'); // saída normal já limpou state.room
    });
}

async function joinRoom() {
  const joinBtn = document.getElementById('join-btn');
  if (joinBtn.disabled) return; // já tem um "Entrando..." em andamento (ex: Enter apertado 2x)

  const roomId = dom.roomInput.value.trim();
  if (!roomId) return showToast(t('alert.noRoom'));
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return showToast(t('alert.invalidRoom'));
  }

  joinBtn.disabled = true;
  joinBtn.textContent = t('join.loading');

  state.roomId = roomId;
  const typedName = dom.nameInput.value.trim();
  state.myName = typedName.slice(0, 40) || t('participant.anonymous');

  localStorage.setItem('golive-last-room', state.roomId);
  if (typedName) localStorage.setItem('golive-last-name', typedName);

  // Entra sem pedir câmera nem mic: o navegador só pergunta quando a pessoa
  // ligar um deles (ver controls.js).
  const room = new Room({
    adaptiveStream: true, // cada vídeo chega no tamanho em que está sendo mostrado (e pausa escondido)
    dynacast: true, // camada de câmera que ninguém está vendo para de ser enviada
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: { videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
  });
  state.room = room;
  wireRoom(room);

  try {
    const { url, token, identity } = await fetchToken();
    if (state.room !== room) return; // saiu enquanto esperava
    state.myId = identity;
    await room.connect(url, token);
  } catch (e) {
    if (state.room !== room) return;
    console.error('Não deu pra entrar na sala:', e);
    showToast(e.message ? translateServerMessage(e.message) : t('alert.joinErrorDefault'), { holdMs: 6000 });
    leaveRoom();
    return;
  }
  if (state.room !== room) return;

  ensureParticipant('local', { name: `${state.myName} (${t('participant.you')})`, isLocal: true });
  // quem já estava na sala antes de mim
  room.remoteParticipants.forEach((participant) => {
    ensureRemote(participant);
    participant.trackPublications.forEach((pub) => {
      if (pub.track) routeTrack(participant.identity, pub.source, pub.track);
    });
    syncParticipant(participant);
  });
  unlockAudioOnNextClick(room);

  dom.joinSection.style.display = 'none';
  dom.appEl.classList.add('active');
  state.callStartedAt = Date.now();
  setConnectionState('ok');
  startNetworkMonitor();

  joinSocketRoom();

  state.socket.on('reaction', ({ peerId: fromId, emoji }) => {
    const sender = state.participants.get(fromId);
    spawnReaction(emoji, sender?.name);
  });

  // apontador ao vivo do outro lado — a posição já vem em % (ver app.js),
  // então funciona igual dos dois lados independente do tamanho de tela.
  state.socket.on('pointer', ({ peerId: fromId, x, y, sharer }) => {
    const sender = state.participants.get(fromId);
    // `sharer` = de quem é a tela apontada (pode haver várias transmissões)
    const sharerId = sharer === state.myId ? 'local' : sharer;
    spawnPointerPing(x, y, sender?.name, sharerId);
  });

  // mensagem de chat de outra pessoa (a minha própria já foi desenhada na
  // hora do envio, otimista — ver app.js). Se o painel estiver fechado,
  // acende a bolinha vermelha no ícone em vez de deixar passar batido.
  state.socket.on('chat-message', ({ peerId: fromId, name, text }) => {
    appendChatMessage({ name: name || state.participants.get(fromId)?.name, text, own: false });
    if (!isPanelOpen('chat')) {
      state.unreadChat += 1;
      dom.chatBadge.hidden = false;
    }
  });
}

function leaveRoom() {
  closePopout(); // o palco volta pra página antes de tudo ser desmontado
  state.roomId = '';
  resetScreenShare();
  const room = state.room;
  state.room = null; // antes do disconnect: o aviso de 'Disconnected' não é queda
  room?.disconnect(); // também para câmera, mic e tela
  state.myId = '';
  stopNetworkMonitor();
  state.socket.removeAllListeners('reaction');
  state.socket.removeAllListeners('pointer');
  state.socket.removeAllListeners('chat-message');
  state.socket.disconnect();

  state.participants.forEach(removeElements);
  state.participants.clear();
  state.nextColorIndex = 0;
  state.activeSharerId = null;
  state.micEnabled = false;
  state.camEnabled = false;
  state.isScreenSharing = false;
  toggleCinemaMode(false); // não faz sentido sair da sala e a próxima ficar no escuro

  resetLayout(); // sem blocos, o palco volta pro convite vazio (e sai da tela cheia)
  dom.stageBubbles.classList.remove('merged');
  dom.micBtn.classList.add('off');
  dom.camBtn.classList.add('off'); dom.camBtn.disabled = false;
  closePopovers();
  dom.participantsList.innerHTML = '';
  dom.participantsCount.textContent = '0';
  clearChat();
  resetPanels(); // volta pro padrão do tamanho de tela atual, não "tudo fechado"
  state.unreadChat = 0;
  dom.chatBadge.hidden = true;
  state.callStartedAt = null;
  dom.callTimer.textContent = '00:00';

  dom.appEl.classList.remove('active');
  dom.joinSection.style.display = 'flex';
  dom.statusEl.textContent = t('status.disconnected');
  dom.onlineDot.classList.remove('on', 'reconnecting');

  const joinBtn = document.getElementById('join-btn');
  joinBtn.disabled = false;
  joinBtn.textContent = t('join.button');

  state.socket.connect();
}

export function initRoom() {
  state.socket = io();

  // O Socket.io reconecta sozinho; o servidor esqueceu em que sala a gente
  // estava (só pro chat/reações), então reentra.
  state.socket.on('connect', joinSocketRoom);

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
