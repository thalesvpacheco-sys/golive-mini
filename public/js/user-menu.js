// Menu de botão direito numa pessoa, estilo Discord: volume da voz, volume da
// transmissão e silenciar. Tudo LOCAL — muda só o que você ouve; a outra
// pessoa não fica sabendo e não é afetada.
//
// Abre por botão direito na linha do painel, na bolha de câmera ou no palco
// (quando é a tela de alguém). Na linha do painel abre também com clique
// normal, porque no celular não existe botão direito.

import { dom, state } from './state.js';
import { applyVolumes } from './participants.js';
import { saveVolumes } from './volumes.js';
import { t } from './i18n.js';

let targetId = null;

function target() {
  return state.participants.get(targetId);
}

function render(p) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  dom.userMenuName.textContent = p.name;
  dom.userMenuVoice.value = Math.round(p.volume * 100);
  dom.userMenuVoiceValue.textContent = p.muted ? t('menu.muted') : pct(p.volume);
  dom.userMenuStream.value = Math.round(p.streamVolume * 100);
  dom.userMenuStreamValue.textContent = pct(p.streamVolume);
  // volume da transmissão só faz sentido enquanto a pessoa está transmitindo
  dom.userMenuStreamRow.hidden = !p.sharingScreen;
  dom.userMenuMute.textContent = t(p.muted ? 'menu.unmute' : 'menu.mute');
  dom.userMenuMute.classList.toggle('active', p.muted);
}

function update(patch) {
  const p = target();
  if (!p) return;
  Object.assign(p, patch);
  applyVolumes(p);
  saveVolumes(p);
  render(p);
}

// Devolve false pra você mesmo: não existe "seu próprio volume", então aí o
// menu nativo do navegador continua valendo.
function open(peerId, x, y) {
  const p = state.participants.get(peerId);
  if (!p || p.isLocal) return false;
  targetId = peerId;
  render(p);

  const menu = dom.userMenu;
  if (!menu.matches(':popover-open')) menu.showPopover();
  // no ponto do clique, mas sem vazar pra fora da janela
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  return true;
}

function openFromEvent(peerId, e) {
  if (peerId && open(peerId, e.clientX, e.clientY)) e.preventDefault();
}

export function initUserMenu() {
  const rowId = (e) => e.target.closest('li[data-peer-id]')?.dataset.peerId;

  dom.participantsList.addEventListener('contextmenu', (e) => openFromEvent(rowId(e), e));
  dom.participantsList.addEventListener('click', (e) => openFromEvent(rowId(e), e));
  dom.cameraBubbles.addEventListener('contextmenu', (e) => {
    openFromEvent(e.target.closest('.cam-bubble')?.dataset.peerId, e);
  });
  dom.stageMain.addEventListener('contextmenu', (e) => openFromEvent(state.activeSharerId, e));

  dom.userMenuVoice.addEventListener('input', () => update({ volume: dom.userMenuVoice.value / 100 }));
  dom.userMenuStream.addEventListener('input', () => update({ streamVolume: dom.userMenuStream.value / 100 }));
  dom.userMenuMute.addEventListener('click', () => update({ muted: !target()?.muted }));
}

// pessoa saiu da sala com o menu aberto nela
export function closeUserMenuFor(peerId) {
  if (targetId === peerId && dom.userMenu.matches(':popover-open')) dom.userMenu.hidePopover();
}
