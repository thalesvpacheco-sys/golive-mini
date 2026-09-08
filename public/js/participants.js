// Tudo que mexe em participantes: bolhas de câmera, palco central, e o
// escape de HTML pro nome exibido (defesa básica contra XSS via `name`).

import { dom, state } from './state.js';
import { startLevelMeter, stopLevelMeter, stopAllLevelMeters } from './audio-level.js';
import { t } from './i18n.js';

const MIC_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>';
const MIC_OFF_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

// Reconstrói a lista do painel "Participantes" a partir do Map de estado —
// chamada sempre que alguém entra/sai ou muda mic/câmera (ver room.js/controls.js).
export function renderParticipantsList() {
  if (!dom.participantsList) return;
  dom.participantsList.innerHTML = '';
  state.participants.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'participant-row' + (p.speaking ? ' speaking' : '');
    li.dataset.peerId = p.peerId;
    const volumeControl = p.isLocal ? '' : `
      <input type="range" class="volume-slider" min="0" max="100"
        value="${Math.round((p.volume ?? 1) * 100)}"
        data-peer-id="${p.peerId}" aria-label="Volume — ${escapeHtml(p.name)}" title="Volume de ${escapeHtml(p.name)}" />
    `;
    li.innerHTML = `
      <span class="avatar avatar-${p.color}">${escapeHtml(initialOf(p.name))}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="mic-state ${p.mic ? 'on' : ''}">${p.mic ? MIC_ICON : MIC_OFF_ICON}</span>
      ${volumeControl}
    `;
    dom.participantsList.appendChild(li);
  });
  if (dom.participantsCount) dom.participantsCount.textContent = state.participants.size;
}

// Liga o anel verde de "tá falando" na bolha de câmera e destaca a linha
// correspondente no painel de participantes, se ele estiver aberto.
function setSpeaking(peerId, speaking) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.speaking = speaking;
  p.bubbleEl.classList.toggle('speaking', speaking);
  dom.participantsList?.querySelector(`li[data-peer-id="${peerId}"]`)?.classList.toggle('speaking', speaking);
}

export function ensureParticipant(peerId, opts = {}) {
  if (state.participants.has(peerId)) return state.participants.get(peerId);
  const idx = state.nextColorIndex++;
  const color = idx % 2 === 0 ? 'purple' : 'pink';
  const bubbleEl = buildBubble(peerId, color, opts.name || peerId.slice(0, 6));
  const p = {
    peerId, color, name: opts.name || peerId.slice(0, 6),
    cam: false, mic: false, sharingScreen: false, speaking: false,
    bubbleEl, videoEl: bubbleEl.querySelector('video'), lost: false,
    isLocal: !!opts.isLocal, volume: 1, // volume por participante (1 = 100%, estilo Discord)
  };
  state.participants.set(peerId, p);
  dom.cameraBubbles.appendChild(bubbleEl);
  updateBubbleVisibility(p);
  maybeMergeBubbles();
  renderParticipantsList();
  return p;
}

function buildBubble(peerId, color, label) {
  const el = document.createElement('div');
  el.className = `cam-bubble bubble-${color}`;
  el.id = 'bubble-' + peerId;
  el.hidden = true;
  el.innerHTML = `
    <video autoplay playsinline ${peerId === 'local' ? 'muted' : ''}></video>
    <span class="cam-bubble-label">${escapeHtml(label)}</span>
    <span class="cam-bubble-status" hidden>${t('status.connectionLost')}</span>
  `;
  return el;
}

export function attachStream(peerId, stream) {
  const p = ensureParticipant(peerId);
  p.stream = stream;
  p.videoEl.srcObject = stream;
  p.videoEl.volume = p.volume ?? 1;
  startLevelMeter(peerId, stream, (speaking) => setSpeaking(peerId, speaking));
}

// controle de volume por pessoa (estilo Discord) — um slider por linha no
// painel de participantes. Delegação de evento no <ul> em vez de listener
// por slider, porque a lista inteira é reconstruída (innerHTML) toda vez
// que alguém entra/sai/muda mic-câmera — um listener direto no <input>
// morreria junto com o elemento antigo a cada render.
dom.participantsList?.addEventListener('input', (e) => {
  if (!e.target.classList.contains('volume-slider')) return;
  const p = state.participants.get(e.target.dataset.peerId);
  if (!p) return;
  p.volume = Number(e.target.value) / 100;
  if (p.videoEl) p.videoEl.volume = p.volume;
});

export function updateBubbleVisibility(p) {
  if (p.sharingScreen) { p.bubbleEl.hidden = true; return; }
  p.bubbleEl.hidden = p.lost ? false : !p.cam;
}

export function setSharingScreen(peerId, sharing) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.sharingScreen = sharing;

  if (sharing) {
    // so uma pessoa por vez ocupa o palco grande; quem estava sai
    if (state.activeSharerId && state.activeSharerId !== peerId) {
      const prev = state.participants.get(state.activeSharerId);
      if (prev) { prev.sharingScreen = false; demoteFromStage(prev); }
    }
    state.activeSharerId = peerId;
    promoteToStage(p);
  } else {
    if (state.activeSharerId === peerId) state.activeSharerId = null;
    demoteFromStage(p);
  }

  dom.stageEmpty.hidden = !!state.activeSharerId;
}

function promoteToStage(p) {
  dom.stageMain.innerHTML = '';
  dom.stageMain.appendChild(p.videoEl);
  if (p.lost) dom.stageMain.appendChild(buildLostOverlay());
  dom.stageMain.hidden = false;
  p.bubbleEl.hidden = true;
  dom.fullscreenBtn.hidden = false;
}

function demoteFromStage(p) {
  if (p.videoEl.parentElement === dom.stageMain) {
    p.bubbleEl.prepend(p.videoEl);
  }
  if (state.activeSharerId === null) {
    dom.stageMain.hidden = true;
    dom.fullscreenBtn.hidden = true;
    // nada mais pra ver em tela cheia se ninguém está compartilhando
    if (document.fullscreenElement === dom.stage) document.exitFullscreen?.();
  }
  updateBubbleVisibility(p);
}

function buildLostOverlay() {
  const el = document.createElement('div');
  el.className = 'lost-overlay';
  el.textContent = t('status.connectionLost');
  return el;
}

export function markConnectionLost(peerId) {
  const p = state.participants.get(peerId);
  if (!p) return;
  p.lost = true;
  if (p.sharingScreen && p.videoEl.parentElement === dom.stageMain) {
    dom.stageMain.appendChild(buildLostOverlay());
  } else {
    p.bubbleEl.querySelector('.cam-bubble-status').hidden = false;
    p.bubbleEl.hidden = false;
  }
}

export function removeParticipant(peerId) {
  const p = state.participants.get(peerId);
  if (!p) return;
  if (state.activeSharerId === peerId) {
    state.activeSharerId = null;
    dom.stageMain.hidden = true;
    dom.stageMain.innerHTML = '';
    dom.stageEmpty.hidden = false;
    dom.fullscreenBtn.hidden = true;
    if (document.fullscreenElement === dom.stage) document.exitFullscreen?.();
  }
  stopLevelMeter(peerId);
  p.bubbleEl.remove();
  state.participants.delete(peerId);
  delete state.calls[peerId];
  maybeMergeBubbles();
  renderParticipantsList();
}

export { stopAllLevelMeters };

export function maybeMergeBubbles() {
  // a segunda pessoa entrando na sala = local + mais um participante
  dom.stageBubbles.classList.toggle('merged', state.participants.size >= 2);
}

// primeira letra do nome, em maiúscula — usado no avatar do painel de
// participantes e nas bolhas de reação (quem mandou o quê).
export function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
