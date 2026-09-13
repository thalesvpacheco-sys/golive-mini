// Som da tela compartilhada (aba do Chrome, ou tela inteira no Windows),
// misturado com o microfone num track só.
//
// Por que misturar em vez de mandar um segundo track: cada conexão já nasce
// com UM sender de áudio (o do mic), e o PeerJS não renegocia uma chamada em
// andamento — um track novo simplesmente não chegaria do outro lado. Já o
// replaceTrack no sender que existe funciona sem renegociar, então o que muda
// é o conteúdo dele: mic sozinho -> mic + tela -> mic sozinho.
//
// O mute continua funcionando sem mudança: toggleMic desliga o track original
// do mic, que passa a entrar no mixer como silêncio, e o som da tela segue.

import { state } from './state.js';

let mixer = null; // { ctx, track, screenTrack, nodes }

export function trackSenderOf(call, kind) {
  // pelo transceiver e não por sender.track: depois de um replaceTrack(null)
  // o sender fica sem track e sumiria de uma busca por `s.track.kind`.
  return call.peerConnection?.getTransceivers()
    .find((t) => t.receiver.track?.kind === kind)?.sender;
}

export function startScreenAudio(screenStream) {
  stopScreenAudio();
  const screenTrack = screenStream.getAudioTracks()[0];
  if (!screenTrack) return false;

  const ctx = new AudioContext();
  ctx.resume().catch(() => {});
  const dest = ctx.createMediaStreamDestination();
  const nodes = [];

  const screenSource = ctx.createMediaStreamSource(new MediaStream([screenTrack]));
  screenSource.connect(dest);
  nodes.push(screenSource);

  const micTrack = state.localStream?.getAudioTracks()[0];
  if (micTrack) {
    const micSource = ctx.createMediaStreamSource(new MediaStream([micTrack]));
    micSource.connect(dest);
    nodes.push(micSource);
  }

  mixer = { ctx, track: dest.stream.getAudioTracks()[0], screenTrack, nodes };
  Object.values(state.calls).forEach(sendScreenAudioTo);
  return true;
}

// Conexão que nasce no meio de um compartilhamento sai com o mic puro (é o
// que está no localStream); precisa receber a mistura também.
export function sendScreenAudioTo(call) {
  if (!mixer) return;
  trackSenderOf(call, 'audio')?.replaceTrack(mixer.track).catch(() => {});
}

export function stopScreenAudio() {
  if (!mixer) return;
  const micTrack = state.localStream?.getAudioTracks()[0] ?? null;
  Object.values(state.calls).forEach((call) => {
    trackSenderOf(call, 'audio')?.replaceTrack(micTrack).catch(() => {});
  });
  mixer.nodes.forEach((node) => node.disconnect());
  mixer.screenTrack.stop();
  mixer.track.stop();
  mixer.ctx.close().catch(() => {});
  mixer = null;
}

// Opus no WebRTC vem afinado pra voz: mono e ~32 kbps. Música e filme soam
// abafados assim. Ligar estéreo e subir o teto pra 128 kbps no SDP resolve,
// custa quase nada perto do vídeo, e precisa estar tanto no offer quanto no
// answer — por isso vai nas duas pontas (ver room.js).
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
