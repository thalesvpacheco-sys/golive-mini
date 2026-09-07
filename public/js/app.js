// Ponto de entrada: liga os botões de controle e inicializa a sala.
// Carregado como <script type="module"> no index.html.

import { dom, state } from './state.js';
import { toggleMic, toggleCamera, toggleScreenShare, spawnReaction } from './controls.js';
import { initRoom } from './room.js';

document.getElementById('stage-screen-btn').onclick = () => toggleScreenShare();
document.getElementById('stage-cam-btn').onclick = () => toggleCamera();
dom.screenBtn.onclick = () => toggleScreenShare();
dom.camBtn.onclick = () => toggleCamera();
dom.micBtn.onclick = () => toggleMic();
document.getElementById('echo-dismiss').onclick = () => dom.echoBanner.hidden = true;

dom.reactionBtn.onclick = () => { dom.reactionPicker.hidden = !dom.reactionPicker.hidden; };
dom.reactionPicker.querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    const emoji = b.dataset.emoji;
    dom.reactionPicker.hidden = true;
    spawnReaction(emoji);
    state.socket.emit('reaction', { emoji });
  };
});

initRoom();
