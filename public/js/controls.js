// Controles de mídia: mic, câmera, compartilhamento de tela e reações.

import { dom, state } from './state.js';
import { setSharingScreen, updateBubbleVisibility } from './participants.js';

export function toggleMic() {
  if (!state.localStream) return;
  state.micEnabled = !state.micEnabled;
  state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
  dom.micBtn.classList.toggle('off', !state.micEnabled);
  dom.micBtn.textContent = state.micEnabled ? '🎤' : '🔇';
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

// troca a fonte de video (camera <-> tela) sem derrubar as chamadas
export async function toggleScreenShare() {
  if (state.isScreenSharing) { await stopScreenShare(); return; }

  let screenStream;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
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
  setSharingScreen('local', true);
  state.socket.emit('screen-share', { sharing: true });
  dom.camBtn.disabled = true;

  // se parar de compartilhar tela pelo botao nativo do navegador
  newVideoTrack.onended = () => stopScreenShare();
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
  setSharingScreen('local', false);
  state.socket.emit('screen-share', { sharing: false });
  dom.camBtn.disabled = false;
}

export function spawnReaction(emoji) {
  const el = document.createElement('span');
  el.className = 'reaction-emoji';
  el.textContent = emoji;
  el.style.left = `calc(${30 + Math.random() * 40}% - 16px)`;
  dom.reactionsLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

export function showEchoBanner() {
  dom.echoBanner.hidden = false;
  setTimeout(() => dom.echoBanner.hidden = true, 8000);
}
