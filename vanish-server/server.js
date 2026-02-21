// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();

app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Database connection (Update password to your postgres password)
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'vanish_db',
  password: 'DoubleMajor', 
  port: 8001,
});

// In-memory game state for fast validation
const activeMatches = new Map();
const matchmakingQueue = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentUser = `Guest_${Math.floor(Math.random()*1000)}`; // Mock user auth

  // --- 1. GLOBAL MATCHMAKING (15x15 Only) ---
  socket.on('find_global_match', ({ vanishMs, ruleMode }) => {
    const request = { socketId: socket.id, username: currentUser, vanishMs, ruleMode };
    
    // Look for an exact match (simplified for MVP)
    const matchIndex = matchmakingQueue.findIndex(p => p.vanishMs === vanishMs && p.ruleMode === ruleMode);
    
    if (matchIndex !== -1) {
      const opponent = matchmakingQueue.splice(matchIndex, 1)[0];
      startOnlineMatch(opponent, request, 15, vanishMs, ruleMode);
    } else {
      matchmakingQueue.push(request);
      socket.emit('matchmaking_status', 'Waiting for opponent...');
    }
  });

  // --- 2. PRIVATE ROOMS ---
  socket.on('create_private_room', ({ size, vanishMs, ruleMode }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    activeMatches.set(roomCode, {
      id: roomCode,
      host: { socketId: socket.id, username: currentUser },
      guest: null,
      size, vanishMs, ruleMode,
      state: new Array(size * size).fill(0),
      turn: 1 // 1 for P1 (Black), 2 for P2 (White)
    });
    socket.join(roomCode);
    socket.emit('room_created', roomCode);
  });

  socket.on('join_private_room', (roomCode) => {
    const match = activeMatches.get(roomCode);
    if (match && !match.guest) {
      match.guest = { socketId: socket.id, username: currentUser };
      socket.join(roomCode);
      
      // Notify both players
      io.to(match.host.socketId).emit('match_start', { role: 1, matchId: roomCode, settings: match });
      io.to(match.guest.socketId).emit('match_start', { role: 2, matchId: roomCode, settings: match });
      
      // Persist to DB
      pool.query(
        'INSERT INTO matches (id, host_username, guest_username, rule_set, vanish_ms, board_size) VALUES ($1, $2, $3, $4, $5, $6)',
        [roomCode, match.host.username, match.guest.username, match.ruleMode, match.vanishMs, match.size]
      ).catch(err => console.error(err));
    } else {
      socket.emit('error', 'Room not found or full');
    }
  });

  // --- 3. GAMEPLAY LOOP ---
  socket.on('submit_move', ({ matchId, r, c }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    // Identify player role (1 or 2)
    const isHost = match.host.socketId === socket.id;
    const playerRole = isHost ? 1 : 2;

    // Validate turn and empty square
    const idx = r * match.size + c;
    if (match.turn !== playerRole || match.state[idx] !== 0) return;

    // Apply move
    match.state[idx] = playerRole;
    match.turn = playerRole === 1 ? 2 : 1;
    const placedAtUtc = Date.now(); // Absolute UTC time for Vanish syncing

    // Log to DB
    pool.query(
      'INSERT INTO moves (match_id, username, row_idx, col_idx, placed_at_utc) VALUES ($1, $2, $3, $4, $5)',
      [matchId, isHost ? match.host.username : match.guest.username, r, c, placedAtUtc]
    );

    // Broadcast valid move to both players
    io.to(matchId).emit('move_made', { r, c, player: playerRole, placedAtUtc });
  });

  // --- HANDLE MISTAKES ---
  socket.on('commit_mistake', ({ matchId }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;
    
    const isHost = match.host.socketId === socket.id;
    const playerRole = isHost ? 1 : 2;

    // Broadcast the mistake so BOTH clients trigger handleMistake()
    io.to(matchId).emit('mistake_broadcast', { player: playerRole });
  });

  // --- HANDLE TURN FORFEIT (3 MISTAKES) ---
  socket.on('forfeit_turn', ({ matchId }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    const isHost = match.host.socketId === socket.id;
    const playerRole = isHost ? 1 : 2;

    // Verify it was actually their turn
    if (match.turn === playerRole) {
      match.turn = playerRole === 1 ? 2 : 1; // Flip the turn
      
      // Tell BOTH players that the turn was skipped
      io.to(matchId).emit('turn_forfeited', { player: playerRole });
    }
  });

  // --- SYNCHRONIZED RESUME ---
  socket.on('resume_game', ({ matchId }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;
    
    // Tell both players to start the fade-out timer right NOW
    io.to(matchId).emit('game_resumed', { resumeTimeUtc: Date.now() });
  });

  socket.on('disconnect', () => {
    // Basic cleanup
    const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  });
});

function startOnlineMatch(p1, p2, size, vanishMs, ruleMode) {
  const matchId = require('crypto').randomUUID();
  const match = {
    id: matchId, host: p1, guest: p2, size, vanishMs, ruleMode,
    state: new Array(size * size).fill(0), turn: 1
  };
  activeMatches.set(matchId, match);
  
  io.sockets.sockets.get(p1.socketId).join(matchId);
  io.sockets.sockets.get(p2.socketId).join(matchId);

  io.to(p1.socketId).emit('match_start', { role: 1, matchId, settings: match });
  io.to(p2.socketId).emit('match_start', { role: 2, matchId, settings: match });
}

server.listen(3000, () => console.log('Vanish Server running on port 3000'));