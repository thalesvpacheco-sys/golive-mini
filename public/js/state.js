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
  echoBanner: document.getElementById('echo-banner'),
  stageEmpty: document.getElementById('stage-empty'),
  stageBubbles: document.getElementById('stage-bubbles'),
  stageMain: document.getElementById('stage-main'),
  cameraBubbles: document.getElementById('camera-bubbles'),
  reactionsLayer: document.getElementById('reactions-layer'),
  micBtn: document.getElementById('mic-btn'),
  camBtn: document.getElementById('cam-btn'),
  screenBtn: document.getElementById('screen-btn'),
  reactionBtn: document.getElementById('reaction-btn'),
  reactionPicker: document.getElementById('reaction-picker'),
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
  myName: '',
  roomId: '',
};
