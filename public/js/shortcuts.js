// Atalhos de teclado (M / F / C / G / H / Esc) — só valem DENTRO da sala, e nunca quando o foco está
// num campo de texto (não faz sentido "M" mutar enquanto alguém digita uma
// mensagem no chat).

import { dom } from './state.js';
import { toggleMic, toggleFullscreen, toggleCinemaMode } from './controls.js';
import { isPanelOpen, setPanel } from './panels.js';
import { toggleLayout, toggleStrip, exitFocus } from './layout.js';

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!dom.appEl.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'm' || e.key === 'M') {
      toggleMic();
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    } else if (e.key === 'c' || e.key === 'C') {
      toggleCinemaMode();
    } else if (e.key === 'g' || e.key === 'G') {
      toggleLayout();
    } else if (e.key === 'h' || e.key === 'H') {
      toggleStrip();
    } else if (e.key === 'Escape') {
      // os popovers de qualidade/tema fecham sozinhos no Escape (é
      // comportamento nativo do atributo popover), então aqui só sobram os
      // painéis — chat primeiro, que é o que costuma estar aberto por último —
      // e depois o foco do palco, que volta pra grade.
      if (isPanelOpen('chat')) setPanel('chat', false);
      else if (isPanelOpen('people')) setPanel('people', false);
      else exitFocus();
    }
  });
}
