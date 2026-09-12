// Controles de mídia: mic, câmera, compartilhamento de tela e reações.

import { dom, state } from './state.js';
import { setSharingScreen, updateBubbleVisibility, renderParticipantsList, initialOf } from './participants.js';
import { videoConstraints, bitrateFor, getQuality } from './quality.js';

export function toggleMic() {
  if (!state.localStream) return;
  state.micEnabled = !state.micEnabled;
  state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
  dom.micBtn.classList.toggle('off', !state.micEnabled);
  const local = state.participants.get('local');
  if (local) local.mic = state.micEnabled;
  renderParticipantsList();
  state.socket.emit('media-state', { cam: state.camEnabled, mic: state.micEnabled });
}

export function toggleCamera() {
  if (!state.localStream || state.isScreenSharing) return;
  state.camEnabled = !state.camEnabled;
  state.localStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
  dom.camBtn.classList.toggle('off', !state.camEnabled);
  const local = state.participants.get('local');
  if (local) { local.cam = state.camEnabled; updateBubbleVisibility(local); }
  state.socket.emit('media-state', { cam: state.camEnabled, mic: state.micEnabled });
}

// tela cheia no palco (vídeo/tela compartilhada) — ESC já sai sozinho, é
// comportamento nativo do navegador, não precisa de botão extra pra isso.
export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    dom.stage.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}

// modo cinema: apaga as luzes ao redor do vídeo (igual "watch party" da
// Discord/Netflix Party) sem mexer em nenhuma chamada — é só CSS num
// atributo do <body>, então nem precisa avisar o outro lado.
export function toggleCinemaMode(force) {
  state.cinemaMode = typeof force === 'boolean' ? force : !state.cinemaMode;
  document.body.classList.toggle('cinema-mode', state.cinemaMode);
  dom.cinemaBtn?.classList.toggle('active', state.cinemaMode);
}

// troca a fonte de video (camera <-> tela) sem derrubar as chamadas
export async function toggleScreenShare() {
  if (state.isScreenSharing) { await stopScreenShare(); return; }

  let screenStream;
  try {
    // constraints do preset de qualidade escolhido em #quality-picker (ver
    // quality.js) — "ideal" é só uma sugestão pro navegador/hardware, ele
    // não trava se a máquina não aguentar 1080p/60fps, então é seguro pedir
    // o máximo por padrão.
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints() });
  } catch (e) { return; } // usuario cancelou o picker

  const newVideoTrack = screenStream.getVideoTracks()[0];
  const oldVideoTrack = state.localStream.getVideoTracks()[0];

  Object.values(state.calls).forEach((call) => {
    const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(newVideoTrack);
  });

  state.localStream.removeTrack(oldVideoTrack);
  oldVideoTrack.stop();
  state.localStream.addTrack(newVideoTrack);
  state.participants.get('local').videoEl.srcObject = state.localStream;

  state.isScreenSharing = true;
  applyBitrateCap();
  setSharingScreen('local', true);
  state.socket.emit('screen-share', { sharing: true });
  dom.camBtn.disabled = true;

  // se parar de compartilhar tela pelo botao nativo do navegador
  newVideoTrack.onended = () => stopScreenShare();
}

// se você trocar a qualidade NO MEIO de uma transmissão em andamento, tenta
// aplicar na hora via applyConstraints (funciona pra maioria dos navegadores
// pra frameRate/resolução) em vez de esperar o próximo compartilhamento —
// bônus que o preset por si só não dá.
export function applyQualityNow() {
  if (!state.isScreenSharing || !state.localStream) return;
  const track = state.localStream.getVideoTracks()[0];
  track?.applyConstraints(videoConstraints()).catch(() => {});
  applyBitrateCap();
}

function videoSenderOf(call) {
  return call.peerConnection?.getSenders().find((s) => s.track && s.track.kind === 'video');
}

// Teto de bitrate por conexão de saída. Sem isso o encoder do navegador não
// tem limite e insiste no preset escolhido mesmo quando o upload não aguenta
// — e em malha o upload é multiplicado por quantas pessoas estão na sala. O
// congestionamento daí vira buffer, que é literalmente o "atraso de
// segundos" que se sente do outro lado.
export function applyBitrateCap() {
  const maxBitrate = bitrateFor(getQuality());
  if (!maxBitrate) return;
  Object.values(state.calls).forEach((call) => {
    const sender = videoSenderOf(call);
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrate;
    sender.setParameters(params).catch(() => {});
  });
}

// Volta ao "sem teto" ao sair do compartilhamento: o cap foi calculado pro
// upload multiplicado da tela, e aplicá-lo à câmera (que consome muito menos)
// só limitaria qualidade à toa.
export function clearBitrateCap() {
  Object.values(state.calls).forEach((call) => {
    const sender = videoSenderOf(call);
    if (!sender) return;
    const params = sender.getParameters();
    if (params.encodings?.[0]) delete params.encodings[0].maxBitrate;
    sender.setParameters(params).catch(() => {});
  });
}

export async function stopScreenShare() {
  if (!state.isScreenSharing) return;
  let camStream;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (e) { return; }

  const newVideoTrack = camStream.getVideoTracks()[0];
  newVideoTrack.enabled = state.camEnabled;
  const oldVideoTrack = state.localStream.getVideoTracks()[0];

  Object.values(state.calls).forEach((call) => {
    const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(newVideoTrack);
  });

  state.localStream.removeTrack(oldVideoTrack);
  oldVideoTrack.stop();
  state.localStream.addTrack(newVideoTrack);
  state.participants.get('local').videoEl.srcObject = state.localStream;

  state.isScreenSharing = false;
  clearBitrateCap();
  setSharingScreen('local', false);
  state.socket.emit('screen-share', { sharing: false });
  dom.camBtn.disabled = false;
}

// `name` é opcional — se vier, mostra um selinho com a inicial de quem
// mandou por baixo do emoji (assim dá pra saber quem reagiu, igual
// reações em chamada do Discord que aparecem coladas no avatar de quem
// reagiu; aqui simplificamos pra um selo flutuante, já que nosso emoji
// sobe solto pela tela e não fica "grudado" em ninguém).
export function spawnReaction(emoji, name) {
  const wrap = document.createElement('span');
  wrap.className = 'reaction-emoji';
  wrap.style.left = `calc(${30 + Math.random() * 40}% - 16px)`;
  wrap.innerHTML = name
    ? `<span class="reaction-emoji-icon">${emoji}</span><span class="reaction-emoji-name">${escapeForAttr(name)}</span>`
    : emoji;
  dom.reactionsLayer.appendChild(wrap);
  wrap.addEventListener('animationend', () => wrap.remove());
}

function escapeForAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// apontador ao vivo: clique na tela compartilhada manda um "ping" visual
// pro outro lado, igual apontar numa videochamada de verdade. Reaproveita
// a mesma reactions-layer (fica por cima do palco), então já ganha o
// z-index e o "pointer-events: none" certos de graça.
export function spawnPointerPing(xPercent, yPercent, name) {
  const el = document.createElement('span');
  el.className = 'pointer-ping';
  el.style.left = `${xPercent}%`;
  el.style.top = `${yPercent}%`;
  if (name) {
    const label = document.createElement('span');
    label.className = 'pointer-ping-label';
    label.textContent = initialOf(name);
    el.appendChild(label);
  }
  dom.reactionsLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// toast discreto (entrada/saída de participante, erros de validação/mídia)
// — some sozinho, a animação de saída (toast-out, no CSS) que decide quando
// remover o elemento. `holdMs` deixa mensagens mais longas (ex: permissão de
// câmera negada) ficarem visíveis por mais tempo que o padrão de ~2.6s.
export function showToast(message, { holdMs } = {}) {
  if (!dom.toastLayer) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  if (holdMs) el.style.setProperty('--toast-hold', `${holdMs}ms`);
  dom.toastLayer.appendChild(el);
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') el.remove();
  });
}
