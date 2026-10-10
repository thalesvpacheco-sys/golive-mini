// Mede a conexão de verdade: RTT, perda de pacote relatada pelo servidor do
// LiveKit, e a resolução/fps que está realmente saindo (não a que o preset
// pediu). Sem isso não dava pra saber se um "atraso" é a rede de quem
// assiste, a nossa, ou nem é rede. Sem números ainda (ninguém com mic, câmera
// ou tela ligados), usa a qualidade de conexão que o próprio LiveKit calcula.
//
// Também degrada sozinho: se a rede estiver ruim por tempo suficiente
// (não no primeiro soluço) ENQUANTO alguém compartilha tela em "Alta", cai
// pra "Padrão" uma vez e avisa por toast. A alternativa é o que acontecia
// antes — o navegador engasga em silêncio e a pessoa só percebe quando já
// está insuportável.

import { state } from './state.js';
import { getQuality, setQuality } from './quality.js';
import { showToast } from './controls.js';
import { applyQualityNow } from './screen-share.js';
import { t } from './i18n.js';

const { Track, ConnectionQuality } = window.LivekitClient;

const SAMPLE_MS = 2500;
const POOR_SAMPLES_TO_DEGRADE = 3; // ~7,5s ruins seguidos, não um pico isolado
const RTT_POOR_MS = 350;
const RTT_GOOD_MS = 150;
const LOSS_POOR = 0.05; // 5%
const LOSS_GOOD = 0.01; // 1%

let timer = null;
let sampling = false; // getStats() é async; se uma amostra demorar mais que o
                      // intervalo, a próxima não pode entrar por cima dela
let poorStreak = 0;
let autoDowngraded = false;
const subscribers = new Set();
const prev = new Map(); // track sid -> { bytes, lost, sent, at } pra calcular por delta

const latest = {
  rttMs: null,
  lossRatio: null,
  sendKbps: null,
  width: null,
  height: null,
  fps: null,
  tier: 'unknown', // good | fair | poor | unknown
};

function blank() {
  return { rttMs: null, lossRatio: null, sendKbps: null, width: null, height: null, fps: null, tier: 'unknown' };
}

export function getNetworkStats() {
  return { ...latest };
}

// Devolve uma função pra cancelar a inscrição. Quem só quer olhar enquanto
// um painel está aberto (ver popovers.js) chama isso na abertura e cancela
// no fechamento, em vez de manter um timer próprio rodando à toa.
export function onNetworkSample(callback) {
  subscribers.add(callback);
  callback(getNetworkStats());
  return () => subscribers.delete(callback);
}

export function startNetworkMonitor() {
  stopNetworkMonitor();
  timer = setInterval(sample, SAMPLE_MS);
}

export function stopNetworkMonitor() {
  clearInterval(timer);
  timer = null;
  poorStreak = 0;
  autoDowngraded = false;
  prev.clear();
  Object.assign(latest, blank());
}

async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    await collect();
  } finally {
    sampling = false;
  }
}

// tela por último na prioridade: se estou transmitindo, a resolução que
// interessa mostrar é a da tela, não a da câmera
function measuredTracks() {
  const lp = state.room?.localParticipant;
  if (!lp) return {};
  const track = (source) => {
    const pub = lp.getTrackPublication(source);
    return pub && !pub.isMuted ? pub.track : null;
  };
  return {
    lp,
    video: (state.isScreenSharing && track(Track.Source.ScreenShare)) || track(Track.Source.Camera),
    audio: track(Track.Source.Microphone),
  };
}

// perda = pacotes perdidos / enviados desde a amostra anterior
function deltaFor(sid, bytes, lost, sent) {
  const now = performance.now();
  const before = prev.get(sid);
  prev.set(sid, { bytes, lost, sent, at: now });
  if (!before) return {};
  const out = {};
  if (bytes >= before.bytes && now > before.at) out.kbps = Math.round(((bytes - before.bytes) * 8) / (now - before.at));
  if (typeof lost === 'number' && sent > before.sent) {
    out.loss = Math.min(1, Math.max(0, (lost - before.lost) / (sent - before.sent)));
  }
  return out;
}

async function collect() {
  const { lp, video, audio } = measuredTracks();
  if (!lp) {
    Object.assign(latest, blank());
    notify();
    return;
  }

  let rtt = null;
  let loss = null;

  if (video) {
    const layers = await video.getSenderStats().catch(() => []);
    if (layers.length) {
      // simulcast: várias camadas da mesma câmera; a maior é a que importa
      const top = layers.reduce((a, b) => ((b.frameWidth || 0) > (a.frameWidth || 0) ? b : a));
      latest.width = top.frameWidth ?? null;
      latest.height = top.frameHeight ?? null;
      latest.fps = top.framesPerSecond != null ? Math.round(top.framesPerSecond) : null;
      const sum = (key) => layers.reduce((acc, l) => acc + (l[key] || 0), 0);
      const d = deltaFor(video.sid, sum('bytesSent'), layers.some((l) => typeof l.packetsLost === 'number') ? sum('packetsLost') : undefined, sum('packetsSent'));
      latest.sendKbps = d.kbps ?? latest.sendKbps;
      loss = d.loss ?? null;
      rtt = layers.find((l) => typeof l.roundTripTime === 'number')?.roundTripTime ?? null;
    }
  } else {
    latest.width = latest.height = latest.fps = latest.sendKbps = null;
  }

  if (audio && (rtt == null || loss == null)) {
    const s = await audio.getSenderStats().catch(() => undefined);
    if (s) {
      rtt ??= typeof s.roundTripTime === 'number' ? s.roundTripTime : null;
      const d = deltaFor(audio.sid, s.bytesSent || 0, s.packetsLost, s.packetsSent || 0);
      loss ??= d.loss ?? null;
    }
  }

  latest.rttMs = rtt != null ? Math.round(rtt * 1000) : null;
  latest.lossRatio = loss;
  latest.tier = classify(latest.rttMs, latest.lossRatio);
  if (latest.tier === 'unknown') latest.tier = fromConnectionQuality(lp.connectionQuality);
  maybeAutoDegrade(latest.tier);
  notify();
}

function fromConnectionQuality(quality) {
  if (quality === ConnectionQuality.Excellent) return 'good';
  if (quality === ConnectionQuality.Good) return 'fair';
  if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) return 'poor';
  return 'unknown';
}

function classify(rttMs, lossRatio) {
  if (rttMs == null && lossRatio == null) return 'unknown';
  if ((rttMs != null && rttMs > RTT_POOR_MS) || (lossRatio != null && lossRatio > LOSS_POOR)) return 'poor';
  const rttOk = rttMs == null || rttMs < RTT_GOOD_MS;
  const lossOk = lossRatio == null || lossRatio < LOSS_GOOD;
  return rttOk && lossOk ? 'good' : 'fair';
}

// Só faz sentido degradar durante compartilhamento de tela: é o único lugar
// onde o preset existe, e é de longe o que mais consome upload. Degrada uma
// vez por transmissão (autoDowngraded) — ficar oscilando entre os presets
// seria pior que ficar no ruim.
function maybeAutoDegrade(tier) {
  if (!state.isScreenSharing || getQuality() !== 'high' || autoDowngraded) {
    poorStreak = 0;
    return;
  }

  poorStreak = tier === 'poor' ? poorStreak + 1 : 0;
  if (poorStreak < POOR_SAMPLES_TO_DEGRADE) return;

  autoDowngraded = true;
  setQuality('standard');
  applyQualityNow();
  showToast(t('quality.autoDowngraded'), { holdMs: 6000 });
}

function notify() {
  const snapshot = getNetworkStats();
  subscribers.forEach((cb) => cb(snapshot));
}
