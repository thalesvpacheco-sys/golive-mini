// Compartilhamento de tela: uma faixa própria no LiveKit, separada da câmera
// e do mic — dá pra mostrar câmera e tela ao mesmo tempo, e quem assiste
// controla o volume da voz e o da transmissão separadamente.

import { state } from './state.js';
import { setSharingScreen, attachScreen } from './participants.js';
import { PRESETS, getQuality, videoConstraints } from './quality.js';
import { showToast } from './controls.js';
import { t } from './i18n.js';

const { Track, AudioPresets } = window.LivekitClient;

let busy = false; // seletor de tela aberto: ignora cliques repetidos

function screenTrack() {
  return state.room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
}

export async function toggleScreenShare() {
  const lp = state.room?.localParticipant;
  if (!lp || busy) return;
  if (state.isScreenSharing) {
    stopScreenShare();
    return;
  }

  const preset = PRESETS[getQuality()];
  busy = true;
  try {
    await lp.setScreenShareEnabled(
      true,
      {
        // Filtros de voz desligados: em música e filme eles cortam grave e
        // fazem o volume "respirar". systemAudio:'include' deixa o Chrome
        // oferecer o som da tela inteira no Windows, não só o de uma aba.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        resolution: { width: preset.width.ideal, height: preset.height.ideal, frameRate: preset.frameRate.ideal },
        contentHint: 'motion',
      },
      {
        // Teto de bitrate: sem ele o encoder insiste no preset mesmo quando o
        // upload não aguenta, e o congestionamento vira atraso do outro lado.
        screenShareEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.frameRate.ideal },
        // Opus vem afinado pra voz (mono, ~32 kbps): filme e música soam
        // abafados. Estéreo a 128 kbps, sem os atalhos de voz (DTX/RED).
        audioPreset: AudioPresets.musicHighQualityStereo,
        forceStereo: true,
        dtx: false,
        red: false,
      },
    );
  } catch (e) {
    return; // cancelou o seletor
  } finally {
    busy = false;
  }

  const track = screenTrack();
  if (!track) return;
  state.isScreenSharing = true;
  attachScreen('local', 'video', track);
  setSharingScreen('local', true);

  // Sem faixa de áudio = escolheu uma JANELA (o Chrome não captura som de
  // janela) ou desmarcou a opção no seletor. Avisa em vez de deixar o outro
  // lado achando que o som quebrou.
  if (!lp.getTrackPublication(Track.Source.ScreenShareAudio)) showToast(t('share.noAudio'), { holdMs: 7000 });
}

export function stopScreenShare() {
  if (!state.isScreenSharing) return;
  state.room?.localParticipant.setScreenShareEnabled(false).catch(() => {});
  screenShareEnded();
}

// Também chamado por room.js quando a faixa sai sozinha (botão nativo
// "Parar de compartilhar" do navegador).
export function screenShareEnded() {
  if (!state.isScreenSharing) return;
  state.isScreenSharing = false;
  attachScreen('local', 'video', null);
  setSharingScreen('local', false);
}

export function resetScreenShare() {
  stopScreenShare();
}

// Troca de preset NO MEIO de uma transmissão: aplica resolução/fps na hora e
// o novo teto de bitrate direto no sender, sem republicar a tela.
export function applyQualityNow() {
  const track = screenTrack();
  if (!track) return;
  track.mediaStreamTrack.applyConstraints(videoConstraints()).catch(() => {});
  const sender = track.sender;
  const params = sender?.getParameters();
  if (!params?.encodings?.length) return;
  const preset = PRESETS[getQuality()];
  params.encodings.forEach((enc) => {
    enc.maxBitrate = preset.maxBitrate;
    enc.maxFramerate = preset.frameRate.ideal;
  });
  sender.setParameters(params).catch(() => {});
}
