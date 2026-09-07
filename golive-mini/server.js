const express = require('express');
const http = require('http');
const path = require('path');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// broker do WebRTC (troca as "cartas de endereco" dos peers)
const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

// quem esta em cada sala: { roomId: Set(peerId) }
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, peerId }) => {
    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = new Set();

    // avisa a quem ja esta na sala que chegou gente nova
    // (quem ja esta na sala que vai ligar pro novato -> monta o mesh sem duplicar chamada)
    socket.to(roomId).emit('user-joined', peerId);

    rooms[roomId].add(peerId);

    io.to(roomId).emit('room-size', rooms[roomId].size);
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
