// Tudo que mexe em participantes: bolhas de câmera, palco central, e o
// escape de HTML pro nome exibido (defesa básica contra XSS via `name`).

import { dom, state } from './state.js';

export function ensureParticipant(peerId, opts = {}) {
  if (state.participants.has(peerId)) return state.participants.get(peerId);
  const idx = state.nextColorIndex++;
  const color = idx % 2 === 0 ? 'purple' : 'pink';
  const bubbleEl = buildBubble(peerId, color, opts.name || peerId.slice(0, 6));
  const p = {
    peerId, color, name: opts.name || peerId.slice(0, 6),
    cam: false, mic: false, sharingScreen: false,
    bubbleEl, videoEl: bubbleEl.querySelector('video'), lost: false,
    isLocal: !!opts.isLocal
  };
  state.participants.set(peerId, p);
  dom.cameraBubbles.appendChild(bubbleEl);
  updateBubbleVisibility(p);
  maybeMergeBubbles();
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
    <span class="cam-bubble-status" hidden>Conexão perdida, tentando reconectar...</span>
  `;
  return el;
}

export function attachStream(peerId, stream) {
  const p = ensureParticipant(peerId);
  p.stream = stream;
  p.videoEl.srcObject = stream;
}

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
}

function demoteFromStage(p) {
  if (p.videoEl.parentElement === dom.stageMain) {
    p.bubbleEl.prepend(p.videoEl);
  }
  if (state.activeSharerId === null) dom.stageMain.hidden = true;
  updateBubbleVisibility(p);
}

function buildLostOverlay() {
  const el = document.createElement('div');
  el.className = 'lost-overlay';
  el.textContent = 'Conexão perdida, tentando reconectar...';
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
  }
  p.bubbleEl.remove();
  state.participants.delete(peerId);
  delete state.calls[peerId];
  maybeMergeBubbles();
}

export function maybeMergeBubbles() {
  // a segunda pessoa entrando na sala = local + mais um participante
  dom.stageBubbles.classList.toggle('merged', state.participants.size >= 2);
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
