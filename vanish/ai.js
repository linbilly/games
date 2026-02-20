/* Vanish - AI Engine */
(() => {
  'use strict';

  /* Replace the AI_CONFIGS at the top of ai.js */
  const AI_CONFIGS = {
    "easy":   { depth: 2, candidates: 2,  timeMs: 400,  forgetBase: 0.30 }, // High forgetfulness, narrow vision
    "medium": { depth: 4, candidates: 6,  timeMs: 800,  forgetBase: 0.12 },
    "hard":   { depth: 6, candidates: 12, timeMs: 2500, forgetBase: 0.04 }
  };

  function getAIParams() {
    return AI_CONFIGS[window.aiLevel || "medium"] || AI_CONFIGS["medium"];
  }

  function chooseAiMove(){
    if (size === 3) return minimaxBestMove(aiPlaysAs);
    return alphaBetaBestMove(getAIParams());
  }

  function getAiPerceivedState(forgetBase){
    if (boardEl.classList.contains("reveal") || vanishMs >= 3600000) return state;

    const now = performance.now();
    const dt = Math.max(0, now - lastRevealAt);
    const t = Math.max(0, Math.min(1, dt / 15000));
    const p = forgetBase * t;

    if (p <= 0.0001) return state;

    const me = aiPlaysAs;
    const opp = (me === P1) ? P2 : P1;
    const s = state.slice();

    for (let i=0; i<s.length; i++){
      if (s[i] === opp){
        const age = Math.max(0, now - (placedAt[i] || 0));
        const ageFactor = Math.max(0.35, Math.min(1, age / 8000));
        if (Math.random() < p * ageFactor) s[i] = 0;
      }
    }
    return s;
  }

  function alphaBetaBestMove({timeMs, depth, candidates, forgetBase}){
    const me = aiPlaysAs;
    const opp = (me === P1) ? P2 : P1;
    const deadline = performance.now() + timeMs;
    const rootState = getAiPerceivedState(forgetBase);

    const immediate = findImmediateTactic(rootState, me, opp);
    if (immediate) return immediate;

    let bestMove = null;
    let bestScore = -Infinity;
    let rootMoves = generateCandidates(rootState, me, candidates);
    if (!rootMoves.length) return randomEmptyMove();

    for (let d=1; d<=depth; d++){
      const res = negamaxRoot(rootState, d, deadline, me, opp, rootMoves, candidates);
      if (res.timedOut) break;
      if (res.bestMove){
        bestMove = res.bestMove;
        bestScore = res.bestScore;
        if (bestScore > 900000) break;
      }
    }

    return bestMove || {r:rootMoves[0].r, c:rootMoves[0].c} || randomEmptyMove();
  }

  function findImmediateTactic(s, me, opp){
    const isRenju = (ruleMode === "renju" || ruleMode === "swap2");

    for (let r=0; r<size; r++){
      for (let c=0; c<size; c++){
        const k = idx(r,c);
        if (s[k] !== 0) continue;

        if (isRenju && me === P1) {
          s[k] = P1;
          const res = window.violatesRenju(r, c, 1, s); 
          s[k] = 0;
          if (!res.isValid) continue; 
        }

        s[k] = me;
        const w1 = checkWinFrom(r,c,me);
        s[k] = 0;
        if (w1) return {r,c};

        if (isRenju && opp === P1) {
          s[k] = P1;
          const res = window.violatesRenju(r, c, 1, s);
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
    for (let i=0; i<s.length; i++){ if (s[i] !== 0){ hasAny = true; break; } }

    if (!hasAny){
      const mid = (size/2)|0;
      return [{r:mid,c:mid, quick: 0}];
    }

    const isRenju = (ruleMode === "renju" || ruleMode === "swap2");

    for (let r=0; r<size; r++){
      for (let c=0; c<size; c++){
        const k = idx(r,c);
        if (s[k] !== 0) continue;
        if (!nearStone(s, r, c, 2)) continue;

        if (isRenju && player === P1) {
          s[k] = P1;
          const res = window.violatesRenju(r, c, 1, s);
          s[k] = 0;
          if (!res.isValid) continue; 
        }

        const quick = quickMoveScore(s, r, c, player);
        cand.push({r,c, quick});
      }
    }

    cand.sort((a,b)=> b.quick - a.quick);
    return cand.slice(0, limit);
  }

  function negamaxRoot(s, depth, deadline, me, opp, moves, maxCands){
    let alpha = -Infinity, beta = Infinity, bestMove = null, bestScore = -Infinity;
    const ordered = moves.slice().sort((a,b)=> b.quick - a.quick);

    for (const m of ordered){
      if (performance.now() > deadline) return {timedOut:true, bestMove, bestScore};
      const k = idx(m.r,m.c);
      s[k] = me;
      let score;
      if (checkWinFrom(m.r,m.c,me)){
        score = 1000000;
      } else {
        score = -negamax(s, depth-1, -beta, -alpha, opp, me, deadline, maxCands);
      }
      s[k] = 0;

      if (score > bestScore){ bestScore = score; bestMove = {r:m.r, c:m.c}; }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return {timedOut:false, bestMove, bestScore};
  }

  function negamax(s, depth, alpha, beta, player, other, deadline, maxCands){
    if (performance.now() > deadline || depth <= 0) return evaluatePosition(s, aiPlaysAs);

    const moves = generateCandidates(s, player, maxCands);
    if (!moves.length) return 0;
    
    let best = -Infinity;
    for (const m of moves){
      if (performance.now() > deadline) return evaluatePosition(s, aiPlaysAs);
      const k = idx(m.r,m.c);
      s[k] = player;

      let score;
      if (checkWinFrom(m.r,m.c,player)) score = 900000 + depth * 500;
      else score = -negamax(s, depth-1, -beta, -alpha, other, player, deadline, maxCands);
      
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
    return off + def + ((size*0.7 - dist) * 4);
  }

  function patternScoreIfPlaced(s, r, c, player){
    s[idx(r,c)] = player;
    const sc = patternScoreAt(s, r, c, player);
    s[idx(r,c)] = 0;
    return sc;
  }

  function patternScoreAt(s, r, c, player){
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
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
    while (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===player){ count++; rr+=dr; cc+=dc; }
    let open1 = (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===0) ? 1 : 0;
    rr=r-dr; cc=c-dc;
    while (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===player){ count++; rr-=dr; cc-=dc; }
    let open2 = (rr>=0 && cc>=0 && rr<size && cc<size && s[idx(rr,cc)]===0) ? 1 : 0;
    return {count, openEnds: open1 + open2};
  }

  function evaluatePosition(s, perspective){
    const me = perspective;
    let meScore = 0, oppScore = 0;
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];

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
          if (v === me) meScore += add; else oppScore += add;
        }
      }
    }

    const baseScore = meScore - oppScore * 1.05;
    if (ruleMode === "renju" || ruleMode === "swap2") {
       const trapBonus = calculateRenjuTraps(s); 
       return perspective === P1 ? baseScore - trapBonus : baseScore + trapBonus;
    }
    return baseScore;
  }

  function calculateRenjuTraps(s) {
    // Easy AI doesn't understand or look for Renju traps
    if (window.aiLevel === "easy") return 0; 

    let trapBonus = 0;
    const difficultyMultiplier = window.aiLevel === "hard" ? 1.5 : 1.0;
    
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (s[idx(r, c)] !== 0) continue;
        
        if (isNearWhiteThreat(r, c, s)) {
            const res = window.violatesRenju(r, c, 1, s);
            if (!res.isValid) {
                trapBonus += 1000 * difficultyMultiplier; 
            }
        }
      }
    }
    return trapBonus;
  }

  function isNearWhiteThreat(r, c, s) {
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (lineInfo(s, r, c, dr, dc, P2).count >= 3) return true;
    }
    return false;
  }

  // --- SWAP2 AI LOGIC ---
  function aiSwap2Choice() {
    const currentScore = evaluatePosition(state, P1); 
    
    // Threshold increased significantly to prevent AI from stealing Black prematurely
    if (currentScore > 4000) {
      if (window.showOverlay) {
          window.showOverlay("AI Swap2 Choice", "The AI evaluated your opening as heavily favored and chose to Swap to Black. You are now playing as White. It is your turn.", "Play as White");
          window.overlayBtn.onclick = () => { window.overlayBtn.onclick = null; window.finalizeRoles(P1); };
      } else {
          window.finalizeRoles(P1); 
      }
      return;
    } else if (currentScore < -500) {
      if (window.showOverlay) {
          window.showOverlay("AI Swap2 Choice", "The AI evaluated your opening as weak and chose to Stay White. You are Black. The AI will now make its move.", "Continue");
          window.overlayBtn.onclick = () => { window.overlayBtn.onclick = null; window.finalizeRoles(P2); };
      } else {
          window.finalizeRoles(P2);
      }
      return;
    }

    const bestPair = findBestSwap2Pair();
    if(bestPair) {
      if (window.setSwap2Phase) window.setSwap2Phase(3); 
      
      setTimeout(() => {
        window.handleSwap2Move(bestPair.white.r, bestPair.white.c);
        setTimeout(() => window.handleSwap2Move(bestPair.black.r, bestPair.black.c), 600);
      }, 600);
    } else {
      window.finalizeRoles(P2); 
    }
  }

  function findBestSwap2Pair() {
    const params = getAIParams();
    let bestEval = -Infinity, bestPair = null;
    const whiteCandidates = generateCandidates(state, P2, params.candidates); 
    
    for (let w of whiteCandidates) {
      state[idx(w.r, w.c)] = P2;
      const blackCandidates = generateCandidates(state, P1, params.candidates);
      for (let b of blackCandidates) {
        if (w.r === b.r && w.c === b.c) continue;
        state[idx(b.r, b.c)] = P1;
        const evalScore = Math.abs(evaluatePosition(state, P1)); 
        if (evalScore > bestEval) {
          bestEval = evalScore;
          bestPair = { white: w, black: b };
        }
        state[idx(b.r, b.c)] = 0;
      }
      state[idx(w.r, w.c)] = 0;
    }
    return bestPair;
  }

  function randomEmptyMove(){
    const empties = [];
    for (let r=0; r<size; r++) for (let c=0; c<size; c++) if (state[idx(r,c)]===0) empties.push({r,c});
    return empties.length ? empties[Math.floor(Math.random()*empties.length)] : null;
  }

  window.getAIParams = getAIParams;
  window.chooseAiMove = chooseAiMove;
  window.aiSwap2Choice = aiSwap2Choice;
  window.evaluatePosition = evaluatePosition;
})();