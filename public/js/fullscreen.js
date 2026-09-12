// Tela cheia no palco: em fullscreen, a Fullscreen API do navegador só
// desenha o que está DENTRO do elemento que virou tela cheia — tudo que
// fica fora (ex: #control-bar, que no HTML é irmão de #stage, não filho)
// simplesmente some da tela. Por isso, ao entrar em fullscreen, movemos pra
// dentro de #stage tudo que precisa sobreviver (control-bar, os botões e
// painéis de participantes/chat, a camada de toasts) e devolvemos pro lugar
// original ao sair. Guardamos um comentário como "marcador" de onde cada
// coisa estava, já que mover um nó no DOM não duplica nada nem perde os
// onclick já configurados nele.

import { dom } from './state.js';

export function initFullscreen() {
  const controlBarAnchor = document.createComment('control-bar-anchor');
  dom.controlBar.after(controlBarAnchor);
  const participantsBtnAnchor = document.createComment('participants-btn-anchor');
  dom.participantsBtn.after(participantsBtnAnchor);
  const participantsPanelAnchor = document.createComment('participants-panel-anchor');
  dom.participantsPanel.after(participantsPanelAnchor);
  const chatBtnAnchor = document.createComment('chat-btn-anchor');
  dom.chatBtn.after(chatBtnAnchor);
  const chatPanelAnchor = document.createComment('chat-panel-anchor');
  dom.chatPanel.after(chatPanelAnchor);
  const toastLayerAnchor = document.createComment('toast-layer-anchor');
  dom.toastLayer.after(toastLayerAnchor);
  const leaveBtn = document.getElementById('leave-btn');

  let hideControlsTimer = null;
  function showStageControls() {
    dom.stage.classList.remove('controls-hidden');
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => dom.stage.classList.add('controls-hidden'), 2200);
  }

  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = document.fullscreenElement === dom.stage;
    dom.fullscreenBtn.classList.toggle('is-fullscreen', isFullscreen);
    dom.stage.classList.toggle('is-fullscreen', isFullscreen);
    if (isFullscreen) {
      dom.controlBar.insertBefore(dom.participantsBtn, leaveBtn);
      dom.controlBar.insertBefore(dom.chatBtn, leaveBtn);
      dom.stage.appendChild(dom.controlBar);
      dom.stage.appendChild(dom.participantsPanel);
      dom.stage.appendChild(dom.chatPanel);
      dom.stage.appendChild(dom.toastLayer);
      showStageControls();
    } else {
      participantsBtnAnchor.after(dom.participantsBtn);
      chatBtnAnchor.after(dom.chatBtn);
      controlBarAnchor.after(dom.controlBar);
      participantsPanelAnchor.after(dom.participantsPanel);
      chatPanelAnchor.after(dom.chatPanel);
      toastLayerAnchor.after(dom.toastLayer);
      clearTimeout(hideControlsTimer);
      dom.stage.classList.remove('controls-hidden');
    }
  });

  // estilo Discord: em tela cheia, os controles continuam acessíveis por
  // cima do vídeo, só ficam escondidos até o mouse se mexer.
  dom.stage.addEventListener('mousemove', () => {
    if (dom.stage.classList.contains('is-fullscreen')) showStageControls();
  });
}
