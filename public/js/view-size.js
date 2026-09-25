// Qualidade da câmera que acompanha o tamanho em que cada pessoa está vendo —
// o mesmo efeito do simulcast do Discord, só que mais simples: como a sala é
// uma malha (cada um conectado direto com cada um), cada conexão pode mandar a
// câmera numa resolução diferente.
//
//   quem ASSISTE  → depois de cada layout, avisa (via socket) a altura em que
//                   está mostrando a câmera de cada pessoa: 0, 180, 360 ou 720
//   quem ENVIA    → ajusta só a conexão com aquela pessoa: reduz a resolução
//                   (scaleResolutionDownBy) e o teto de bitrate, ou pausa de
//                   vez (active=false) quando ninguém está vendo
//
// Bloco pequeno na faixa = 180p com pouca banda; foco = 720p; bloco escondido,
// vídeo ocultado no menu ou aba no fundo = nada. A voz não é afetada: ela vai
// num sender separado.

import { dom, state } from './state.js';
import { onLayout } from './layout.js';
import { isPoppedOut } from './popout.js';

const BITRATE = { 180: 250_000, 360: 700_000, 720: 2_000_000 };
const SEND_DELAY_MS = 250; // a animação do layout dura ~300ms: espera assentar

const sent = new Map(); // peerId -> altura que já avisei pra essa pessoa
const wanted = new Map(); // peerId -> altura que essa pessoa pediu da minha câmera
let timer = null;

// ---------- quem assiste ----------

function bucket(px) {
  if (px <= 0) return 0;
  if (px <= 200) return 180;
  if (px <= 400) return 360;
  return 720;
}

function desiredHeight(p) {
  if (!p.cam || p.videoHidden || p.lost || p.tileEl.hidden) return 0;
  // aba no fundo (e o palco não está na janela separada): ninguém está vendo
  if (document.hidden && !isPoppedOut() && document.pictureInPictureElement !== p.videoEl) return 0;
  const dpr = dom.tiles.ownerDocument.defaultView?.devicePixelRatio || 1;
  // o tamanho FINAL do bloco (o style), não o do meio da animação
  return bucket((parseFloat(p.tileEl.style.height) || 0) * dpr);
}

function report() {
  timer = null;
  if (!state.socket?.connected || !state.roomId) return;
  state.participants.forEach((p) => {
    if (p.isLocal) return;
    const h = desiredHeight(p);
    if (sent.get(p.peerId) === h) return;
    sent.set(p.peerId, h);
    state.socket.emit('view-size', { to: p.peerId, h });
  });
}

function scheduleReport() {
  clearTimeout(timer);
  timer = setTimeout(report, SEND_DELAY_MS);
}

// ---------- quem envia ----------

function cameraSender(peerId) {
  return state.calls[peerId]?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video');
}

function applyTo(peerId) {
  const h = wanted.get(peerId);
  const sender = cameraSender(peerId);
  if (h === undefined || !sender) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) return; // reaplicado quando a conexão abrir
  const enc = params.encodings[0];
  enc.active = h > 0;
  if (h > 0) {
    const trackH = sender.track.getSettings().height || h;
    enc.scaleResolutionDownBy = Math.max(1, trackH / h);
    enc.maxBitrate = BITRATE[h];
  }
  sender.setParameters(params).catch(() => {});
}

// câmera trocada (a faixa vazia virou a real): a escala depende da altura dela
export function reapplyViewSizes() {
  Object.keys(state.calls).forEach(applyTo);
}

// Chamado por room.js pra cada conexão de câmera: antes da negociação
// terminar as encodings ainda não existem, então aplica de novo ao conectar.
export function watchCall(peerId, call) {
  applyTo(peerId);
  const pc = call.peerConnection;
  pc?.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') applyTo(peerId);
  });
}

// ---------- ciclo de vida ----------

export function joinViewSize() {
  state.socket.on('view-size', ({ peerId, h }) => {
    wanted.set(peerId, h);
    applyTo(peerId);
  });
  scheduleReport();
}

// Reentrou na sala depois de uma queda: o servidor não guarda nada, então
// avisa tudo de novo.
export function resendViewSizes() {
  sent.clear();
  scheduleReport();
}

export function leaveViewSize() {
  clearTimeout(timer);
  timer = null;
  sent.clear();
  wanted.clear();
}

export function forgetPeer(peerId) {
  sent.delete(peerId);
  wanted.delete(peerId);
}

export function initViewSize() {
  onLayout(scheduleReport);
  document.addEventListener('visibilitychange', scheduleReport);
}
