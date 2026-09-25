// Abrir em janela (o "Pop Out" do Discord): o palco inteiro sai da página e
// vai pra uma janela própria que fica sempre por cima das outras — dá pra
// assistir enquanto usa outro programa. Fechar a janela encaixa tudo de volta.
//
// Usa a Document Picture-in-Picture API (Chrome/Edge 116+), que aceita HTML de
// verdade: os mesmos blocos, a mesma grade, os controles funcionando. Os nós
// são MOVIDOS pra lá (nada é recriado), igual fullscreen.js faz com o dock.
// Onde a API não existe (Firefox, Safari), cai no Picture-in-Picture comum,
// que só leva o vídeo do bloco em foco.

import { dom, state } from './state.js';
import { requestLayout, setLayoutWindow } from './layout.js';
import { showStageControls } from './fullscreen.js';

let pipWin = null;
let observer = null;
const stageAnchor = document.createComment('stage-anchor');
const controlBarAnchor = document.createComment('popout-control-bar-anchor');

export const isPoppedOut = () => !!pipWin;

export function togglePopout() {
  if (pipWin) closePopout();
  else openPopout();
}

export function closePopout() {
  pipWin?.close(); // o 'pagehide' da janela faz o resto (dock)
}

export async function openPopout() {
  if (pipWin || !state.localStream) return;
  if (!('documentPictureInPicture' in window)) {
    videoPipFallback();
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});

  const { width, height } = dom.stage.getBoundingClientRect();
  let win;
  try {
    win = await window.documentPictureInPicture.requestWindow({
      width: Math.round(Math.max(320, width * 0.6)),
      height: Math.round(Math.max(200, height * 0.6)),
    });
  } catch (e) {
    console.warn('Não deu pra abrir a janela separada.', e);
    videoPipFallback();
    return;
  }
  pipWin = win;

  copyStyles(win.document);
  win.document.documentElement.lang = document.documentElement.lang;
  if (document.documentElement.dataset.theme) win.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
  win.document.body.className = `${document.body.className} popout-body`;

  dom.stage.before(stageAnchor);
  dom.controlBar.after(controlBarAnchor);
  dom.stage.appendChild(dom.controlBar);
  win.document.body.appendChild(dom.stage);
  dom.stage.classList.add('is-popout', 'is-overlay');
  dom.appEl.classList.add('stage-popped');
  replayVideos();
  showStageControls();

  setLayoutWindow(win);
  observer = new win.ResizeObserver(requestLayout);
  observer.observe(dom.tiles);

  // atalhos de teclado continuam valendo com o foco na janela separada
  win.document.addEventListener('keydown', (e) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }));
  });
  win.addEventListener('pagehide', dock, { once: true });
}

function dock() {
  if (!pipWin) return;
  observer?.disconnect();
  observer = null;
  stageAnchor.replaceWith(dom.stage);
  controlBarAnchor.replaceWith(dom.controlBar);
  dom.stage.classList.remove('is-popout', 'is-overlay', 'controls-hidden');
  dom.appEl.classList.remove('stage-popped');
  pipWin = null;
  setLayoutWindow(window);
  replayVideos();
}

// mover um <video> de documento pode pausar; garante que segue tocando
function replayVideos() {
  dom.stage.querySelectorAll('video').forEach((v) => {
    if (v.srcObject) v.play().catch(() => {});
  });
}

// A janela nasce sem CSS nenhum: copia as regras da página (e o <link> das
// fontes, que por ser de outro domínio não deixa ler as regras).
function copyStyles(doc) {
  [...document.styleSheets].forEach((sheet) => {
    try {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      doc.head.appendChild(style);
    } catch (e) {
      if (!sheet.href) return;
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      doc.head.appendChild(link);
    }
  });
}

// Sem Document PiP: leva só o vídeo do bloco em foco (ou o primeiro com vídeo)
function videoPipFallback() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
    return;
  }
  const tile = dom.tiles.querySelector('.tile.is-focused:not([data-video="off"])')
    || dom.tiles.querySelector('.tile:not([hidden]):not([data-video="off"])');
  tile?.querySelector('video')?.requestPictureInPicture?.().catch(() => {});
}

// Abre sozinho: o Chrome chama esse handler quando a aba vai pro fundo
// durante uma chamada (o "PiP automático" de videochamada). Onde não existe,
// não faz nada.
export function initPopout() {
  try {
    navigator.mediaSession?.setActionHandler('enterpictureinpicture', () => openPopout());
  } catch (e) {
    // navegador não conhece essa ação
  }
  document.getElementById('stage-dock-btn').onclick = closePopout;
}
