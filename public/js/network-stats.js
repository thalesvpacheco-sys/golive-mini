// Mede a conexão de verdade, via RTCPeerConnection.getStats(): RTT, perda de
// pacote relatada pelo OUTRO lado, e a resolução/fps que está realmente
// saindo (não a que o preset pediu). Sem isso não dava pra saber se um
// "atraso" é a rede de quem assiste, a nossa, ou nem é rede.
//
// Também degrada sozinho: se a rede estiver ruim por tempo suficiente
// (não no primeiro soluço) ENQUANTO alguém compartilha tela em "Alta", cai
// pra "Padrão" uma vez e avisa por toast. A alternativa é o que acontecia
// antes — o navegador engasga em silêncio e a pessoa só percebe quando já
// está insuportável.
//
// Por que a perda vem de 'remote-inbound-rtp': é o relatório que o outro
// lado manda de volta sobre o que NÓS enviamos. É a métrica certa pra
// "meu upload está atrapalhando a chamada", que é o gargalo do mesh.

import { state } from './state.js';
import { getQuality, setQuality } from './quality.js';
import { applyQualityNow, showToast } from './controls.js';
import { t } from './i18n.js';

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
const prevBytes = new Map(); // peerId -> { bytes, at } pra calcular kbps por delta

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
  prevBytes.clear();
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

async function collect() {
  const calls = Object.values(state.calls);
  if (!calls.length) {
    Object.assign(latest, blank());
    notify();
    return;
  }

  let rttSum = 0, rttCount = 0;
  let lossSum = 0, lossCount = 0;
  let outbound = null;
  let outboundPeerId = null;

  for (const call of calls) {
    const pc = call.peerConnection;
    if (!pc?.getStats) continue;

    let report;
    try {
      report = await pc.getStats();
    } catch (e) {
      continue; // conexão caindo no meio da coleta não é motivo pra derrubar a amostra toda
    }

    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
        rttSum += s.currentRoundTripTime * 1000;
        rttCount++;
      }
      if (s.type === 'remote-inbound-rtp' && s.kind === 'video' && typeof s.fractionLost === 'number') {
        lossSum += s.fractionLost;
        lossCount++;
      }
      if (s.type === 'outbound-rtp' && s.kind === 'video') {
        // resolução/fps são do MESMO encoder local pra todas as conexões,
        // então uma amostra qualquer já representa o que está saindo.
        outbound = s;
        outboundPeerId = call.peer;
      }
    });
  }

  if (rttCount) latest.rttMs = Math.round(rttSum / rttCount);
  latest.lossRatio = lossCount ? lossSum / lossCount : latest.lossRatio;

  if (outbound) {
    latest.width = outbound.frameWidth ?? latest.width;
    latest.height = outbound.frameHeight ?? latest.height;
    latest.fps = outbound.framesPerSecond != null ? Math.round(outbound.framesPerSecond) : latest.fps;

    const now = performance.now();
    const prev = prevBytes.get(outboundPeerId);
    if (prev && typeof outbound.bytesSent === 'number' && outbound.bytesSent >= prev.bytes) {
      const deltaMs = now - prev.at;
      if (deltaMs > 0) latest.sendKbps = Math.round(((outbound.bytesSent - prev.bytes) * 8) / deltaMs);
    }
    if (typeof outbound.bytesSent === 'number') {
      prevBytes.set(outboundPeerId, { bytes: outbound.bytesSent, at: now });
    }
  }

  latest.tier = classify(latest.rttMs, latest.lossRatio);
  maybeAutoDegrade(latest.tier);
  notify();
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
