/* Vanish - AI Engine (refactored out of main.js)
   - Alpha-beta (negamax) + pattern evaluation + move ordering + time budget
   - Includes optional human-like memory model (imperfect opponent-stone recall)
   This file defines global functions used by main.js.
*/
(() => {
  'use strict';

// ----- Stronger AI for larger boards -----
// Alpha–beta (negamax) + pattern evaluation + move ordering + time budget.
// Also includes an optional "human-like memory" model (imperfect opponent-stone recall).

function chooseAiMove(){
  // Easy: uses the same engine with small time/candidates + more forgetting.
  if (aiLevel === "easy"){
    if (size === 3) return minimaxBestMove(aiPlaysAs);
    return alphaBetaBestMove({timeMs: 70, maxDepth: 3, maxCandidates: 8, forgetBase: 0.22});
  }

  if (size === 3){
    return minimaxBestMove(aiPlaysAs);
  }

  if (aiLevel === "medium"){
    return alphaBetaBestMove({timeMs: 160, maxDepth: 5, maxCandidates: 12, forgetBase: 0.12});
  }

  // hard
  return alphaBetaBestMove({timeMs: 380, maxDepth: 7, maxCandidates: 16, forgetBase: 0.04});
}

// --- Memory model: AI may "forget" some opponent stones when the board is hidden.
// This keeps solo play fairer in Vanish.
function getAiPerceivedState(forgetBase){
  if (boardEl.classList.contains("reveal")) return state;
  if (vanishMs >= 3600000) return state;

  const now = performance.now();
  const dt = Math.max(0, now - lastRevealAt);

  // Forgetting grows with time since last reveal (caps at ~15s).
  const t = Math.max(0, Math.min(1, dt / 15000));
  const p = forgetBase * t;

  if (p <= 0.0001) return state;

  const me = aiPlaysAs;
  const opp = (me === P1) ? P2 : P1;
  const s = state.slice();

  for (let i=0; i<s.length; i++){
    if (s[i] === opp){
      // Newer stones are less likely to be forgotten (within last ~8s)
      const age = Math.max(0, now - (placedAt[i] || 0));
      const ageFactor = Math.max(0.35, Math.min(1, age / 8000));
      const pp = p * ageFactor;

      if (Math.random() < pp){
        s[i] = 0;
      }
    }
  }
  return s;
}

function alphaBetaBestMove({timeMs, maxDepth, maxCandidates, forgetBase}){
  const me = aiPlaysAs;
  const opp = (me === P1) ? P2 : P1;

  const deadline = performance.now() + timeMs;

  // Use perceived state for move selection fairness
  const rootState = getAiPerceivedState(forgetBase);

  // Quick tactical checks (win now / block now)
  const immediate = findImmediateTactic(rootState, me, opp);
  if (immediate) return immediate;

  let bestMove = null;
  let bestScore = -Infinity;

  let rootMoves = generateCandidates(rootState, me, maxCandidates);
  if (!rootMoves.length) return randomEmptyMove();

  // Iterative deepening
  for (let depth=1; depth<=maxDepth; depth++){
    const res = negamaxRoot(rootState, depth, deadline, me, opp, rootMoves);
    if (res.timedOut) break;
    if (res.bestMove){
      bestMove = res.bestMove;
      bestScore = res.bestScore;
      if (bestScore > 900000) break;
    }
  }

  return bestMove || {r:rootMoves[0].r, c:rootMoves[0].c} || randomEmptyMove();
}

/* ai.js - Renju Mode Support */

function findImmediateTactic(s, me, opp){
  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const k = idx(r,c);
      if (s[k] !== 0) continue;

      // Check if move is legal for current player if Renju is active
      if (ruleMode === "renju" && me === P1) {
        s[k] = P1;
        const illegal = window.violatesRenju(r, c);
        s[k] = 0;
        if (illegal) continue; 
      }

      s[k] = me;
      const w1 = checkWinFrom(r,c,me);
      s[k] = 0;
      if (w1) return {r,c};

      // Blocking opponent: Opponent only has restrictions if they are P1
      if (ruleMode === "renju" && opp === P1) {
        s[k] = P1;
        const res = window.violatesRenju(r, c); // Changed to handle object
        s[k] = 0;
        if (!res.isValid) continue;
      }

      s[k] = opp;
      const w2 = checkWinFrom(r,c,opp);
      s[k] = 0;
      if (w2) return {r,c};
    }
  }
  return null;
}


function generateCandidates(s, player, limit){
  const cand = [];
  let hasAny = false;

  for (let i=0; i<s.length; i++){
    if (s[i] !== 0){ hasAny = true; break; }
  }

  if (!hasAny){
    const mid = (size/2)|0;
    return [{r:mid,c:mid, quick: 0}];
  }

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const k = idx(r,c);
      if (s[k] !== 0) continue;
      if (!nearStone(s, r, c, 2)) continue;

      // RENJU FILTER: If AI is P1 (Black), skip moves that violate rules
      if (ruleMode === "renju" && player === P1) {
        // Temporarily set state for validator
        const oldVal = s[k];
        s[k] = P1;
        const illegal = window.violatesRenju(r, c);
        s[k] = oldVal;
        if (illegal) continue; 
      }

      const quick = quickMoveScore(s, r, c, player);
      cand.push({r,c, quick});
    }
  }

  cand.sort((a,b)=> b.quick - a.quick);
  return cand.slice(0, limit);
}

function negamaxRoot(s, depth, deadline, me, opp, moves){
  let alpha = -Infinity;
  let beta = Infinity;
  let bestMove = null;
  let bestScore = -Infinity;

  const ordered = moves.slice().sort((a,b)=> b.quick - a.quick);

  for (const m of ordered){
    if (performance.now() > deadline) return {timedOut:true, bestMove, bestScore};

    const k = idx(m.r,m.c);
    s[k] = me;

    let score;
    const win = checkWinFrom(m.r,m.c,me);
    if (win){
      score = 1000000;
    } else {
      score = -negamax(s, depth-1, -beta, -alpha, opp, me, deadline);
    }

    s[k] = 0;

    if (score > bestScore){
      bestScore = score;
      bestMove = {r:m.r, c:m.c};
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  return {timedOut:false, bestMove, bestScore};
}

function negamax(s, depth, alpha, beta, player, other, deadline){
  if (performance.now() > deadline) return evaluatePosition(s, aiPlaysAs);

  if (depth <= 0){
    return evaluatePosition(s, aiPlaysAs);
  }

  const moves = generateCandidates(s, player, (aiLevel==="hard")?16:12);
  if (!moves.length) return 0;

  moves.sort((a,b)=> b.quick - a.quick);

  let best = -Infinity;

  for (const m of moves){
    if (performance.now() > deadline) return evaluatePosition(s, aiPlaysAs);

    const k = idx(m.r,m.c);
    s[k] = player;

    let score;
    const win = checkWinFrom(m.r,m.c,player);
    if (win){
      score = 900000 + depth * 500;
    } else {
      score = -negamax(s, depth-1, -beta, -alpha, other, player, deadline);
    }

    s[k] = 0;

    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  return best;
}


function nearStone(s, r, c, rad){
  for (let dr=-rad; dr<=rad; dr++){
    for (let dc=-rad; dc<=rad; dc++){
      if (dr===0 && dc===0) continue;
      const rr=r+dr, cc=c+dc;
      if (rr<0||cc<0||rr>=size||cc>=size) continue;
      if (s[idx(rr,cc)] !== 0) return true;
    }
  }
  return false;
}

function quickMoveScore(s, r, c, player){
  const me = player;
  const opp = (me === P1) ? P2 : P1;

  const off = patternScoreIfPlaced(s, r, c, me);
  const def = patternScoreIfPlaced(s, r, c, opp) * 0.9;

  const center = (size-1)/2;
  const dist = Math.abs(r-center) + Math.abs(c-center);
  const cen = (size*0.7 - dist) * 4;

  return off + def + cen;
}

function patternScoreIfPlaced(s, r, c, player){
  const k = idx(r,c);
  s[k] = player;
  const sc = patternScoreAt(s, r, c, player);
  s[k] = 0;
  return sc;
}

function patternScoreAt(s, r, c, player){
  const dirs = [
    {dr:0, dc:1},
    {dr:1, dc:0},
    {dr:1, dc:1},
    {dr:1, dc:-1},
  ];

  let total = 0;

  for (const {dr,dc} of dirs){
    const {count, openEnds} = lineInfo(s, r, c, dr, dc, player);

    if (count >= goal) total += 200000;

    if (count === 4 && openEnds === 2) total += 90000;
    else if (count === 4 && openEnds === 1) total += 35000;
    else if (count === 3 && openEnds === 2) total += 12000;
    else if (count === 3 && openEnds === 1) total += 3500;
    else if (count === 2 && openEnds === 2) total += 1200;
    else if (count === 2 && openEnds === 1) total += 400;
    else total += count * 12;

    total += openEnds * 60;
  }

  return total;
}

function lineInfo(s, r, c, dr, dc, player){
  let count = 1;

  let rr=r+dr, cc=c+dc;
  while (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===player){
    count++; rr+=dr; cc+=dc;
  }
  let open1 = (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===0) ? 1 : 0;

  rr=r-dr; cc=c-dc;
  while (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===player){
    count++; rr-=dr; cc-=dc;
  }
  let open2 = (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===0) ? 1 : 0;

  return {count, openEnds: open1 + open2};
}

function evaluatePosition(s, perspective){
  const me = perspective;
  const opp = (me === P1) ? P2 : P1;

  let meScore = 0;
  let oppScore = 0;

  const dirs = [
    {dr:0, dc:1},
    {dr:1, dc:0},
    {dr:1, dc:1},
    {dr:1, dc:-1},
  ];

  for (let r=0; r<size; r++){
    for (let c=0; c<size; c++){
      const v = s[idx(r,c)];
      if (v === 0) continue;

      for (const {dr,dc} of dirs){
        const {count, openEnds} = lineInfo(s, r, c, dr, dc, v);

        let add = 0;
        if (count >= goal) add = 500000;
        else if (count === 4 && openEnds === 2) add = 50000;
        else if (count === 4 && openEnds === 1) add = 18000;
        else if (count === 3 && openEnds === 2) add = 6500;
        else if (count === 3 && openEnds === 1) add = 1800;
        else if (count === 2 && openEnds === 2) add = 600;
        else if (count === 2 && openEnds === 1) add = 180;
        else add = count * 10;

        add += openEnds * 25;

        if (v === me) meScore += add;
        else oppScore += add;
      }
    }
  }

  return meScore - oppScore * 1.05;
}

  // expose entrypoint
  window.chooseAiMove = chooseAiMove;
  window.aiChooseMove = chooseAiMove;
})();
