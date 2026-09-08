// Qualidade da transmissão de tela: dois presets simples em vez de expor
// um monte de configuração técnica (resolução, bitrate...) que ninguém
// além de nós dois vai mexer. "Alta" mira 1080p/60fps (melhor pra
// filme/série com movimento rápido), "Padrão" mira 720p/30fps (mais leve
// se a internet de alguém estiver ruim naquele dia). Fica salvo no
// navegador de cada um — cada lado escolhe o seu.

const KEY = 'golive-quality';

export const PRESETS = {
  high: {
    frameRate: { ideal: 60, max: 60 },
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
  },
  standard: {
    frameRate: { ideal: 30, max: 30 },
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
  },
};

export function getQuality() {
  const saved = localStorage.getItem(KEY);
  return saved === 'standard' ? 'standard' : 'high'; // padrão é qualidade alta
}

export function setQuality(preset) {
  localStorage.setItem(KEY, preset);
}

export function videoConstraints() {
  return { ...PRESETS[getQuality()] };
}
