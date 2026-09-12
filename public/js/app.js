// Ponto de entrada: liga os botões de controle e inicializa a sala.
// Carregado como <script type="module"> no index.html.

import { dom, state } from './state.js';
import { toggleMic, toggleCamera, toggleScreenShare, toggleFullscreen, toggleCinemaMode, spawnPointerPing } from './controls.js';
import { initRoom } from './room.js';
import { ready as i18nReady } from './i18n.js';
import { appendChatMessage } from './chat.js';
import { mountAnimatedGradientBackground } from './gradient-bg.js';
import { initFullscreen } from './fullscreen.js';
import { initPopovers } from './popovers.js';
import { initShortcuts } from './shortcuts.js';
import { togglePanel, setPanel, isPanelOpen, resetPanels } from './panels.js';

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

initFullscreen();

resetPanels();

dom.participantsBtn.onclick = () => togglePanel('people');
dom.participantsClose.onclick = () => setPanel('people', false);

dom.chatBtn.onclick = () => {
  togglePanel('chat');
  if (isPanelOpen('chat')) {
    state.unreadChat = 0;
    dom.chatBadge.hidden = true;
    dom.chatInput.focus();
  }
};
dom.chatClose.onclick = () => setPanel('chat', false);
dom.chatForm.onsubmit = (e) => {
  e.preventDefault();
  const text = dom.chatInput.value.trim();
  if (!text) return;
  appendChatMessage({ text, own: true });
  state.socket.emit('chat-message', { text });
  dom.chatInput.value = '';
};

// cronômetro da chamada — atualiza a cada segundo a partir de
// state.callStartedAt (marcado em room.js quando o peer abre).
setInterval(() => {
  if (!state.callStartedAt) return;
  const totalSeconds = Math.floor((Date.now() - state.callStartedAt) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  dom.callTimer.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}, 1000);

initPopovers();
initShortcuts();

// espera a detecção de idioma (IP -> pt/en) antes de "abrir a loja" — assim
// o status inicial, os textos do formulário de entrada etc já nascem no
// idioma certo, sem trocar debaixo do usuário um instante depois.
i18nReady.then(initRoom);
