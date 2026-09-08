// Idioma automático: detecta o país por IP (ela é americana, então quem
// acessa de fora do Brasil já recebe a interface em inglês, sem precisar
// mexer em nada). Guardamos a escolha no localStorage pra não bater na API
// de geolocalização toda vez que a página carrega, e pra não "piscar" de
// idioma numa reconexão.
//
// Fallback em cascata se a API de geo falhar (rede bloqueada, CORS, etc.):
// 1) navigator.language do navegador (pt-* => português, resto => inglês)
// 2) português (idioma "nativo" do app, já que a maioria dos acessos é do BR)

const STRINGS = {
  'status.disconnected': { pt: 'Não conectado', en: 'Not connected' },
  'status.requestingMedia': { pt: 'Pedindo acesso à câmera/mic...', en: 'Requesting camera/mic access...' },
  'status.reconnecting': { pt: 'Reconectando...', en: 'Reconnecting...' },
  'status.lost': { pt: 'Conexão perdida — recarregue a página', en: 'Connection lost — reload the page' },
  'status.connected': { pt: 'Conectado (sala: {room})', en: 'Connected (room: {room})' },
  'status.connectionLost': { pt: 'Conexão perdida, tentando reconectar...', en: 'Connection lost, trying to reconnect...' },

  'aria.participants': { pt: 'Ver participantes', en: 'View participants' },
  'aria.closeParticipants': { pt: 'Fechar participantes', en: 'Close participants' },

  'share.button': { pt: 'Compartilhar sala', en: 'Share room' },
  'share.copied': { pt: 'Link copiado!', en: 'Link copied!' },
  'share.manualCopy': { pt: 'Copia manual: {url}', en: 'Copy manually: {url}' },

  'join.tagline': { pt: 'Compartilhem a tela e assistam juntos, mesmo longe.', en: 'Share your screen and watch together, even far apart.' },
  'join.nameLabel': { pt: 'Seu nome', en: 'Your name' },
  'join.namePlaceholder': { pt: 'Como você aparece na sala', en: 'How you appear in the room' },
  'join.roomLabel': { pt: 'Sala', en: 'Room' },
  'join.roomPlaceholder': { pt: 'ID da sala (combinem um)', en: 'Room ID (agree on one together)' },
  'join.button': { pt: 'Entrar', en: 'Join' },
  'join.loading': { pt: 'Entrando...', en: 'Joining...' },

  'action.shareScreen': { pt: 'Compartilhar tela', en: 'Share screen' },
  'action.enableCam': { pt: 'Ativar câmera', en: 'Turn on camera' },
  'action.fullscreen': { pt: 'Tela cheia', en: 'Fullscreen' },
  'action.leave': { pt: 'Sair', en: 'Leave' },

  'mic.title': { pt: 'Mic', en: 'Mic' },
  'mic.aria': { pt: 'Ligar/desligar microfone', en: 'Turn microphone on/off' },
  'cam.title': { pt: 'Câmera', en: 'Camera' },
  'cam.aria': { pt: 'Ligar/desligar câmera', en: 'Turn camera on/off' },
  'cinema.title': { pt: 'Modo cinema (C)', en: 'Cinema mode (C)' },
  'cinema.aria': { pt: 'Modo cinema', en: 'Cinema mode' },
  'reaction.title': { pt: 'Reação', en: 'Reaction' },
  'reaction.aria': { pt: 'Abrir reações', en: 'Open reactions' },

  'panel.title': { pt: 'Participantes', en: 'Participants' },

  'quality.title': { pt: 'Qualidade da transmissão', en: 'Streaming quality' },
  'quality.high': { pt: 'Alta (60fps)', en: 'High (60fps)' },
  'quality.standard': { pt: 'Padrão (30fps)', en: 'Standard (30fps)' },
  'quality.note': { pt: 'Vale a partir da próxima vez que compartilhar a tela.', en: 'Applies the next time you share your screen.' },

  'toast.joined': { pt: '{name} entrou na sala', en: '{name} joined the room' },
  'toast.left': { pt: '{name} saiu da sala', en: '{name} left the room' },

  'alert.noRoom': { pt: 'Digita um ID de sala, mano.', en: 'Type in a room ID first.' },
  'alert.invalidRoom': { pt: 'ID de sala inválido. Use só letras, números, "-" ou "_" (até 40 caracteres).', en: 'Invalid room ID. Use only letters, numbers, "-" or "_" (up to 40 characters).' },
  'alert.mediaDenied': { pt: 'Não consegui acessar câmera/microfone. Verifica se você deu permissão pro navegador (ícone de cadeado na barra de endereço) e tenta de novo.', en: "Couldn't access your camera/microphone. Check that you granted permission in the browser (padlock icon in the address bar) and try again." },
  'alert.joinErrorDefault': { pt: 'Não foi possível entrar na sala.', en: 'Could not join the room.' },
};

// mensagens que só existem no servidor (validação de sala) — casamos pelo
// texto original em pt, já que o servidor não sabe (nem precisa saber) de
// idioma.
const SERVER_MESSAGES = {
  'Sala ou peerId inválido.': { en: 'Invalid room or peer id.' },
};

export let lang = localStorage.getItem('golive-lang') || 'pt';

export function t(key, params) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let str = entry[lang] || entry.pt;
  if (params) {
    for (const [k, v] of Object.entries(params)) str = str.replace(`{${k}}`, v);
  }
  return str;
}

export function translateServerMessage(message) {
  if (lang === 'pt') return message;
  for (const [pt, tr] of Object.entries(SERVER_MESSAGES)) {
    if (message === pt || message.startsWith(pt.split('(')[0].trim())) return tr.en;
  }
  // mensagem dinâmica tipo "Sala cheia (máx. N pessoas)." — trata à parte
  const cheia = message.match(/Sala cheia \(máx\. (\d+) pessoas\)\./);
  if (cheia) return `Room is full (max. ${cheia[1]} people).`;
  return message;
}

// aplica o idioma detectado em todo texto estático marcado com data-i18n /
// data-i18n-placeholder / data-i18n-title / data-i18n-aria no HTML.
export function applyStaticI18n() {
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}

async function detectLang() {
  const saved = localStorage.getItem('golive-lang');
  if (saved) { lang = saved; return; }
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    lang = data.country_code === 'BR' ? 'pt' : 'en';
  } catch (e) {
    console.warn('Não deu pra detectar país por IP, usando idioma do navegador.', e);
    lang = navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  }
  localStorage.setItem('golive-lang', lang);
}

// roda a detecção uma vez e devolve uma Promise — quem importar este módulo
// espera ela resolver antes de aplicar as traduções, pra não desenhar a tela
// em português e trocar pra inglês um instante depois.
export const ready = detectLang().then(applyStaticI18n);
