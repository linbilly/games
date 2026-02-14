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

const turnPill = $("turnPill");
const goalPill = $("goalPill");
const modePill = $("modePill");

const newGameBtn = $("newGameBtn");
const resumeBtn = $("resumeBtn");

const turnPiece = $("turnPiece");


const audioBtn = $("audioBtn");
const muteToggle = $("muteToggle");
const p2Label = $("p2Label");
const p2Sub = $("p2Sub");

// ---------- Audio (WebAudio, no files needed) ----------
let audioCtx = null;
let audioEnabled = false;
let muted = false;

let mistakeResumeArmed = false; // board revealed after mistake; next click auto-resumes


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
let pieceEls = [];       // DOM references for the "piece" div in each cell
let currentPlayer = P1;
let gameOver = false;

let mode = "pvp";        // "pvp" | "ai"
let aiLevel = "medium";
let aiPlaysAs = P2;      // AI is player 2
let inputLocked = false;

function idx(r,c){ return r*size + c; }
function inBounds(r,c){ return r>=0 && c>=0 && r<size && c<size; }

function setPills(){

  // Side turn indicator piece
  if (turnPiece){
    turnPiece.classList.toggle("p1", currentPlayer === P1);
    turnPiece.classList.toggle("p2", currentPlayer !== P1);
  }

  turnPill.textContent = `Turn: ${currentPlayer === P1 ? "P1" : (mode==="ai" ? "AI" : "P2")}`;
  goalPill.textContent = `Goal: Connect ${goal}`;
  modePill.textContent = `Mode: ${mode === "ai" ? "Single Player" : "PvP"}`;
  p2Label.textContent = (mode==="ai") ? "AI Opponent" : "Player 2";
  p2Sub.textContent = (mode==="ai") ? `Difficulty: ${aiLevel}` : "Red";
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
}

function clearWinHighlights(){
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach(c => c.classList.remove("win-line"));
}

function renderPieceVisible(r,c,player){
  const k = idx(r,c);
  const piece = pieceEls[k];

  piece.style.opacity = "0";
  piece.style.transform = "scale(.6)";
  piece.className = `piece ${player === P1 ? "p1" : "p2"} pop-in`;

  // ✅ 60 minutes = effectively always visible
  if (vanishMs >= 3600000){
    setTimeout(() => {
      piece.classList.remove("pop-in");
      piece.style.opacity = "1";
      piece.style.transform = "scale(1)";
    }, 170);
    return;
  }

  // ✅ fade duration scales with vanish time
  const fadeDur = Math.max(450, Math.min(1300, Math.floor(vanishMs * 0.35)));
  piece.style.transition = `opacity ${fadeDur}ms ease, transform ${fadeDur}ms ease`;

  setTimeout(() => {
    if (boardEl.classList.contains("reveal")) return;
    piece.classList.remove("pop-in");
    piece.style.opacity = "1";
    piece.style.transform = "scale(1)";
  }, 170);

  const startFadeAt = Math.max(0, vanishMs - fadeDur);
  window.setTimeout(() => {
    if (boardEl.classList.contains("reveal")) return;
    piece.style.opacity = "0";
    piece.style.transform = "scale(.98)";
  }, startFadeAt);
}


function setAllPiecesVisible(forceVisible){
  // ✅ If vanish time is 'stay revealed', never hide pieces.
  if (!forceVisible && vanishMs >= 3600000){
    forceVisible = true;
    boardEl.classList.add("reveal");
  }

  if (forceVisible) boardEl.classList.add("reveal");
  else boardEl.classList.remove("reveal");

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const k = idx(r,c);
      const v = state[k];
      const piece = pieceEls[k];

      if (v === 0){
        piece.className = "piece";
        piece.style.opacity = "0";
      } else {
        piece.className = `piece ${v===P1?"p1":"p2"}`;
        if (forceVisible){
          piece.style.opacity = "1";
          piece.style.transform = "scale(1)";
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

function onCellClick(r,c){
  if (gameOver || inputLocked) return;

  // If the board is revealed from a mistake, the next player's first click auto-resumes.
  if (mistakeResumeArmed){
    mistakeResumeArmed = false;
    setAllPiecesVisible(false);           // vanish
    resumeBtn.classList.add("hidden");    // hide the Resume button if you have it
  }

  if (mode === "ai" && currentPlayer === aiPlaysAs) return;

  if (isOccupied(r,c)){
    handleMistake();
    return;
  }

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
  state[idx(r,c)] = player;
  if (sfx) sfxPlace();
  if (animate) renderPieceVisible(r,c,player);
  else {
    const k = idx(r,c);
    const piece = pieceEls[k];
    piece.className = `piece ${player===P1?"p1":"p2"}`;
    piece.style.opacity = "0";
  }
}

function handleMistake(){
  sfxMistake();
  inputLocked = true;

  // Reveal board
  setAllPiecesVisible(true);
  sfxReveal();

  // Show Resume button
  resumeBtn.classList.remove("hidden");

  showOverlay(
    "Uh oh!",
    "You lose your turn. Opponent's turn next.",
    "OK"
  );

  // Lose turn immediately
  switchTurn();

  overlayBtn.onclick = () => {
    overlayBtn.onclick = null;
    hideOverlay();
    // Keep board revealed until Resume is clicked

    // Allow next player to continue while board is still revealed.
    inputLocked = false;
    mistakeResumeArmed = true;

    if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver){
      setAllPiecesVisible(false);
      resumeBtn.classList.add("hidden");
      mistakeResumeArmed = false;
      aiMoveSoon();
    }


  };

  const resumeGame = () => {
    // Hide board again (vanish)
    setAllPiecesVisible(false);

    // Hide Resume button
    resumeBtn.classList.add("hidden");

    inputLocked = false;

    // If AI's turn, proceed
    if (mode === "ai" && currentPlayer === aiPlaysAs && !gameOver){
      aiMoveSoon();
    }

    resumeBtn.removeEventListener("click", resumeGame);
  };

  resumeBtn.addEventListener("click", resumeGame);
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
  if (aiLevel === "easy"){
    return randomEmptyMove();
  }
  if (size === 3){
    return minimaxBestMove(aiPlaysAs);
  }
  return heuristicBestMove(aiLevel);
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

// ----- Heuristic for larger boards -----
function heuristicBestMove(level){
  const me = aiPlaysAs;
  const opp = (me===P1)?P2:P1;

  const noise = (level === "medium") ? 0.35 : 0.08;

  let best = {score:-Infinity, r:0, c:0};

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const k = idx(r,c);
      if (state[k] !== 0) continue;

      const s = scoreCell(r,c,me) + 0.85*scoreCell(r,c,opp);
      const jitter = (Math.random()*2-1) * noise;
      const total = s + jitter;

      if (total > best.score){
        best = {score: total, r, c};
      }
    }
  }

  return best.score === -Infinity ? null : {r:best.r, c:best.c};
}

function scoreCell(r,c,player){
  const dirs = [
    {dr:0, dc:1},
    {dr:1, dc:0},
    {dr:1, dc:1},
    {dr:1, dc:-1},
  ];

  let total = 0;
  const k0 = idx(r,c);
  state[k0] = player;

  for (const {dr,dc} of dirs){
    const run = countRun(r,c,dr,dc,player);
    const openEnds = countOpenEnds(r,c,dr,dc,player);

    if (run >= goal) total += 1e6;
    total += Math.pow(run, 3) * 25;
    total += openEnds * 18;

    const center = (size-1)/2;
    const dist = Math.abs(r-center) + Math.abs(c-center);
    total += (size*0.8 - dist) * 0.8;
  }

  state[k0] = 0;
  return total;
}

function countRun(r,c,dr,dc,player){
  let count = 1;

  let rr=r+dr, cc=c+dc;
  while (inBounds(rr,cc) && state[idx(rr,cc)]===player){
    count++; rr+=dr; cc+=dc;
  }
  rr=r-dr; cc=c-dc;
  while (inBounds(rr,cc) && state[idx(rr,cc)]===player){
    count++; rr-=dr; cc-=dc;
  }
  return count;
}

function countOpenEnds(r,c,dr,dc,player){
  let open = 0;

  let rr=r, cc=c;
  while (inBounds(rr+dr,cc+dc) && state[idx(rr+dr,cc+dc)]===player){
    rr+=dr; cc+=dc;
  }
  if (inBounds(rr+dr,cc+dc) && state[idx(rr+dr,cc+dc)]===0) open++;

  rr=r; cc=c;
  while (inBounds(rr-dr,cc-dc) && state[idx(rr-dr,cc-dc)]===player){
    rr-=dr; cc-=dc;
  }
  if (inBounds(rr-dr,cc-dc) && state[idx(rr-dr,cc-dc)]===0) open++;

  return open;
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

function newGame(){
  resumeBtn.classList.add("hidden");
  applySettingsFromUI();
  buildBoard();
  hideOverlay();
  setPills();
  inputLocked = false;

  if (vanishMs >= 3600000){
    setAllPiecesVisible(true);
  } else {
    setAllPiecesVisible(false);
  }
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
