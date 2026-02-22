/* Vanish - full game
   - 3x3 connect 3 (tic tac toe)
   - 8x8 connect 5
   - 12x12 connect 5
   - Pieces visually vanish after N ms but remain in state
   - Mistake on occupied: reveal board briefly, lose turn
   - AI opponent for single player: Easy/Medium/Hard
*/


const socket = io('http://localhost:3000');
let isOnline = false;
let onlineMatchId = null;
let myOnlineRole = null; // 1 (Black) or 2 (White)
let currentAppleId = "mock_user_123"; // Update this dynamically during login

const $ = (id) => document.getElementById(id);

const boardEl = $("board");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayBody = $("overlayBody");
const overlayBtn = $("overlayBtn");



const turnPill = $("turnPill");
const goalPill = $("goalPill");
const modePill = $("modePill");

const mistakeMeterEl = $("mistakeMeter");


// ---------- Audio ----------
let audioCtx = null;
let audioEnabled = false;
let muted = false;

// --- TIMERS ---
let turnDeadline = 0;
let localTickInterval = null;

let opponentWantsRematch = false;

// --- MOBILE UI ROUTING & STATE ---
let currentMode = '';
let isWaitingForMatch = false;
let pendingMatchData = null;
let mmTimer5s, mmTimer20s;

let isRoomHost = false;
let leftSideRole = 1; // 1 = Black, 2 = White. Tracks the color of the Left Side UI.

function showGamePage() {
    $('landing-page').classList.add('hidden');
    $('game-page').classList.remove('hidden');
    resizeBoard(); 
}

function showLandingPage() {
    $('game-page').classList.add('hidden');
    $('landing-page').classList.remove('hidden');
    if (localTickInterval) clearInterval(localTickInterval);
}

// Dynamically scale the CSS Grid board to fit the screen
function resizeBoard() {
    const container = $('board-container');
    const board = $('board');
    if (!container || !board) return;

    const margin = 20; 
    const maxSize = Math.min(container.clientWidth, container.clientHeight) - margin;
    board.style.width = `${maxSize}px`;
    board.style.height = `${maxSize}px`;
}
window.addEventListener('resize', resizeBoard);

// --- MENU LOGIC ---
function selectMode(selectedMode) {
    currentMode = selectedMode;
    $('main-menu').classList.add('hidden');
    $('sub-menu').classList.remove('hidden');
    
    $('mode-title').innerText = selectedMode.replace('_', ' ').toUpperCase();
    
    const sizeSelect = $('board-size-select');
    const aiGroup = $('ai-level-group'); 
    const startBtn = $('start-btn');
    const joinBtn = $('join-btn');
    
    // Toggle AI dropdown visibility
    if (selectedMode === 'local_ai') {
        aiGroup.style.display = 'flex';
    } else {
        aiGroup.style.display = 'none';
    }

    // Lock board size for ladder
    if (selectedMode === 'online_ladder') {
        sizeSelect.value = "15";
        sizeSelect.disabled = true;
    } else {
        sizeSelect.disabled = false;
    }

    // Dynamic Private Room Buttons
    if (selectedMode === 'online_private') {
        startBtn.innerText = "Create a Room";
        joinBtn.classList.remove('hidden');
    } else {
        startBtn.innerText = "Start Match";
        joinBtn.classList.add('hidden');
    }
}

function backToMainMenu() {
    $('sub-menu').classList.add('hidden');
    $('main-menu').classList.remove('hidden');
}

function joinPrivateRoom() {
    const code = prompt("Enter 6-digit Room Code:");
    
    if (code && code.trim().length > 0) {
        // Switch to the game page and show a loading state
        showGamePage();
        showOverlay("Joining Room", `Connecting to room ${code.toUpperCase()}...`);
        
        // Remove the close action from the overlay so they can't dismiss it yet
        if ($('overlayBtn')) $('overlayBtn').classList.add('hidden'); 
        
        socket.emit('join_private_room', code.toUpperCase());
    }
}

function confirmStart() {
    // Read the dropdowns ONLY when clicking "Start Match"
    applySettingsFromUI();

    // 2. Route the mode
    if (currentMode.includes('local')) {
        mode = currentMode === 'local_ai' ? 'ai' : 'pvp';
        isOnline = false;
        showGamePage();
        newGame(); // Triggers your existing setup
    } else if (currentMode === 'online_private') {
        showGamePage();
        socket.emit('create_private_room', { size, vanishMs, ruleMode }); 
    } else if (currentMode === 'online_ladder') {
        startMatchmakingUI();
        socket.emit('find_global_match', { vanishMs, ruleMode, appleId: currentAppleId });
    }
}

// --- MATCHMAKING UI & BACKGROUND AI ---
function startMatchmakingUI() {
    $('matchmaking-text').innerText = "Searching for opponent...";
    $('matchmaking-spinner').classList.remove('hidden');
    $('matchmaking-actions').classList.add('hidden');
    $('matchmaking-cancel-initial').classList.remove('hidden');
    $('matchmaking-modal').classList.remove('hidden');

    mmTimer5s = setTimeout(() => { $('matchmaking-text').innerText = "Broadening search..."; }, 5000);
    mmTimer20s = setTimeout(() => {
        $('matchmaking-text').innerText = "No opponent found.";
        $('matchmaking-spinner').classList.add('hidden');
        $('matchmaking-cancel-initial').classList.add('hidden');
        $('matchmaking-actions').classList.remove('hidden'); // Shows the "Play AI" button
    }, 20000);
}

function cancelMatchmaking() {
    clearTimeout(mmTimer5s); clearTimeout(mmTimer20s);
    $('matchmaking-modal').classList.add('hidden');
    isWaitingForMatch = false;
    socket.emit('cancel_search');
}

function playAIWhileWaiting() {
    clearTimeout(mmTimer5s); clearTimeout(mmTimer20s);
    $('matchmaking-modal').classList.add('hidden');
    isWaitingForMatch = true; // Crucial: We are still in the server queue!
    
    mode = 'ai';
    isOnline = false;
    showGamePage();
    newGame();
}

// --- INTERCEPTING THE ONLINE MATCH ---
// Update your existing socket.on('match_start') to this:
socket.on('match_start', (data) => {
    clearTimeout(mmTimer5s); clearTimeout(mmTimer20s);
    
    if (isWaitingForMatch) {
        // Pause AI game, show prompt
        pendingMatchData = data;
        inputLocked = true; 
        $('match-found-modal').classList.remove('hidden');
    } else {
        // Not playing AI, jump straight in
        $('matchmaking-modal').classList.add('hidden');
        setupOnlineGame(data);
    }
});

function acceptOnlineMatch() {
    $('match-found-modal').classList.add('hidden');
    isWaitingForMatch = false;
    setupOnlineGame(pendingMatchData);
    pendingMatchData = null;
}

function declineOnlineMatch() {
    $('match-found-modal').classList.add('hidden');
    socket.emit('decline_match', { matchId: pendingMatchData.settings.id });
    pendingMatchData = null;
    isWaitingForMatch = false; 
    inputLocked = false; // Resume AI game
}

function setupOnlineGame(data) {
    hideOverlay();
    isOnline = true;
    mode = 'pvp';
    onlineMatchId = data.matchId;
    myOnlineRole = data.role;
    turnDeadline = data.settings.turnDeadline || (Date.now() + 30000);

    opponentWantsRematch = false; // Reset the flag for the new match

    isRoomHost = (data.role === 1);
    leftSideRole = 1; // Always start as Black
    
    size = data.settings.size;
    vanishMs = data.settings.vanishMs;
    ruleMode = data.settings.ruleMode;

    // --- CRITICAL REMATCH RESET ---
    if (ruleMode === "swap2") {
        swap2Phase = 1;
        openingStones = [];
        if (myOnlineRole === 1) {
            showOverlay("Swap2 Opening", "Player 1: Place the first 3 stones (Black, White, Black).", "Let's Go");
        }
    } else {
        swap2Phase = 0;
    }

    // Set names for online play
    $('p1-name').innerText = data.settings.host.username;
    $('p2-name').innerText = data.settings.guest ? data.settings.guest.username : "Opponent";
    
    showGamePage(); // Ensure we are on the game page
    buildBoard();
    startLocalClocks();
    
    currentPlayer = 1;
    inputLocked = (myOnlineRole !== 1); 
    
    // Trigger vanish state properly for rematches
    if (vanishMs < 3600000 && swap2Phase === 0) {
        setAllPiecesVisible(false);
    } else {
        setAllPiecesVisible(true);
    }

    setPills();
}

function formatTime(ms) {
  if (ms <= 0) return "00:00";
  // Use Math.ceil so the clock doesn't show 00:00 while there is still 0.9s left
  const totalSeconds = Math.ceil(ms / 1000); 
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startLocalClocks() {
  if (localTickInterval) clearInterval(localTickInterval);
  
  localTickInterval = setInterval(() => {
    // Stop counting if the game is already over
    if (gameOver) {
        clearInterval(localTickInterval);
        return; 
    }

    // Calculate time remaining
    const timeLeft = Math.max(0, turnDeadline - Date.now());

    // If the board isn't currently revealed (mistake mode) and vanishing is enabled...
    if (!boardEl.classList.contains("reveal") && vanishMs < 3600000) {
        // Force a visibility check for all pieces based on their local timestamps
        setAllPiecesVisible(false); 
    }

    // 1. TIMEOUT LOSS LOGIC
    if (timeLeft <= 0 && !gameOver) {
      gameOver = true;
      inputLocked = true;
      clearInterval(localTickInterval);
      
      // Reveal the board so players can see the final state
      setAllPiecesVisible(true);

      // Figure out who ran out of time
      const loserName = currentPlayer === P1 ? "Player 1 (Black)" : (mode === "ai" ? "AI (White)" : "Player 2 (White)");
      const winnerName = currentPlayer === P1 ? (mode === "ai" ? "AI (White)" : "Player 2 (White)") : "Player 1 (Black)";

      // Trigger the end game UI
      showOverlay("Time's Up!", `${loserName} ran out of time. ${winnerName} wins!`, "New Game", "Main Menu", () => {
        hideOverlay();
        quitGame();
    });
  
    overlayBtn.onclick = () => {
        overlayBtn.onclick = null;
        hideOverlay();
        handleNewGameRequest();
    };
      
      return; // Stop processing the rest of the interval
    }

    // 2. NORMAL UI UPDATES
    const displayStr = formatTime(timeLeft);
    const isPanic = timeLeft > 0 && timeLeft <= 5000; 
    
    // Grab our single mobile timer
    const activeTimer = $('timerP1'); 

    if (activeTimer) {
        activeTimer.textContent = displayStr;
        activeTimer.classList.toggle('panic', isPanic);
    }
  }, 100); 
}

async function updateLeaderboard() {
  try {
    const response = await fetch('http://localhost:3000/leaderboard');
    if (!response.ok) return;
    
    const players = await response.json();
    const list = document.getElementById('leaderboardList');
    
    if (list) {
      list.innerHTML = players.map((p, i) => `
        <li>
          <span class="rank">#${i + 1}</span>
          <span class="name">${p.username}</span>
          <span class="rating">${Math.round(p.rating_15_standard || 1500)}</span>
        </li>
      `).join('');
    }
  } catch (err) {
    console.error("Leaderboard UI update failed:", err);
  }
}

async function initializeUser() {
  const isNative = window.Capacitor && Capacitor.isNativePlatform();
  let userData = { playerId: "mock_user_123", displayName: "BrowserDev" };

  try {
    const response = await fetch('http://localhost:3000/auth/gamecenter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });

    // --- ADD THIS LOGGING ---
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server Error Response:", errorText);
      return;
    }

    const dbUser = await response.json();
    currentUser = dbUser.username;
    console.log(`Logged in as: ${currentUser}`);
  } catch (err) {
    console.error("Fetch failed entirely:", err);
  }

  if (isNative) {
    try {
      // 1. Use the correct GameServices plugin name
      const GameCenter = Capacitor.Plugins.GameServices; 
      
      if (!GameCenter) {
          throw new Error("GameServices plugin is not registered.");
      }

      // 2. The API call remains exactly the same!
      const authResult = await GameCenter.signIn();
      
      userData = { 
          playerId: authResult.player_id, 
          displayName: authResult.player_name 
      };
      console.log("Native Game Center Login Success!", userData);

    } catch (err) {
      console.error("Native login failed:", err);
    }
  }

  const response = await fetch('http://localhost:3000/auth/gamecenter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData)
  });

  const dbUser = await response.json();
  currentUser = dbUser.username;
  myRating = dbUser.rating; //
  
  // Update UI with ranking
  console.log(`Authenticated as ${currentUser}. Rating: ${Math.round(myRating)}`);
  updateLeaderboard(); 
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  audioEnabled = true;
}

function tone({freq=440, type="sine", gain=0.06, dur=0.08, slideTo=null}) {
  if (!audioEnabled || muted) return;
  ensureAudio();
  const t0 = audioCtx.currentTime;

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g);
  g.connect(audioCtx.destination);

  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function sfxPlace() {
  tone({freq: 640, type:"triangle", gain:0.07, dur:0.07, slideTo: 520});
}
function sfxMistake() {
  tone({freq: 150, type:"sawtooth", gain:0.09, dur:0.12, slideTo: 90});
  setTimeout(() => tone({freq: 110, type:"sawtooth", gain:0.07, dur:0.10}), 90);
}
function sfxReveal() {
  tone({freq: 420, type:"sine", gain:0.05, dur:0.09, slideTo: 760});
}
function sfxWin() {
  const seq = [{f:520, d:0.08}, {f:660, d:0.08}, {f:880, d:0.10}];
  let t = 0;
  for (const s of seq) {
    setTimeout(() => tone({freq:s.f, type:"triangle", gain:0.08, dur:s.d}), t);
    t += Math.floor(s.d*1000) + 20;
  }
}

// ---------- Game State ----------
const P1 = 1;
const P2 = 2;

let size = 9;
let goal = 5;
let vanishMs = 3000;

let state = [];          
let pieceEls = [];
let placedAt = [];       
let lastRevealAt = 0;    
let currentPlayer = P1;
let gameOver = false;

let mode = "pvp";        
let aiLevel = "medium";
let ruleMode = "nolimit";
let aiPlaysAs = P2;      
let inputLocked = false;
let mistakeResumeArmed = false; 

// Swap2 Logic Variables
let swap2Phase = 0; 
let openingStones = [];

// Penalty system
let meterPos = 0; 

function idx(r,c){ return r*size + c; }
function inBounds(r,c){ return r>=0 && c>=0 && r<size && c<size; }

function setPills() {
    const p1Info = $('p1-info'); // Left Side
    const p2Info = $('p2-info'); // Right Side
    const p1Pill = $('p1-pill');
    const p2Pill = $('p2-pill');

    if (!p1Info || !p2Info) return;

    p1Info.classList.remove('active');
    p2Info.classList.remove('active');
    p1Pill.className = 'turn-piece hidden';
    p2Pill.className = 'turn-piece hidden';

    // 1. Handle Swap2 Opening (Placing the 3 or 5 stones)
    if (ruleMode === 'swap2' && swap2Phase > 0) {
        if (swap2Phase === 1) {
            p1Info.classList.add('active'); // Left side placing
            p1Pill.className = `turn-piece ${(openingStones.length === 1) ? 'p2' : 'p1'}`;
            p1Pill.classList.remove('hidden');
        } else if (swap2Phase === 3) {
            p2Info.classList.add('active'); // Right side placing
            p2Pill.className = `turn-piece ${(openingStones.length === 3) ? 'p2' : 'p1'}`;
            p2Pill.classList.remove('hidden');
        } else if (swap2Phase === 2) {
            p2Info.classList.add('active'); // Right side thinking
        } else if (swap2Phase === 4) {
            p1Info.classList.add('active'); // Left side thinking
        }
        updateMistakeMeter();
        return;
    }

    // 2. Standard Play / Post-Swap
    const activeColor = (currentPlayer === 1) ? 'p1' : 'p2';

    if (currentPlayer === leftSideRole) {
        // It is the Left Side's turn
        p1Info.classList.add('active');
        p1Pill.className = `turn-piece ${activeColor}`;
        p1Pill.classList.remove('hidden');
    } else {
        // It is the Right Side's turn
        p2Info.classList.add('active');
        p2Pill.className = `turn-piece ${activeColor}`;
        p2Pill.classList.remove('hidden');
    }

    updateMistakeMeter();
}

function initMistakeMeter(){
  if (!mistakeMeterEl) return;
  mistakeMeterEl.innerHTML = ""; 
  for (let i=0;i<7;i++){
    const d=document.createElement('div');
    d.className='meter-slot' + ((i===0||i===6)?' endcap':'');
    mistakeMeterEl.appendChild(d);
  }
  updateMistakeMeter();
}

function updateMistakeMeter(){
  if (!mistakeMeterEl) return;
  const slots = mistakeMeterEl.querySelectorAll('.meter-slot');
  slots.forEach(s=>s.classList.remove('marker'));
  const clamped = Math.max(-3, Math.min(3, meterPos));
  const idxSlot = 3 + clamped;
  if (slots[idxSlot]) slots[idxSlot].classList.add('marker');
}

function showOverlay(title, body, btn1Text="Continue", btn2Text=null, btn2Action=null) {
  const titleEl = $('overlayTitle');
  const bodyEl = $('overlayBody');
  const btn1 = $('overlayBtn');
  const btn2 = $('overlayBtn2');

  if(titleEl) titleEl.textContent = title;
  if(bodyEl) bodyEl.textContent = body;
  
  // 1. THE FIX: Always ensure Button 1 is visible when an overlay is shown!
  if(btn1) {
      btn1.textContent = btn1Text;
      btn1.classList.remove('hidden'); 
      // Reset styling so it doesn't stay gold on future modals
      btn1.style.backgroundColor = ""; 
      btn1.style.color = "";
  }
  
  // 2. Button 2 logic remains the same
  if (btn2Text && btn2) {
    btn2.textContent = btn2Text;
    btn2.classList.remove('hidden');
    btn2.onclick = btn2Action;
  } else if (btn2) {
    btn2.classList.add('hidden');
    btn2.onclick = null;
  }
  
  const overlayEl = $('overlay');
  if(overlayEl) overlayEl.classList.remove("hidden");
}

function hideOverlay() {
  const overlayEl = $('overlay');
  if(overlayEl) overlayEl.classList.add("hidden");
}

function quitGame() {
    showLandingPage();
    if (isOnline && onlineMatchId) {
        socket.emit('leave_room', { matchId: onlineMatchId });
    }
}

function handleNewGameRequest() {
    if (isOnline) {
        // USE REMATCH LOGIC FOR ALL ONLINE GAMES
        if (opponentWantsRematch) {
            // ACCEPTING
            showOverlay("Starting...", "Loading the board...");
            if ($('overlayBtn')) $('overlayBtn').classList.add('hidden'); 
            if ($('overlayBtn2')) $('overlayBtn2').classList.add('hidden');
            socket.emit('request_rematch', { matchId: onlineMatchId });
            
        } else {
            // INITIATING
            showOverlay("Waiting...", "Asking opponent for a rematch...", "Cancel");
            const mainBtn = $('overlayBtn');
            if (mainBtn) {
                mainBtn.onclick = () => {
                    hideOverlay();
                    quitGame(); // Leaves the room and goes to main menu
                };
            }
            if ($('overlayBtn2')) $('overlayBtn2').classList.add('hidden');
            socket.emit('request_rematch', { matchId: onlineMatchId });
        }
    } else {
        // Local or AI Game
        newGame();
    }
}

function buildBoard(){
  boardEl.innerHTML = "";
  state = new Array(size*size).fill(0);
  pieceEls = new Array(size*size).fill(null);
  placedAt = new Array(size*size).fill(0);
  lastRevealAt = 0;
  gameOver = false;
  currentPlayer = P1;
  inputLocked = false;

  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${size}, 1fr)`;

  if (size === 3) {
    boardEl.classList.add("tictactoe");
    boardEl.parentElement.classList.add("no-border");
  } else {
    boardEl.classList.remove("tictactoe");
    boardEl.parentElement.classList.remove("no-border");
  }

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const cell = document.createElement("div");
      cell.className = "cell";
      
      if (size > 3) {
        if (r === 0) cell.classList.add("edge-top");
        if (r === size - 1) cell.classList.add("edge-bottom");
        if (c === 0) cell.classList.add("edge-left");
        if (c === size - 1) cell.classList.add("edge-right");
        
        if (size === 15) {
          const hoshiCoords = [3, 7, 11]; 
          if (hoshiCoords.includes(r) && hoshiCoords.includes(c)) {
            cell.classList.add("hoshi");
          }
        }
      }

      cell.dataset.r = r;
      cell.dataset.c = c;

      const piece = document.createElement("div");
      piece.className = "piece";
      cell.appendChild(piece);

      const k = idx(r,c);
      pieceEls[k] = piece;

      cell.addEventListener("click", () => onCellClick(r,c));
      boardEl.appendChild(cell);
    }
  }

  setPills();
  initMistakeMeter();
  updateMistakeMeter();
}


function renderPieceVisible(r,c,player){
  const k = idx(r,c);
  const piece = pieceEls[k];
  
  // Set these to explicitly be visible before the animation classes take over
  piece.style.opacity = "1"; 
  piece.style.transform = "scale(1)";
  piece.className = `piece ${player === P1 ? "p1" : "p2"} pop-in`;

  if (ruleMode === "swap2" && swap2Phase > 0) return; // Keep visible during Swap2

  window.setTimeout(() => {
    if (boardEl.classList.contains("reveal") || (ruleMode === "swap2" && swap2Phase > 0)) return;
    piece.classList.remove("pop-in");
    piece.classList.add("fade-out");
  }, Math.max(0, vanishMs - 2000));

  window.setTimeout(() => {
    if (boardEl.classList.contains("reveal") || (ruleMode === "swap2" && swap2Phase > 0)) return;
    piece.classList.remove("fade-out");
    piece.style.opacity = "0";
  }, vanishMs);
}

function setAllPiecesVisible(forceVisible) {
  if (forceVisible) {
    boardEl.classList.add("reveal");
    lastRevealAt = Date.now(); // FIX 1: Use absolute time
  } else {
    boardEl.classList.remove("reveal");
  }

  const now = Date.now(); // FIX 2: Use absolute time

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const k = idx(r, c);
      const v = state[k];
      const piece = pieceEls[k];

      if (v === 0) {
        piece.className = "piece";
        piece.style.opacity = "0";
        continue;
      }

      piece.className = `piece ${v === P1 ? "p1" : "p2"}`;

      if (forceVisible) {
        piece.style.opacity = "1";
        piece.style.transform = "scale(1)";
        piece.classList.remove("fade-out");
      } else {
        const age = now - placedAt[k];
        const remaining = vanishMs - age;

        if (remaining > 0) {
          piece.style.opacity = "1";
          piece.style.transform = "scale(1)";
          
          window.setTimeout(() => {
            if (boardEl.classList.contains("reveal") || (ruleMode === "swap2" && swap2Phase > 0)) return;
            piece.classList.remove("pop-in");
            piece.classList.add("fade-out");
          }, Math.max(0, remaining - 2000));

          window.setTimeout(() => {
            if (boardEl.classList.contains("reveal") || (ruleMode === "swap2" && swap2Phase > 0)) return;
            piece.classList.remove("fade-out");
            piece.style.opacity = "0";
          }, remaining);
        } else {
          piece.style.opacity = "0";
        }
      }
    }
  }
}

function switchTurn() {
  currentPlayer = (currentPlayer === P1) ? P2 : P1;

  // Reset the clock if playing locally
  if (!isOnline) turnDeadline = Date.now() + 30000; 

  setPills();
}

function isOccupied(r,c){
  return state[idx(r,c)] !== 0;
}

// --- Swap2 Logic ---
function handleSwap2Move(r, c) {
  if (isOccupied(r, c)) return;

  if (swap2Phase === 1) {
    const color = (openingStones.length === 1) ? P2 : P1; 
    placePiece(r, c, color, { animate: true, sfx: true });
    openingStones.push({ r, c, color });

    if (openingStones.length === 3) {
      swap2Phase = 2;
      inputLocked = true; // Lock while choosing!
      if (mode === "ai" && aiPlaysAs === P2) {
        setTimeout(() => { if (window.aiSwap2Choice) window.aiSwap2Choice(); }, 500);
      } else {
        showSwap2ChoiceOverlay();
      }
    }
  } else if (swap2Phase === 3) {
    const color = (openingStones.length === 3) ? P2 : P1;
    placePiece(r, c, color, { animate: true, sfx: true });
    openingStones.push({ r, c, color });

    if (openingStones.length === 5) {
      swap2Phase = 4;
      inputLocked = true; // Lock while deciding!
      if (mode === "ai" && aiPlaysAs === P1) {
         const currentScore = window.evaluatePosition ? window.evaluatePosition(state, P1) : 0;
         setTimeout(() => finalizeRoles(currentScore > 0 ? P1 : P2), 1000);
      } else {
        showP1FinalChoice();
      }
    }
  }
}

function clearOverlayButtons() {
    const card = document.querySelector('.overlay-card');
    const old = card.querySelector('.choice-container');
    if (old) old.remove();
}

function showSwap2ChoiceOverlay() {
  inputLocked = true;
  showOverlay("Swap2: Choice", "Choose your path as Player 2:", "Stay White");

  const card = document.querySelector('.overlay-card');
  const btnRow = $('overlayBtn').parentElement; // Get the flex container holding the buttons
  clearOverlayButtons();

  const btnContainer = document.createElement('div');
  btnContainer.className = "choice-container";
  btnContainer.style.display = "flex";
  btnContainer.style.gap = "10px";
  btnContainer.style.marginBottom = "15px";

  const swapBtn = document.createElement('button');
  swapBtn.className = "btn ghost";
  swapBtn.textContent = "Swap to Black";
  swapBtn.onclick = () => { 
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'swap' });
      else finalizeRoles(P1); 
  };

  const plus2Btn = document.createElement('button');
  plus2Btn.className = "btn ghost";
  plus2Btn.textContent = "Place 2 More";
  plus2Btn.onclick = () => { 
    if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'plus2' });
    else {
        swap2Phase = 3; 
        inputLocked = false; 
        hideOverlay(); 
        setPills();
    }
  };

  btnContainer.append(swapBtn, plus2Btn);
  // FIX: Insert before the row container, not inside it
  card.insertBefore(btnContainer, btnRow);

  overlayBtn.onclick = () => { 
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'stay' });
      else finalizeRoles(P2); 
  };
}

function showP1FinalChoice() {
  inputLocked = true;
  const currentScore = window.evaluatePosition ? window.evaluatePosition(state, P1) : 0;
  const suggestion = currentScore > 0 ? "Black" : "White";

  showOverlay(
    "Swap2: Final Choice", 
    `Player 2 has added two stones. Choose your final color. (AI suggests: ${suggestion})`, 
    "Play as Black"
  );

  const card = document.querySelector('.overlay-card');
  const btnRow = $('overlayBtn').parentElement;
  clearOverlayButtons();

  const btnContainer = document.createElement('div');
  btnContainer.className = "choice-container";
  btnContainer.style.display = "flex";
  btnContainer.style.gap = "10px";
  btnContainer.style.marginBottom = "15px";

  const whiteBtn = document.createElement('button');
  whiteBtn.className = "btn ghost";
  whiteBtn.textContent = "Play as White";
  whiteBtn.onclick = () => { 
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'stay', role: 2 });
      else finalizeRoles(P2); 
  };

  btnContainer.appendChild(whiteBtn);
  card.insertBefore(btnContainer, btnRow);

  overlayBtn.onclick = () => { 
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'swap', role: 1 });
      else finalizeRoles(P1); 
  };
}


// ------------------------------------

function onCellClick(r, c) {
  if (gameOver || inputLocked) return;

  // 1. CLEAR MISTAKE STATE FIRST
  if (mistakeResumeArmed) {
    if (isOnline) {
      // Tell the server we are ready to resume so both screens sync
      socket.emit('resume_game', { matchId: onlineMatchId });
    } else {
      // Local play: just resume immediately
      executeResume(Date.now());
    }
    return; // Stop here! The click ONLY resumes the game. They must click again to move.
  }

  // 2. ONLINE MULTIPLAYER INTERCEPTION
  if (isOnline) {
    if (currentPlayer !== myOnlineRole) return; 
    
    if (isOccupied(r, c)) { 
      socket.emit('commit_mistake', { matchId: onlineMatchId }); 
      return; 
    } 
    
    inputLocked = true;
    socket.emit('submit_move', { matchId: onlineMatchId, r, c });
    return;
  }


  // 3. EXISTING LOCAL LOGIC
  if (isOccupied(r, c)) {
    handleMistake();
    return;
  }

  // Local SWAP2 OPENING MOVES ---
  if (ruleMode === "swap2" && swap2Phase > 0) {
      handleSwap2Move(r, c);
      setPills(); // Instantly update the new dual-player UI!
      return;     // Stop here so it doesn't trigger a normal turn switch
  }

  const isRenju = (ruleMode === "renju" || ruleMode === "swap2");
  if (isRenju && currentPlayer === P1) {
      state[idx(r,c)] = P1; 
      const result = window.violatesRenju(r, c, 1, state);
      state[idx(r,c)] = 0; 

      if (!result.isValid) {
          handleMistake(result.reason); 
          return;
      }
  }

  placePiece(r, c, currentPlayer, { animate: true, sfx: true });
  const win = checkWinFrom(r, c, currentPlayer);
  if (win) {
    endGame(win);
    return;
  }

  if (!state.includes(0)) {
    endGame({ player: 0, line: [] }, true);
    return;
  }

  switchTurn();

  if (mode === "ai" && currentPlayer === aiPlaysAs) {
    aiMoveSoon();
  }
}

function placePiece(r, c, player, { animate = false, sfx = false, absoluteTime = null } = {}) {
  const _k = idx(r, c);

  if (state[_k] !== 0) {
      console.error("FATAL: Attempted to overwrite an existing piece at", r, c);
      return; 
  }

  state[_k] = player;
  
  // Use server time if online, otherwise local performance time
  placedAt[_k] = absoluteTime || Date.now(); 
  
  if (sfx) sfxPlace();
  
  const piece = pieceEls[_k];
  piece.className = `piece ${player === P1 ? "p1" : "p2"} pop-in`;
  piece.style.opacity = "1";

  if (ruleMode === "swap2" && swap2Phase > 0) return;

  if (vanishMs < 3600000) {
    window.setTimeout(() => {
      if (!boardEl.classList.contains("reveal")) {
        piece.classList.remove("pop-in"); // <--- ADD THIS LINE
        piece.classList.add("fade-out");
      }
    }, Math.max(0, vanishMs - 2000));

    window.setTimeout(() => {
      if (!boardEl.classList.contains("reveal")) {
        piece.classList.remove("fade-out");
        piece.style.opacity = "0"; // Now this will successfully apply!
      }
    }, vanishMs);
  }
}

function executeResume(syncTime) {
  // Prevent double-resumes if both players click at the exact same time
  if (!boardEl.classList.contains("reveal")) return; 

  mistakeResumeArmed = false;

  // FIX: Reset all existing pieces to the sync time. 
  // This forces them to respect the vanish timer and fade out gracefully!
  for (let i = 0; i < state.length; i++) {
    if (state[i] !== 0) {
      placedAt[i] = syncTime;
    }
  }

  setAllPiecesVisible(false);

  // Restore proper turn locks
  if (isOnline) {
    inputLocked = (currentPlayer !== myOnlineRole);
  } else {
    inputLocked = false;
  }

  // AI check
  if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) {
    aiMoveSoon();
  }
}

function handleMistake(customMsg, offender = currentPlayer) {
  sfxMistake();
  
  if (!isOnline || currentPlayer === myOnlineRole) {
      inputLocked = true;
  }

  setAllPiecesVisible(true);
  sfxReveal();

  if (offender === P1) meterPos--;
  else meterPos++;

  meterPos = Math.max(-3, Math.min(3, meterPos));
  updateMistakeMeter();

  const hitEnd = (meterPos === -3) || (meterPos === 3);
  
  let actorText = isOnline && offender !== myOnlineRole ? "Opponent" : "You";
  const bodyMessage = customMsg ? `${customMsg}.` : `${actorText} clicked an occupied square.`;

  const title = hitEnd ? "Penalty!" : "Mistake";
  const msg = hitEnd
    ? `Third mistake reached the end of the meter. ${bodyMessage} ${actorText} forfeit this move.`
    : `${bodyMessage} The board is revealed for review. Close this message, then click the board or press Resume to continue.`;

  showOverlay(title, msg, "Close");

  const resumeGame = () => {
    if (hitEnd) return;
    
    if (isOnline) {
      // Tell the server we are ready to resume
      socket.emit('resume_game', { matchId: onlineMatchId });
    } else {
      // Local play: just resume immediately
      executeResume(Date.now());
    }
  };

  // Fetch the LIVE button from the DOM
  const mainBtn = $('overlayBtn');
  
  if (mainBtn) {
      mainBtn.onclick = () => {
        mainBtn.onclick = null;
        hideOverlay();

        if (hitEnd) {
          meterPos = 0; 
          updateMistakeMeter();
          setAllPiecesVisible(false);
          
          if (isOnline) {
             if (offender === myOnlineRole) {
                 inputLocked = true;
                 socket.emit('forfeit_turn', { matchId: onlineMatchId });
             }
          } else {
            inputLocked = false;
            switchTurn();
            if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) aiMoveSoon();
          }
          return;
        }

        mistakeResumeArmed = true;
        
        if (isOnline) {
          inputLocked = (currentPlayer !== myOnlineRole);
        } else {
          inputLocked = false;
        }

        const resumeGame = () => {
            if (isOnline) socket.emit('resume_game', { matchId: onlineMatchId });
            else executeResume(Date.now());
        };

        if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) resumeGame();
      };
  }
}

overlayBtn.addEventListener("click", hideOverlay);

// ---------- Win Checking ----------
function checkWinFrom(r,c,player){
  const directions = [
    {dr:0, dc:1},
    {dr:1, dc:0},
    {dr:1, dc:1},
    {dr:1, dc:-1},
  ];

  for (const {dr,dc} of directions){
    const line = [{r,c}];

    let rr=r+dr, cc=c+dc;
    while (inBounds(rr,cc) && state[idx(rr,cc)]===player){
      line.push({r:rr,c:cc});
      rr+=dr; cc+=dc;
    }
    rr=r-dr; cc=c-dc;
    while (inBounds(rr,cc) && state[idx(rr,cc)]===player){
      line.unshift({r:rr,c:cc});
      rr-=dr; cc-=dc;
    }

    if (line.length >= goal){
      return { player, line: line.slice(0, goal) };
    }
  }
  return null;
}

function highlightWin(line){
  const cells = boardEl.querySelectorAll(".cell");
  for (const p of line){
    const k = idx(p.r,p.c);
    cells[k].classList.add("win-line");
  }
}

function endGame(winObj, isDraw = false) {
  gameOver = true;
  inputLocked = true;

  setAllPiecesVisible(true);

  // 1. Visuals and Audio
  if (winObj && winObj.line && winObj.line.length) {
    highlightWin(winObj.line);
  }
  if (!isDraw) sfxWin();

  // 2. Determine Text
  const winnerText =
    (winObj && winObj.player === P1) ? "Player 1 (Black)" :
    (mode === "ai" ? "AI (White)" : "Player 2 (White)");

  const title = isDraw ? "Draw" : "Winner!";
  const msg = isDraw 
    ? "No more moves left. Review the final board, or play again." 
    : `${winnerText} connected ${goal}. Review the final board, or play again.`;

  // 1. Determine base text
  let primaryBtnText = isOnline ? "Rematch" : "New Game";
  
  // 2. RACE CONDITION CATCH: If they asked before we even rendered the menu, swap it now!
  if (opponentWantsRematch) {
      primaryBtnText = "Accept Rematch";
  }

  // Trigger the 2-button overlay
  showOverlay(title, msg, primaryBtnText, "Main Menu", () => {
      hideOverlay();
      quitGame();
  });

  const mainBtn = $('overlayBtn');
  if (mainBtn) {
      // If we caught the race condition, make sure it's gold right from the start!
      if (opponentWantsRematch) {
          mainBtn.style.backgroundColor = "#ffcf40";
          mainBtn.style.color = "#000";
      }
      
      mainBtn.onclick = () => { 
          mainBtn.onclick = null; 
          hideOverlay(); 
          handleNewGameRequest();
      };
  }
}

// ---------- AI ----------
function aiMoveSoon() {
  if (gameOver || !inputLocked) {
    inputLocked = true;
  }

  setTimeout(() => {
    // 1. Pass the actual board state and player role to the AI!
    let move = window.chooseAiMove ? window.chooseAiMove(state, currentPlayer) : null;
    
    // 2. FAILSAFE: If the AI tries to overwrite a piece, reject it and find an empty cell
    if (!move || isOccupied(move.r, move.c)) {
        console.warn("AI attempted an illegal move! Overriding.");
        move = null;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!isOccupied(r, c)) {
                    move = { r, c };
                    break;
                }
            }
            if (move) break;
        }
    }

    if (move) {
      placePiece(move.r, move.c, currentPlayer, { animate: true, sfx: true });
      
      const win = checkWinFrom(move.r, move.c, currentPlayer);
      if (win){
        endGame(win);
        return;
      }
      
      if (!state.includes(0)){
        endGame({player:0, line:[]}, true);
        return;
      }
      
      switchTurn();
      inputLocked = false; 
      
      if (turnPill) turnPill.style.color = ""; 
    }
  }, 50);
}

// ---------- Setup / UI ----------
function applySettingsFromUI() {
  const sizeSelect = $('board-size-select');
  const vanishSel = $('vanish-timer-select');
  const ruleSel = $('rule-set-select');
  const aiSel = $('ai-level-select');

  // 1. OVERRIDE: If playing AI while in the matchmaking queue
  if (isWaitingForMatch) {
      mode = 'ai';
      aiLevel = 'medium';
      vanishMs = 10000; // Force 10 second vanish
      size = 15;        // Lock to 15x15 to match the ladder they are waiting for
      ruleMode = 'nolimit';
  } 
  // 2. NORMAL FLOW: Read from the UI dropdowns
  else {
      mode = currentMode.includes('ai') ? 'ai' : 'pvp';
      size = sizeSelect ? parseInt(sizeSelect.value, 10) : 15;
      vanishMs = vanishSel ? parseInt(vanishSel.value, 10) : 10000;
      ruleMode = ruleSel ? ruleSel.value : "nolimit"; 
      aiLevel = aiSel ? aiSel.value : "medium"; 
  }
  
  // Apply the global AI level for the engine
  window.aiLevel = aiLevel; 
  
  // Game automatically adjusts to Connect-3 for a 3x3 board
  goal = (size === 3) ? 3 : 5;
  setPills();
}

function finalizeRoles(winnerOfOpening) {
  clearOverlayButtons();
  overlayBtn.onclick = null;

  if (!isOnline) {
      // If Phase 2 (Right Side) chooses Black, Left Side becomes White (P2)
      if (swap2Phase === 2 && winnerOfOpening === P1) leftSideRole = P2;
      // If Phase 4 (Left Side) chooses White, Left Side becomes White (P2)
      if (swap2Phase === 4 && winnerOfOpening === P2) leftSideRole = P2;
  }

  if ((swap2Phase === 2 && winnerOfOpening === P1) || (swap2Phase === 4 && winnerOfOpening === P2)) {
     aiPlaysAs = (aiPlaysAs === P1) ? P2 : P1;
  }
  
  swap2Phase = 0;
  hideOverlay();
  inputLocked = false;
  
  const now = Date.now(); // Change performance.now() to Date.now()
  for (let i = 0; i < state.length; i++) { if (state[i] !== 0) placedAt[i] = now; }
  
  // FIX: Explicitly trigger the vanish logic now that Swap2 phase is over
  setAllPiecesVisible(false);
  
  currentPlayer = P2; 
  setPills();
  if (mode === "ai" && currentPlayer === aiPlaysAs) aiMoveSoon();
}

function newGame() {
  meterPos = 0; 
  openingStones = [];
  leftSideRole = 1;

  turnDeadline = Date.now() + 30000;
  startLocalClocks();
  
  initMistakeMeter(); 
  updateMistakeMeter(); 
  
  buildBoard();
  hideOverlay();
  clearOverlayButtons();
  overlayBtn.onclick = null; 

  // Set names for local play
  if (!isOnline) {
      $('p1-name').innerText = currentUser || "Player 1";
      $('p2-name').innerText = mode === "ai" ? `AI (${aiLevel})` : "Player 2";
  }
  
  if (ruleMode === "swap2") {
      swap2Phase = 1;
      inputLocked = false; 
      currentPlayer = P1;
      setPills();
      showOverlay("Swap2 Opening", "Player 1: Place the first 3 stones (Black, White, Black).", "Let's Go");
  } else {
      swap2Phase = 0;
      inputLocked = false;
      currentPlayer = P1;
      setPills();
  }
  
  if (vanishMs >= 3600000) {
    setAllPiecesVisible(true);
  } else {
    setAllPiecesVisible(false);
  }
  
  if (mode === "ai" && currentPlayer === aiPlaysAs && swap2Phase === 0) {
      aiMoveSoon();
  }
}



socket.on('room_created', (code) => {
  showOverlay("Private Room", `Your room code is: ${code}. Waiting for guest...`, "Cancel");
});

socket.on('move_made', (data) => {
  // Destructure the data object so the rest of your code works
  const { r, c, player, placedAtUtc, turnDeadline: serverDeadline } = data;

  // Sync the timer
  turnDeadline = serverDeadline;
  
  // Place the piece
  placePiece(r, c, player, { animate: true, sfx: true });
  placedAt[idx(r, c)] = placedAtUtc;
  
  const win = checkWinFrom(r, c, player);
  if (win) { 
    endGame(win); 
    return; 
  }
  
  switchTurn();
  
  // Unlock the board only if it's now your turn
  inputLocked = (currentPlayer !== myOnlineRole);
});

socket.on('turn_forfeited', ({ player }) => {
  // We don't need to show an overlay here because the mistake_broadcast 
  // already triggered handleMistake() to show the UI! 
  
  // Just sync the turn state and unlock the board for the innocent player
  switchTurn();
  inputLocked = (currentPlayer !== myOnlineRole); 
});

socket.on('mistake_broadcast', ({ player }) => {
  handleMistake(null, player);
});



socket.on('game_resumed', ({ resumeTimeUtc }) => {
  executeResume(resumeTimeUtc);
});

socket.on('rematch_requested', () => {
    console.log("Rematch requested by opponent!"); // Helpful for debugging
    opponentWantsRematch = true; 
    
    // 1. Force the button to change immediately
    const mainBtn = document.getElementById('overlayBtn');
    if (mainBtn) {
        mainBtn.innerText = "Accept Rematch";
        mainBtn.style.backgroundColor = "#ffcf40"; // Gold
        mainBtn.style.color = "#000";
    }
    
    // 2. Safely append the text
    const bodyEl = document.getElementById('overlayBody');
    if (bodyEl && !bodyEl.innerText.includes("wants a rematch")) {
        bodyEl.innerText += "\n\nOpponent wants a rematch!";
    }
});

socket.on('opponent_left', () => {
    showOverlay("Room Closed", "Your opponent left the private room.", "Main Menu");
    overlayBtn.onclick = () => {
        hideOverlay();
        quitGame();
    };
});

socket.on('timeout_loss', ({ loserRole, winnerRole }) => {
  gameOver = true;
  inputLocked = true;
  if (localTickInterval) clearInterval(localTickInterval);
  
  // Clean up timers
  $('timerP1').classList.remove('panic');
  $('timerP2').classList.remove('panic');
  
  const winnerText = (winnerRole === myOnlineRole) ? "You win by timeout!" : "You lost by timeout.";
  const loserColor = (loserRole === 1) ? "Black" : "White";
  
  showOverlay("Time's Up!", `${loserColor} ran out of time. ${winnerText}`, "New Game", "Main Menu", () => {
    hideOverlay();
    quitGame();
  });

  overlayBtn.onclick = () => {
    overlayBtn.onclick = null;
    hideOverlay();
    handleNewGameRequest();
  };
});

// Triggers when you successfully create a room
socket.on('room_created', (code) => {
  showOverlay("Private Room", `Your room code is: ${code}\nWaiting for opponent...`, "Cancel");
  
  // Allow the host to cancel and go back to the main menu
  const mainBtn = $('overlayBtn');
  if (mainBtn) {
      mainBtn.classList.remove('hidden');
      mainBtn.onclick = () => {
          hideOverlay();
          quitGame(); // Safely leaves the room and returns to the menu
      };
  }
});

// Triggers if a guest types the wrong code
socket.on('error', (msg) => {
    showOverlay("Error", msg, "Main Menu");
    
    const mainBtn = $('overlayBtn');
    if (mainBtn) {
        mainBtn.classList.remove('hidden');
        mainBtn.onclick = () => {
            hideOverlay();
            quitGame();
        };
    }
});

socket.on('match_over', ({ winnerRole, newRating, pointsGained }) => {
    // The app already drew the 5th piece and popped up the overlay from the move_made event.
    // Now we just append the Elo rating changes to it!
    const bodyEl = $('overlayBody');
    if (bodyEl && newRating) {
        const gainStr = pointsGained >= 0 ? `+${pointsGained}` : pointsGained;
        bodyEl.textContent += `\n\nRating Updated: ${newRating} (${gainStr})`;
    }
});

socket.on('swap2_choice_required', ({ phase }) => {
    swap2Phase = phase;
    if (phase === 2 && myOnlineRole === 2) {
        showSwap2ChoiceOverlay(); // Use your existing UI
    } else if (phase === 4 && myOnlineRole === 1) {
        showP1FinalChoice(); // Use your existing UI
    }
});

socket.on('roles_finalized', ({ hostId, guestId }) => {
    // Update your role (1=Black, 2=White)
    myOnlineRole = (socket.id === hostId) ? 1 : 2;

    // THE FIX: Explicitly set the Left Side's color based on the swap result
    // If I created the room, the left side is my color.
    // If I joined the room, the left side is the opponent's color.
    leftSideRole = isRoomHost ? myOnlineRole : (myOnlineRole === 1 ? 2 : 1);
    
    swap2Phase = 0; // End opening
    currentPlayer = 2; // White (P2) moves first after opening
    
    // Unlock if the current turn (White) matches your new role
    inputLocked = (myOnlineRole !== 2); 
    
    hideOverlay();
    clearOverlayButtons();
    setPills(); 
});

socket.on('swap2_plus2_started', () => {
    swap2Phase = 3;
    hideOverlay();
    clearOverlayButtons();
    inputLocked = (myOnlineRole !== 2); // Only Player 2 (the guest) can move now
    setPills();
});

// Final assignments
window.handleSwap2Move = handleSwap2Move;
window.showOverlay = showOverlay;
window.overlayBtn = overlayBtn;
window.finalizeRoles = finalizeRoles;

applySettingsFromUI();
// Manually trigger the login sequence on load
initializeUser();
newGame();