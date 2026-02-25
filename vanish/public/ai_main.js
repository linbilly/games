/* Vanish - Professional Gomoku AI Engine 
 * Features: Alpha-Beta Pruning, Exact Shape Recognition, Renju Trap Awareness, Center-Bias Tiebreaking
 */

(() => {
    'use strict';
    
    // Engine Configuration
    const AI_CONFIGS = {
        // Easy: Shallow depth, forgets pieces easily, narrow vision
        "easy":   { depth: 2, candidates: 3,  timeMs: 400,  forgetBase: 0.30 }, 
        // Medium: Standard lookahead, forgets pieces occasionally
        "medium": { depth: 4, candidates: 6,  timeMs: 800,  forgetBase: 0.12 },
        // Hard: Deep calculation, rarely forgets
        "hard":   { depth: 6, candidates: 10, timeMs: 2000, forgetBase: 0.04 },
        // Expert: Massive depth, wide candidate net, perfect memory (0 forgetfulness)
        "expert": { depth: 8, candidates: 14, timeMs: 3000, forgetBase: 0.00 }
    };

    // Professional Gomoku Shape Scores
    const SCORES = {
        WIN: 100000000,
        OPEN_FOUR: 10000000,
        CLOSED_FOUR: 100000,
        OPEN_THREE: 50000,
        CLOSED_THREE: 1000,
        OPEN_TWO: 500,
        CLOSED_TWO: 50
    };

    function getAIParams() {
        return AI_CONFIGS[window.aiLevel || "medium"] || AI_CONFIGS["medium"];
    }

    // --- 1. MAIN ENTRY POINTS (Signatures perfectly match old ai.js) ---

    function chooseAiMove(currentState = state, currentPlayer = aiPlaysAs) {
        if (ruleMode === "swap2" && swap2Phase === 2) {
            return aiSwap2Choice();
        }

        const me = currentPlayer;
        const opp = (me === P1) ? P2 : P1;
        const config = getAIParams();

        // 1. Failsafe: If the board is totally empty, play the exact center (Deterministic, no random)
        if (!currentState.includes(1) && !currentState.includes(2)) {
            return getCenterMove();
        }

        // 2. Check for an immediate 1-move win or forced block to save CPU time
        const tactic = findImmediateTactic(currentState, me, opp);
        if (tactic) return tactic;

        // 3. Run the Deep Alpha-Beta Engine
        const bestMove = runAlphaBeta(config, currentState, me, opp);
        return bestMove || getCenterMove();
    }

    function aiSwap2Choice() {
        // AI analyzes the 3 stones placed by P1
        const currentScore = evaluatePosition(state, P1); 
        
        // If P1 played a terrible opening, AI happily takes Black (P1)
        if (currentScore > 80000) {
            finalizeRoles(P1); 
            return null; 
        } 
        // If P1 played a brutally strong opening, AI takes White (P2) to defend
        else if (currentScore < -80000) {
            finalizeRoles(P2); 
            return null;
        }

        // If the opening is balanced, AI places 2 more stones (Phase 3)
        swap2Phase = 3;
        inputLocked = true;

        const bestPair = findBestSwap2Pair();
        
        if (bestPair) {
            setTimeout(() => {
                handleSwap2Move(bestPair.white.r, bestPair.white.c);
                setTimeout(() => {
                    handleSwap2Move(bestPair.black.r, bestPair.black.c);
                }, 600);
            }, 600);
        } else {
            finalizeRoles(P2); // Defensive fallback
        }
        
        return null; 
    }

    // --- 2. THE ALPHA-BETA ENGINE ---

    function runAlphaBeta(config, rootState, me, opp) {
        const deadline = performance.now() + config.timeMs;
        const perceivedState = getAiPerceivedState(config.forgetBase, rootState);

        let bestMove = null;
        let rootMoves = generateCandidates(perceivedState, me, opp, config.candidates);
        
        if (!rootMoves.length) return getCenterMove();

        // Iterative Deepening: Start shallow, go deeper if time allows
        for (let d = 1; d <= config.depth; d++) {
            let res = minimaxRoot(perceivedState, d, -Infinity, Infinity, me, opp, rootMoves, deadline);
            
            if (res.timedOut) break; // Time's up, use the best move from the LAST completed depth
            
            if (res.bestMove) {
                bestMove = res.bestMove;
                // If we found a forced win, stop thinking immediately
                if (res.bestScore >= SCORES.WIN / 2) break; 
            }
        }

        return bestMove || { r: rootMoves[0].r, c: rootMoves[0].c };
    }

    function minimaxRoot(s, depth, alpha, beta, me, opp, moves, deadline) {
        let bestMove = null;
        let bestScore = -Infinity;

        for (const m of moves) {
            if (performance.now() > deadline) return { timedOut: true, bestMove, bestScore };

            const k = idx(m.r, m.c);
            s[k] = me;
            
            let score;
            if (checkWinFrom(m.r, m.c, me)) {
                score = SCORES.WIN + depth; // Favor faster wins
            } else {
                score = -minimax(s, depth - 1, -beta, -alpha, opp, me, deadline);
            }
            s[k] = 0;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { r: m.r, c: m.c };
            }
            alpha = Math.max(alpha, score);
        }
        return { timedOut: false, bestMove, bestScore };
    }

    function minimax(s, depth, alpha, beta, currPlayer, nextPlayer, deadline) {
        if (depth === 0 || performance.now() > deadline) {
            // Minimax returns relative score (Positive = good for currPlayer)
            return evaluatePosition(s, currPlayer);
        }

        // Limit candidates heavily in deep nodes to keep speed up
        const moves = generateCandidates(s, currPlayer, nextPlayer, 8);
        if (!moves.length) return 0; // Draw

        let best = -Infinity;
        for (const m of moves) {
            const k = idx(m.r, m.c);
            s[k] = currPlayer;

            let score;
            if (checkWinFrom(m.r, m.c, currPlayer)) {
                score = SCORES.WIN + depth;
            } else {
                score = -minimax(s, depth - 1, -beta, -alpha, nextPlayer, currPlayer, deadline);
            }
            s[k] = 0;

            best = Math.max(best, score);
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break; // Prune
        }
        return best;
    }

    // --- 3. EXACT SHAPE EVALUATION ---

    function evaluatePosition(s, perspective) {
        const me = perspective;
        const opp = (me === P1) ? P2 : P1;
        
        let meScore = scorePlayerShapes(s, me);
        let oppScore = scorePlayerShapes(s, opp);

        // Standard Gomoku bias: Defending against a threat is slightly more urgent than attacking
        let baseScore = meScore - (oppScore * 1.1);

        // Expert Renju AI actively hunts for traps
        if (ruleMode === "renju" || ruleMode === "swap2") {
            const trapBonus = calculateRenjuTraps(s);
            if (perspective === P1) baseScore -= trapBonus; // Traps are bad for Black
            else baseScore += trapBonus;                    // Traps are great for White
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
                    // Only evaluate the line if we are at the "start" of it, to avoid counting the same line 5 times
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
        let count = 0;
        let rr = r, cc = c;
        
        // Count stones forward
        while (rr >= 0 && rr < size && cc >= 0 && cc < size && s[idx(rr, cc)] === player) {
            count++;
            rr += dr;
            cc += dc;
        }

        // Check front end
        let openEnds = 0;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size && s[idx(rr, cc)] === 0) openEnds++;

        // Check back end
        let br = r - dr, bc = c - dc;
        if (br >= 0 && br < size && bc >= 0 && bc < size && s[idx(br, bc)] === 0) openEnds++;

        return { count, openEnds };
    }

    // --- 4. TACTICS & GENERATORS ---

    function findImmediateTactic(s, me, opp) {
        const isRenju = (ruleMode === "renju" || ruleMode === "swap2");

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const k = idx(r, c);
                if (s[k] !== 0) continue;

                // 1. Can I win right now?
                s[k] = me;
                if (!(isRenju && me === P1 && !window.violatesRenju(r, c, 1, s).isValid)) {
                    if (checkWinFrom(r, c, me)) { s[k] = 0; return {r, c}; }
                }
                s[k] = 0;

                // 2. Do I need to block an immediate win?
                s[k] = opp;
                if (!(isRenju && opp === P1 && !window.violatesRenju(r, c, 1, s).isValid)) {
                    if (checkWinFrom(r, c, opp)) { s[k] = 0; return {r, c}; }
                }
                s[k] = 0;
            }
        }
        return null;
    }

    function generateCandidates(s, currPlayer, nextPlayer, limit) {
        const cand = [];
        const isRenju = (ruleMode === "renju" || ruleMode === "swap2");
        const center = Math.floor(size / 2);

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const k = idx(r, c);
                if (s[k] !== 0) continue;
                
                // Threat Area Filtering: Only consider moves within 2 spaces of existing stones
                if (!isNearStone(s, r, c, 2)) continue;

                // Renju Filtering: Don't evaluate illegal moves for Black
                if (isRenju && currPlayer === P1) {
                    s[k] = P1;
                    const res = window.violatesRenju(r, c, 1, s);
                    s[k] = 0;
                    if (!res.isValid) continue; 
                }

                // Quick heuristic score: If I play here, how much does my shape score improve?
                s[k] = currPlayer;
                const offScore = scorePlayerShapes(s, currPlayer);
                s[k] = nextPlayer;
                const defScore = scorePlayerShapes(s, nextPlayer);
                s[k] = 0;
                
                // NO RANDOMNESS: Center bias serves as a deterministic tie-breaker
                const distToCenter = Math.abs(r - center) + Math.abs(c - center);
                const score = offScore + (defScore * 0.9) - distToCenter;

                cand.push({ r, c, score });
            }
        }

        // Sort descending and slice to the limit (Pruning)
        cand.sort((a, b) => b.score - a.score);
        return cand.slice(0, limit);
    }

    function isNearStone(s, r, c, radius) {
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                if (dr === 0 && dc === 0) continue;
                const rr = r + dr, cc = c + dc;
                if (rr >= 0 && rr < size && cc >= 0 && cc < size) {
                    if (s[idx(rr, cc)] !== 0) return true;
                }
            }
        }
        return false;
    }

    function getCenterMove() {
        const center = Math.floor(size / 2);
        return { r: center, c: center };
    }

    // --- 5. EXPERT RENJU TRAP HUNTING ---

    function calculateRenjuTraps(s) {
        if (window.aiLevel === "easy" || window.aiLevel === "medium") return 0; 
        let trapBonus = 0;
        const mult = window.aiLevel === "expert" ? 2.5 : 1.0; 
        
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (s[idx(r, c)] !== 0) continue;
                
                // Is this a foul point for Black?
                const res = window.violatesRenju(r, c, P1, s);
                if (!res.isValid) {
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

    // --- 6. SWAP2 & MEMORY LOGIC ---

    function findBestSwap2Pair() {
        const params = getAIParams();
        let bestEval = -Infinity, bestPair = null;
        
        // Use a wide candidate net to find 2 good spots
        const whiteCandidates = generateCandidates(state, P2, P1, params.candidates); 
        
        for (let w of whiteCandidates) {
            state[idx(w.r, w.c)] = P2;
            const blackCandidates = generateCandidates(state, P1, P2, params.candidates);
            
            for (let b of blackCandidates) {
                if (w.r === b.r && w.c === b.c) continue;
                state[idx(b.r, b.c)] = P1;
                
                // Measure the tension of the board (closer to 0 is a more balanced opening)
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

    function getAiPerceivedState(forgetBase, actualState) {
        if (boardEl.classList.contains("reveal") || vanishMs >= 3600000) return actualState;

        const now = Date.now(); 
        const dt = Math.max(0, now - lastRevealAt);
        const t = Math.max(0, Math.min(1, dt / 15000));
        const p = forgetBase * t;

        if (p <= 0.0001) return actualState;

        const opp = (aiPlaysAs === P1) ? P2 : P1;
        const s = actualState.slice();

        for (let i = 0; i < s.length; i++) {
            if (s[i] === opp) {
                const age = Math.max(0, now - (placedAt[i] || 0));
                const ageFactor = Math.max(0.35, Math.min(1, age / 8000));
                // RNG is ONLY used here to simulate human memory failure based on time elapsed
                if (Math.random() < p * ageFactor) s[i] = 0; 
            }
        }
        return s;
    }

    // Final Bindings to keep main.js happy
    window.getAIParams = getAIParams;
    window.chooseAiMove = chooseAiMove;
    window.aiSwap2Choice = aiSwap2Choice;
    window.evaluatePosition = evaluatePosition;
})();