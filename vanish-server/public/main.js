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

const $ = (id) => document.getElementById(id);

const boardEl = $("board");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayBody = $("overlayBody");
const overlayBtn = $("overlayBtn");

const modeSelect = $("modeSelect");
const boardSelect = $("boardSelect");
const aiSelect = $("aiSelect");
const aiControl = $("aiControl");
const vanishSelect = $("vanishSelect");
const ruleSelect = $("ruleSelect");

const turnPill = $("turnPill");
const goalPill = $("goalPill");
const modePill = $("modePill");

const newGameBtn = $("newGameBtn");
const audioBtn = $("audioBtn");
const muteToggle = $("muteToggle");
const p2Label = $("p2Label");
const p2Sub = $("p2Sub");
const turnPiece = $("turnPiece");
const mistakeMeterEl = $("mistakeMeter");

const resumeBtn = $("resumeBtn");

// ---------- Audio ----------
let audioCtx = null;
let audioEnabled = false;
let muted = false;

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
let ruleMode = (ruleSelect && ruleSelect.value) ? ruleSelect.value : "nolimit"; 
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

function setPills(){
  turnPill.textContent = `Turn: ${currentPlayer === P1 ? "Black" : (mode==="ai" ? "AI" : "White")}`;
  goalPill.textContent = `Goal: Connect ${goal}`;
  modePill.textContent = `Mode: ${mode === "ai" ? "Single Player" : "PvP"}`;
  p2Label.textContent = (mode==="ai") ? "AI Opponent" : "Player 2";
  p2Sub.textContent = (mode==="ai") ? `Difficulty: ${aiLevel}` : "White";
  
  if (turnPiece){
    turnPiece.classList.toggle("p1", currentPlayer === P1);
    turnPiece.classList.toggle("p2", currentPlayer !== P1);
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

function showOverlay(title, body, btnText="Continue"){
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  overlayBtn.textContent = btnText;
  overlay.classList.remove("hidden");
}
function hideOverlay(){
  overlay.classList.add("hidden");
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



function switchTurn(){
  currentPlayer = (currentPlayer === P1) ? P2 : P1;
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
  clearOverlayButtons();

  const btnContainer = document.createElement('div');
  btnContainer.className = "choice-container";

  const swapBtn = document.createElement('button');
  swapBtn.className = "btn ghost";
  swapBtn.textContent = "Swap to Black";
  swapBtn.onclick = () => { overlayBtn.onclick = null; finalizeRoles(P1); };

  const plus2Btn = document.createElement('button');
  plus2Btn.className = "btn ghost";
  plus2Btn.textContent = "Place 2 More";
  plus2Btn.onclick = () => { 
    overlayBtn.onclick = null; 
    swap2Phase = 3; 
    inputLocked = false; 
    hideOverlay(); 
  };

  btnContainer.append(swapBtn, plus2Btn);
  card.insertBefore(btnContainer, overlayBtn);

  overlayBtn.onclick = () => { overlayBtn.onclick = null; finalizeRoles(P2); };
}

function showP1FinalChoice() {
  inputLocked = true;
  const currentScore = window.evaluatePosition ? window.evaluatePosition(state, P1) : 0;
  const suggestion = currentScore > 0 ? "Black" : "White";

  showOverlay(
    "Swap2: Final Choice", 
    `Player 2 has added two stones. Now, Player 1 (You) must choose your final color. (AI suggests: ${suggestion})`, 
    "Play as Black"
  );

  const card = document.querySelector('.overlay-card');
  clearOverlayButtons();

  const btnContainer = document.createElement('div');
  btnContainer.className = "choice-container";

  const whiteBtn = document.createElement('button');
  whiteBtn.className = "btn ghost";
  whiteBtn.textContent = "Play as White";
  whiteBtn.onclick = () => { overlayBtn.onclick = null; finalizeRoles(P2); };

  btnContainer.appendChild(whiteBtn);
  card.insertBefore(btnContainer, overlayBtn);

  overlayBtn.onclick = () => { overlayBtn.onclick = null; finalizeRoles(P1); };
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
  if (resumeBtn) resumeBtn.classList.add("hidden");

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

  overlayBtn.onclick = () => {
    overlayBtn.onclick = null;
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
    if (resumeBtn) resumeBtn.classList.remove("hidden");
    
    // FIX: Explicitly unlock the board so the player's next click actually registers!
    if (isOnline) {
      inputLocked = (currentPlayer !== myOnlineRole);
    } else {
      inputLocked = false;
    }

    if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) resumeGame();
  };

  if (!hitEnd && resumeBtn) resumeBtn.onclick = resumeGame; 
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

function endGame(winObj, isDraw=false){
  gameOver = true;
  inputLocked = true;

  setAllPiecesVisible(true);

  if (isDraw){
    showOverlay("Draw", "No more moves left. You can close this and review the final board. Click New Game when you're ready to restart.", "Close");
    overlayBtn.onclick = () => { overlayBtn.onclick = null; hideOverlay(); };
    return;
  }

  if (winObj?.line?.length){
    highlightWin(winObj.line);
  }
  sfxWin();

  const winnerText =
    (winObj.player === P1) ? "Player 1 (Black)" :
    (mode==="ai" ? "AI (White)" : "Player 2 (White)");

  showOverlay("Winner!", `${winnerText} connected ${goal}. Close this to review the final board. Click New Game to play again.`, "Close");
  overlayBtn.onclick = () => { overlayBtn.onclick = null; hideOverlay(); };
}

// ---------- AI ----------
function aiMoveSoon() {
  if (gameOver || !inputLocked) {
    inputLocked = true;
  }

  // UX Fix: Tell the user the AI is crunching numbers before locking the thread
  if (turnPill) {
    turnPill.textContent = "Turn: AI (Thinking...)";
    turnPill.style.color = "#ffcf40"; // Give it a gold highlight while thinking
  }

  // Use a short 50ms timeout. This gives the browser exactly enough time 
  // to paint the "Thinking..." text to the screen before the AI locks the thread.
  setTimeout(() => {
    const move = window.chooseAiMove();
    
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
      
      // Reset the turn pill color back to normal for the human
      if (turnPill) turnPill.style.color = ""; 
    }
  }, 50);
}

// ---------- Setup / UI ----------
function applySettingsFromUI(){
  mode = modeSelect.value;
  size = parseInt(boardSelect.value, 10);
  vanishMs = parseInt(vanishSelect.value, 10);
  aiLevel = aiSelect.value;
  
  window.aiLevel = aiLevel; // ✅ syncs difficulty for ai.js engine
  
  ruleMode = (ruleSelect && ruleSelect.value) ? ruleSelect.value : "nolimit"; // ✅ keeps rules working

  goal = (size === 3) ? 3 : 5;

  aiControl.style.display = (mode === "ai") ? "flex" : "none";
  setPills();
}

function finalizeRoles(winnerOfOpening) {
  clearOverlayButtons();
  overlayBtn.onclick = null;

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
  
  applySettingsFromUI();
  initMistakeMeter(); 
  updateMistakeMeter(); 
  
  buildBoard();
  hideOverlay();
  clearOverlayButtons();
  overlayBtn.onclick = null; 
  
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

  if (resumeBtn) resumeBtn.classList.add("hidden");
  
  if (mode === "ai" && currentPlayer === aiPlaysAs && swap2Phase === 0) {
      aiMoveSoon();
  }
}

newGameBtn.addEventListener("click", newGame);

modeSelect.addEventListener("change", () => {
  applySettingsFromUI();
  setPills();
  newGame();
});

boardSelect.addEventListener("change", newGame);

ruleSelect.addEventListener("change", () => {
  applySettingsFromUI();
  newGame();
});

aiSelect.addEventListener("change", () => {
  applySettingsFromUI();
  setPills();
});

vanishSelect.addEventListener("change", newGame);

audioBtn.addEventListener("click", () => {
  ensureAudio();
  audioEnabled = true;
  audioBtn.textContent = "Sound Enabled";
  sfxReveal();
});

muteToggle.addEventListener("change", (e) => {
  muted = e.target.checked;
});

// Add to bottom of main.js
// --- SOCKET MULTIPLAYER EVENTS ---

$('btnGlobal').onclick = () => {
  socket.emit('find_global_match', { vanishMs, ruleMode });
  showOverlay("Matchmaking", "Searching for a 15x15 opponent...", "Cancel");
};

$('btnCreateRoom').onclick = () => {
  socket.emit('create_private_room', { size, vanishMs, ruleMode });
};

$('btnJoinRoom').onclick = () => {
  const code = prompt("Enter 6-digit Room Code:");
  if (code) socket.emit('join_private_room', code.toUpperCase());
};

socket.on('room_created', (code) => {
  showOverlay("Private Room", `Your room code is: ${code}. Waiting for guest...`, "Cancel");
});

socket.on('match_start', (data) => {
  hideOverlay();
  isOnline = true;
  onlineMatchId = data.matchId;
  myOnlineRole = data.role;
  
  // Sync UI to server settings
  size = data.settings.size;
  vanishMs = data.settings.vanishMs;
  ruleMode = data.settings.ruleMode;
  
  // Reset board
  buildBoard();
  currentPlayer = 1;
  inputLocked = (myOnlineRole !== 1); // Lock if you are White
  
  turnPill.textContent = myOnlineRole === 1 ? "You are Black" : "You are White";
});

socket.on('move_made', ({ r, c, player, placedAtUtc }) => {
  // Server confirmed the move. Render it using the absolute UTC time.
  placePiece(r, c, player, { animate: true, sfx: true, absoluteTime: placedAtUtc });
  
  // Standard win checks
  const win = checkWinFrom(r, c, player);
  if (win) { endGame(win); return; }
  
  switchTurn();
  
  // Unlock if it's now your turn
  inputLocked = (currentPlayer !== myOnlineRole);
});

socket.on('turn_forfeited', ({ player }) => {
  // If the opponent is the one who forfeited, show a message
  if (player !== myOnlineRole) {
    showOverlay("Opponent Penalty!", "They made 3 mistakes and forfeited their turn. It is your move!", "Close");
    overlayBtn.onclick = () => { hideOverlay(); };
    meterPos = 0;
    updateMistakeMeter();
  }
  
  switchTurn();
  // Unlock the board for the person whose turn it now is
  inputLocked = (currentPlayer !== myOnlineRole); 
});

socket.on('mistake_broadcast', ({ player }) => {
  handleMistake(null, player);
});

socket.on('turn_forfeited', ({ player }) => {
  switchTurn();
  inputLocked = (currentPlayer !== myOnlineRole); 
});

socket.on('game_resumed', ({ resumeTimeUtc }) => {
  executeResume(resumeTimeUtc);
});

// Final assignments
window.handleSwap2Move = handleSwap2Move;
window.showOverlay = showOverlay;
window.overlayBtn = overlayBtn;
window.finalizeRoles = finalizeRoles;

applySettingsFromUI();
newGame();