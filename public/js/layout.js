// Layout do palco, estilo Discord: decide ONDE cada bloco (câmera ou tela)
// aparece e em que tamanho — tudo automático.
//
//   grade  → ninguém em foco: blocos 16:9 do maior tamanho que couber
//   foco   → um bloco grande + o resto numa faixa embaixo
//   vazio  → nada com vídeo: mostra o convite de compartilhar/ligar câmera
//
// Quando alguém começa a compartilhar a tela, ela entra em foco sozinha.
// Clicar num bloco fixa o foco nele; clicar de novo (ou G / Esc) volta pra
// grade. Todos os blocos ficam no mesmo container com posição absoluta, e o
// JS só troca left/top/width/height — o CSS anima a mudança, então qualquer
// troca de layout desliza em vez de saltar.

import { dom, state } from './state.js';

const GAP = 8;
const ASPECT = 16 / 9;
const PREFS_KEY = 'golive-layout';

// 'auto' = segue a transmissão; 'grid' = grade forçada; 'pinned' = foco fixo em `key`
let view = { mode: 'auto', key: null };
const prefs = loadPrefs();
let frame = 0;

function loadPrefs() {
  try {
    return { stripHidden: false, showNoVideo: true, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch (e) {
    return { stripHidden: false, showNoVideo: true };
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

export const tileKey = (kind, peerId) => `${kind}:${peerId}`;

// Blocos que devem aparecer agora, na ordem da faixa: telas primeiro (é o que
// a sala veio ver), depois as câmeras na ordem em que as pessoas entraram.
function visibleTiles() {
  const all = [...state.participants.values()];
  const hasVideo = all.some((p) => p.cam || p.sharingScreen);
  const screens = all.filter((p) => p.sharingScreen)
    .map((p) => ({ key: tileKey('screen', p.peerId), el: p.screenTileEl }));
  const cams = all.filter((p) => p.cam || p.lost || (hasVideo && prefs.showNoVideo))
    .map((p) => ({ key: tileKey('cam', p.peerId), el: p.tileEl }));
  return [...screens, ...cams];
}

function focusedKey(tiles) {
  const has = (key) => tiles.some((tile) => tile.key === key);
  if (view.mode === 'pinned') {
    if (has(view.key)) return view.key;
    view = { mode: 'auto', key: null }; // quem estava em foco sumiu
  }
  if (view.mode === 'grid') return null;
  const auto = state.activeSharerId && tileKey('screen', state.activeSharerId);
  return auto && has(auto) ? auto : null;
}

export function requestLayout() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    layout();
  });
}

function layout() {
  const tiles = visibleTiles();
  const focus = focusedKey(tiles);
  const W = dom.tiles.clientWidth;
  const H = dom.tiles.clientHeight;

  const rects = new Map();
  if (focus) {
    const others = tiles.filter((tile) => tile.key !== focus);
    const showStrip = others.length > 0 && !prefs.stripHidden;
    const stripH = showStrip ? Math.round(Math.min(140, Math.max(64, H * 0.2))) : 0;
    rects.set(focus, { x: 0, y: 0, w: W, h: H - (showStrip ? stripH + GAP : 0) });
    if (showStrip) stripRects(others, W, H, stripH).forEach((r, key) => rects.set(key, r));
  } else {
    gridRects(tiles, W, H).forEach((r, key) => rects.set(key, r));
  }

  // tudo que existe mas não tem lugar agora fica escondido
  dom.tiles.querySelectorAll('.tile').forEach((el) => {
    if (![...rects.keys()].includes(el.dataset.key)) {
      el.hidden = true;
      el.classList.remove('is-focused');
    }
  });
  rects.forEach((r, key) => {
    const el = tiles.find((tile) => tile.key === key).el;
    place(el, r);
    el.classList.toggle('is-focused', key === focus);
  });

  const mode = tiles.length === 0 ? 'empty' : focus ? 'focus' : 'grid';
  dom.stage.dataset.layout = mode;
  dom.stageEmpty.hidden = mode !== 'empty';
  dom.stageToolbar.hidden = mode === 'empty';
  dom.layoutBtn.hidden = tiles.length < 2;
  dom.layoutBtn.classList.toggle('is-grid', mode === 'grid');
  dom.stripBtn.hidden = mode !== 'focus' || tiles.length < 2;
  dom.stripBtn.classList.toggle('active', prefs.stripHidden);
  dom.noVideoBtn.classList.toggle('active', !prefs.showNoVideo);
  if (mode === 'empty' && document.fullscreenElement === dom.stage) document.exitFullscreen?.();
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

function setView(next) {
  view = next;
  requestLayout();
}

// alguém começou a compartilhar: a transmissão ganha o foco
export function resetView() {
  setView({ mode: 'auto', key: null });
}

export function focusTile(key) {
  setView({ mode: 'pinned', key });
}

// G / botão de layout: grade ↔ foco
export function toggleLayout() {
  if (isFocused()) { setView({ mode: 'grid', key: null }); return; }
  if (state.activeSharerId) { resetView(); return; }
  // sem transmissão: foca a primeira câmera de outra pessoa (ou a sua)
  const tiles = visibleTiles();
  const pick = tiles.find((tile) => !tile.key.endsWith(':local')) || tiles[0];
  if (pick) focusTile(pick.key);
}

// Esc: sai do foco fixo. Devolve false se não havia o que desfazer.
export function exitFocus() {
  if (!isFocused()) return false;
  setView({ mode: 'grid', key: null });
  return true;
}

// H / botão da faixa: esconde ou mostra os outros blocos durante o foco
export function toggleStrip() {
  prefs.stripHidden = !prefs.stripHidden;
  savePrefs();
  requestLayout();
}

export function toggleNoVideo() {
  prefs.showNoVideo = !prefs.showNoVideo;
  savePrefs();
  requestLayout();
}

export function resetLayout() {
  view = { mode: 'auto', key: null };
  requestLayout();
}

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

// Ponto em % da tela compartilhada → % do palco, pra desenhar o apontador.
export function screenPointToStage(x, y) {
  const p = state.participants.get(state.activeSharerId);
  if (!p || p.screenTileEl.hidden) return null;
  const content = videoContentRect(p.screenVideoEl);
  const stage = dom.stage.getBoundingClientRect();
  if (!stage.width || !stage.height) return null;
  return {
    x: ((content.left - stage.left + (x / 100) * content.width) / stage.width) * 100,
    y: ((content.top - stage.top + (y / 100) * content.height) / stage.height) * 100,
  };
}

export function initLayout({ onScreenClick }) {
  new ResizeObserver(requestLayout).observe(dom.tiles);

  dom.tiles.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    // o 2º clique de um duplo clique é do dblclick (tela cheia), não desfoca
    if (!el || e.detail > 1) return;
    if (!el.classList.contains('is-focused')) {
      focusTile(el.dataset.key);
    } else if (el.dataset.kind === 'screen') {
      onScreenClick(e, el); // clicar na transmissão em foco = apontador
    } else {
      setView({ mode: 'grid', key: null });
    }
  });

  // duplo clique: esse bloco em foco e o palco em tela cheia (ou sai dela)
  dom.tiles.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.tile');
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    focusTile(el.dataset.key);
    dom.stage.requestFullscreen?.().catch(() => {});
  });

  dom.layoutBtn.onclick = toggleLayout;
  dom.stripBtn.onclick = toggleStrip;
  dom.noVideoBtn.onclick = toggleNoVideo;
  requestLayout();
}
