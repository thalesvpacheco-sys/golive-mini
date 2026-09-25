// Menu de botão direito numa pessoa, estilo Discord: volume da voz, volume da
// transmissão e silenciar, mais as ações do palco (focar, desencaixar, abrir
// em janela, tela cheia, ocultar o vídeo). Tudo LOCAL — muda só o que você vê
// e ouve; a outra pessoa não fica sabendo e não é afetada.
//
// Abre por botão direito na linha do painel ou em qualquer bloco do palco
// (câmera ou tela da pessoa). Na linha do painel abre também com clique
// normal, e nos blocos com toque longo, porque no celular não existe botão
// direito.

import { dom, state } from './state.js';
import { applyVolumes, updateTile } from './participants.js';
import { saveVolumes } from './volumes.js';
import { focusTile, unfocus, isFocusedKey, isFloating, toggleFloating, tileKey, getPref, setPref } from './layout.js';
import { togglePopout, isPoppedOut } from './popout.js';
import { t } from './i18n.js';

const LONG_PRESS_MS = 550;

let targetId = null;
let targetKey = null; // bloco em que o menu foi aberto (câmera ou tela)

function target() {
  return state.participants.get(targetId);
}

function render(p) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  dom.userMenuName.textContent = p.name;
  // não existe "seu próprio volume": pra você mesmo o menu só tem as ações
  dom.userMenuAudio.hidden = p.isLocal;
  dom.userMenuVoice.value = Math.round(p.volume * 100);
  dom.userMenuVoiceValue.textContent = p.muted ? t('menu.muted') : pct(p.volume);
  dom.userMenuStream.value = Math.round(p.streamVolume * 100);
  dom.userMenuStreamValue.textContent = pct(p.streamVolume);
  // volume da transmissão só faz sentido enquanto a pessoa está transmitindo
  dom.userMenuStreamRow.hidden = !p.sharingScreen;
  dom.userMenuMute.textContent = t(p.muted ? 'menu.unmute' : 'menu.mute');
  dom.userMenuMute.classList.toggle('active', p.muted);
  renderActions(p);
}

function renderActions(p) {
  const tile = dom.tiles.querySelector(`.tile[data-key="${targetKey}"]`);
  const onStage = !!tile && !tile.hidden;
  const isCam = targetKey.startsWith('cam:');
  const actions = {
    focus: { show: onStage && !isFloating(targetKey), label: isFocusedKey(targetKey) ? 'menu.unfocus' : 'menu.focus' },
    float: { show: onStage, label: isFloating(targetKey) ? 'menu.dock' : 'menu.float' },
    popout: { show: true, label: isPoppedOut() ? 'menu.popin' : 'menu.popout' },
    fullscreen: { show: onStage && !isPoppedOut(), label: 'action.fullscreen' },
    'hide-video': { show: isCam && !p.isLocal && p.cam, label: p.videoHidden ? 'menu.showVideo' : 'menu.hideVideo' },
    mirror: { show: isCam && p.isLocal, label: 'menu.mirror', active: getPref('mirrorSelf') },
    'hide-self': { show: isCam && p.isLocal, label: 'menu.hideSelf', active: getPref('hideSelf') },
  };
  dom.userMenuActions.querySelectorAll('button[data-action]').forEach((btn) => {
    const a = actions[btn.dataset.action];
    btn.hidden = !a.show;
    btn.textContent = t(a.label);
    btn.classList.toggle('active', !!a.active);
    btn.setAttribute('aria-pressed', a.active === undefined ? 'false' : String(a.active));
  });
}

function update(patch) {
  const p = target();
  if (!p) return;
  Object.assign(p, patch);
  applyVolumes(p);
  saveVolumes(p);
  render(p);
}

function runAction(action) {
  const p = target();
  if (!p) return;
  let keepOpen = false;
  switch (action) {
    case 'focus':
      if (isFocusedKey(targetKey)) unfocus();
      else focusTile(targetKey);
      break;
    case 'float':
      toggleFloating(targetKey);
      break;
    case 'popout':
      togglePopout();
      break;
    case 'fullscreen':
      focusTile(targetKey);
      dom.stage.requestFullscreen?.().catch(() => {});
      break;
    case 'hide-video':
      p.videoHidden = !p.videoHidden;
      updateTile(p); // o vídeo escondido também para de chegar (view-size.js)
      break;
    case 'mirror':
      setPref('mirrorSelf', !getPref('mirrorSelf'));
      keepOpen = true;
      break;
    case 'hide-self':
      setPref('hideSelf', !getPref('hideSelf'));
      break;
  }
  if (keepOpen) renderActions(p);
  else dom.userMenu.hidePopover();
}

function open(peerId, key, x, y) {
  const p = state.participants.get(peerId);
  if (!p) return;
  targetId = peerId;
  targetKey = key || tileKey('cam', peerId);
  render(p);

  const menu = dom.userMenu;
  if (!menu.matches(':popover-open')) menu.showPopover();
  // no ponto do clique, mas sem vazar pra fora da janela
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function openFromEvent(peerId, key, e) {
  if (!peerId || !state.participants.has(peerId)) return;
  e.preventDefault();
  // No Linux/Mac o contextmenu dispara no mousedown: abrir agora faria o
  // mouseup logo em seguida contar como "clique fora" e fechar o menu na hora.
  if (e.buttons) {
    const { clientX, clientY } = e;
    window.addEventListener('pointerup', () => setTimeout(() => open(peerId, key, clientX, clientY)), { once: true });
  } else {
    open(peerId, key, e.clientX, e.clientY);
  }
}

// Toque longo num bloco = botão direito (o iOS não dispara contextmenu).
function initLongPress() {
  let timer = null;
  let start = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  dom.tiles.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || isPoppedOut()) return;
    const tile = e.target.closest('.tile');
    if (!tile || tile.classList.contains('is-floating')) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      if (!state.participants.has(tile.dataset.peerId)) return;
      open(tile.dataset.peerId, tile.dataset.key, start.x, start.y);
      // o toque que abriu o menu não vale como clique no bloco
      tile.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
    }, LONG_PRESS_MS);
  });
  dom.tiles.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  dom.tiles.addEventListener('pointerup', cancel);
  dom.tiles.addEventListener('pointercancel', cancel);
}

export function initUserMenu() {
  const rowId = (e) => e.target.closest('li[data-peer-id]')?.dataset.peerId;

  dom.participantsList.addEventListener('contextmenu', (e) => openFromEvent(rowId(e), null, e));
  dom.participantsList.addEventListener('click', (e) => openFromEvent(rowId(e), null, e));
  dom.tiles.addEventListener('contextmenu', (e) => {
    // o menu mora na página: com o palco na janela separada ele abriria
    // escondido atrás dela, então lá fica o menu nativo
    if (isPoppedOut()) return;
    const tile = e.target.closest('.tile');
    if (tile) openFromEvent(tile.dataset.peerId, tile.dataset.key, e);
  });
  initLongPress();

  dom.userMenuVoice.addEventListener('input', () => update({ volume: dom.userMenuVoice.value / 100 }));
  dom.userMenuStream.addEventListener('input', () => update({ streamVolume: dom.userMenuStream.value / 100 }));
  dom.userMenuMute.addEventListener('click', () => update({ muted: !target()?.muted }));
  dom.userMenuActions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) runAction(btn.dataset.action);
  });
}

// pessoa saiu da sala com o menu aberto nela
export function closeUserMenuFor(peerId) {
  if (targetId === peerId && dom.userMenu.matches(':popover-open')) dom.userMenu.hidePopover();
}
