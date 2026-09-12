// Estado dos painéis laterais (pessoas e chat) num lugar só.
//
// O ponto principal: o JS daqui NÃO sabe se um painel aberto vira uma coluna
// do bento (desktop) ou uma gaveta por cima do vídeo (celular). Ele só liga e
// desliga `data-people` / `data-chat` no #app — quem traduz isso em layout é
// o CSS. Sem isso, cada lugar que abre/fecha painel precisaria checar largura
// de tela na mão, e as duas fontes de verdade iam divergir na primeira vez que
// alguém girasse o celular.

import { dom } from './state.js';

const DESKTOP = '(min-width: 1081px)';

function isDesktop() {
  return window.matchMedia(DESKTOP).matches;
}

export function isPanelOpen(name) {
  return dom.appEl.dataset[name] === 'open';
}

export function setPanel(name, open) {
  dom.appEl.dataset[name] = open ? 'open' : 'closed';
}

export function togglePanel(name) {
  const opening = !isPanelOpen(name);
  setPanel(name, opening);
  // No celular os dois painéis ocupam exatamente o mesmo espaço (gaveta na
  // direita), então abrir um precisa fechar o outro. No bento do desktop eles
  // são colunas separadas e convivem sem problema.
  if (opening && !isDesktop()) {
    setPanel(name === 'chat' ? 'people' : 'chat', false);
  }
}

export function closePanels() {
  setPanel('people', false);
  setPanel('chat', false);
}

// Estado inicial (e o de volta pra tela de entrada, ver leaveRoom): no desktop
// o bento nasce com as duas colunas abertas, porque elas fazem parte do
// layout; no celular nascem fechadas, senão a gaveta cobriria a chamada
// inteira assim que alguém entra na sala.
export function resetPanels() {
  const open = isDesktop();
  setPanel('people', open);
  setPanel('chat', open);
}
