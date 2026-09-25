// Câmera e microfone só são pedidos quando a pessoa LIGA um deles — dá pra
// entrar na sala só pra assistir, sem permissão nenhuma e sem ter câmera.
//
// O porém: cada chamada nasce com os canais de áudio e vídeo que o stream
// tinha naquele momento, e o PeerJS não renegocia pra adicionar canal depois.
// Então a sala começa com faixas "vazias" (silêncio e um quadro preto)
// ocupando esses canais; ao ligar o mic ou a câmera, a faixa vazia é trocada
// pela real com replaceTrack, sem derrubar nenhuma chamada.

import { state } from './state.js';

// câmera em 16:9 e 720p: é o formato dos blocos do palco, e em foco ela
// ocupa o palco inteiro — o padrão do navegador (640×480, 4:3) fica borrado.
const CONSTRAINTS = {
  audio: true,
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 } },
};

const placeholders = new Set();
const pending = {}; // evita dois pedidos de permissão se clicar duas vezes
let silenceCtx = null;

export function createPlaceholderStream() {
  silenceCtx = new AudioContext();
  const audio = silenceCtx.createMediaStreamDestination().stream.getAudioTracks()[0];

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 9;
  canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
  const video = canvas.captureStream(1).getVideoTracks()[0];

  [audio, video].forEach((track) => {
    track.enabled = false;
    placeholders.add(track);
  });
  return new MediaStream([audio, video]);
}

// Devolve { track, fresh } — fresh=true quando acabou de trocar a faixa vazia
// pela real (quem chamou precisa atualizar a própria prévia). track=null se a
// permissão foi negada ou não existe o dispositivo.
export function acquireDevice(kind) {
  pending[kind] ??= acquire(kind).finally(() => delete pending[kind]);
  return pending[kind];
}

async function acquire(kind) {
  const current = kind === 'audio' ? state.localStream.getAudioTracks()[0] : state.localStream.getVideoTracks()[0];
  if (current && !placeholders.has(current)) return { track: current, fresh: false };

  let track;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ [kind]: CONSTRAINTS[kind] });
    track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  } catch (e) {
    console.warn(`Sem acesso ao ${kind === 'audio' ? 'microfone' : 'câmera'}.`, e);
    return { track: null, fresh: false };
  }
  if (!state.localStream) { // saiu da sala enquanto o navegador pedia permissão
    track.stop();
    return { track: null, fresh: false };
  }

  Object.values(state.calls).forEach((call) => {
    call.peerConnection?.getSenders()
      .find((sender) => sender.track === current)
      ?.replaceTrack(track).catch(() => {});
  });
  if (current) {
    state.localStream.removeTrack(current);
    placeholders.delete(current);
    current.stop();
  }
  state.localStream.addTrack(track);
  return { track, fresh: true };
}

export function releasePlaceholders() {
  placeholders.forEach((track) => track.stop());
  placeholders.clear();
  silenceCtx?.close().catch(() => {});
  silenceCtx = null;
}
