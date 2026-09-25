// Layout do palco, estilo Discord: decide ONDE cada bloco (câmera ou tela)
// aparece e em que tamanho — tudo automático.
//
//   grade     → ninguém em foco: blocos 16:9 do maior tamanho que couber
//   foco      → um bloco grande + o resto numa faixa embaixo
//   flutuante → bloco desencaixado, arrastável, gruda no canto mais próximo
//   vazio     → nada com vídeo: mostra o convite de compartilhar/ligar câmera
//
// Quando alguém começa a compartilhar a tela, ela entra em foco sozinha (e a
// sua câmera vira mini janela no canto). Clicar num bloco fixa o foco nele;
// clicar de novo (ou G / Esc) volta pra grade. Todos os blocos ficam no mesmo
// container com posição absoluta, e o JS só troca translate/width/height — o
// CSS anima a mudança, então qualquer troca de layout desliza em vez de saltar.

import { dom, state } from './state.js';

const GAP = 8;
const ASPECT = 16 / 9;
const FLOAT_MARGIN = 12;
const FOLLOW_DELAY_MS = 1500; // fala contínua antes de o foco trocar de pessoa
const PREFS_KEY = 'golive-layout';
const DEFAULT_PREFS = {
  stripHidden: false,
  stripH: null, // null = automático (20% da altura)
  showNoVideo: true,
  followSpeaker: false,
  autoFloatSelf: true,
  mirrorSelf: true,
  hideSelf: false,
};

// 'auto' = segue a transmissão; 'grid' = grade forçada; 'pinned' = foco fixo em `key`
let view = { mode: 'auto', key: null };
const prefs = loadPrefs();
// key -> { corner: 'tl' | 'tr' | 'bl' | 'br', w, auto }
const floating = new Map();
let autoFloatBlocked = false; // desencaixou/encaixou na mão durante a transmissão
let frame = 0;
// o palco pode estar numa janela de Picture-in-Picture (popout.js): o
// requestAnimationFrame da aba de origem para quando ela fica escondida
let win = window;
const followTimers = new Map();
const listeners = [];

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

export const getPref = (name) => prefs[name];

export function setPref(name, value) {
  prefs[name] = value;
  savePrefs();
  requestLayout();
}

export const tileKey = (kind, peerId) => `${kind}:${peerId}`;

// Blocos que devem aparecer agora, na ordem da faixa: telas primeiro (é o que
// a sala veio ver), depois as câmeras na ordem em que as pessoas entraram.
function visibleTiles() {
  const all = [...state.participants.values()];
  const hasVideo = all.some((p) => p.cam || p.sharingScreen);
  const screens = all.filter((p) => p.sharingScreen)
    .map((p) => ({ key: tileKey('screen', p.peerId), el: p.screenTileEl }));
  const cams = all
    .filter((p) => !(p.isLocal && prefs.hideSelf))
    .filter((p) => p.cam || p.lost || (hasVideo && prefs.showNoVideo))
    .map((p) => ({ key: tileKey('cam', p.peerId), el: p.tileEl }));
  return [...screens, ...cams];
}

function focusedKey(docked) {
  const has = (key) => docked.some((tile) => tile.key === key);
  if (view.mode === 'pinned') {
    if (has(view.key)) return view.key;
    view = { mode: 'auto', key: null }; // quem estava em foco sumiu
  }
  if (view.mode === 'grid') return null;
  const auto = state.activeSharerId && tileKey('screen', state.activeSharerId);
  return auto && has(auto) ? auto : null;
}

// Sua câmera vira mini janela no canto enquanto alguém transmite, e volta pra
// faixa quando a transmissão acaba — a não ser que você tenha mexido nela.
function syncAutoFloat(tiles) {
  const sharing = [...state.participants.values()].some((p) => p.sharingScreen);
  const self = tileKey('cam', 'local');
  const selfVisible = tiles.some((tile) => tile.key === self);
  if (!sharing) {
    autoFloatBlocked = false;
    if (floating.get(self)?.auto) floating.delete(self);
  } else if (prefs.autoFloatSelf && selfVisible && !autoFloatBlocked && !floating.has(self)) {
    floating.set(self, { corner: 'br', w: null, auto: true });
  }
}

export function requestLayout() {
  if (frame) return;
  frame = win.requestAnimationFrame(() => {
    frame = 0;
    layout();
  });
}

export function setLayoutWindow(next) {
  if (frame) win.cancelAnimationFrame(frame);
  frame = 0;
  win = next;
  requestLayout();
}

function layout() {
  const tiles = visibleTiles();
  syncAutoFloat(tiles);
  const docked = tiles.filter((tile) => !floating.has(tile.key));
  const floated = tiles.filter((tile) => floating.has(tile.key));
  const focus = focusedKey(docked);
  const W = dom.tiles.clientWidth;
  const H = dom.tiles.clientHeight;

  const rects = new Map();
  let strip = null;
  if (focus) {
    const others = docked.filter((tile) => tile.key !== focus);
    const showStrip = others.length > 0 && !prefs.stripHidden && !state.cinemaMode;
    const stripH = showStrip ? stripHeight(H) : 0;
    rects.set(focus, { x: 0, y: 0, w: W, h: H - (showStrip ? stripH + GAP : 0) });
    if (showStrip) {
      stripRects(others, W, H, stripH).forEach((r, key) => rects.set(key, r));
      strip = { y: H - stripH - GAP, h: GAP };
    }
  } else {
    gridRects(docked, W, H).forEach((r, key) => rects.set(key, r));
  }
  floated.forEach((tile) => rects.set(tile.key, floatRect(floating.get(tile.key), W, H)));

  // tudo que existe mas não tem lugar agora fica escondido
  dom.tiles.querySelectorAll('.tile').forEach((el) => {
    if (!rects.has(el.dataset.key)) {
      el.hidden = true;
      el.classList.remove('is-focused', 'is-floating');
    }
  });
  rects.forEach((r, key) => {
    const el = tiles.find((tile) => tile.key === key).el;
    place(el, r);
    el.classList.toggle('is-focused', key === focus);
    el.classList.toggle('is-floating', floating.has(key));
    if (floating.has(key)) el.dataset.corner = floating.get(key).corner;
  });

  dom.stripHandle.hidden = !strip;
  if (strip) {
    dom.stripHandle.style.translate = `0 ${Math.round(strip.y)}px`;
    dom.stripHandle.style.height = `${strip.h}px`;
  }

  const mode = tiles.length === 0 ? 'empty' : focus ? 'focus' : 'grid';
  dom.stage.dataset.layout = mode;
  dom.stageEmpty.hidden = mode !== 'empty';
  dom.stageToolbar.hidden = mode === 'empty';
  dom.layoutBtn.hidden = docked.length < 2;
  dom.layoutBtn.classList.toggle('is-grid', mode === 'grid');
  dom.stripBtn.hidden = mode !== 'focus' || docked.length < 2;
  dom.stripBtn.classList.toggle('active', prefs.stripHidden);
  dom.noVideoBtn.classList.toggle('active', !prefs.showNoVideo);
  dom.followBtn.classList.toggle('active', prefs.followSpeaker);
  dom.tiles.classList.toggle('mirror-self', prefs.mirrorSelf);
  if (mode === 'empty' && document.fullscreenElement === dom.stage) document.exitFullscreen?.();

  listeners.forEach((fn) => fn());
}

// Avisado depois de cada layout — a qualidade adaptativa (view-size.js)
// mede o tamanho novo de cada bloco daqui.
export function onLayout(fn) {
  listeners.push(fn);
}

function stripHeight(H) {
  const auto = Math.min(140, Math.max(64, H * 0.2));
  return Math.round(Math.min(H * 0.45, Math.max(56, prefs.stripH ?? auto)));
}

// Testa todo número de colunas e fica com o que dá o maior bloco 16:9.
function gridRects(tiles, W, H) {
  const n = tiles.length;
  const rects = new Map();
  if (!n) return rects;
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - (cols - 1) * GAP) / cols, ((H - (rows - 1) * GAP) / rows) * ASPECT);
    if (w > best.w) best = { cols, w };
  }
  const w = Math.floor(best.w);
  const h = Math.floor(w / ASPECT);
  const rows = Math.ceil(n / best.cols);
  const top = (H - (rows * h + (rows - 1) * GAP)) / 2;
  tiles.forEach((tile, i) => {
    const row = Math.floor(i / best.cols);
    // a última linha, se incompleta, fica centralizada — igual ao Discord
    const inRow = row === rows - 1 ? n - row * best.cols : best.cols;
    const left = (W - (inRow * w + (inRow - 1) * GAP)) / 2;
    rects.set(tile.key, { x: left + (i % best.cols) * (w + GAP), y: top + row * (h + GAP), w, h });
  });
  return rects;
}

// Faixa embaixo do foco: blocos da altura da faixa, encolhendo se não couber.
function stripRects(tiles, W, H, stripH) {
  const n = tiles.length;
  const w = Math.floor(Math.min(stripH * ASPECT, (W - (n - 1) * GAP) / n));
  const h = Math.floor(w / ASPECT);
  const left = (W - (n * w + (n - 1) * GAP)) / 2;
  const rects = new Map();
  tiles.forEach((tile, i) => rects.set(tile.key, { x: left + i * (w + GAP), y: H - h, w, h }));
  return rects;
}

function floatWidth(entry, W) {
  const auto = Math.min(240, W * 0.3);
  return Math.round(Math.min(W * 0.6, Math.max(120, entry.w ?? auto)));
}

function floatRect(entry, W, H) {
  const w = Math.min(floatWidth(entry, W), W - FLOAT_MARGIN * 2);
  const h = Math.round(w / ASPECT);
  const x = entry.corner.endsWith('l') ? FLOAT_MARGIN : W - w - FLOAT_MARGIN;
  const y = entry.corner.startsWith('t') ? FLOAT_MARGIN : H - h - FLOAT_MARGIN;
  return { x, y, w, h };
}

function place(el, r) {
  const appearing = el.hidden;
  if (appearing) el.classList.add('no-anim'); // nasce no lugar, sem voar do canto
  el.hidden = false;
  el.style.translate = `${Math.round(r.x)}px ${Math.round(r.y)}px`;
  el.style.width = `${Math.max(0, Math.round(r.w))}px`;
  el.style.height = `${Math.max(0, Math.round(r.h))}px`;
  if (appearing) {
    el.getBoundingClientRect(); // aplica a posição antes de religar a transição
    el.classList.remove('no-anim');
  }
}

export function isFocused() {
  return dom.stage.dataset.layout === 'focus';
}

export function isFocusedKey(key) {
  return dom.tiles.querySelector(`.tile[data-key="${key}"]`)?.classList.contains('is-focused') ?? false;
}

function setView(next) {
  view = next;
  requestLayout();
}

// alguém começou a compartilhar: a transmissão ganha o foco
export function resetView() {
  setView({ mode: 'auto', key: null });
}

export function focusTile(key) {
  if (floating.delete(key) && key === tileKey('cam', 'local')) autoFloatBlocked = true;
  setView({ mode: 'pinned', key });
}

export function unfocus() {
  setView({ mode: 'grid', key: null });
}

// G / botão de layout: grade ↔ foco
export function toggleLayout() {
  if (isFocused()) { unfocus(); return; }
  if (state.activeSharerId) { resetView(); return; }
  // sem transmissão: foca a primeira câmera de outra pessoa (ou a sua)
  const tiles = visibleTiles().filter((tile) => !floating.has(tile.key));
  const pick = tiles.find((tile) => !tile.key.endsWith(':local')) || tiles[0];
  if (pick) focusTile(pick.key);
}

// Esc: sai do foco. Devolve false se não havia o que desfazer.
export function exitFocus() {
  if (!isFocused()) return false;
  unfocus();
  return true;
}

// 1–9: foca o N-ésimo bloco na ordem em que aparecem
export function focusNth(n) {
  const tile = visibleTiles()[n - 1];
  if (tile) focusTile(tile.key);
}

// H / botão da faixa: esconde ou mostra os outros blocos durante o foco
export function toggleStrip() {
  setPref('stripHidden', !prefs.stripHidden);
}

export function toggleNoVideo() {
  setPref('showNoVideo', !prefs.showNoVideo);
}

export function toggleFollowSpeaker() {
  setPref('followSpeaker', !prefs.followSpeaker);
}

// ---------- desencaixar / encaixar ----------

export const isFloating = (key) => floating.has(key);

export function toggleFloating(key) {
  if (key === tileKey('cam', 'local')) autoFloatBlocked = true;
  if (floating.has(key)) {
    floating.delete(key);
  } else {
    floating.set(key, { corner: 'br', w: null, auto: false });
    if (view.mode === 'pinned' && view.key === key) view = { mode: 'auto', key: null };
  }
  requestLayout();
}

// Arrastar a mini janela: segue o dedo/mouse sem animação e, ao soltar,
// gruda no canto mais próximo (aí sim animando).
function startFloatDrag(e, el) {
  const entry = floating.get(el.dataset.key);
  if (!entry) return;
  const box = dom.tiles.getBoundingClientRect();
  const start = el.getBoundingClientRect();
  const offX = e.clientX - start.left;
  const offY = e.clientY - start.top;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');

  const move = (ev) => {
    const x = ev.clientX - box.left - offX;
    const y = ev.clientY - box.top - offY;
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
    moved = true;
    el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  };
  const end = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.classList.remove('dragging');
    if (!moved) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - box.left;
    const cy = r.top + r.height / 2 - box.top;
    entry.corner = (cy < box.height / 2 ? 't' : 'b') + (cx < box.width / 2 ? 'l' : 'r');
    entry.auto = false;
    requestLayout();
    // o clique que vem depois de um arrasto não é clique
    el.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Alça no canto da mini janela: muda a largura (a altura segue o 16:9).
function startFloatResize(e, el) {
  const entry = floating.get(el.dataset.key);
  if (!entry) return;
  e.stopPropagation();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const startW = el.getBoundingClientRect().width;
  const left = entry.corner.endsWith('l');
  dom.tiles.classList.add('resizing');
  const move = (ev) => {
    const dx = ev.clientX - e.clientX;
    entry.w = startW + (left ? dx : -dx);
    entry.auto = false;
    requestLayout();
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    dom.tiles.classList.remove('resizing');
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// Divisa entre o foco e a faixa: arrastar muda a altura da faixa.
function startStripResize(e) {
  const handle = dom.stripHandle;
  handle.setPointerCapture(e.pointerId);
  const box = dom.tiles.getBoundingClientRect();
  dom.tiles.classList.add('resizing');
  const move = (ev) => {
    prefs.stripH = box.bottom - ev.clientY - GAP / 2;
    requestLayout();
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    dom.tiles.classList.remove('resizing');
    savePrefs();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---------- seguir quem fala ----------

// Com "seguir quem fala" ligado, o foco vai pra quem fala por mais de 1,5s —
// menos quando o foco está numa transmissão (ninguém quer perder o filme).
export function onSpeaking(peerId, speaking) {
  clearTimeout(followTimers.get(peerId));
  followTimers.delete(peerId);
  if (!speaking || !prefs.followSpeaker || peerId === 'local') return;
  followTimers.set(peerId, setTimeout(() => {
    followTimers.delete(peerId);
    const focused = dom.tiles.querySelector('.tile.is-focused');
    if (focused?.dataset.kind === 'screen') return;
    const key = tileKey('cam', peerId);
    if (!visibleTiles().some((tile) => tile.key === key) || floating.has(key)) return;
    setView({ mode: 'pinned', key });
  }, FOLLOW_DELAY_MS));
}

export function resetLayout() {
  view = { mode: 'auto', key: null };
  floating.clear();
  autoFloatBlocked = false;
  followTimers.forEach(clearTimeout);
  followTimers.clear();
  requestLayout();
}

// ---------- apontador ----------

// Retângulo da imagem DE VERDADE dentro do <video> (object-fit: contain
// deixa faixas pretas). O apontador usa isso pra cair no mesmo ponto da tela
// compartilhada pros dois lados, mesmo com janelas de proporção diferente.
export function videoContentRect(video) {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return box;
  const scale = Math.min(box.width / vw, box.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

// Ponto em % da tela de `sharerId` → % do palco, pra desenhar o apontador.
export function screenPointToStage(x, y, sharerId = state.activeSharerId) {
  const p = state.participants.get(sharerId);
  if (!p || p.screenTileEl.hidden) return null;
  const content = videoContentRect(p.screenVideoEl);
  const stage = dom.stage.getBoundingClientRect();
  if (!stage.width || !stage.height) return null;
  return {
    x: ((content.left - stage.left + (x / 100) * content.width) / stage.width) * 100,
    y: ((content.top - stage.top + (y / 100) * content.height) / stage.height) * 100,
  };
}

// ---------- eventos ----------

export function initLayout({ onScreenClick }) {
  new ResizeObserver(requestLayout).observe(dom.tiles);

  dom.tiles.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    // o 2º clique de um duplo clique é do dblclick (tela cheia), não desfoca
    if (!el || e.detail > 1) return;
    if (e.target.closest('.tile-dock')) { toggleFloating(el.dataset.key); return; }
    if (el.classList.contains('is-floating')) return; // mini janela: só arrasta
    if (!el.classList.contains('is-focused')) {
      focusTile(el.dataset.key);
    } else if (el.dataset.kind === 'screen') {
      onScreenClick(e, el); // clicar na transmissão em foco = apontador
    } else {
      unfocus();
    }
  });

  // duplo clique: esse bloco em foco e o palco em tela cheia (ou sai dela)
  dom.tiles.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.tile');
    if (!el || e.target.closest('.tile-dock, .tile-resize')) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (dom.stage.classList.contains('is-popout')) return; // PiP não tem tela cheia
    focusTile(el.dataset.key);
    dom.stage.requestFullscreen?.().catch(() => {});
  });

  dom.tiles.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.tile.is-floating');
    if (!el) return;
    if (e.target.closest('.tile-resize')) startFloatResize(e, el);
    else if (!e.target.closest('.tile-dock')) startFloatDrag(e, el);
  });
  dom.stripHandle.addEventListener('pointerdown', startStripResize);
  // duplo clique na divisa: volta a faixa pro tamanho automático
  dom.stripHandle.addEventListener('dblclick', () => setPref('stripH', null));

  dom.layoutBtn.onclick = toggleLayout;
  dom.stripBtn.onclick = toggleStrip;
  dom.noVideoBtn.onclick = toggleNoVideo;
  dom.followBtn.onclick = toggleFollowSpeaker;
  requestLayout();
}
