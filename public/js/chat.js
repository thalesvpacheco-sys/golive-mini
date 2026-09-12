// Chat de texto da sala — bloco do bento (mesmo "corpo" visual do painel de
// participantes, ver .bento-panel em style.css). Mensagens só existem na
// memória da aba: sem histórico, sem persistência — combina com o resto do
// app, que é todo "efêmero" (a sala nem existe no servidor até alguém entrar).

import { dom } from './state.js';
import { escapeHtml } from './participants.js';

export function appendChatMessage({ name, text, own }) {
  if (!dom.chatMessages) return;
  const li = document.createElement('li');
  li.className = 'chat-msg' + (own ? ' own' : '');
  li.innerHTML = `
    ${own ? '' : `<span class="chat-author">${escapeHtml(name || '')}</span>`}
    <span class="chat-bubble">${escapeHtml(text)}</span>
  `;
  dom.chatMessages.appendChild(li);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

export function clearChat() {
  if (dom.chatMessages) dom.chatMessages.innerHTML = '';
}
