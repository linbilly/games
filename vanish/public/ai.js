/* Vanish - Web Worker AI Engine */

// 1. MOCK THE WINDOW OBJECT
// Workers don't have a 'window'. We map 'self' to 'window' so if your rules.js 
// tries to attach window.violatesRenju, it attaches successfully to the worker.
self.window = self;

// Import your Renju rules logic so the AI knows what moves are illegal
try {
    importScripts('rules.js');
} catch (e) {
    console.warn("Could not import rules.js into Worker. Renju validation may fail.");
}

// 2. ENGINE CONFIGURATION
const AI_CONFIGS = {
    "easy":   { depth: 2, candidates: 3,  timeMs: 400,  forgetBase: 0.30 }, 
    "medium": { depth: 4, candidates: 6,  timeMs: 800,  forgetBase: 0.12 },
    "hard":   { depth: 6, candidates: 10, timeMs: 2000, forgetBase: 0.04 },
    "expert": { depth: 8, candidates: 14, timeMs: 3000, forgetBase: 0.00 }
};

const SCORES = {
    WIN: 100000000, OPEN_FOUR: 10000000, CLOSED_FOUR: 100000,
    OPEN_THREE: 50000, CLOSED_THREE: 1000, OPEN_TWO: 500, CLOSED_TWO: 50
};

// Global states for the worker
let size = 15;
let goal = 5;
let ruleMode = "nolimit";
let aiPlaysAs = 2;
let P1 = 1, P2 = 2;

// 3. LISTEN FOR MESSAGES FROM MAIN.JS
self.onmessage = function(e) {
    const data = e.data;
    
    // Unpack the current game state
    size = data.size;
    goal = size === 3 ? 3 : 5;
    ruleMode = data.ruleMode;
    aiPlaysAs = data.aiPlaysAs;
    
    const config = AI_CONFIGS[data.aiLevel || "medium"];

    if (data.type === 'request_move') {
        const move = calculateMove(data.state, config, data);
        self.postMessage({ type: 'move_result', move: move });
    } 
    else if (data.type === 'request_swap2') {
        const decision = calculateSwap2Choice(data.state, config);
        self.postMessage({ type: 'swap2_result', decision: decision });
    }
    else if (data.type === 'request_phase4_eval') {
        // AI uses the evaluation engine from the perspective of Player 1
        const currentScore = evaluatePosition(data.state, 1);
        self.postMessage({ type: 'phase4_result', score: currentScore });
    }
};

function idx(r, c) { return r * size + c; }

// --- ENGINE LOGIC ---

function calculateMove(state, config, data) {
    const me = aiPlaysAs;
    const opp = (me === P1) ? P2 : P1;

    // 1. Empty board = Center
    if (!state.includes(1) && !state.includes(2)) return getCenterMove();

    // 2. Immediate Tactics
    const tactic = findImmediateTactic(state, me, opp);
    if (tactic) return tactic;

    // 3. Deep Alpha-Beta
    const perceivedState = getAiPerceivedState(config.forgetBase, state, data);
    const deadline = performance.now() + config.timeMs;
    
    let bestMove = null;
    let rootMoves = generateCandidates(perceivedState, me, opp, config.candidates);
    
    if (!rootMoves.length) return getCenterMove();

    for (let d = 1; d <= config.depth; d++) {
        let res = minimaxRoot(perceivedState, d, -Infinity, Infinity, me, opp, rootMoves, deadline);
        if (res.timedOut) break; 
        if (res.bestMove) {
            bestMove = res.bestMove;
            if (res.bestScore >= SCORES.WIN / 2) break; 
        }
    }

    return bestMove || { r: rootMoves[0].r, c: rootMoves[0].c };
}

function calculateSwap2Choice(state, config) {
    const currentScore = evaluatePosition(state, P1); 
    
    if (currentScore > 80000) return { action: 'take_black' };
    if (currentScore < -80000) return { action: 'take_white' };

    let bestEval = -Infinity, bestPair = null;
    const whiteCandidates = generateCandidates(state, P2, P1, config.candidates); 
    
    for (let w of whiteCandidates) {
        state[idx(w.r, w.c)] = P2;
        const blackCandidates = generateCandidates(state, P1, P2, config.candidates);
        
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
    
    if (bestPair) return { action: 'place_two', pair: bestPair };
    return { action: 'take_white' };
}

// --- MINIMAX CORE (Identical to before) ---

function minimaxRoot(s, depth, alpha, beta, me, opp, moves, deadline) {
    let bestMove = null; let bestScore = -Infinity;
    for (const m of moves) {
        if (performance.now() > deadline) return { timedOut: true, bestMove, bestScore };
        const k = idx(m.r, m.c);
        s[k] = me;
        // FIX: Passed 's' into checkWinFrom
        let score = checkWinFrom(s, m.r, m.c, me) ? SCORES.WIN + depth : -minimax(s, depth - 1, -beta, -alpha, opp, me, deadline);
        s[k] = 0;
        if (score > bestScore) { bestScore = score; bestMove = { r: m.r, c: m.c }; }
        alpha = Math.max(alpha, score);
    }
    return { timedOut: false, bestMove, bestScore };
}

function minimax(s, depth, alpha, beta, currPlayer, nextPlayer, deadline) {
    if (depth === 0 || performance.now() > deadline) return evaluatePosition(s, currPlayer);
    const moves = generateCandidates(s, currPlayer, nextPlayer, 8);
    if (!moves.length) return 0;

    let best = -Infinity;
    for (const m of moves) {
        const k = idx(m.r, m.c);
        s[k] = currPlayer;
        // FIX: Passed 's' into checkWinFrom
        let score = checkWinFrom(s, m.r, m.c, currPlayer) ? SCORES.WIN + depth : -minimax(s, depth - 1, -beta, -alpha, nextPlayer, currPlayer, deadline);
        s[k] = 0;
        best = Math.max(best, score);
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break; 
    }
    return best;
}

// --- EVALUATION & GENERATORS ---

function evaluatePosition(s, perspective) {
    const me = perspective; const opp = (me === P1) ? P2 : P1;
    let baseScore = scorePlayerShapes(s, me) - (scorePlayerShapes(s, opp) * 1.1);
    if (ruleMode === "renju" || ruleMode === "swap2") {
        const trapBonus = calculateRenjuTraps(s);
        baseScore += (perspective === P1) ? -trapBonus : trapBonus;
    }
    return baseScore;
}

function scorePlayerShapes(s, player) {
    let total = 0;
    const dirs = [{dr: 0, dc: 1}, {dr: 1, dc: 0}, {dr: 1, dc: 1}, {dr: 1, dc: -1}];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (s[idx(r, c)] !== player) continue;
            for (const {dr, dc} of dirs) {
                let br = r - dr, bc = c - dc;
                if (br >= 0 && br < size && bc >= 0 && bc < size && s[idx(br, bc)] === player) continue;
                const { count, openEnds } = getLineDetails(s, r, c, dr, dc, player);
                if (count >= goal) total += SCORES.WIN;
                else if (count === 4 && openEnds === 2) total += SCORES.OPEN_FOUR;
                else if (count === 4 && openEnds === 1) total += SCORES.CLOSED_FOUR;
                else if (count === 3 && openEnds === 2) total += SCORES.OPEN_THREE;
                else if (count === 3 && openEnds === 1) total += SCORES.CLOSED_THREE;
                else if (count === 2 && openEnds === 2) total += SCORES.OPEN_TWO;
                else if (count === 2 && openEnds === 1) total += SCORES.CLOSED_TWO;
            }
        }
    }
    return total;
}

function getLineDetails(s, r, c, dr, dc, player) {
    let count = 0, rr = r, cc = c;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && s[idx(rr, cc)] === player) { count++; rr += dr; cc += dc; }
    let openEnds = 0;
    if (rr >= 0 && rr < size && cc >= 0 && cc < size && s[idx(rr, cc)] === 0) openEnds++;
    let br = r - dr, bc = c - dc;
    if (br >= 0 && br < size && bc >= 0 && bc < size && s[idx(br, bc)] === 0) openEnds++;
    return { count, openEnds };
}

function generateCandidates(s, currPlayer, nextPlayer, limit) {
    const cand = []; const center = Math.floor(size / 2);
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const k = idx(r, c);
            if (s[k] !== 0) continue;
            if (!isNearStone(s, r, c, 2)) continue;
            if ((ruleMode === "renju" || ruleMode === "swap2") && currPlayer === P1) {
                s[k] = P1;
                const res = self.window.violatesRenju ? self.window.violatesRenju(r, c, 1, s) : { isValid: true };
                s[k] = 0;
                if (!res.isValid) continue; 
            }
            s[k] = currPlayer; const offScore = scorePlayerShapes(s, currPlayer);
            s[k] = nextPlayer; const defScore = scorePlayerShapes(s, nextPlayer);
            s[k] = 0;
            const dist = Math.abs(r - center) + Math.abs(c - center);
            cand.push({ r, c, score: offScore + (defScore * 0.9) - dist });
        }
    }
    cand.sort((a, b) => b.score - a.score);
    return cand.slice(0, limit);
}

function findImmediateTactic(s, me, opp) {
    const isRenju = (ruleMode === "renju" || ruleMode === "swap2");
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const k = idx(r, c);
            if (s[k] !== 0) continue;
            s[k] = me;
            if (!(isRenju && me === P1 && self.window.violatesRenju && !self.window.violatesRenju(r, c, 1, s).isValid)) {
                // FIX: Passed 's' into checkWinFrom
                if (checkWinFrom(s, r, c, me)) { s[k] = 0; return {r, c}; }
            }
            s[k] = opp;
            if (!(isRenju && opp === P1 && self.window.violatesRenju && !self.window.violatesRenju(r, c, 1, s).isValid)) {
                // FIX: Passed 's' into checkWinFrom
                if (checkWinFrom(s, r, c, opp)) { s[k] = 0; return {r, c}; }
            }
            s[k] = 0;
        }
    }
    return null;
}

function isNearStone(s, r, c, radius) {
    for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < size && cc >= 0 && cc < size && s[idx(rr, cc)] !== 0) return true;
        }
    }
    return false;
}

function getCenterMove() { const center = Math.floor(size / 2); return { r: center, c: center }; }

function checkWinFrom(s, r, c, player) {
    const dirs = [{dr: 0, dc: 1}, {dr: 1, dc: 0}, {dr: 1, dc: 1}, {dr: 1, dc: -1}];
    for (const {dr, dc} of dirs) {
        let count = 1;
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && cc >= 0 && rr < size && cc < size && s[idx(rr, cc)] === player) { count++; rr += dr; cc += dc; }
        rr = r - dr; cc = c - dc;
        while (rr >= 0 && cc >= 0 && rr < size && cc < size && s[idx(rr, cc)] === player) { count++; rr -= dr; cc -= dc; }
        if (count >= goal) return true;
    }
    return false;
}

function calculateRenjuTraps(s) {
    if (!self.window.violatesRenju || window.aiLevel === "easy" || window.aiLevel === "medium") return 0; 
    let trapBonus = 0; const mult = window.aiLevel === "expert" ? 2.5 : 1.0; 
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (s[idx(r, c)] !== 0) continue;
            if (!self.window.violatesRenju(r, c, P1, s).isValid) {
                const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
                for (const {dr, dc} of dirs) {
                    const {count} = getLineDetails(s, r, c, dr, dc, P2);
                    if (count >= 5) trapBonus += (SCORES.WIN / 2) * mult; 
                    else if (count === 4) trapBonus += SCORES.OPEN_FOUR * mult;
                    else if (count === 3) trapBonus += SCORES.OPEN_THREE * mult;
                }
            }
        }
    }
    return trapBonus;
}

function getAiPerceivedState(forgetBase, actualState, data) {
    if (data.isRevealed || data.vanishMs >= 3600000) return actualState;
    const now = Date.now(); 
    const dt = Math.max(0, now - data.lastRevealAt);
    const p = forgetBase * Math.max(0, Math.min(1, dt / 15000));
    if (p <= 0.0001) return actualState;

    const opp = (aiPlaysAs === P1) ? P2 : P1;
    const s = actualState.slice();
    for (let i = 0; i < s.length; i++) {
        if (s[i] === opp) {
            const age = Math.max(0, now - (data.placedAt[i] || 0));
            if (Math.random() < p * Math.max(0.35, Math.min(1, age / 8000))) s[i] = 0; 
        }
    }
    return s;
}