// Tema visual (roxo / branco / preto) — troca o [data-theme] no <html>, que
// é o que os tokens de cor em style.css (:root[data-theme="..."]) escutam.
// Sem atributo = roxo (o :root puro, sem override).
//
// O tema salvo já é aplicado por um script inline no <head> do index.html
// (antes de qualquer CSS pintar, pra não ter "flash" de roxo->tema salvo).
// Este módulo só cuida da troca em tempo real, pelo popover.

const STORAGE_KEY = 'golive-theme';
const VALID = ['purple', 'white', 'black'];

export function getTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(saved) ? saved : 'purple';
}

export function setTheme(theme) {
  if (!VALID.includes(theme)) return;
  if (theme === 'purple') {
    document.documentElement.removeAttribute('data-theme'); // roxo = default, sem atributo
  } else {
    document.documentElement.dataset.theme = theme;
  }
  localStorage.setItem(STORAGE_KEY, theme);
}
