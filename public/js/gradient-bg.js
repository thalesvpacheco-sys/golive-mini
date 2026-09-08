// Port fiel do componente pago "Animated Gradient Background"
// (21st.dev/@hammamikhairi) pro nosso stack vanilla JS, sem React/framer-
// motion. O algoritmo é EXATAMENTE o mesmo — e olha que o componente
// original, por baixo do capô, já fazia isso em JS puro dentro de um
// useEffect: um valor `width` sobe e desce dentro de um range
// (breathingRange), a cada frame, e o radial-gradient é redesenhado com
// esse valor via requestAnimationFrame. framer-motion ali só cuidava da
// ENTRADA (fade + scale ao montar) — isso vira uma transição comum de CSS
// aqui (ver .agb-wrap/.agb-in em style.css). Ou seja: não é "inspirado
// em", é o mesmo mecanismo, linha a linha.
//
// Cores: em vez do arco-íris neon do demo genérico, usamos os tokens da
// nossa própria paleta (--bg, --purple, --pink) lidos do :root — assim o
// fundo já nasce dark + detalhe rosa, do jeito que você pediu, e continua
// sincronizado se a paleta mudar no futuro.
export function mountAnimatedGradientBackground(container, opts = {}) {
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const {
    startingGap = 125,
    breathing = true,
    gradientColors = [cssVar('--bg'), cssVar('--purple'), cssVar('--pink'), cssVar('--purple')],
    gradientStops = [30, 55, 80, 100],
    animationSpeed = 0.02,
    breathingRange = 6,
    topOffset = 0,
  } = opts;

  if (gradientColors.length !== gradientStops.length) {
    throw new Error(`gradientColors e gradientStops precisam ter o mesmo tamanho (${gradientColors.length} vs ${gradientStops.length}).`);
  }

  const wrap = document.createElement('div');
  wrap.className = 'agb-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('div');
  inner.className = 'agb-inner';
  wrap.appendChild(inner);
  container.prepend(wrap);

  // entrada (equivalente ao motion.div: opacity 0/scale 1.5 -> opacity 1/scale 1)
  // — dois rAF pra garantir que o navegador pinte o estado inicial antes de
  // disparar a transição (senão o CSS "funde" os dois estados num só frame).
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('agb-in')));

  let width = startingGap;
  let directionWidth = 1;
  let frameId;

  function animateGradient() {
    if (width >= startingGap + breathingRange) directionWidth = -1;
    if (width <= startingGap - breathingRange) directionWidth = 1;
    if (!breathing) directionWidth = 0;
    width += directionWidth * animationSpeed;

    const gradientStopsString = gradientStops
      .map((stop, index) => `${gradientColors[index]} ${stop}%`)
      .join(', ');
    inner.style.background = `radial-gradient(${width}% ${width + topOffset}% at 50% 20%, ${gradientStopsString})`;

    frameId = requestAnimationFrame(animateGradient);
  }
  frameId = requestAnimationFrame(animateGradient);

  // devolve uma função de limpeza (cancela o loop e remove o DOM) — útil se
  // um dia precisarmos desmontar isso (ex: trocar de tela).
  return () => { cancelAnimationFrame(frameId); wrap.remove(); };
}
