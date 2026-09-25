// Tudo que mexe em participantes: os blocos de câmera e de tela do palco, e
// o escape de HTML pro nome exibido (defesa básica contra XSS via `name`).
// ONDE cada bloco aparece e em que tamanho é decidido em layout.js.

import { dom, state } from './state.js';
import { requestLayout, resetView, tileKey } from './layout.js';
import { startLevelMeter, stopLevelMeter, stopAllLevelMeters } from './audio-level.js';
import { t } from './i18n.js';
import { loadVolumes } from './volumes.js';

// um SVG só por ícone (não um par on/off) — o traço da barra some via CSS
// quando o `<span>` pai tem a classe "on" (`.off-slash`, mesmo truque já
// usado nos botões do control-bar — ver style.css), então não precisamos
// manter duas cópias quase idênticas de cada ícone.
const MIC_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/><line class="off-slash" x1="3" y1="3" x2="21" y2="21"/></svg>';
const CAM_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 8l4.5-2.5a1 1 0 0 1 1.5.9v11.2a1 1 0 0 1-1.5.9L15 16"/><rect x="2" y="6" width="13" height="12" rx="2"/><line class="off-slash" x1="1" y1="2" x2="23" y2="22"/></svg>';

// Reconstrói a lista do painel "Participantes" a partir do Map de estado —
// chamada sempre que alguém entra/sai ou muda mic/câmera (ver room.js/controls.js).
export function renderParticipantsList() {
  if (!dom.participantsList) return;
  dom.participantsList.innerHTML = '';
  state.participants.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'participant-row' + (p.speaking ? ' speaking' : '') + (p.muted ? ' locally-muted' : '');
    li.dataset.peerId = p.peerId;
    li.dataset.local = p.isLocal ? 'true' : 'false';
    li.innerHTML = `
      <span class="avatar avatar-${p.color}">${escapeHtml(initialOf(p.name))}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="mic-state ${p.mic ? 'on' : ''}">${MIC_ICON}</span>
      <span class="cam-state ${p.cam ? 'on' : ''}">${CAM_ICON}</span>
    `;
    dom.participantsList.appendChild(li);
  });
  if (dom.participantsCount) dom.participantsCount.textContent = state.participants.size;
}

// Liga o anel verde de "tá falando" no bloco da câmera e destaca a linha
// correspondente no painel de participantes, se ele estiver aberto.
function setSpeaking(peerId, speaking) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.speaking = speaking;
  p.tileEl.classList.toggle('speaking', speaking);
  dom.participantsList?.querySelector(`li[data-peer-id="${peerId}"]`)?.classList.toggle('speaking', speaking);
}

export function ensureParticipant(peerId, opts = {}) {
  if (state.participants.has(peerId)) return state.participants.get(peerId);
  const idx = state.nextColorIndex++;
  // íris e ciano ficam bem longe uma da outra no círculo cromático, então
  // continuam distinguíveis inclusive pra quem tem daltonismo — diferente do
  // par roxo/rosa anterior, que era praticamente a mesma cor pra alguns tipos.
  const color = idx % 2 === 0 ? 'iris' : 'cyan';
  const name = opts.name || peerId.slice(0, 6);
  const tileEl = buildCamTile(peerId, color, name);
  const screenVideoEl = buildScreenVideo(peerId);
  const p = {
    peerId, color, name,
    cam: false, mic: false, sharingScreen: false, speaking: false,
    tileEl, videoEl: tileEl.querySelector('video'), lost: false,
    // a tela vem numa conexão própria (screen-share.js), então tem o próprio
    // <video> num bloco só dela: dá pra ver a tela e a câmera ao mesmo tempo.
    screenVideoEl,
    screenTileEl: buildScreenTile(peerId, name, screenVideoEl),
    isLocal: !!opts.isLocal,
    ...loadVolumes(name), // volume, streamVolume, muted — escolhidos no menu de botão direito
  };
  state.participants.set(peerId, p);
  dom.tiles.append(p.screenTileEl, tileEl);
  updateTile(p);
  maybeMergeBubbles();
  renderParticipantsList();
  return p;
}

function buildCamTile(peerId, color, name) {
  const el = document.createElement('div');
  el.className = 'tile tile-cam';
  el.dataset.kind = 'cam';
  el.dataset.key = tileKey('cam', peerId);
  el.dataset.peerId = peerId;
  el.dataset.local = peerId === 'local' ? 'true' : 'false';
  el.hidden = true;
  // sem câmera, o bloco mostra o avatar — igual ao Discord
  el.innerHTML = `
    <video autoplay playsinline ${peerId === 'local' ? 'muted' : ''}></video>
    <div class="tile-avatar"><span class="avatar avatar-${color}">${escapeHtml(initialOf(name))}</span></div>
    <div class="tile-footer">
      <span class="tile-mic">${MIC_ICON}</span>
      <span class="tile-name">${escapeHtml(name)}</span>
    </div>
    <span class="tile-status" hidden>${t('status.connectionLost')}</span>
  `;
  return el;
}

function buildScreenTile(peerId, name, video) {
  const el = document.createElement('div');
  el.className = 'tile tile-screen';
  el.dataset.kind = 'screen';
  el.dataset.key = tileKey('screen', peerId);
  el.dataset.peerId = peerId;
  el.hidden = true;
  el.innerHTML = `
    <div class="tile-footer">
      <span class="tile-live">${t('tile.live')}</span>
      <span class="tile-name">${escapeHtml(name)}</span>
    </div>
    <span class="tile-status" hidden>${t('status.connectionLost')}</span>
  `;
  el.prepend(video);
  return el;
}

function buildScreenVideo(peerId) {
  const el = document.createElement('video');
  el.autoplay = true;
  el.playsInline = true;
  el.muted = peerId === 'local'; // sua própria tela: você já ouve o som original
  return el;
}

export function attachStream(peerId, stream) {
  const p = ensureParticipant(peerId);
  p.stream = stream;
  p.videoEl.srcObject = stream;
  applyVolumes(p);
  startLevelMeter(peerId, stream, (speaking) => setSpeaking(peerId, speaking));
}

// stream null = a transmissão acabou
export function attachScreenStream(peerId, stream) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.screenVideoEl.srcObject = stream;
  applyVolumes(p);
  // o bloco da tela pode ainda estar escondido quando o stream chega (o
  // aviso de "começou a compartilhar" vem por outro caminho), e autoplay não
  // garante o play de um <video> que não está sendo desenhado.
  if (stream) p.screenVideoEl.play().catch(() => {});
}

// Voz = <video> da câmera (leva o mic); transmissão = <video> da tela.
// Por serem elementos separados, cada um tem o próprio volume.
export function applyVolumes(p) {
  if (p.isLocal) return;
  p.videoEl.volume = p.volume;
  p.videoEl.muted = p.muted;
  p.screenVideoEl.volume = p.streamVolume;
  p.tileEl.classList.toggle('locally-muted', p.muted);
  dom.participantsList?.querySelector(`li[data-peer-id="${p.peerId}"]`)?.classList.toggle('locally-muted', p.muted);
}

// Estado visual do bloco da câmera (vídeo ou avatar, mic cortado, queda de
// conexão). Se o bloco aparece ou some é o layout que decide.
export function updateTile(p) {
  p.tileEl.dataset.video = p.cam && !p.lost ? 'on' : 'off';
  p.tileEl.classList.toggle('mic-off', !p.mic);
  p.tileEl.querySelector('.tile-status').hidden = !p.lost;
  p.screenTileEl.querySelector('.tile-status').hidden = !p.lost;
  requestLayout();
}

export function setSharingScreen(peerId, sharing) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.sharingScreen = sharing;

  if (sharing) {
    // só uma transmissão por vez; quem estava para de aparecer
    if (state.activeSharerId && state.activeSharerId !== peerId) {
      const prev = state.participants.get(state.activeSharerId);
      if (prev) prev.sharingScreen = false;
    }
    state.activeSharerId = peerId;
    resetView(); // a transmissão nova ganha o foco sozinha
  } else if (state.activeSharerId === peerId) {
    state.activeSharerId = null;
  }
  requestLayout();
}

export function markConnectionLost(peerId) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.lost = true;
  updateTile(p);
}

export function removeParticipant(peerId) {
  const p = state.participants.get(peerId);
  if (!p) return;
  if (state.activeSharerId === peerId) state.activeSharerId = null;
  stopLevelMeter(peerId);
  p.tileEl.remove();
  p.screenTileEl.remove();
  state.participants.delete(peerId);
  delete state.calls[peerId];
  maybeMergeBubbles();
  renderParticipantsList();
  requestLayout();
}

export { stopAllLevelMeters };

export function maybeMergeBubbles() {
  // a segunda pessoa entrando na sala = local + mais um participante
  dom.stageBubbles.classList.toggle('merged', state.participants.size >= 2);
}

// primeira letra do nome, em maiúscula — usado no avatar do painel de
// participantes, no bloco de quem está sem câmera e nas bolhas de reação (quem mandou o quê).
export function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
