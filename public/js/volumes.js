// Volumes que você escolheu pra cada pessoa, lembrados entre sessões.
//
// Chaveado pelo NOME e não pelo peerId: o peerId muda a cada vez que alguém
// entra na sala, então preferência salva por id se perderia na chamada
// seguinte. É o mesmo comportamento do Discord, que lembra o volume de cada
// amigo sem precisar reajustar toda vez.

const KEY = 'golive-volumes';
const DEFAULTS = { volume: 1, streamVolume: 1, muted: false };

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {
    return {};
  }
}

export function loadVolumes(name) {
  return { ...DEFAULTS, ...(readAll()[name] || {}) };
}

export function saveVolumes({ name, volume, streamVolume, muted }) {
  const all = readAll();
  all[name] = { volume, streamVolume, muted };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    // aba anônima com storage cheio/bloqueado: o volume vale só pra esta sessão
  }
}
