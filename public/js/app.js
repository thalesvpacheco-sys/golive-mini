// Ponto de entrada: liga os botões de controle e inicializa a sala.
// Carregado como <script type="module"> no index.html.

import { dom, state } from './state.js';
import { toggleMic, toggleCamera, toggleScreenShare, toggleFullscreen, toggleCinemaMode, spawnPointerPing, applyQualityNow } from './controls.js';
import { initRoom } from './room.js';
import { ready as i18nReady } from './i18n.js';
import { getQuality, setQuality } from './quality.js';
import { mountAnimatedGradientBackground } from './gradient-bg.js';

mountAnimatedGradientBackground(dom.joinSection);

// mascote da tela inicial — o Lottie de verdade que veio junto com o
// componente pago (lottie-web é a MESMA engine que o DotLottieReact usa por
// baixo dos panos, só que sem precisar de React pra tocar). Path é a URL
// pública do lottie.host — a mesma que estava no demo.tsx original.
if (window.lottie) {
  window.lottie.loadAnimation({
    container: document.getElementById('join-mascot'),
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: 'https://lottie.host/8cf4ba71-e5fb-44f3-8134-178c4d389417/0CCsdcgNIP.json',
  });
} else {
  console.warn('lottie-web não carregou — mascote da tela inicial fica sem animação.');
}

document.getElementById('stage-screen-btn').onclick = () => toggleScreenShare();
document.getElementById('stage-cam-btn').onclick = () => toggleCamera();
dom.screenBtn.onclick = () => toggleScreenShare();
dom.camBtn.onclick = () => toggleCamera();
dom.micBtn.onclick = () => toggleMic();
dom.fullscreenBtn.onclick = () => toggleFullscreen();
dom.cinemaBtn.onclick = () => toggleCinemaMode();

// apontador ao vivo: clicar em cima do vídeo grande (a tela/câmera
// compartilhada) manda um "ping" visual pro outro lado, na posição exata
// do clique (em % da largura/altura, pra funcionar em qualquer resolução).
// Não vale clique em botão nenhum — só no próprio vídeo.
dom.stageMain.addEventListener('click', (e) => {
  if (dom.stageMain.hidden) return;
  const rect = dom.stageMain.getBoundingClientRect();
  const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
  const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
  spawnPointerPing(xPercent, yPercent, state.myName);
  state.socket.emit('pointer', { x: xPercent, y: yPercent });
});

// estilo Discord: em tela cheia, os controles (mic/câmera/compartilhar/sair)
// continuam acessíveis por cima do vídeo — só ficam escondidos até o mouse
// se mexer. A Fullscreen API do navegador só desenha o que está DENTRO do
// elemento que virou tela cheia; tudo que fica fora (e #control-bar, no HTML,
// é irmão de #stage, não filho) simplesmente some da tela. Por isso, ao
// entrar em fullscreen, movemos o #control-bar de verdade pra dentro de
// #stage (o CSS o transforma numa pílula flutuante nesse caso — ver
// style.css) e devolvemos ele pro lugar original ao sair. Guardamos um
// comentário como "marcador" de onde ele estava, já que mover um nó no DOM
// não duplica nada nem perde os onclick já configurados nele.
// mesma lógica vale pro botão de participantes (some do cabeçalho junto com
// tudo mais) e pro próprio painel de participantes (é um <aside> fixed, mas
// "fixed" não adianta se o elemento nem está sendo desenhado). Então na
// prática tudo que precisa sobreviver ao fullscreen entra dentro de #stage.
const controlBarAnchor = document.createComment('control-bar-anchor');
dom.controlBar.after(controlBarAnchor);
const participantsBtnAnchor = document.createComment('participants-btn-anchor');
dom.participantsBtn.after(participantsBtnAnchor);
const participantsPanelAnchor = document.createComment('participants-panel-anchor');
dom.participantsPanel.after(participantsPanelAnchor);
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
    dom.stage.appendChild(dom.controlBar);
    dom.stage.appendChild(dom.participantsPanel);
    dom.stage.appendChild(dom.toastLayer);
    showStageControls();
  } else {
    participantsBtnAnchor.after(dom.participantsBtn);
    controlBarAnchor.after(dom.controlBar);
    participantsPanelAnchor.after(dom.participantsPanel);
    toastLayerAnchor.after(dom.toastLayer);
    clearTimeout(hideControlsTimer);
    dom.stage.classList.remove('controls-hidden');
  }
});
dom.stage.addEventListener('mousemove', () => {
  if (dom.stage.classList.contains('is-fullscreen')) showStageControls();
});

dom.participantsBtn.onclick = () => { dom.participantsPanel.hidden = false; };
dom.participantsClose.onclick = () => { dom.participantsPanel.hidden = true; };

// popover de qualidade da transmissão (abre/fecha no clique do botão, marca
// a opção ativa com destaque visual) — agora mora no cartão do topo.
function renderQualityPicker() {
  const current = getQuality();
  dom.qualityPicker.querySelectorAll('button[data-quality]').forEach((b) => {
    b.classList.toggle('active', b.dataset.quality === current);
  });
}
renderQualityPicker();
dom.qualityBtn.onclick = () => { dom.qualityPicker.hidden = !dom.qualityPicker.hidden; };
dom.qualityPicker.querySelectorAll('button[data-quality]').forEach((b) => {
  b.onclick = () => {
    setQuality(b.dataset.quality);
    renderQualityPicker();
    applyQualityNow();
    dom.qualityPicker.hidden = true;
  };
});
// atalhos de teclado — só valem DENTRO da sala, e nunca quando o foco está
// num campo de texto (não faz sentido "M" mutar enquanto alguém digita o
// nome na tela inicial, por exemplo).
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
  } else if (e.key === 'Escape') {
    if (!dom.qualityPicker.hidden) dom.qualityPicker.hidden = true;
    else if (!dom.participantsPanel.hidden) dom.participantsPanel.hidden = true;
  }
});

// espera a detecção de idioma (IP -> pt/en) antes de "abrir a loja" — assim
// o status inicial, os textos do formulário de entrada etc já nascem no
// idioma certo, sem trocar debaixo do usuário um instante depois.
i18nReady.then(initRoom);
