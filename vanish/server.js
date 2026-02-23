// server.js
const express = require('express');
const http = require('http');
const cors = require('cors'); // 1. Import cors

const { Server } = require('socket.io');
const { Pool } = require('pg');

// Initialize the Postgres Connection Pool
// It will automatically grab the DATABASE_URL variable you hid inside Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Supabase requires this to accept outside connections safely
    }
});

// Test the connection when the server boots up
pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.stack);
    } else {
        console.log('Successfully connected to Supabase PostgreSQL!');
    }
    if (client) release();
});

const app = express();
// Add this line to handle JSON data in POST requests
app.use(cors({ origin: '*' })); // Allow all origins for testing
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
  socket.on('find_global_match', ({ vanishMs, ruleMode, appleId }) => {
    const request = { socketId: socket.id, username: currentUser, appleId, vanishMs, ruleMode };

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

    // --- SWAP2 SERVER OVERRIDE ---
    if (match.ruleMode === 'swap2' && (!match.swap2Phase || match.swap2Phase > 0)) {
        match.openingStones = match.openingStones || [];
        
        // Phase 1: Host places first 3 stones
        if (match.openingStones.length < 3) {
            if (playerRole !== 1) return; // Only host can place first 3
            const color = (match.openingStones.length === 1) ? 2 : 1; 
            executeServerMove(match, r, c, color, matchId);
            match.openingStones.push({ r, c, color });
            
            if (match.openingStones.length === 3) {
                match.swap2Phase = 2; // Move to Guest Choice phase
                io.to(matchId).emit('swap2_choice_required', { phase: 2 });
            }
            return;
        }
        
        // Phase 3: Guest places 2 more stones
        if (match.swap2Phase === 3 && match.openingStones.length < 5) {
            if (playerRole !== 2) return; // Only guest can place these
            const color = (match.openingStones.length === 3) ? 2 : 1;
            executeServerMove(match, r, c, color, matchId);
            match.openingStones.push({ r, c, color });
            
            if (match.openingStones.length === 5) {
                match.swap2Phase = 4; // Move to Host Final Choice phase
                io.to(matchId).emit('swap2_choice_required', { phase: 4 });
            }
            return;
        }
    }

    // --- NORMAL MOVE LOGIC ---
    if (match.turn !== playerRole || match.state[idx] !== 0) return;
    executeServerMove(match, r, c, playerRole, matchId);
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

  // 4. MATCHMAKING CANCELLATIONS
  socket.on('cancel_search', () => {
    const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  });

  // --- DECLINE MATCH LOGIC ---
  socket.on('decline_match', ({ matchId }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    const declinerRole = match.host.socketId === socket.id ? 1 : 2;
    const innocentPlayer = declinerRole === 1 ? match.guest : match.host;

    if (match.timerInterval) clearInterval(match.timerInterval);
    activeMatches.delete(matchId);

    // Put the innocent player back in the queue
    matchmakingQueue.unshift({
        socketId: innocentPlayer.socketId, 
        username: innocentPlayer.username, 
        appleId: innocentPlayer.appleId, // <--- ADD THIS LINE
        vanishMs: match.vanishMs, 
        ruleMode: match.ruleMode 
    });

    // This line MUST be inside the decline_match block, right before the closing bracket!
    io.to(innocentPlayer.socketId).emit('matchmaking_status', 'Opponent declined. Resuming search...');
  }); // <-- CRUCIAL: decline_match closes right here!


  // --- REMATCH & DISCONNECT LOGIC ---
  // (These should be completely separate listeners, sitting right below decline_match)
  socket.on('request_rematch', ({ matchId }) => {
    console.log(`[REMATCH] Player ${socket.id} requesting rematch for room: ${matchId}`);
    
    const match = activeMatches.get(matchId);
    if (!match) {
        console.log(`[REMATCH FAILED] Room ${matchId} no longer exists on the server!`);
        return;
    }

    match.rematchRequests = match.rematchRequests || new Set();
    match.rematchRequests.add(socket.id);

    if (match.rematchRequests.size === 2) {
        console.log(`[REMATCH SUCCESS] Both players agreed. Restarting room ${matchId}`);
        match.state = new Array(match.size * match.size).fill(0);
        match.turn = 1;
        match.isOver = false;
        match.turnDeadline = Date.now() + 30000;
        match.rematchRequests.clear();

        // --- ADD THESE TWO LINES TO RESET SWAP2 ---
        match.swap2Phase = (match.ruleMode === 'swap2') ? 1 : 0;
        match.openingStones = [];

        // Swap roles
        const temp = match.host;
        match.host = match.guest;
        match.guest = temp;

        io.to(match.host.socketId).emit('match_start', { role: 1, matchId, settings: match });
        io.to(match.guest.socketId).emit('match_start', { role: 2, matchId, settings: match });
        startMatchTimer(matchId);
    } else {
        console.log(`[REMATCH WAITING] Telling the other player in ${matchId}...`);
        socket.to(matchId).emit('rematch_requested');
    }
  });

  socket.on('leave_room', ({ matchId }) => {
      socket.leave(matchId);
      socket.to(matchId).emit('opponent_left');
      activeMatches.delete(matchId);
  });

  socket.on('swap2_decision', ({ matchId, decision, role }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    if (decision === 'stay') {
        finalizeOnlineRoles(match, matchId, match.host, match.guest);
    } else if (decision === 'swap') {
        // Switch host and guest roles
        const newHost = match.guest;
        const newGuest = match.host;
        finalizeOnlineRoles(match, matchId, newHost, newGuest);
    } else if (decision === 'plus2') {
        match.swap2Phase = 3;
        io.to(matchId).emit('swap2_plus2_started');
    }
  });

  // --- DRAW LOGIC ---
    socket.on('offer_draw', ({ matchId }) => {
        const match = activeMatches.get(matchId);
        if (!match) return;

        // Find the opponent and send them the offer
        const opponent = (socket.id === match.host.socketId) ? match.guest : match.host;
        if (opponent) {
            io.to(opponent.socketId).emit('draw_offered');
        }
    });

    socket.on('draw_response', ({ matchId, accepted }) => {
        const match = activeMatches.get(matchId);
        if (!match) return;

        if (accepted) {
            match.isOver = true;
            // Tell BOTH players the draw was accepted
            io.to(match.host.socketId).emit('draw_accepted');
            if (match.guest) io.to(match.guest.socketId).emit('draw_accepted');
        } else {
            // Tell the person who offered that it was declined
            const opponent = (socket.id === match.host.socketId) ? match.guest : match.host;
            if (opponent) {
                io.to(opponent.socketId).emit('draw_declined');
            }
        }
    });

});


  // Helper to keep code clean
  function executeServerMove(match, r, c, playerRole, matchId) {
    const idx = r * match.size + c;
    match.state[idx] = playerRole;
    match.turn = playerRole === 1 ? 2 : 1;
    match.turnDeadline = Date.now() + 30000;
    io.to(matchId).emit('move_made', { r, c, player: playerRole, turnDeadline: match.turnDeadline });
    
    // Win check (only if not in opening phase)
    if (!match.swap2Phase || match.swap2Phase === 0) {
        const hasWon = checkServerWin(match.state, match.size, 5, r, c, playerRole);
        if (hasWon) handleServerWin(match, playerRole, matchId);
    }
  }


  function finalizeOnlineRoles(match, matchId, newHost, newGuest) {
    match.host = newHost;
    match.guest = newGuest;
    match.swap2Phase = 0;
    match.turn = 2; // White always moves after opening is set
    match.turnDeadline = Date.now() + 30000;
    
    io.to(matchId).emit('roles_finalized', { 
        hostId: match.host.socketId, 
        guestId: match.guest.socketId 
    });
}
  

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
          match.isOver = true; // It's a Private Room, keep it alive for a rematch!
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

function handleServerWin(match, winningPlayerRole, matchId) {
    // 1. Stop the game and clear timers
    match.isOver = true;
    if (match.timerInterval) clearInterval(match.timerInterval);

    // 2. Identify the winner and loser
    const loserRole = winningPlayerRole === 1 ? 2 : 1;
    const winner = winningPlayerRole === 1 ? match.host : match.guest;
    const loser = loserRole === 1 ? match.host : match.guest;

    // 3. Process Ratings if both players are authenticated (Apple ID exists)
    if (winner.appleId && loser.appleId) {
        (async () => {
            const ratingData = await finalizeMatchRatings(winner.appleId, loser.appleId, match.vanishMs);
            
            io.to(matchId).emit('match_over', {
                winnerRole: winningPlayerRole,
                newRating: ratingData ? Math.round(ratingData.winnerRating) : null,
                pointsGained: ratingData ? ratingData.winnerGain : null,
                reason: 'win'
            });
        })();
    } else {
        // Unranked/Guest match: Just broadcast the win without Elo changes
        io.to(matchId).emit('match_over', {
            winnerRole: winningPlayerRole,
            reason: 'win'
        });
    }
}

async function finalizeMatchRatings(winnerAppleId, loserAppleId, vanishMs) {
    // GUARD CLAUSE: Unranked/private match
    if (!winnerAppleId || !loserAppleId) return null;

    // Map the vanish setting to your specific column
    let ratingCol = 'rating_15_standard';
    if (vanishMs === 3000) ratingCol = 'rating_15_3s';
    if (vanishMs === 10000) ratingCol = 'rating_15_10s';

    try {
        const winnerRes = await pool.query('SELECT * FROM users WHERE apple_id = $1', [winnerAppleId]);
        const loserRes = await pool.query('SELECT * FROM users WHERE apple_id = $1', [loserAppleId]);

        const winner = winnerRes.rows[0];
        const loser = loserRes.rows[0];

        if (!winner || !loser) return null;

        // Calculate changes (Standard Elo)
        const K = 32;
        const expectedW = 1 / (1 + Math.pow(10, (loser[ratingCol] - winner[ratingCol]) / 400));
        const gain = Math.round(K * (1 - expectedW));

        // Update Winner
        await pool.query(`
            UPDATE users SET 
            ${ratingCol} = ${ratingCol} + $1, 
            rd = GREATEST(30, rd * 0.95), 
            wins = wins + 1 
            WHERE apple_id = $2`, [gain, winnerAppleId]
        );
            
        // Update Loser
        await pool.query(`
            UPDATE users SET 
            ${ratingCol} = ${ratingCol} - $1, 
            losses = losses + 1 
            WHERE apple_id = $2`, [gain, loserAppleId]
        );

        // CRITICAL: Return this data so the socket can send it to the frontend!
        return {
            winnerRating: winner[ratingCol] + gain,
            winnerGain: gain
        };

    } catch (err) {
        console.error("Rating Update Error:", err);
        return null;
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

// This tells the server to accept the port Railway assigns, or default to 3000
const PORT = process.env.PORT || 3000;

// The '0.0.0.0' explicitly tells the server to accept connections from the outside internet!
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanish server is live and listening on port ${PORT}`);
});