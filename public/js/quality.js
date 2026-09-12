// Qualidade da transmissão de tela: dois presets simples em vez de expor
// um monte de configuração técnica (resolução, bitrate...) que ninguém
// além de nós dois vai mexer. "Alta" mira 1080p/60fps (melhor pra
// filme/série com movimento rápido), "Padrão" mira 720p/30fps (mais leve
// se a internet de alguém estiver ruim naquele dia). Fica salvo no
// navegador de cada um — cada lado escolhe o seu.

const KEY = 'golive-quality';

// maxBitrate é o TETO que a gente impõe ao encoder (ver applyBitrateCap em
// controls.js) — não é constraint de mídia, é parâmetro do RTCRtpSender.
// Sem teto, o navegador tenta empurrar o preset mesmo quando o upload não
// aguenta; o congestionamento vira buffer, e buffer é exatamente o que se
// sente como "atraso de segundos". Os valores são folgados pra qualidade
// pretendida, mas cortam a faixa onde o encoder só estaria se afogando.
export const PRESETS = {
  high: {
    frameRate: { ideal: 60, max: 60 },
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    maxBitrate: 6_000_000, // ~6 Mbps
  },
  standard: {
    frameRate: { ideal: 30, max: 30 },
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    maxBitrate: 2_000_000, // ~2 Mbps
  },
};

export function getQuality() {
  const saved = localStorage.getItem(KEY);
  return saved === 'standard' ? 'standard' : 'high'; // padrão é qualidade alta
}

export function setQuality(preset) {
  localStorage.setItem(KEY, preset);
}

// maxBitrate fica de fora de propósito: getDisplayMedia/getUserMedia esperam
// MediaTrackConstraints, e bitrate não é uma delas — vai por outro caminho.
export function videoConstraints() {
  const { maxBitrate, ...constraints } = PRESETS[getQuality()];
  return constraints;
}

export function bitrateFor(preset) {
  return PRESETS[preset]?.maxBitrate;
}
