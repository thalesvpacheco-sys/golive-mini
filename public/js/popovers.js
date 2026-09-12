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

export function initPopovers() {
  renderQualityPicker();
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
