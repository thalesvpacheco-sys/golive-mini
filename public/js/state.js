// Estado global compartilhado entre os módulos + referências de DOM.
// Fica tudo num objeto só (`state`) pra não espalhar `let` soltos pelos arquivos.

export const dom = {
  joinSection: document.getElementById('join-section'),
  nameInput: document.getElementById('name-input'),
  roomInput: document.getElementById('room-input'),
  statusEl: document.getElementById('status'),
  onlineDot: document.getElementById('online-dot'),
  shareRoomBtn: document.getElementById('share-room-btn'),
  appEl: document.getElementById('app'),
  toastLayer: document.getElementById('toast-layer'),
  stage: document.getElementById('stage'),
  stageEmpty: document.getElementById('stage-empty'),
  stageBubbles: document.getElementById('stage-bubbles'),
  stageMain: document.getElementById('stage-main'),
  cameraBubbles: document.getElementById('camera-bubbles'),
  reactionsLayer: document.getElementById('reactions-layer'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  controlBar: document.getElementById('control-bar'),
  micBtn: document.getElementById('mic-btn'),
  camBtn: document.getElementById('cam-btn'),
  screenBtn: document.getElementById('screen-btn'),
  cinemaBtn: document.getElementById('cinema-btn'),
  qualityBtn: document.getElementById('quality-btn'),
  qualityPicker: document.getElementById('quality-picker'),
  themeBtn: document.getElementById('theme-btn'),
  themePicker: document.getElementById('theme-picker'),
  participantsBtn: document.getElementById('participants-btn'),
  participantsPanel: document.getElementById('participants-panel'),
  participantsClose: document.getElementById('participants-close'),
  participantsList: document.getElementById('participants-list'),
  participantsCount: document.getElementById('participants-count'),
};

export const state = {
  socket: null,
  peer: null,
  localStream: null,
  calls: {}, // peerId -> MediaConnection
  participants: new Map(), // peerId -> participant state
  leftPeers: new Set(), // peerIds que saíram de propósito (via 'user-left')
  nextColorIndex: 0,
  activeSharerId: null, // peerId no palco grande (null = ninguém)
  micEnabled: false,
  camEnabled: false,
  isScreenSharing: false,
  cinemaMode: false,
  myName: '',
  myColor: '',
  roomId: '',
};
