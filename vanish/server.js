// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
// Add this line to handle JSON data in POST requests
app.use(express.json()); 

app.use(express.static('public')); // Existing line


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
      turn: 1, // 1 for P1 (Black), 2 for P2 (White)
      turnDeadline: Date.now() + 30000, // Exactly 30 seconds from now
      timerInterval: null
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

      // FIX: Use roomCode here, not matchId!
      startMatchTimer(roomCode); 
      
      pool.query(
        'INSERT INTO matches (id, host_username, guest_username, rule_set, vanish_ms, board_size) VALUES ($1, $2, $3, $4, $5, $6)',
        [roomCode, match.host.username, match.guest.username, match.ruleMode, match.vanishMs, match.size]
      ).catch(err => console.error(err));
    } else {
      socket.emit('error', 'Room not found or full');
    }
  });

  // --- 3. GAMEPLAY LOOP ---

  socket.on('submit_move', async ({ matchId, r, c }) => {
      const match = activeMatches.get(matchId);
      if (!match) return;

      const playerRole = (match.host.socketId === socket.id) ? 1 : 2;
      const idx = r * match.size + c;

      if (match.turn !== playerRole || match.state[idx] !== 0) return;

      match.state[idx] = playerRole; // Update board
      
      // 1. Authoritative Win Check
      const hasWon = checkServerWin(match.state, match.size, 5, r, c, playerRole);

      if (hasWon) {
          const winner = playerRole === 1 ? match.host : match.guest;
          const loser = playerRole === 1 ? match.guest : match.host;

          // Trigger Glicko-2 Logic
          const ratingData = await finalizeMatchRatings(winner.appleId, loser.appleId, match.vanishMs);

          io.to(matchId).emit('match_over', {
              winnerRole: playerRole,
              newRating: ratingData ? Math.round(ratingData.winnerRating) : null,
              pointsGained: ratingData ? ratingData.winnerGain : 0
          });

          if (match.timerInterval) clearInterval(match.timerInterval);
          activeMatches.delete(matchId);
          return; // Stop processing further move logic
      }

      // 2. Otherwise, continue turn rotation as normal
      match.turn = playerRole === 1 ? 2 : 1;
      match.turnDeadline = Date.now() + 30000;
      io.to(matchId).emit('move_made', { r, c, player: playerRole, turnDeadline: match.turnDeadline });
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
    state: new Array(size * size).fill(0), turn: 1, 
    turnDeadline: Date.now() + 30000, // Exactly 30 seconds from now
    timerInterval: null
  };
  activeMatches.set(matchId, match);

  
  io.sockets.sockets.get(p1.socketId).join(matchId);
  io.sockets.sockets.get(p2.socketId).join(matchId);

  io.to(p1.socketId).emit('match_start', { role: 1, matchId, settings: match });
  io.to(p2.socketId).emit('match_start', { role: 2, matchId, settings: match });
  startMatchTimer(matchId);
}

function startMatchTimer(matchId) {
  const match = activeMatches.get(matchId);
  if (!match) return;

  // Clear any existing interval just in case
  if (match.timerInterval) clearInterval(match.timerInterval);

  match.timerInterval = setInterval(() => {
    const currentMatch = activeMatches.get(matchId);
    
    // If match was deleted by a move or disconnect, kill this timer
    if (!currentMatch) {
      clearInterval(match.timerInterval);
      return;
    }

    if (Date.now() >= currentMatch.turnDeadline) {
      const loserRole = currentMatch.turn;
      const winnerRole = loserRole === 1 ? 2 : 1;

      // Identify players
      const winner = (winnerRole === 1) ? currentMatch.host : currentMatch.guest;
      const loser = (loserRole === 1) ? currentMatch.host : currentMatch.guest;

      io.to(matchId).emit('timeout_loss', { loserRole, winnerRole });

      // Update Glicko-2 ratings in DB
      if (winner.appleId && loser.appleId) {
          // We wrap this in an async IIFE or handle the promise to avoid blocking the interval
          (async () => {
              const ratingData = await finalizeMatchRatings(winner.appleId, loser.appleId, currentMatch.vanishMs);
              
              if (ratingData) {
                  io.to(matchId).emit('match_over', {
                      winnerRole,
                      newRating: Math.round(ratingData.winnerRating),
                      pointsGained: ratingData.winnerGain
                  });
              }
          })();
      }

      clearInterval(currentMatch.timerInterval);
      activeMatches.delete(matchId);
    }
  }, 500); 
}

// server.js: Authoritative Win Checker
function checkServerWin(state, size, goal, r, c, player) {
  const directions = [
    { dr: 0, dc: 1 },  // Horizontal
    { dr: 1, dc: 0 },  // Vertical
    { dr: 1, dc: 1 },  // Diagonal \
    { dr: 1, dc: -1 }, // Diagonal /
  ];

  for (const { dr, dc } of directions) {
    let count = 1;
    // Check forward
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && state[rr * size + cc] === player) {
      count++; rr += dr; cc += dc;
    }
    // Check backward
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && state[rr * size + cc] === player) {
      count++; rr -= dr; cc -= dc;
    }

    if (count >= goal) return true;
  }
  return false;
}

async function finalizeMatchRatings(winnerAppleId, loserAppleId, vanishMs) {
    // Map the vanish setting to your specific column
    let ratingCol = 'rating_15_standard';
    if (vanishMs === 3000) ratingCol = 'rating_15_3s';
    if (vanishMs === 10000) ratingCol = 'rating_15_10s';

    try {
        const winner = (await pool.query('SELECT * FROM users WHERE apple_id = $1', [winnerAppleId])).rows[0];
        const loser = (await pool.query('SELECT * FROM users WHERE apple_id = $1', [loserAppleId])).rows[0];

        if (!winner || !loser) return;

        // Calculate changes (simplified Glicko-2 step)
        const K = 32;
        const expectedW = 1 / (1 + Math.pow(10, (loser[ratingCol] - winner[ratingCol]) / 400));
        const gain = Math.round(K * (1 - expectedW));

        // Update the specific rating column in the DB
        await pool.query(`
            UPDATE users SET 
            ${ratingCol} = ${ratingCol} + $1, 
            rd = GREATEST(30, rd * 0.95), 
            wins = wins + 1 
            WHERE apple_id = $2`, [gain, winnerAppleId]);
            
        await pool.query(`
            UPDATE users SET 
            ${ratingCol} = ${ratingCol} - $1, 
            losses = losses + 1 
            WHERE apple_id = $2`, [gain, loserAppleId]);
    } catch (err) {
        console.error("Glicko Update Error:", err);
    }
}

// Glicko-2 Helper: Update ratings in the DB
async function processMatchResult(winnerId, loserId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch current ratings
        const winner = (await client.query('SELECT * FROM users WHERE apple_id = $1', [winnerId])).rows[0];
        const loser = (await client.query('SELECT * FROM users WHERE apple_id = $1', [loserId])).rows[0];

        if (!winner || !loser) throw new Error("Player not found");

        // 2. Calculate Elo/Glicko Change (Simplified for example)
        const K = 32; 
        const expectedW = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
        const ratingChange = Math.round(K * (1 - expectedW));

        // 3. Update Database
        await client.query('UPDATE users SET rating = rating + $1, wins = wins + 1 WHERE apple_id = $2', [ratingChange, winnerId]);
        await client.query('UPDATE users SET rating = rating - $1, losses = losses + 1 WHERE apple_id = $2', [ratingChange, loserId]);

        await client.query('COMMIT');
        return { ratingChange, newWinnerRating: winner.rating + ratingChange };
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Glicko Update Failed", e);
    } finally {
        client.release();
    }
}

// GET /leaderboard - Fetch the masters of Vanish
app.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT username, rating, wins, losses 
            FROM users 
            ORDER BY rating DESC 
            LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Leaderboard fetch error", err);
        res.status(500).json({ error: "Failed to load rankings" });
    }
});

app.post('/auth/gamecenter', async (req, res) => {
  const { playerId, displayName } = req.body; // main.js sends playerId
  try {
    let result = await pool.query('SELECT * FROM users WHERE apple_id = $1', [playerId]);
    // ... rest of your insertion logic
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Auth error", err);
    res.status(500).send("Server Error");
  }
});

server.listen(3000, () => console.log('Vanish Server running on port 3000'));