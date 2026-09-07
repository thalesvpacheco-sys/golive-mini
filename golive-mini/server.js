const express = require('express');
const http = require('http');
const path = require('path');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

// quem esta em cada sala: { roomId: Set(peerId) }
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, peerId, name }) => {
    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = new Set();

    socket.to(roomId).emit('user-joined', { peerId, name });

    rooms[roomId].add(peerId);
    io.to(roomId).emit('room-size', rooms[roomId].size);
  });

  // repassa avisos de estado (tela compartilhada, mic/cam ligado) pro resto da sala
  socket.on('screen-share', ({ sharing }) => {
    const { roomId, peerId } = socket.data || {};
    if (roomId) socket.to(roomId).emit('screen-share', { peerId, sharing });
  });

  socket.on('media-state', ({ kind, enabled }) => {
    const { roomId, peerId } = socket.data || {};
    if (roomId) socket.to(roomId).emit('media-state', { peerId, kind, enabled });
  });

  socket.on('reaction', ({ emoji }) => {
    const { roomId, peerId } = socket.data || {};
    if (roomId) socket.to(roomId).emit('reaction', { peerId, emoji });
  });

  socket.on('disconnect', () => {
    const { roomId, peerId } = socket.data || {};
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(peerId);
      socket.to(roomId).emit('user-left', peerId);
      io.to(roomId).emit('room-size', rooms[roomId].size);
      if (rooms[roomId].size === 0) delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GoLive Mini rodando em http://localhost:${PORT}`);
});