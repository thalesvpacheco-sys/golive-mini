// Detecta quem está falando DE VERDADE (não só "mic ligado") analisando o
// volume de cada stream de áudio em tempo real, via Web Audio API.
//
// Conceito rápido: um AnalyserNode "escuta" um MediaStream e devolve os
// valores da onda de áudio (getByteTimeDomainData). A gente calcula o RMS
// (raiz da média dos quadrados — a forma padrão de medir "volume médio" de
// um trecho de áudio) e compara com um limiar. Se passar do limiar, a
// pessoa está falando. Um "hold" de alguns milissegundos evita que o anel
// fique piscando entre uma palavra e outra.
//
// Importante: quando o track de áudio está com `enabled = false` (mic
// mutado, ver controls.js), o navegador entrega só silêncio pra esse track
// — então uma pessoa com o mic desligado nunca vai aparecer como "falando"
// aqui, de graça, sem precisar checar isso manualmente.

let audioCtx = null;
const meters = new Map(); // peerId -> { source, analyser, raf }

const SPEAKING_THRESHOLD = 0.05; // pode precisar de ajuste fino conforme o microfone
const HOLD_MS = 250;

function ensureContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function startLevelMeter(peerId, stream, onChange) {
  stopLevelMeter(peerId);
  if (!stream || stream.getAudioTracks().length === 0) return;

  let ctx;
  try {
    ctx = ensureContext();
  } catch (e) {
    console.warn('Web Audio API indisponível, indicador de "quem tá falando" desativado.', e);
    return;
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let lastSpeakingAt = 0;
  let isSpeaking = false;
  const meter = { source, analyser, raf: null };

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);

    const now = performance.now();
    if (rms > SPEAKING_THRESHOLD) lastSpeakingAt = now;
    const speaking = now - lastSpeakingAt < HOLD_MS;

    if (speaking !== isSpeaking) {
      isSpeaking = speaking;
      onChange(speaking);
    }
    meter.raf = requestAnimationFrame(tick);
  }

  meters.set(peerId, meter);
  tick();
}

export function stopLevelMeter(peerId) {
  const meter = meters.get(peerId);
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  try { meter.source.disconnect(); } catch (e) {}
  try { meter.analyser.disconnect(); } catch (e) {}
  meters.delete(peerId);
}

export function stopAllLevelMeters() {
  [...meters.keys()].forEach(stopLevelMeter);
}
