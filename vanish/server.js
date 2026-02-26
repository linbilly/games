// server.js
const express = require('express');
const http = require('http');
const cors = require('cors'); // 1. Import cors



require('dotenv').config();

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

const corsOptions = {
    origin: [
        "https://playgomoku.bigwgames.com", // Live Web App
        "http://localhost:3000",            // Local Web Testing
        "capacitor://localhost",            // Native iOS App
        "http://localhost"                  // Native Android App
    ],
    methods: ["GET", "POST", "DELETE", "PUT"],
    credentials: true
};

app.use(cors(corsOptions));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "https://playgomoku.bigwgames.com", 
            "http://localhost:3000",
            "capacitor://localhost",
            "http://localhost"
        ],
        methods: ["GET", "POST"],
        credentials: true
    }
});

// In-memory game state for fast validation
const activeMatches = new Map();
const matchmakingQueue = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentUser = `Guest_${Math.floor(Math.random()*1000)}`; // Mock user auth

  // --- 1. GLOBAL MATCHMAKING (15x15 Only) ---

  //  Live Queue Polling for the UI
  socket.on('check_queue_count', ({ vanishMs, ruleMode }) => {
    // Count how many people are in the exact same settings bucket
    const count = matchmakingQueue.filter(p => p.vanishMs === vanishMs && p.ruleMode === ruleMode).length;
    socket.emit('queue_count_result', { count, vanishMs, ruleMode });
  });

  socket.on('find_global_match', ({ vanishMs, ruleMode, platformId }) => {
    const request = { socketId: socket.id, username: socket.username||"Guest", platformId, vanishMs, ruleMode };

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
      host: { socketId: socket.id, username: socket.username || "Guest" },
      guest: null,
      size, vanishMs, ruleMode,
      state: new Array(size * size).fill(0),
      turn: 1, // 1 for P1 (Black), 2 for P2 (White)
      turnDeadline: Date.now() + 30000, // Exactly 30 seconds from now
      timerInterval: null, 
      swap2Phase: ruleMode === 'swap2' ? 1 : 0,
      openingStones: []
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
    if (!match || match.isOver) return;

    const playerRole = (match.host.socketId === socket.id) ? 1 : 2;
    const idx = r * match.size + c;

    if (match.ruleMode === 'swap2' && (match.swap2Phase === 1 || match.swap2Phase === 3)) {
      if (match.state[idx] !== 0) return;
      match.openingStones = match.openingStones || [];
      
      if (match.swap2Phase === 1) {
          if (playerRole !== 1) return;
          const color = (match.openingStones.length === 1) ? 2 : 1; 
          
          // FIX: Pass 'false' for shouldSwitchTurn until the 3rd stone
          const isLastStone = (match.openingStones.length === 2);
          executeServerMove(match, r, c, color, matchId, isLastStone);
          
          match.openingStones.push({ r, c, color });
          
          if (match.openingStones.length === 3) {
              match.swap2Phase = 2;
              io.to(matchId).emit('swap2_choice_required', { phase: 2 });
          }
          return;
      }
      
      if (match.swap2Phase === 3) {
          if (playerRole !== 2) return;
          const color = (match.openingStones.length === 3) ? 2 : 1;
          
          // FIX: Pass 'false' for shouldSwitchTurn until the 5th stone
          const isLastStone = (match.openingStones.length === 4);
          executeServerMove(match, r, c, color, matchId, isLastStone);
          
          match.openingStones.push({ r, c, color });
          
          if (match.openingStones.length === 5) {
              match.swap2Phase = 4;
              io.to(matchId).emit('swap2_choice_required', { phase: 4 });
          }
          return;
      }
    }

    // --- NORMAL MOVE LOGIC ---
    if (match.turn !== playerRole || match.state[idx] !== 0) return;
    executeServerMove(match, r, c, playerRole, matchId);
});


// --- LIVE SESSION UPDATES ---
    socket.on('set_user_data', (data) => {
        // Update the server's memory for this specific socket
        socket.username = data.username;
        socket.platformId = data.platformId;
        console.log(`Socket ${socket.id} updated name to: ${data.username}`);
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




// A helper to handle forfeits cleanly
async function handleForfeit(socket, matchId) {
    const match = activeMatches.get(matchId);
    // Only forfeit if the match is actually "ongoing"
    if (!match || match.isOver) return; 

    const isHost = match.host.socketId === socket.id;
    const loser = isHost ? match.host : match.guest;
    const winner = isHost ? match.guest : match.host;

    if (!winner) return; // Case where guest hasn't joined yet

    console.log(`Forfeit in match ${matchId}: ${loser.username} left.`);
    match.isOver = true;
    
    if (match.timerInterval) {
        clearInterval(match.timerInterval);
        match.timerInterval = null;
    }

    // 1. Process Elo if it's a ranked match
    let ratings = null;
    if (winner.platformId && loser.platformId) {
        ratings = await finalizeMatchRatings(winner.platformId, loser.platformId, match.vanishMs);
    }

    // 2. Notify the winner they won by forfeit
    io.to(winner.socketId).emit('match_over', {
        winnerRole: isHost ? 2 : 1, // If Host quit, Guest (2) wins
        reason: 'opponent_forfeit',
        ratings: ratings
    });

    // 3. Cleanup
    activeMatches.delete(matchId);
}

// Updated Listeners
socket.on('leave_room', ({ matchId }) => {
    handleForfeit(socket, matchId); // Trigger the loss immediately
    const match = activeMatches.get(matchId);
    if (match) {
        // Notify the other player that the room is now closed
        socket.to(matchId).emit('opponent_left');
        
        // Stop any active server-side timers
        if (match.timerInterval) {
            clearInterval(match.timerInterval);
        }
        
        activeMatches.delete(matchId);
    }
    socket.leave(matchId);
});

socket.on('disconnect', () => {
    for (const [matchId, match] of activeMatches.entries()) {
        if (match.host.socketId === socket.id || (match.guest && match.guest.socketId === socket.id)) {
            // Option A: Instant Loss (strict)
            handleForfeit(socket, matchId);
            
            // Option B: The "Blink" logic we discussed (grace period)
            // For now, let's stick to Option A to satisfy your requirement
            break; 
        }
    }
});


socket.on('reconnect_to_match', ({ matchId, platformId }) => {
    const match = activeMatches.get(matchId);
    if (match && (match.host.platformId === platformId || match.guest?.platformId === platformId)) {
        const isHost = (match.host.platformId === platformId);
        
        // Update the active socket ID to the new one
        if (isHost) match.host.socketId = socket.id;
        else match.guest.socketId = socket.id;

        socket.join(matchId);
        io.to(matchId).emit('player_reconnected');

        // Send current state to the returning player
        socket.emit('sync_match_state', {
            state: match.state,
            turn: match.turn,
            turnDeadline: match.turnDeadline
        });
    }
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
        platformId: innocentPlayer.platformId, // <--- ADD THIS LINE
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

        match.meterPos = 0;

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


  socket.on('swap2_decision', ({ matchId, decision, role }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    if (decision === 'stay') {
        // Pass 'stay' here
        finalizeOnlineRoles(match, matchId, match.host, match.guest, 'stay');
    } else if (decision === 'swap') {
        const newHost = match.guest;
        const newGuest = match.host;
        // Pass 'swap' here
        finalizeOnlineRoles(match, matchId, newHost, newGuest, 'swap');
    } else if (decision === 'plus2') {
        match.swap2Phase = 3;
        io.to(matchId).emit('swap2_plus2_started');
    }
  });

  // --- SURRENDER LOGIC ---
    socket.on('surrender_match', async ({ matchId }) => {
        const match = activeMatches.get(matchId);
        if (!match || match.isOver) return;

        // Identify the winner (the player who DID NOT click surrender)
        const isHost = (match.host.socketId === socket.id);
        const winnerRole = isHost ? 2 : 1;

        console.log(`Match ${matchId}: ${socket.username} surrendered.`);

        // Reuse your existing win handler to process Elo and broadcast the result
        // We pass 'surrender' as an optional reason to customize the message
        handleServerWin(match, winnerRole, matchId, 'surrender');
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

    // --- EMOJI CHAT ---
    socket.on('send_emoji', ({ matchId, emoji, role }) => {
        // Broadcast the emoji to the opponent in the room
        socket.to(matchId).emit('receive_emoji', { emoji, role });
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


function executeServerMove(match, r, c, playerRole, matchId, shouldSwitchTurn = true) {
    const idx = r * match.size + c;
    match.state[idx] = playerRole;
    
    // Only flip the turn if we aren't in the middle of a multi-stone opening phase
    if (shouldSwitchTurn) {
        match.turn = playerRole === 1 ? 2 : 1;
    }
    
    match.turnDeadline = Date.now() + 30000;
    
    // FIX: Broadcast the ACTUAL next turn so the clients stay perfectly synced
    io.to(matchId).emit('move_made', { 
        r, c, 
        player: playerRole, 
        turnDeadline: match.turnDeadline,
        nextTurn: match.turn // <--- ADD THIS
    });
    
    if (!match.swap2Phase || match.swap2Phase === 0) {
        const hasWon = checkServerWin(match.state, match.size, 5, r, c, playerRole);
        if (hasWon) handleServerWin(match, playerRole, matchId);
    }
}


// Add the 'decision' parameter
function finalizeOnlineRoles(match, matchId, newHost, newGuest, decision) {
    match.host = newHost;
    match.guest = newGuest;
    match.swap2Phase = 0;
    match.turn = 2; // White always moves after opening is set
    match.turnDeadline = Date.now() + 30000;
    
    io.to(matchId).emit('roles_finalized', { 
        hostId: match.host.socketId, 
        guestId: match.guest.socketId,
        decision: decision // <--- Emit it to the clients
    });
}
  

function startOnlineMatch(p1, p2, size, vanishMs, ruleMode) {
  const matchId = require('crypto').randomUUID();
  const match = {
    id: matchId, host: p1, guest: p2, size, vanishMs, ruleMode,
    state: new Array(size * size).fill(0), turn: 1, 
    turnDeadline: Date.now() + 30000, // Exactly 30 seconds from now
    timerInterval: null, 
    swap2Phase: ruleMode === 'swap2' ? 1 : 0,
    openingStones: []
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
    if (!currentMatch || currentMatch.isOver) {
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
      if (winner.platformId && loser.platformId) {
          // We wrap this in an async IIFE or handle the promise to avoid blocking the interval
          (async () => {
              const ratingData = await finalizeMatchRatings(winner.platformId, loser.platformId, currentMatch.vanishMs);
              
              if (ratingData) {
                  io.to(matchId).emit('match_over', {
                      winnerRole,
                      ratings: ratingData // Send the whole object, let the client sort it out!
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

function handleServerWin(match, winningPlayerRole, matchId, reason = 'win') {
    match.isOver = true;
    if (match.timerInterval) clearInterval(match.timerInterval);

    const winner = winningPlayerRole === 1 ? match.host : match.guest;
    const loser = winningPlayerRole === 1 ? match.guest : match.host;

    if (winner.platformId && loser.platformId) {
        (async () => {
            const ratingData = await finalizeMatchRatings(winner.platformId, loser.platformId, match.vanishMs);
            io.to(matchId).emit('match_over', {
                winnerRole: winningPlayerRole,
                ratings: ratingData,
                reason: reason // Now includes 'surrender' if applicable
            });
        })();
    } else {
        io.to(matchId).emit('match_over', {
            winnerRole: winningPlayerRole,
            reason: reason
        });
    }
}

async function finalizeMatchRatings(winnerplatformId, loserplatformId, vanishMs) {
    if (!winnerplatformId || !loserplatformId) return null;

    // FIX 1: Unify all 15x15 games into the standard column so the Leaderboard works!
    let ratingCol = 'rating_15_standard'; 

    try {
        const winnerRes = await pool.query('SELECT * FROM users WHERE platform_id = $1', [winnerplatformId]);
        const loserRes = await pool.query('SELECT * FROM users WHERE platform_id = $1', [loserplatformId]);

        const winner = winnerRes.rows[0];
        const loser = loserRes.rows[0];

        if (!winner || !loser) return null;

        const K = 32;
        const expectedW = 1 / (1 + Math.pow(10, (loser[ratingCol] - winner[ratingCol]) / 400));
        const gain = Math.round(K * (1 - expectedW));

        await pool.query(`UPDATE users SET ${ratingCol} = ${ratingCol} + $1, rd = GREATEST(30, rd * 0.95), wins = wins + 1 WHERE platform_id = $2`, [gain, winnerplatformId]);
        await pool.query(`UPDATE users SET ${ratingCol} = ${ratingCol} - $1, losses = losses + 1 WHERE platform_id = $2`, [gain, loserplatformId]);

        // FIX 2: Return BOTH players' stats in an object
        return {
            winnerRating: winner[ratingCol] + gain,
            winnerGain: gain,
            loserRating: loser[ratingCol] - gain,
            loserGain: -gain // This creates the negative number for the loser
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
            SELECT username, rating_15_standard, wins, losses 
            FROM users 
            ORDER BY rating_15_standard DESC 
            LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Leaderboard fetch error", err);
        res.status(500).json({ error: "Failed to load rankings" });
    }
});

// GET /user/stats/:platformId - Fetch fresh stats for the profile page
app.get('/user/stats/:platformId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT rating_15_standard, wins, losses 
            FROM users 
            WHERE platform_id = $1
        `, [req.params.platformId]);
        
        // Return the stats, or an empty object if somehow not found
        res.json(result.rows[0] || {}); 
    } catch (err) {
        console.error("Stats fetch error", err);
        res.status(500).json({ error: "Failed to load stats" });
    }
});

// DELETE /user/:platformId - Wipe a user from the database
app.delete('/user/:platformId', async (req, res) => {
    try {
        const platformId = req.params.platformId;
        
        // Delete the user from the Supabase database
        // Note: If you have foreign keys in your 'matches' table, 
        // you might need 'ON DELETE CASCADE' set up in Supabase.
        const result = await pool.query('DELETE FROM users WHERE platform_id = $1', [platformId]);
        
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Account deleted successfully." });
        } else {
            res.status(404).json({ error: "User not found." });
        }
    } catch (err) {
        console.error("Account deletion error:", err);
        res.status(500).json({ error: "Failed to delete account." });
    }
});

// --- UPDATE USERNAME ---
app.put('/user/:platformId/name', async (req, res) => {
    const { platformId } = req.params;
    const { username } = req.body;

    // Basic validation to prevent blank names or massive strings
    if (!username || username.trim().length === 0 || username.length > 15) {
        return res.status(400).json({ error: "Invalid username length" });
    }

    try {
        await pool.query(
            'UPDATE users SET username = $1 WHERE platform_id = $2',
            [username.trim(), platformId]
        );
        res.json({ success: true, username: username.trim() });
    } catch (err) {
        console.error("Failed to update username:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/auth/provider', async (req, res) => {
  const { playerId, displayName, platform } = req.body; // 'apple' or 'android'
  try {
    let result = await pool.query('SELECT * FROM users WHERE platform_id = $1', [playerId]);
    
    if (result.rows.length === 0) {
      // New user registration
      result = await pool.query(
        'INSERT INTO users (platform_id, username, platform_type) VALUES ($1, $2, $3) RETURNING *',
        [playerId, displayName, platform]
      );
    }
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