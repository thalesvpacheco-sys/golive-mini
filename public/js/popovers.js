// Popovers do topo: qualidade da transmissão e tema.
//
// Abrir, fechar, Escape, clique-fora, empilhamento e "fechar o outro quando
// este abre" são todos do atributo `popover` nativo (ver index.html) — não tem
// mais JS nenhum pra isso aqui. O que sobra é só o que é de fato deste app:
// aplicar a escolha e marcar qual opção está ativa.

import { dom } from './state.js';
import { getQuality, setQuality } from './quality.js';
import { getTheme, setTheme } from './theme.js';
import { applyQualityNow } from './controls.js';
import { onNetworkSample } from './network-stats.js';
import { t } from './i18n.js';

function renderQualityPicker() {
  const current = getQuality();
  dom.qualityPicker.querySelectorAll('button[data-quality]').forEach((b) => {
    b.classList.toggle('active', b.dataset.quality === current);
  });
}

function renderThemePicker() {
  const current = getTheme();
  dom.themePicker.querySelectorAll('button[data-theme-option]').forEach((b) => {
    b.classList.toggle('active', b.dataset.themeOption === current);
  });
}

// Linha de leitura da conexão: RTT, perda relatada pelo outro lado, e a
// resolução/fps que está REALMENTE saindo — que é o número que denuncia
// congestionamento (o preset pede 1080p60, sai 960x540@18).
function formatStats(s) {
  const parts = [];
  if (s.rttMs != null) parts.push(`RTT ${s.rttMs}ms`);
  if (s.lossRatio != null) parts.push(`${t('quality.statsLoss')} ${(s.lossRatio * 100).toFixed(1)}%`);
  if (s.width && s.height) parts.push(`${s.width}x${s.height}${s.fps ? '@' + s.fps : ''}`);
  if (s.sendKbps != null) parts.push(`${(s.sendKbps / 1000).toFixed(1)} Mbps`);
  return parts.length ? parts.join(' · ') : t('quality.statsEmpty');
}

// Ponto colorido no próprio botão: dá pra perceber que a rede piorou sem
// precisar abrir nada — e explica de antemão um eventual auto-degrade.
function updateQualityDot(tier) {
  if (!dom.qualityDot) return;
  dom.qualityDot.hidden = tier === 'unknown';
  dom.qualityDot.classList.toggle('fair', tier === 'fair');
  dom.qualityDot.classList.toggle('poor', tier === 'poor');
}

export function initPopovers() {
  renderQualityPicker();

  updateQualityDot('unknown');
  onNetworkSample((s) => updateQualityDot(s.tier));

  // só escuta as amostras enquanto o popover está aberto — 'toggle' é evento
  // nativo do atributo popover, então não precisa de timer próprio nem de
  // saber quando alguém clicou fora.
  let unsubscribe = null;
  dom.qualityPicker.addEventListener('toggle', (e) => {
    if (e.newState === 'open') {
      unsubscribe = onNetworkSample((s) => {
        if (dom.qualityStats) dom.qualityStats.textContent = formatStats(s);
      });
    } else {
      unsubscribe?.();
      unsubscribe = null;
    }
  });
  dom.qualityPicker.querySelectorAll('button[data-quality]').forEach((b) => {
    b.onclick = () => {
      setQuality(b.dataset.quality);
      renderQualityPicker();
      applyQualityNow();
      dom.qualityPicker.hidePopover();
    };
  });

  renderThemePicker();
  dom.themePicker.querySelectorAll('button[data-theme-option]').forEach((b) => {
    b.onclick = () => {
      setTheme(b.dataset.themeOption);
      renderThemePicker();
      dom.themePicker.hidePopover();
    };
  });
}

// Fecha os dois se estiverem abertos (usado ao sair da sala). hidePopover()
// num popover já fechado lança InvalidStateError, daí a checagem.
export function closePopovers() {
  [dom.qualityPicker, dom.themePicker].forEach((el) => {
    if (el?.matches(':popover-open')) el.hidePopover();
  });
}
