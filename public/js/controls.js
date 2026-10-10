// Controles de mídia: mic, câmera, tela cheia, modo cinema, reações e toasts.
// O compartilhamento de tela mora em screen-share.js.

import { dom, state } from './state.js';
import { updateTile, renderParticipantsList, initialOf } from './participants.js';
import { screenPointToStage, requestLayout } from './layout.js';
import { t } from './i18n.js';

// Mic e câmera são independentes: ligar/desligar um nunca mexe no outro.
// Ligar pela primeira vez pede a permissão do navegador (o LiveKit publica a
// faixa nessa hora); depois disso, desligar só silencia/apaga a faixa.
// Se a permissão for negada, o botão continua desligado e um toast explica.

// clique repetido enquanto o navegador ainda pergunta a permissão: sem essa
// trava os dois cliques terminariam juntos e ligariam/desligariam na hora
const busy = { mic: false, cam: false };

async function setDevice(kind, enabled) {
  const lp = state.room?.localParticipant;
  if (!lp || busy[kind]) return false;
  busy[kind] = true;
  try {
    if (kind === 'mic') await lp.setMicrophoneEnabled(enabled);
    else await lp.setCameraEnabled(enabled);
    return true;
  } catch (e) {
    console.warn(`Sem acesso ao ${kind === 'mic' ? 'microfone' : 'câmera'}.`, e);
    if (enabled) showToast(t(kind === 'mic' ? 'alert.micDenied' : 'alert.camDenied'), { holdMs: 6000 });
    return false;
  } finally {
    busy[kind] = false;
  }
}

export async function toggleMic() {
  const next = !state.micEnabled;
  if (!(await setDevice('mic', next))) return;
  state.micEnabled = next;
  dom.micBtn.classList.toggle('off', !next);
  const local = state.participants.get('local');
  if (local) { local.mic = next; updateTile(local); }
  renderParticipantsList();
}

export async function toggleCamera() {
  // a tela é outra faixa, então a câmera funciona durante o compartilhamento
  const next = !state.camEnabled;
  if (!(await setDevice('cam', next))) return;
  state.camEnabled = next;
  dom.camBtn.classList.toggle('off', !next);
  const local = state.participants.get('local');
  if (local) { local.cam = next; updateTile(local); }
}

// tela cheia no palco (vídeo/tela compartilhada) — ESC já sai sozinho, é
// comportamento nativo do navegador, não precisa de botão extra pra isso.
export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    dom.stage.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}

// modo cinema: apaga as luzes ao redor do vídeo (igual "watch party" da
// Discord/Netflix Party) sem mexer em nenhuma chamada — é só CSS num
// atributo do <body>, então nem precisa avisar o outro lado.
export function toggleCinemaMode(force) {
  state.cinemaMode = typeof force === 'boolean' ? force : !state.cinemaMode;
  document.body.classList.toggle('cinema-mode', state.cinemaMode);
  requestLayout(); // no modo cinema a faixa de membros some
  dom.cinemaBtn?.classList.toggle('active', state.cinemaMode);
}

// `name` é opcional — se vier, mostra um selinho com a inicial de quem
// mandou por baixo do emoji (assim dá pra saber quem reagiu, igual
// reações em chamada do Discord que aparecem coladas no avatar de quem
// reagiu; aqui simplificamos pra um selo flutuante, já que nosso emoji
// sobe solto pela tela e não fica "grudado" em ninguém).
export function spawnReaction(emoji, name) {
  const wrap = document.createElement('span');
  wrap.className = 'reaction-emoji';
  wrap.style.left = `calc(${30 + Math.random() * 40}% - 16px)`;
  wrap.innerHTML = name
    ? `<span class="reaction-emoji-icon">${emoji}</span><span class="reaction-emoji-name">${escapeForAttr(name)}</span>`
    : emoji;
  dom.reactionsLayer.appendChild(wrap);
  wrap.addEventListener('animationend', () => wrap.remove());
}

function escapeForAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// apontador ao vivo: clique na tela compartilhada manda um "ping" visual
// pro outro lado, igual apontar numa videochamada de verdade. Reaproveita
// a mesma reactions-layer (fica por cima do palco), então já ganha o
// z-index e o "pointer-events: none" certos de graça.
// x/y chegam em % da tela compartilhada e são convertidos pra % do palco,
// porque a transmissão pode estar na faixa, com faixas pretas etc.
export function spawnPointerPing(xPercent, yPercent, name, sharerId) {
  const pos = screenPointToStage(xPercent, yPercent, sharerId);
  if (!pos) return; // transmissão escondida: não tem onde apontar
  const el = document.createElement('span');
  el.className = 'pointer-ping';
  el.style.left = `${pos.x}%`;
  el.style.top = `${pos.y}%`;
  if (name) {
    const label = document.createElement('span');
    label.className = 'pointer-ping-label';
    label.textContent = initialOf(name);
    el.appendChild(label);
  }
  dom.reactionsLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// toast discreto (entrada/saída de participante, erros de validação/mídia)
// — some sozinho, a animação de saída (toast-out, no CSS) que decide quando
// remover o elemento. `holdMs` deixa mensagens mais longas (ex: permissão de
// câmera negada) ficarem visíveis por mais tempo que o padrão de ~2.6s.
export function showToast(message, { holdMs } = {}) {
  if (!dom.toastLayer) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  if (holdMs) el.style.setProperty('--toast-hold', `${holdMs}ms`);
  dom.toastLayer.appendChild(el);
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') el.remove();
  });
}
