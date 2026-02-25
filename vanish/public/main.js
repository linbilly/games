/* Memory Gomoku - full game
   - 3x3 connect 3 (tic tac toe)
   - 8x8 connect 5
   - 12x12 connect 5
   - Pieces visually vanish after N ms but remain in state
   - Mistake on occupied: reveal board briefly, lose turn
   - AI opponent for single player: Easy/Medium/Hard
*/

// At the very top of main.js
// This checks if you are testing on your computer vs the live app
// 1. Are we running inside the iOS/Android app?
const isNative = window.Capacitor && window.Capacitor.isNativePlatform();

// 2. Are we testing in a desktop browser? (Ignore 'localhost' if on a phone)
const isLocalDev = !isNative && (window.location.hostname === 'localhost' || window.location.protocol === 'file:');

// 3. Set the URL securely
const SERVER_URL = isLocalDev ? 'http://localhost:3000' : 'https://playgomoku.bigwgames.com'; 
const socket = io(SERVER_URL);

let isOnline = false;
let onlineMatchId = null;
let myOnlineRole = null; // 1 (Black) or 2 (White)
let currentPlatformId = null;

let currentUser = "Guest";
let myRating = 1500;
let myWins = 0;
let myLosses = 0;

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

let selectedR = null;
let selectedC = null;

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
    // Left intentionally blank. The CSS aspect-ratio and Flexbox 
    // now handle all responsive scaling flawlessly!
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
        socket.emit('find_global_match', { vanishMs, ruleMode, platformId: currentPlatformId });
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

    if ($('overlayBtn')) $('overlayBtn').onclick = null;
    if ($('overlayBtn2')) $('overlayBtn2').onclick = null;

    isOnline = true;
    mode = 'pvp';
    onlineMatchId = data.matchId;
    myOnlineRole = data.role;

    // ADD THESE: Save to memory so refresh doesn't kill the session
    localStorage.setItem('active_match_id', onlineMatchId);
    localStorage.setItem('my_platform_id', currentPlatformId);

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
    const response = await fetch(`${SERVER_URL}/leaderboard`);
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
  const platform = isNative ? Capacitor.getPlatform() : 'web'; 
  
  let savedGuestId = localStorage.getItem('vanish_guest_id');
  if (!savedGuestId) {
      savedGuestId = "guest_" + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('vanish_guest_id', savedGuestId);
  }

  let userData = { 
    playerId: savedGuestId, 
    displayName: "Guest",
    platform: platform 
  };

  if (isNative) {
    try {
      if (platform === 'ios') {
        const GameCenter = Capacitor.Plugins.GameServices;
        const auth = await GameCenter.signIn();
        userData.playerId = auth.player_id;
        userData.displayName = auth.player_name;
      } else if (platform === 'android') {
        // Ensure you have @capacitor-community/google-play-games installed
        const GPlay = Capacitor.Plugins.GooglePlayGames;
        const auth = await GPlay.signIn();
        userData.playerId = auth.playerId;
        userData.displayName = auth.displayName;
      }
    } catch (err) { 
      console.error("Native Auth failed, proceeding as guest:", err); 
    }
  }

  try {
    const response = await fetch(`${SERVER_URL}/auth/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });

    if (!response.ok) throw new Error("Server authentication failed");

    const dbUser = await response.json();
    
    // Store globally for the "Additional Info" overlay
    currentUser = dbUser.username;
    currentPlatformId = dbUser.platform_id; 
    myRating = dbUser.rating_15_standard; 
    myWins = dbUser.wins || 0;
    myLosses = dbUser.losses || 0;

    console.log(`Authenticated as ${currentUser}. Rating: ${Math.round(myRating)}`);

    const deleteBtn = document.getElementById('btn-delete-account');
    if (deleteBtn) {
        deleteBtn.onclick = requestAccountDeletion;
    }
    
    // Refresh UI elements
    const welcomeText = document.getElementById('welcome-text');
    if (welcomeText) welcomeText.innerText = `Welcome, ${currentUser}`;
    
    updateLeaderboard(); 
} catch (err) {
    console.error("Auth fetch failed:", err);
    document.getElementById('welcome-text').innerText = "Offline Mode";
    
    // Disable the online buttons when the server can't be reached
    const privateBtn = document.getElementById('btn-online-private');
    const ladderBtn = document.getElementById('btn-online-ladder');
    
    if (privateBtn) {
        privateBtn.disabled = true;
        privateBtn.innerText = "Private Room (Offline)";
    }
    
    if (ladderBtn) {
        ladderBtn.disabled = true;
        ladderBtn.innerText = "Online Ladder (Offline)";
        ladderBtn.classList.remove('highlight-btn'); // Remove the gold highlight
    }
  }
}

async function checkActiveMatch() {
    const savedMatchId = localStorage.getItem('active_match_id');
    if (savedMatchId && currentPlatformId) {
        console.log("Attempting to rejoin match:", savedMatchId);
        socket.emit('reconnect_to_match', { matchId: savedMatchId, platformId: currentPlatformId });
    }
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  audioEnabled = true;
}

async function requestAccountDeletion() {
    if (!currentPlatformId) {
        alert("No active account found to delete.");
        return;
    }

    // 1. Ask for confirmation using your polished overlay system
    showOverlay(
        "Delete Account", 
        "Are you absolutely sure? This will permanently erase your username, Elo rating, and match history. This cannot be undone.", 
        "Delete", 
        "Cancel", 
        () => { 
            // Cancel Action
            hideOverlay(); 
            // Reset the primary button color just in case
            if ($('overlayBtn')) $('overlayBtn').style.backgroundColor = ""; 
        }
    );

    // 2. Make the Delete button red so they know it's destructive
    const mainBtn = $('overlayBtn');
    if (mainBtn) {
        mainBtn.style.backgroundColor = "#ff4444"; 
        mainBtn.style.color = "#fff";

        mainBtn.onclick = async () => {
            mainBtn.onclick = null;
            mainBtn.style.backgroundColor = ""; // Reset for future overlays
            hideOverlay();
            
            // Show a loading state
            showOverlay("Deleting...", "Erasing your account data from the servers...");
            if ($('overlayBtn')) $('overlayBtn').classList.add('hidden');

            try {
                // 3. Tell the server to delete the row
                const response = await fetch(`${SERVER_URL}/user/${currentPlatformId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    // 4. Scrub the local device memory
                    localStorage.removeItem('vanish_guest_id');
                    localStorage.removeItem('active_match_id');
                    localStorage.removeItem('my_platform_id');
                    localStorage.removeItem('my_role');

                    // 5. Hard reload the app to generate a fresh new Guest session
                    alert("Your account has been successfully deleted.");
                    window.location.reload(); 
                } else {
                    hideOverlay();
                    alert("Failed to delete account. Please try again.");
                }
            } catch (err) {
                console.error("Deletion failed:", err);
                hideOverlay();
                alert("Network error. Could not reach the server to delete your account.");
            }
        };
    }
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

  // Cleanup the new buttons so they don't bleed into other overlays
  const minBtn = $('minimize-overlay-btn');
  const restoreBtn = $('restore-overlay-btn');
  if (minBtn) minBtn.classList.add('hidden');
  if (restoreBtn) restoreBtn.classList.add('hidden');
}

function quitGame() {
    if (isOnline && onlineMatchId && !gameOver) {
        socket.emit('leave_room', { matchId: onlineMatchId });
    }
    
    localStorage.removeItem('active_match_id');
    gameOver = true;
    if (localTickInterval) clearInterval(localTickInterval);
    
    // FIX 3: Completely wipe the memory slate so new games start fresh
    onlineMatchId = null;
    isOnline = false;
    swap2Phase = 0;
    openingStones = [];
    meterPos = 0;
    boardEl.classList.remove('reveal'); // Just in case a mistake was active

    // --- ADD THESE THREE LINES ---
    hideOverlay(); 
    const restoreBtn = $('restore-overlay-btn');
    if (restoreBtn) restoreBtn.classList.add('hidden');
    
    showLandingPage();
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
  clearSelection();
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

  showOverlay(
    "Swap2: Final Choice", 
    `Player 2 has added two stones. Choose your final color.`, 
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
      // FIX 1: To play as White (Role 2), Player 1 MUST swap roles with the Guest!
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'swap' });
      else finalizeRoles(P2); 
  };

  btnContainer.appendChild(whiteBtn);
  card.insertBefore(btnContainer, btnRow);

  overlayBtn.onclick = () => { 
      // FIX 1 (Cont): To play as Black (Role 1), Player 1 stays as the Host!
      if (isOnline) socket.emit('swap2_decision', { matchId: onlineMatchId, decision: 'stay' });
      else finalizeRoles(P1); 
  };
}


// ------------------------------------

function onCellClick(r, c) {
    if (gameOver || inputLocked) return;

    // 1. CLEAR MISTAKE STATE FIRST
    if (mistakeResumeArmed) {
        if (isOnline) socket.emit('resume_game', { matchId: onlineMatchId });
        else executeResume(Date.now());
        return; 
    }

    // --- NEW: DOUBLE-TAP TO CONFIRM ---
    // If they clicked the exact cell that is already highlighted, confirm it!
    if (selectedR === r && selectedC === c) {
        confirmPlacement();
        return;
    }

    // 2. MOVE THE CURSOR
    selectedR = r;
    selectedC = c;

    // Visually update the board
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach(cell => cell.classList.remove('selected-cell'));
    cells[idx(r, c)].classList.add('selected-cell');

    updatePlaceButton();
}

function confirmPlacement() {
    if (selectedR === null || selectedC === null || gameOver || inputLocked) return;

    const r = selectedR;
    const c = selectedC;
    clearSelection();

    if (isOnline) {
        // Explicitly allow P1 to move if Phase 1 is active, regardless of currentPlayer
        const isMyOpening = (swap2Phase === 1 && myOnlineRole === 1) || (swap2Phase === 3 && myOnlineRole === 2);
        
        if (!isMyOpening && currentPlayer !== myOnlineRole) return; 
        
        if (isOccupied(r, c)) { 
            socket.emit('commit_mistake', { matchId: onlineMatchId }); 
            return; 
        } 
        
        inputLocked = true;
        socket.emit('submit_move', { matchId: onlineMatchId, r, c });
        return;
    }

    // 2. LOCAL LOGIC (PvP and AI)
    if (isOccupied(r, c)) {
        handleMistake();
        return;
    }

    // Local SWAP2 OPENING MOVES
    if (ruleMode === "swap2" && swap2Phase > 0) {
        handleSwap2Move(r, c);
        setPills(); 
        return;     
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

async function refreshMyStats() {
    try {
        // Only fetch if we have successfully logged in and have an ID
        if (currentPlatformId) {
            const response = await fetch(`${SERVER_URL}/user/stats/${currentPlatformId}`);
            if (response.ok) {
                const freshData = await response.json();
                
                // Update our local variables with the absolute truth from the DB
                myRating = freshData.rating_15_standard || 1500;
                myWins = freshData.wins || 0;
                myLosses = freshData.losses || 0;
            }
        }
    } catch (err) {
        console.error("Failed to pull fresh stats from DB:", err);
    }
    
    // Visually update the HTML elements
    updateMyStatsUI();
}

function openInfoOverlay() {
    $('info-overlay').classList.remove('hidden');
    
    // Both of these now pull fresh data directly from the PostgreSQL database!
    updateLeaderboard(); 
    refreshMyStats();    
}

function closeInfoOverlay() {
    $('info-overlay').classList.add('hidden');
}

function updateMyStatsUI() {
    // These values should be stored globally in main.js after your auth call
    $('stat-username').innerText = currentUser || "Guest";
    $('stat-elo').innerText = Math.round(myRating) || 1500;
    // Assuming you update these variables when the user logs in
    $('stat-wins').innerText = myWins || 0;
    $('stat-losses').innerText = myLosses || 0;
}

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    $(`tab-${tab}`).classList.remove('hidden');
    event.currentTarget.classList.add('active');
}

function executeResume(syncTime) {
  // Prevent double-resumes if both players click at the exact same time
  if (!boardEl.classList.contains("reveal")) return; 

  mistakeResumeArmed = false;

  // FIX 1: Auto-dismiss the overlay if the opponent already resumed!
  hideOverlay();
  if ($('overlayBtn')) $('overlayBtn').onclick = null;

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
  clearSelection();
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
  
  // UX Tweak: Tell the innocent player they are just waiting
  let msg = hitEnd
    ? `Three strikes! ${bodyMessage} ${actorText} forfeit this move.`
    : `${bodyMessage} The board is revealed for review. Close this message, then play a piece to continue.`;
    
  if (!hitEnd && isOnline && offender !== myOnlineRole) {
      msg = `${bodyMessage} The board is revealed. Waiting for opponent to resume...`;
  }

  showOverlay(title, msg, "Close");

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

        // FIX 2: Only the OFFENDER is allowed to arm the resume click!
        if (isOnline && offender !== myOnlineRole) {
            mistakeResumeArmed = false;
            return; // Exit here and keep waiting for them to resume
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

  // 2. Determine Text and Title dynamically
  let overlayTitle = "Winner!";

  if (isDraw) {
      overlayTitle = "Draw";
  } else if (isOnline) {
      // Online Multiplayer Logic
      if (winObj && winObj.player === myOnlineRole) {
          overlayTitle = "Victory!";
      } else {
          overlayTitle = "Defeat!";
      }
  } else if (mode === "ai") {
      // Single Player AI Logic
      if (winObj && winObj.player === aiPlaysAs) {
          overlayTitle = "Defeat!";
      } else {
          overlayTitle = "Victory!";
      }
  } 

  const msg = isDraw 
    ? "Game ended in a draw. Play again?" 
    : `Play again?`;

  let primaryBtnText = isOnline ? "Rematch" : "New Game";
  
  if (opponentWantsRematch) {
      primaryBtnText = "Accept Rematch";
  }

  // Trigger the 2-button overlay
  showOverlay(overlayTitle, msg, primaryBtnText, "Main Menu", () => {
      hideOverlay();
      quitGame();
  });

  const minBtn = $('minimize-overlay-btn');
  if (minBtn) minBtn.classList.remove('hidden');

  let restoreBtn = $('restore-overlay-btn');
  
  if (!restoreBtn) {
      restoreBtn = document.createElement('button');
      restoreBtn.id = 'restore-overlay-btn';
      restoreBtn.className = 'restore-btn hidden';
      restoreBtn.innerHTML = '▲ Show';
      restoreBtn.onclick = restoreOverlay;
  }
  
  document.body.appendChild(restoreBtn);

  const mainBtn = $('overlayBtn');
  if (mainBtn) {
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
    let move = window.chooseAiMove ? window.chooseAiMove(state, currentPlayer) : null;
    
    // 1. TRUE FAILSAFE: Only trigger if the AI engine completely crashes and returns null
    if (!move) {
        console.warn("AI engine failed to return a move! Using random fallback.");
        let emptySpots = [];
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!isOccupied(r, c)) emptySpots.push({ r, c });
            }
        }
        if (emptySpots.length > 0) {
            move = emptySpots[Math.floor(Math.random() * emptySpots.length)];
        }
    }

    if (move) {
      // 2. THE FIX: If the AI forgot a piece and chose an occupied square, trigger a mistake!
      if (isOccupied(move.r, move.c)) {
          console.log("AI forgot a piece and triggered a mistake!");
          // Trigger the mistake penalty specifically for the AI
          handleMistake("The AI tried to place a stone on an occupied square", currentPlayer);
          return; // Stop the piece placement!
      }
      
      // 3. Normal placement
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
    }
  }, 300);
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

function minimizeOverlay() {
    const overlayEl = $('overlay');
    if (overlayEl) overlayEl.classList.add("hidden");
    
    const restoreBtn = $('restore-overlay-btn');
    if (restoreBtn) restoreBtn.classList.remove('hidden');
}

function restoreOverlay() {
    const overlayEl = $('overlay');
    if (overlayEl) overlayEl.classList.remove("hidden");
    
    const restoreBtn = $('restore-overlay-btn');
    if (restoreBtn) restoreBtn.classList.add('hidden');
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

function tabToRules() {
    switchTab('rules');
}

function newGame() {
  clearSelection();
  meterPos = 0; 
  openingStones = [];
  leftSideRole = 1;
  aiPlaysAs = P2; //AI is always playing P2 (white)

  turnDeadline = Date.now() + 30000;
  startLocalClocks();
  
  initMistakeMeter(); 
  updateMistakeMeter(); 
  
  buildBoard();
  hideOverlay();
  clearOverlayButtons();
  if ($('overlayBtn')) $('overlayBtn').onclick = null;

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

function clearSelection() {
    selectedR = null;
    selectedC = null;
    
    // Remove cursor from all cells
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach(cell => cell.classList.remove('selected-cell'));
    
    // THE FIX: Recalculate button state instead of hiding it
    updatePlaceButton();
}

function updatePlaceButton() {
    const placeBtn = $('btn-place');
    if (!placeBtn) return;

    // The button is strictly DISABLED if:
    // 1. The game is over
    // 2. Input is currently locked (opponent's turn, AI thinking, or Swap2 menu is open)
    // 3. No square is currently targeted
    // 4. The board is revealed due to a mistake
    if (gameOver || inputLocked || selectedR === null || selectedC === null || mistakeResumeArmed) {
        placeBtn.disabled = true;
    } else {
        placeBtn.disabled = false;
    }
}

function offerDraw() {
    if (gameOver) return;

    if (isOnline) {
        // Send offer to server
        socket.emit('offer_draw', { matchId: onlineMatchId });
        showOverlay("Draw Offer Sent", "Waiting for opponent to accept or decline...", "Cancel Offer");
        
        $('overlayBtn').onclick = () => {
            hideOverlay();
            // Optional: you could emit a cancel event here, but hiding is fine for now
        };
    } else if (mode === "ai") {
        // AI Logic: Declines unless the board is very crowded (<30% empty space left)
        const emptySpots = state.filter(v => v === 0).length;
        if (emptySpots < (size * size * 0.3)) {
            endGame(null, true); // AI accepts, triggers draw
        } else {
            showOverlay("Draw Declined", "The AI thinks it can still win and refuses your offer.", "Close");
            $('overlayBtn').onclick = hideOverlay;
        }
    } else {
        // Local PvP: Show a prompt to the other player
        const offerer = currentPlayer === P1 ? "Player 1 (Black)" : "Player 2 (White)";
        showOverlay("Draw Offer", `${offerer} is offering a draw. Do you accept?`, "Accept", "Decline", () => {
            // Decline Action
            hideOverlay();
        });

        // Accept Action
        $('overlayBtn').onclick = () => {
            hideOverlay();
            endGame(null, true); // True means it's a draw
        };
    }
}

// --- ONLINE DRAW SOCKET LISTENERS ---
socket.on('draw_offered', () => {
    showOverlay("Draw Offer", "Your opponent is offering a draw. Do you accept?", "Accept", "Decline", () => {
        // Decline Action
        socket.emit('draw_response', { matchId: onlineMatchId, accepted: false });
        hideOverlay();
    });

    // Accept Action
    $('overlayBtn').onclick = () => {
        socket.emit('draw_response', { matchId: onlineMatchId, accepted: true });
        hideOverlay();
    };
});

socket.on('draw_declined', () => {
    showOverlay("Draw Declined", "Your opponent declined the draw offer. The game continues.", "Close");
    $('overlayBtn').onclick = hideOverlay;
});

socket.on('draw_accepted', () => {
    hideOverlay();
    endGame(null, true); // True means it's a draw!
});



socket.on('room_created', (code) => {
  showOverlay("Private Room", `Your room code is: ${code}. Waiting for guest...`, "Cancel");
});

socket.on('move_made', (data) => {
  const { r, c, player, turnDeadline: serverDeadline, nextTurn } = data;

  // Sync the timer
  turnDeadline = serverDeadline;
  
  // FIX 1: Keep local opening stones synced so UI updates properly!
  if (ruleMode === 'swap2' && (swap2Phase === 1 || swap2Phase === 3)) {
      openingStones.push({ r, c, color: player });
  }

  placePiece(r, c, player, { animate: true, sfx: true });
  
  const win = checkWinFrom(r, c, player);
  if (win) { 
    endGame(win); 
    return; 
  }
  
  // FIX 2: Trust the server's turn rather than blindly flipping
  if (nextTurn !== undefined) {
      currentPlayer = nextTurn;
      clearSelection();
      setPills();
  } else {
      switchTurn();
  }
  
  // FIX 3: Accurately manage input lock during Swap2 phases
  if (ruleMode === 'swap2' && swap2Phase === 1) {
      inputLocked = (myOnlineRole !== 1);
  } else if (ruleMode === 'swap2' && swap2Phase === 3) {
      inputLocked = (myOnlineRole !== 2);
  } else {
      inputLocked = (currentPlayer !== myOnlineRole);
  }
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
    showOverlay("Room Closed", "Your opponent left the room.", "Main Menu");
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

socket.on('match_over', ({ winnerRole, ratings, reason }) => {

    gameOver = true;
    if (localTickInterval) clearInterval(localTickInterval);

    const isWinner = (winnerRole === myOnlineRole);
    let title = isWinner ? "Victory!" : "Defeat!";
    let msg = "Play again?";
    let primaryBtnText = isOnline ? "Rematch" : "New Game";

    
    // NEW: Handle the forfeit message
    if (reason === 'opponent_forfeit') {
      msg = `Opponent quit the match. You win by forfeit!`; 
      primaryBtnText = "Main Menu";
    }

    showOverlay(title, msg, primaryBtnText, null, null);

    const mainBtn = $('overlayBtn');
    const bodyEl = $('overlayBody');

    if (mainBtn && reason === 'opponent_forfeit') {
        mainBtn.onclick = () => {
            hideOverlay();
            quitGame();
        };
    } else if (mainBtn) {
        // Standard rematch logic
        mainBtn.onclick = () => {
            mainBtn.onclick = null; // <--- FIX 1: Wipe the memory!
            hideOverlay();
            handleNewGameRequest();
        };
    }
    
    // Ensure we have a valid DOM element and rating data
    if (bodyEl && ratings) {
        // FIX 4: Determine if WE are the winner or the loser
        const isWinner = (winnerRole === myOnlineRole);
        
        // Extract the correct stats for our screen
        const myNewRating = isWinner ? ratings.winnerRating : ratings.loserRating;
        const myGain = isWinner ? ratings.winnerGain : ratings.loserGain;
        
        // Format the UI string (e.g. "+16" or "-16")
        const gainStr = myGain >= 0 ? `+${myGain}` : myGain;
        bodyEl.textContent += `\n\nRating Updated: ${Math.round(myNewRating)} (${gainStr})`;
        
        // Update local stats silently in the background
        if (isWinner) {
            myWins++;
        } else {
            myLosses++;
        }
        myRating = myNewRating;
        
        updateLeaderboard(); 
    }
});

socket.on('swap2_choice_required', ({ phase }) => {
    swap2Phase = phase;
    setPills(); // Refresh the UI to show the phase change

    if (phase === 2 && myOnlineRole === 2) {
        showSwap2ChoiceOverlay(); 
    } else if (phase === 4 && myOnlineRole === 1) {
        showP1FinalChoice(); 
    } else {
        // FIX 4: If it's not my choice, lock my board!
        inputLocked = true;
    }
});

socket.on('opponent_blinked', () => {
    showOverlay("Connection Lost", "Opponent disconnected. Their clock is still ticking...", "Wait");
    // Hide the button so they can't dismiss it until the opponent returns or time runs out
    if ($('overlayBtn')) $('overlayBtn').classList.add('hidden');
});

socket.on('player_reconnected', () => {
    hideOverlay(); // Hide the "Waiting" message
});

socket.on('sync_match_state', (data) => {
    // 1. Update your local game state to match the server
    state = data.state;
    currentPlayer = data.turn;
    turnDeadline = data.turnDeadline;
    
    // 2. Redraw the board
    setAllPiecesVisible(true); // Temporarily show all to sync
    setTimeout(() => setAllPiecesVisible(false), 2000);
    
    hideOverlay();
    inputLocked = (currentPlayer !== myOnlineRole);
});

socket.on('roles_finalized', ({ hostId, guestId, decision }) => {
    const previousPhase = swap2Phase; 
    
    myOnlineRole = (socket.id === hostId) ? 1 : 2;
    leftSideRole = isRoomHost ? myOnlineRole : (myOnlineRole === 1 ? 2 : 1);
    
    swap2Phase = 0; 
    currentPlayer = 2; // White always moves first after setup
    
    inputLocked = (myOnlineRole !== 2); 
    
    const now = Date.now();
    for (let i = 0; i < state.length; i++) { 
        if (state[i] !== 0) placedAt[i] = now; 
    }
    
    if (vanishMs < 3600000) {
        setAllPiecesVisible(false);
    }
    
    hideOverlay();
    clearOverlayButtons();
    setPills(); 

    // 2. THE UX NOTIFICATIONS
    if (previousPhase === 2) {
        // Notifications for P1 waiting on P2's Phase 2 choice
        if (decision === 'swap' && myOnlineRole === 2) {
            showOverlay("Roles Swapped!", "Opponent chose to play as Black. You are now White. It's your turn!", "Continue");
            const mainBtn = $('overlayBtn');
            if (mainBtn) mainBtn.onclick = () => { mainBtn.onclick = null; hideOverlay(); };
            
        } else if (decision === 'stay' && myOnlineRole === 1) {
            showOverlay("Roles Maintained", "Opponent chose to stay as White. Waiting for their move...", "Close");
            const mainBtn = $('overlayBtn');
            if (mainBtn) mainBtn.onclick = () => { mainBtn.onclick = null; hideOverlay(); };
        }
    } else if (previousPhase === 4) {
        // NEW: Notifications for P2 waiting on P1's Phase 4 choice
        if (decision === 'stay' && myOnlineRole === 2) {
            // P1 chose to stay Black. P2 is White and must play immediately.
            showOverlay("Final Roles Set", "Opponent chose to play as Black. You are White. It's your turn!", "Continue");
            const mainBtn = $('overlayBtn');
            if (mainBtn) mainBtn.onclick = () => { mainBtn.onclick = null; hideOverlay(); };
            
        } else if (decision === 'swap' && myOnlineRole === 1) {
            // P1 chose to swap to White. P2 is Black and must wait for P1 to play.
            showOverlay("Final Roles Set", "Opponent chose to play as White. You are Black. Waiting for their move...", "Close");
            const mainBtn = $('overlayBtn');
            if (mainBtn) mainBtn.onclick = () => { mainBtn.onclick = null; hideOverlay(); };
        }
    }
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