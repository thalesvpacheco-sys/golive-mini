// Compartilhamento de tela numa conexão PRÓPRIA, separada da câmera e do mic.
//
// Antes a tela substituía a câmera dentro da mesma conexão, e o som dela era
// misturado com a voz. Isso impedia duas coisas: o outro lado controlar o
// volume da voz e o da transmissão separadamente (misturado não tem como
// separar de novo), e mostrar câmera e tela ao mesmo tempo. Com uma segunda
// conexão só pra tela — como o Discord faz — as duas coisas saem de graça.
//
// Quem compartilha liga pra cada pessoa com metadata { kind: 'screen' }; quem
// recebe atende sem enviar mídia nenhuma de volta. A conexão só existe
// enquanto a tela está no ar.

import { state } from './state.js';
import { setSharingScreen, attachScreenStream } from './participants.js';
import { videoConstraints, bitrateFor, getQuality } from './quality.js';
import { showToast } from './controls.js';
import { t } from './i18n.js';

const incoming = {}; // peerId -> MediaConnection da tela que ESTOU recebendo

export async function toggleScreenShare() {
  if (state.isScreenSharing) {
    stopScreenShare();
    return;
  }

  let stream;
  try {
    // Filtros de voz desligados: em música e filme eles cortam grave e fazem
    // o volume "respirar". systemAudio:'include' deixa o Chrome oferecer o som
    // da tela inteira no Windows, não só o de uma aba.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(),
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
    });
  } catch (e) {
    return; // cancelou o seletor
  }

  state.screenStream = stream;
  state.isScreenSharing = true;
  stream.getVideoTracks()[0].onended = () => stopScreenShare(); // botão nativo "Parar de compartilhar"

  attachScreenStream('local', stream);
  setSharingScreen('local', true);
  state.socket.emit('screen-share', { sharing: true });
  state.participants.forEach((p, peerId) => {
    if (!p.isLocal) callWithScreen(peerId);
  });

  // Sem track de áudio = escolheu uma JANELA (o Chrome não captura som de
  // janela) ou desmarcou a opção no seletor. Avisa em vez de deixar o outro
  // lado achando que o som quebrou.
  if (!stream.getAudioTracks().length) showToast(t('share.noAudio'), { holdMs: 7000 });
}

export function stopScreenShare() {
  if (!state.isScreenSharing) return;
  Object.values(state.screenCalls).forEach((call) => {
    try { call.close(); } catch (e) {}
  });
  state.screenCalls = {};
  state.screenStream?.getTracks().forEach((track) => track.stop());
  state.screenStream = null;
  state.isScreenSharing = false;
  attachScreenStream('local', null);
  setSharingScreen('local', false);
  state.socket?.emit('screen-share', { sharing: false });
}

// Também chamado quando alguém entra no meio de uma transmissão (room.js).
export function callWithScreen(peerId) {
  if (!state.screenStream || state.screenCalls[peerId] || !state.peer) return;
  const call = state.peer.call(peerId, state.screenStream, {
    metadata: { kind: 'screen' },
    sdpTransform: musicFriendlySdp,
  });
  state.screenCalls[peerId] = call;

  // Antes da negociação terminar, alguns navegadores ainda não expõem as
  // encodings do sender e o teto de bitrate não pega. Tenta já, e de novo
  // quando a conexão abrir.
  applyBitrateCapTo(call);
  const pc = call.peerConnection;
  pc?.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') applyBitrateCapTo(call);
  });

  call.on('close', () => {
    if (state.screenCalls[peerId] === call) delete state.screenCalls[peerId];
  });
}

export function receiveScreenCall(call) {
  const peerId = call.peer;
  closeIncoming(peerId); // nova transmissão da mesma pessoa substitui a anterior
  incoming[peerId] = call;
  call.answer(undefined, { sdpTransform: musicFriendlySdp });
  call.on('stream', (stream) => attachScreenStream(peerId, stream));
  call.on('close', () => {
    if (incoming[peerId] !== call) return;
    delete incoming[peerId];
    attachScreenStream(peerId, null);
  });
}

function closeIncoming(peerId) {
  const call = incoming[peerId];
  if (!call) return;
  delete incoming[peerId];
  try { call.close(); } catch (e) {}
}

// A pessoa parou de transmitir ou saiu da sala: encerra as conexões de tela
// com ela nos dois sentidos, sem esperar o ICE perceber sozinho (demora).
export function closeScreenCallsWith(peerId) {
  closeIncoming(peerId);
  const outgoing = state.screenCalls[peerId];
  if (outgoing) {
    delete state.screenCalls[peerId];
    try { outgoing.close(); } catch (e) {}
  }
  attachScreenStream(peerId, null);
}

export function resetScreenShare() {
  stopScreenShare();
  Object.keys(incoming).forEach(closeIncoming);
}

// ---------- qualidade / teto de bitrate ----------

function videoSenderOf(call) {
  return call.peerConnection?.getSenders().find((sender) => sender.track?.kind === 'video');
}

// Sem teto, o encoder insiste no preset mesmo quando o upload não aguenta — e
// em malha o upload é multiplicado por pessoa na sala. O congestionamento
// vira buffer, que é o "atraso de segundos" do outro lado. Só a tela leva
// teto: a câmera consome pouco e segue livre.
function applyBitrateCapTo(call) {
  const maxBitrate = bitrateFor(getQuality());
  const sender = videoSenderOf(call);
  if (!sender || !maxBitrate) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) return; // reaplicado quando a conexão abrir
  params.encodings[0].maxBitrate = maxBitrate;
  sender.setParameters(params).catch(() => {});
}

export function applyBitrateCap() {
  Object.values(state.screenCalls).forEach(applyBitrateCapTo);
}

// Troca de preset NO MEIO de uma transmissão: aplica resolução/fps na hora via
// applyConstraints, em vez de esperar o próximo compartilhamento.
export function applyQualityNow() {
  const track = state.screenStream?.getVideoTracks()[0];
  if (!track) return;
  track.applyConstraints(videoConstraints()).catch(() => {});
  applyBitrateCap();
}

// Opus no WebRTC vem afinado pra voz: mono e ~32 kbps. Música e filme soam
// abafados assim. Estéreo + teto de 128 kbps no SDP resolve; precisa estar no
// offer E no answer, por isso vai nas duas pontas da conexão de tela.
export function musicFriendlySdp(sdp) {
  const opus = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!opus) return sdp;
  const fmtp = new RegExp(`a=fmtp:${opus[1]} ([^\\r\\n]*)`);
  return sdp.replace(fmtp, (line, params) => {
    const present = new Set(params.split(';').map((p) => p.split('=')[0].trim()));
    const extra = [['stereo', '1'], ['sprop-stereo', '1'], ['maxaveragebitrate', '128000']]
      .filter(([key]) => !present.has(key))
      .map(([key, value]) => `${key}=${value}`);
    return extra.length ? `${line};${extra.join(';')}` : line;
  });
}
