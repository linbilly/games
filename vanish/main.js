/* Vanish - full game
   - 3x3 connect 3 (tic tac toe)
   - 8x8 connect 5
   - 12x12 connect 5
   - Pieces visually vanish after N ms but remain in state
   - Mistake on occupied: reveal board briefly, lose turn
   - AI opponent for single player: Easy/Medium/Hard
*/

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

// ---------- Audio (WebAudio, no files needed) ----------
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
  const seq = [
    {f:520, d:0.08},
    {f:660, d:0.08},
    {f:880, d:0.10},
  ];
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

let state = [];          // 0 empty, 1 P1, 2 P2
let pieceEls = [];
let placedAt = [];       // ms timestamps of placement (for AI memory model)
let lastRevealAt = 0;    // ms timestamp of last full reveal       // DOM references for the "piece" div in each cell
let currentPlayer = P1;
let gameOver = false;

let mode = "pvp";        // "pvp" | "ai"
let aiLevel = "medium";
let ruleMode = (ruleSelect && ruleSelect.value) ? ruleSelect.value : "nolimit"; // nolimit | renju | swap2 (if UI present)
let aiPlaysAs = P2;      // AI is player 2
let inputLocked = false;
let mistakeResumeArmed = false; // board revealed after mistake; next click auto-resumes

// Penalty system
let meterPos = 0; // -3 .. +3 (0 is center). P1 mistakes move left (negative), P2 mistakes move right (positive).
let skipNext = { [P1]: false, [P2]: false };

function idx(r,c){ return r*size + c; }
function inBounds(r,c){ return r>=0 && c>=0 && r<size && c<size; }

function setPills(){
  turnPill.textContent = `Turn: ${currentPlayer === P1 ? "P1" : (mode==="ai" ? "AI" : "P2")}`;
  goalPill.textContent = `Goal: Connect ${goal}`;
  modePill.textContent = `Mode: ${mode === "ai" ? "Single Player" : "PvP"}`;
  p2Label.textContent = (mode==="ai") ? "AI Opponent" : "Player 2";
  p2Sub.textContent = (mode==="ai") ? `Difficulty: ${aiLevel}` : "Red";
  // Side turn indicator piece
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

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const cell = document.createElement("div");
      cell.className = "cell";
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

  clearWinHighlights();
  setPills();
  initMistakeMeter();
  updateMistakeMeter();
}

function clearWinHighlights(){
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach(c => c.classList.remove("win-line"));
}

function renderPieceVisible(r,c,player){
  const k = idx(r,c);
  const piece = pieceEls[k];
  piece.style.opacity = "";
  piece.style.transform = "";
  piece.className = `piece ${player === P1 ? "p1" : "p2"} pop-in`;

  // schedule vanish animation
  window.setTimeout(() => {
    if (boardEl.classList.contains("reveal")) return;
    piece.classList.remove("pop-in");
    piece.classList.add("fade-out");
  }, Math.max(0, vanishMs - 800));

  window.setTimeout(() => {
    if (boardEl.classList.contains("reveal")) return;
    piece.classList.remove("fade-out");
    piece.style.opacity = "0";
  }, vanishMs);
}

function setAllPiecesVisible(forceVisible) {
  if (forceVisible) {
    boardEl.classList.add("reveal");
    lastRevealAt = performance.now();
  } else {
    boardEl.classList.remove("reveal");
  }

  const now = performance.now();

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
        // Remove any active fade-out classes while board is revealed
        piece.classList.remove("fade-out");
      } else {
        // RESUME LOGIC: Check if this piece should still be visible
        const age = now - placedAt[k];
        const remaining = vanishMs - age;

        // If vanishMs is 60 mins (3600000ms), it effectively never vanishes.
        if (remaining > 0) {
          piece.style.opacity = "1";
          piece.style.transform = "scale(1)";
          
          // Re-trigger the vanish timer for the remaining duration
          window.setTimeout(() => {
            if (boardEl.classList.contains("reveal")) return;
            piece.classList.add("fade-out");
          }, Math.max(0, remaining - 800));

          window.setTimeout(() => {
            if (boardEl.classList.contains("reveal")) return;
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

function applySkipIfNeeded(){
  if (skipNext[currentPlayer]){
    skipNext[currentPlayer] = false;
    // Keep board hidden when skipping
    setAllPiecesVisible(false);
    showOverlay(
      "Penalty",
      `${currentPlayer===P1?"Player 1":"Player 2"} forfeits this move (meter hit the end).`,
      "OK"
    );
    // After acknowledging, pass turn
    overlayBtn.onclick = () => { overlayBtn.onclick = null; hideOverlay(); switchTurn(); };
    return true;
  }
  return false;
}

function switchTurn(){
  currentPlayer = (currentPlayer === P1) ? P2 : P1;
  setPills();
  // If the next player must skip, apply immediately.
  applySkipIfNeeded();
}

function isOccupied(r,c){
  return state[idx(r,c)] !== 0;
}

function onCellClick(r,c){
  if (gameOver || inputLocked) return;

  // If the board is revealed from a mistake, the next player's first click auto-resumes.
  if (mistakeResumeArmed){
    mistakeResumeArmed = false;
    setAllPiecesVisible(false);
    if (resumeBtn) if (resumeBtn) resumeBtn && resumeBtn.classList.add("hidden");
  }
  if (mode === "ai" && currentPlayer === aiPlaysAs) return;


  if (isOccupied(r,c)){
    handleMistake();
    return;
  }

  // --- RENJU INTEGRATION START ---

  if (ruleMode === "renju" && currentPlayer === P1) {
      state[idx(r,c)] = P1; 
      const result = window.violatesRenju(r,c);
      state[idx(r,c)] = 0; 

      if (!result.isValid) {
          handleMistake(result.reason); // Pass the specific rule name
          return;
      }
  }
  // --- RENJU INTEGRATION END ---

  placePiece(r,c,currentPlayer, {animate:true, sfx:true});
  const win = checkWinFrom(r,c,currentPlayer);
  if (win){
    endGame(win);
    return;
  }

  if (!state.includes(0)){
    endGame({player:0, line:[]}, true);
    return;
  }

  switchTurn();

  if (mode === "ai" && currentPlayer === aiPlaysAs){
    aiMoveSoon();
  }
}

function placePiece(r,c,player,{animate=false,sfx=false}={}){
  const _k = idx(r,c);
  state[_k] = player;
  placedAt[_k] = performance.now();
  if (sfx) sfxPlace();
  if (animate) renderPieceVisible(r,c,player);
  else {
    const k = idx(r,c);
    const piece = pieceEls[k];
    piece.className = `piece ${player===P1?"p1":"p2"}`;
    piece.style.opacity = "0";
  }
}

/* main.js - Fixed handleMistake */
function handleMistake(customMsg) {
  sfxMistake();
  inputLocked = true;

  setAllPiecesVisible(true);
  sfxReveal();

  if (currentPlayer === P1) meterPos--;
  else meterPos++;

  meterPos = Math.max(-3, Math.min(3, meterPos));
  updateMistakeMeter();

  const hitEnd = (meterPos === -3) || (meterPos === 3);
  const bodyMessage = customMsg ? `${customMsg}.` : "Occupied square.";

  const title = hitEnd ? "Penalty!" : "Mistake";
  const msg = hitEnd
    ? `Third mistake reached the end of the meter. ${bodyMessage} You forfeit this move.`
    : `${bodyMessage} The board is revealed for review. Close this message, then click the board or press Resume to continue.`;

  showOverlay(title, msg, "Close");

  const resumeGame = () => {
    if (hitEnd) return;
    setAllPiecesVisible(false);
    if (resumeBtn) resumeBtn.classList.add("hidden");
    mistakeResumeArmed = false;
    inputLocked = false;
    if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) {
      aiMoveSoon();
    }
  };

  overlayBtn.onclick = () => {
    overlayBtn.onclick = null;
    hideOverlay();

    if (hitEnd) {
      meterPos = 0; 
      updateMistakeMeter();
      setAllPiecesVisible(false);
      inputLocked = false;
      switchTurn();
      if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) {
        aiMoveSoon();
      }
      return;
    }

    inputLocked = false;
    mistakeResumeArmed = true;
    if (resumeBtn) resumeBtn.classList.remove("hidden");

    if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver) {
      resumeGame();
    }
  };

  // Fixed Button Logic: Use onclick to avoid parentNode null errors
  if (!hitEnd && resumeBtn) {
    resumeBtn.onclick = resumeGame; 
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

function endGame(winObj, isDraw=false){
  gameOver = true;
  inputLocked = true;

  // reveal full board permanently so players can review
  setAllPiecesVisible(true);

  if (isDraw){
    showOverlay("Draw", "No more moves left. You can close this and review the final board. Click New Game when you're ready to restart.", "Close");
    // Just close — don't reset the board automatically
    overlayBtn.onclick = () => { overlayBtn.onclick = null; hideOverlay(); };
    return;
  }

  if (winObj?.line?.length){
    highlightWin(winObj.line);
  }
  sfxWin();

  const winnerText =
    (winObj.player === P1) ? "Player 1 (Blue)" :
    (mode==="ai" ? "AI (Red)" : "Player 2 (Red)");

  showOverlay("Winner!", `${winnerText} connected ${goal}. Close this to review the final board. Click New Game to play again.`, "Close");
  // Just close — keep the revealed board for review
  overlayBtn.onclick = () => { overlayBtn.onclick = null; hideOverlay(); };
}




// ---------- AI ----------
function aiMoveSoon(){
  inputLocked = true;
  setTimeout(() => {
    if (gameOver) return;
    const move = chooseAiMove();
    if (!move){
      endGame({player:0,line:[]}, true);
      return;
    }
    placePiece(move.r, move.c, aiPlaysAs, {animate:true, sfx:true});
    const win = checkWinFrom(move.r, move.c, aiPlaysAs);
    if (win){
      endGame(win);
      return;
    }
    if (!state.includes(0)){
      endGame({player:0,line:[]}, true);
      return;
    }
    switchTurn();
    inputLocked = false;
  }, 420);
}


function chooseAiMove(){
  // AI engine is in ai.js (window.aiChooseMove). No legacy heuristic fallbacks.
  if (aiLevel === "easy") aiLevel = "medium"; // just in case old settings existed
  if (window.aiChooseMove) return window.aiChooseMove();
  // Fallback: pick first empty (should never happen if ai.js loaded)
  return randomEmptyMove();
}


function randomEmptyMove(){
  const empties = [];
  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      if (state[idx(r,c)]===0) empties.push({r,c});
    }
  }
  if (!empties.length) return null;
  return empties[Math.floor(Math.random()*empties.length)];
}

// ----- Minimax for 3x3 -----
function minimaxBestMove(player){
  const opponent = (player===P1)?P2:P1;

  function winnerOn3(){
    const lines = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6]
    ];
    for (const L of lines){
      const a=state[L[0]], b=state[L[1]], c=state[L[2]];
      if (a && a===b && b===c) return a;
    }
    return 0;
  }

  function minimax(turn, depth){
    const w = winnerOn3();
    if (w === player) return 10 - depth;
    if (w === opponent) return depth - 10;
    if (!state.includes(0)) return 0;

    let best = (turn===player) ? -Infinity : Infinity;

    for (let i=0; i<9; i++){
      if (state[i]!==0) continue;
      state[i] = turn;
      const score = minimax(turn===player?opponent:player, depth+1);
      state[i] = 0;

      if (turn===player) best = Math.max(best, score);
      else best = Math.min(best, score);
    }
    return best;
  }

  let bestScore = -Infinity;
  let bestMove = null;

  for (let r=0; r<3; r++){
    for (let c=0; c<3; c++){
      const k = idx(r,c);
      if (state[k]!==0) continue;
      state[k] = player;
      const score = minimax(opponent, 0);
      state[k] = 0;
      if (score > bestScore){
        bestScore = score;
        bestMove = {r,c};
      }
    }
  }

  return bestMove || randomEmptyMove();
}

// ---------- Setup / UI ----------
function applySettingsFromUI(){
  mode = modeSelect.value;
  size = parseInt(boardSelect.value, 10);
  vanishMs = parseInt(vanishSelect.value, 10);
  aiLevel = aiSelect.value;

  goal = (size === 3) ? 3 : 5;

  aiControl.style.display = (mode === "ai") ? "flex" : "none";
  setPills();
}

function newGame() {
  meterPos = 0; 
  skipNext[P1] = false;
  skipNext[P2] = false;
  
  ruleMode = (ruleSelect && ruleSelect.value) ? ruleSelect.value : "nolimit";
  applySettingsFromUI();
  
  initMistakeMeter(); 
  updateMistakeMeter(); 
  
  buildBoard();
  hideOverlay();
  setPills();
  
  inputLocked = false;
  
  // If vanishMs is 60 minutes, start the board in reveal mode
  if (vanishMs >= 3600000) {
    setAllPiecesVisible(true);
  } else {
    setAllPiecesVisible(false);
  }

  if (resumeBtn) resumeBtn.classList.add("hidden");
}

newGameBtn.addEventListener("click", newGame);

modeSelect.addEventListener("change", () => {
  applySettingsFromUI();
  setPills();
  newGame();
});

boardSelect.addEventListener("change", newGame);
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

applySettingsFromUI();
newGame();
