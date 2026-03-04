
// --- Supabase Setup ---
const SUPABASE_URL = 'https://dxnxwwgamfylqcjahtzv.supabase.co'; // Replace with your URL
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VRwl-Fna636SBgiGpF-yGw_pGqe0VrS'; // Use your new publishable key
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);



// --- Audio System (MusicEngine) ---
// Requires music_engine.js to be loaded before game.js
const musicEngine = new MusicEngine();

function playComboSound(level){ musicEngine.onCombo(level); }
function playUndoSound(){ musicEngine.onUndo(); }
function playWinSound(){ musicEngine.onWin(); }


// --- Game State ---
const MODES = {
    practice1: { name: 'Practice 1', tiles: 3, target: 10, ops: ['+', '-'], instr: 'Make 10 using all numbers' },
    practice2: { name: 'Practice 2', tiles: 3, target: 20, ops: ['+', '-', '*', '/'], instr: 'Make 20 using all numbers' },
    practice3: { name: 'Practice 3', tiles: 4, target: 50, ops: ['+', '-', '*', '/'], instr: 'Make 50 using all numbers', pool: [1, 2, 5, 10] },
    make50:    { name: 'Make 50', tiles: 5, target: 50, ops: ['+', '-', '*', '/'], instr: 'Make 50 using all numbers shown' }, 
    challenge: { name: '10 Q Challenge', tiles: 5, target: 50, ops: ['+', '-', '*', '/'], instr: 'Finish 10 questions and challenge your friends!' }
};

// State trackers
let consecutiveSolves = 0;
let totalSolves = 0; // Tracks all-time solves for the session
let maxCombo = 0;    // Tracks highest combo achieved
let usedUndoThisRound = false;
let roundStartTime = 0;
let gameStarted = false;

let currentMode = 'make50';
let score = 0;
let timeLeft = 100;
let timerInterval;
let activeTiles = [];
let history = []; 
let currentSolutionSteps = []; // Tracks the solution as an array of equation objects

let selectedTileId = null;
let selectedOp = null;

let lastTapTime = 0;      // NEW: Tracks double-taps
let lastTapTileId = null; // NEW: Tracks double-taps

let hintUsedThisRound = false;

let challengeQuestions = []; // Stores the 10 questions upfront
let currentQuestionIndex = 0;
let urlChallengeId = new URLSearchParams(window.location.search).get('challenge');
let challengeCreatorName = "";

const savedMusicPref = localStorage.getItem('make50_music_pref');
let isMusicEnabled = savedMusicPref !== null ? savedMusicPref === 'true' : true;

// --- Logic: Math Solver (Now returns an array of visual steps) ---
function findSolution(arr, target, allowedOps, currentSteps = []) {
    if (arr.length === 1) {
        if (Math.abs(arr[0].val - target) < 0.001) return currentSteps;
        return null;
    }
    
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
            if (i === j) continue;
            
            let remaining = arr.filter((_, idx) => idx !== i && idx !== j);
            let a = arr[i], b = arr[j];
            let results = [];
            let newCombo = a.combo + b.combo;
            
            // Inside findSolution...
            if (allowedOps.includes('+')) results.push({ val: a.val + b.val, op: '+' });
            
            // STRICT MATH: Only allow subtraction if it stays positive
            if (allowedOps.includes('-') && a.val - b.val > 0) results.push({ val: a.val - b.val, op: '−' });
            
            if (allowedOps.includes('*')) results.push({ val: a.val * b.val, op: '×' });
            
            // STRICT MATH: Only allow division if it creates a clean whole integer
            if (allowedOps.includes('/') && b.val !== 0 && a.val % b.val === 0) results.push({ val: a.val / b.val, op: '÷' });
            
            for (let res of results) {
                // Save the equation data for this step
                let stepObj = {
                    aVal: a.val, aCombo: a.combo,
                    bVal: b.val, bCombo: b.combo,
                    op: res.op,
                    resVal: res.val, resCombo: newCombo
                };
                
                let solution = findSolution(
                    [...remaining, { val: res.val, combo: newCombo }], 
                    target, allowedOps, [...currentSteps, stepObj]
                );
                if (solution) return solution; 
            }
        }
    }
    return null;
}

// --- Logic: Question Generation ---
function generateTiles() {
    document.getElementById('hint-display').classList.add('hidden');
    document.getElementById('hint-btn').classList.add('hidden');
    
    // NEW: Check if we are done with the 10 questions
    if (currentMode === 'challenge' && currentQuestionIndex >= 10) {
        endGame("Challenge Completed!");
        return;
    }

    const params = MODES[currentMode];
    let numbers = [];

    if (currentMode === 'challenge') {
        // If creating a brand new challenge, pre-generate 10 sets of numbers
        if (challengeQuestions.length === 0 && !urlChallengeId) {
            for(let q = 0; q < 10; q++) {
                let foundSet = generateSingleValidSet(params);
                challengeQuestions.push(foundSet);
            }
        }
        // Pull the numbers from our pre-generated array
        let currentQ = challengeQuestions[currentQuestionIndex];
        numbers = currentQ.numbers;
        currentSolutionSteps = currentQ.solution;
        
    } else {
        // Normal game mode generation
        let foundSet = generateSingleValidSet(params);
        numbers = foundSet.numbers;
        currentSolutionSteps = foundSet.solution;
    }

    activeTiles = numbers.map(num => ({
        id: Math.random().toString(36).substr(2, 9),
        value: num, comboCount: 1, leftChild: null, rightChild: null
    }));
    
    history = []; selectedTileId = null; selectedOp = null;
    usedUndoThisRound = false; roundStartTime = Date.now();
}

// Helper to clean up the generation logic
function generateSingleValidSet(params) {
    const pool = params.pool || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10];
    let validSet = false, numbers = [], foundSolution = null;
    while (!validSet) {
        numbers = [];
        let onesAndTwos = 0;
        for (let i = 0; i < params.tiles; i++) {
            let num = pool[Math.floor(Math.random() * pool.length)];
            if (num === 1 || num === 2) onesAndTwos++;
            numbers.push(num);
        }
        let testArr = numbers.map(n => ({ val: n, combo: 1 }));
        foundSolution = findSolution(testArr, params.target, params.ops);
        if (onesAndTwos <= 3 && foundSolution) validSet = true;
    }
    return { numbers, solution: foundSolution };
}



// --- UI & Interactions ---
function updateUIForMode() {
    const params = MODES[currentMode];
    document.getElementById('game-title').innerText = `Make ${params.target}`;
    
    document.querySelectorAll('.op-btn').forEach(btn => {
        if (!params.ops.includes(btn.dataset.op)) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.pointerEvents = 'none';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    });
}

function render() {
    document.getElementById('score').innerText = `Score: ${score}`;
    document.getElementById('combo-count').innerText = `Combo: ${consecutiveSolves}`;
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    
    const params = MODES[currentMode];

    activeTiles.forEach((tile, index) => {
        const el = document.createElement('div');
        let isGold = (activeTiles.length === 1 && tile.value === params.target && tile.comboCount === params.tiles);
        let comboClass = tile.comboCount <= 5 ? `combo-${tile.comboCount}` : 'combo-5';
        
        // FIX: Properly closed the template literal and ternary operator!
        el.className = `tile ${comboClass} ${isGold ? 'gold' : ''} ${tile.id === selectedTileId ? 'selected' : ''}`;
        
        el.innerText = Number.isInteger(tile.value) ? tile.value : parseFloat(tile.value.toFixed(2));
    
        
        // Click Logic
        el.onclick = (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;
            
            if (tapLength < 300 && tapLength > 0 && lastTapTileId === tile.id) {
                e.preventDefault(); 
                breakUpTile(tile.id);
                lastTapTime = 0; 
            } else {
                lastTapTime = currentTime;
                lastTapTileId = tile.id;
                handleTileClick(tile.id);
            }
        };
        
        stage.appendChild(el);
    });

    document.querySelectorAll('.op-btn').forEach(btn => {
        btn.classList.toggle('selected-op', btn.dataset.op === selectedOp);
    });
}

function updateBackground() {
    // Math logic: Increase saturation over 10 solves
    const saturation = Math.min(consecutiveSolves * 10, 100);
    const lightness = 97 - (saturation * 0.47); // Transitions from off-white (97%) to gold (50%)
    document.body.style.backgroundColor = `hsl(45, ${saturation}%, ${lightness}%)`;
}

function showRewardText() {
    const solveTime = (Date.now() - roundStartTime) / 1000;
    let messages = [];
    
    if (solveTime < 30) messages.push("Fast Solve!");
    if (!usedUndoThisRound) messages.push("Perfect!");
    // Removed "+1 solve"

    const goldTile = document.querySelector('.tile.gold');
    const referenceRect = goldTile ? goldTile.getBoundingClientRect() : document.getElementById('stage').getBoundingClientRect();

    messages.forEach((text, i) => {
        const el = document.createElement('div');
        el.className = 'reward-float';
        el.innerText = text;
        // Space them out vertically so they read as 2 separate lines
        el.style.top = `${referenceRect.top + 10 + (i * 25)}px`;
        document.body.appendChild(el);
    });
}

// Mode Selection Buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
        musicEngine.resume(); // Ensure audio unlocks on click
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        document.getElementById('info-modal').classList.add('hidden');
        startGame(); 
    };
});

function handleTileClick(id) {
    musicEngine.resume(); 

    // Start timer & hide instructions on first interaction
    if (!gameStarted) {
        gameStarted = true;

        // SAFELY start the music engine here, only if they haven't muted it
        if (isMusicEnabled) musicEngine.start();

        roundStartTime = Date.now();
        document.getElementById('instruction-overlay').classList.add('hidden');
        timerInterval = setInterval(() => {
            timeLeft--;
            document.getElementById('timer').innerText = `${timeLeft}s`;
            
            // NEW: Show hint button at 30 seconds if not already used
            if (timeLeft <= 30 && !hintUsedThisRound) {
                document.getElementById('hint-btn').classList.remove('hidden');
            }
            
            if (timeLeft <= 0) endGame();
        }, 1000);
    }
    
    if (!selectedOp) {
        selectedTileId = selectedTileId === id ? null : id;
    } else {
        if (selectedTileId === id) return;
        mergeTiles(selectedTileId, id, selectedOp);
    }
    render();
}

document.querySelectorAll('.op-btn').forEach(btn => {
    btn.onclick = () => {
        if (selectedTileId) {
            selectedOp = selectedOp === btn.dataset.op ? null : btn.dataset.op;
            render();
        }
    };
});

function mergeTiles(id1, id2, op) {
    

    history.push(JSON.parse(JSON.stringify(activeTiles)));

    const t1 = activeTiles.find(t => t.id === id1);
    const t2 = activeTiles.find(t => t.id === id2);
    
    let result = 0;
    switch(op) {
        case '+': result = t1.value + t2.value; break;
        case '-': result = t1.value - t2.value; break;
        case '*': result = t1.value * t2.value; break;
        case '/': result = t1.value / t2.value; break;
    }

    const newTile = {
        id: Math.random().toString(36).substr(2, 9),
        value: result,
        comboCount: t1.comboCount + t2.comboCount,
        leftChild: t1,
        rightChild: t2
    };

    activeTiles = activeTiles.filter(t => t.id !== id1 && t.id !== id2);
    activeTiles.push(newTile);
    
    selectedTileId = null;
    selectedOp = null;
    
    playComboSound(newTile.comboCount); // Play sound with dynamic pitch
    checkWinCondition();
}

function breakUpTile(id) {
    

    const tile = activeTiles.find(t => t.id === id);
    if (!tile || tile.comboCount === 1) return;
    
    history.push(JSON.parse(JSON.stringify(activeTiles)));
    activeTiles = activeTiles.filter(t => t.id !== id);
    activeTiles.push(tile.leftChild, tile.rightChild);
    
    selectedTileId = null;
    selectedOp = null;
    
    usedUndoThisRound = true; // Track undo
    playUndoSound();
    render();
}

// Global Undo Button
document.getElementById('undo-btn').onclick = () => {
    
    if (history.length > 0) {
        activeTiles = history.pop();
        selectedTileId = null;
        selectedOp = null;
        usedUndoThisRound = true; // Track undo
        playUndoSound();
        render();
    }
};

// --- Game Loop & Win/Loss ---
function checkWinCondition() {
    const params = MODES[currentMode];
    if (activeTiles.length === 1 && activeTiles[0].value === params.target && activeTiles[0].comboCount === params.tiles) {
        
        const baseScore = params.target + timeLeft;
        // Apply 5% bonus for every consecutive solve BEFORE this current one
        const bonusPercent = consecutiveSolves * 0.05; 
        const bonusPoints = Math.floor(baseScore * bonusPercent);
        
        score += (baseScore + bonusPoints); 
        
        totalSolves++;
        consecutiveSolves++;
        if (consecutiveSolves > maxCombo) maxCombo = consecutiveSolves;
        
        // Triggers
        document.getElementById('solve-count').innerText = `Solves: ${consecutiveSolves}`;
        updateBackground();
        showRewardText();
        playWinSound(); 
        render(); 
        
        // Pause to let the player read the reward text before clearing
        setTimeout(() => {
            // Clean up old floating text
            document.querySelectorAll('.reward-float').forEach(el => el.remove());
            
            timeLeft = 100; 
            document.getElementById('timer').innerText = `${timeLeft}s`; 
            currentQuestionIndex++;
            generateTiles(); 
            render(); 
        }, 1200); 
    }
}

function startGame() {
    clearInterval(timerInterval);
    score = 0;
    maxCombo = 0;
    totalSolves = 0;
    timeLeft = 100;
    consecutiveSolves = 0; // Reset consecutive count
    gameStarted = false;   // Wait for first tap to start timer
    hintUsedThisRound = false;

    
    // Reset UI
    document.body.style.backgroundColor = '#fcf9f2'; // Reset background to initial white/off-white
    document.getElementById('timer').innerText = `100s`;
    document.getElementById('solve-count').innerText = `Solves: 0`;
    
    // Set Instructions
    const instr = MODES[currentMode].instr;
    document.getElementById('instruction-overlay').innerText = instr;
    document.getElementById('instruction-overlay').classList.remove('hidden');

    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('score-submission').classList.remove('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
    document.getElementById('solution-display').classList.add('hidden');
    document.getElementById('player-name').value = '';

    updateUIForMode();
    generateTiles();
    render();
}

function renderSolution() {
    const container = document.getElementById('solution-text');
    container.innerHTML = ''; 
    
    currentSolutionSteps.forEach(step => {
        const row = document.createElement('div');
        row.className = 'solution-row';
        
        // Helper to quickly generate the styled mini-tiles
        const createTile = (val, combo, isRes) => {
            const el = document.createElement('div');
            let comboClass = combo <= 5 ? `combo-${combo}` : 'combo-5';
            
            const params = MODES[currentMode];
            // If it's the final target tile, make it flash gold
            if (isRes && combo === params.tiles && Math.abs(val - params.target) < 0.001) {
                el.className = `mini-tile gold`;
            } else {
                el.className = `mini-tile ${comboClass}`;
            }
            
            el.innerText = Number.isInteger(val) ? val : parseFloat(val.toFixed(2));
            return el;
        };

        const opSpan = document.createElement('span');
        opSpan.className = 'solution-op';
        opSpan.innerText = step.op;
        
        const eqSpan = document.createElement('span');
        eqSpan.className = 'solution-op';
        eqSpan.innerText = '=';
        
        // Build the row: [Num1] op [Num2] = [Result]
        row.appendChild(createTile(step.aVal, step.aCombo, false));
        row.appendChild(opSpan);
        row.appendChild(createTile(step.bVal, step.bCombo, false));
        row.appendChild(eqSpan);
        row.appendChild(createTile(step.resVal, step.resCombo, true));
        
        container.appendChild(row);
    });
}

function endGame(reason = "Time's Up!") {
    clearInterval(timerInterval);
    musicEngine.stop();
    
    document.querySelector('#game-over-modal h2').innerText = reason; 
    document.getElementById('final-score').innerText = score;
    document.getElementById('final-solves').innerText = totalSolves;
    document.getElementById('final-combo').innerText = maxCombo;     
    document.body.style.backgroundColor = '#fcf9f2'; 
    
    renderSolution(); // NEW: Call the visual step renderer
    
    document.getElementById('solution-display').classList.remove('hidden');
    document.getElementById('game-over-modal').classList.remove('hidden');
}

// --- Leaderboard & Nickname Submit (Supabase) ---
document.getElementById('submit-score-btn').onclick = async () => {
    const btn = document.getElementById('submit-score-btn');
    let name = document.getElementById('player-name').value.trim() || "Anonymous";
    btn.disabled = true; btn.innerText = "Saving...";
    
    if (currentMode === 'challenge') {
        let currentChallengeId = urlChallengeId;
        
        // If you are the creator, upload the 10 questions to the database first!
        if (!currentChallengeId) {
            const { data, error } = await supabaseClient.from('challenges')
                .insert([{ creator_name: name, questions: challengeQuestions }])
                .select('id').single();
            if (data) currentChallengeId = data.id;
        }
        
        // Save score to challenge_scores
        await supabaseClient.from('challenge_scores').insert([{ 
            challenge_id: currentChallengeId, player_name: name, 
            score: score, solves: totalSolves, max_combo: maxCombo 
        }]);
        
        // Show the Share Link UI
        const shareUrl = `${window.location.origin}${window.location.pathname}?challenge=${currentChallengeId}`;
        document.getElementById('share-link').value = shareUrl;
        document.getElementById('share-link-container').classList.remove('hidden');
        
        // Update Leaderboard specifically for this challenge
        await renderChallengeLeaderboard(currentChallengeId);
        
    } else {
        // Normal Make 50 Leaderboard saving (Keep your existing saveToLeaderboard call here)
        await saveToLeaderboard(name, score);
        await renderLeaderboard();
    }
    
    document.getElementById('score-submission').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.remove('hidden');
    btn.disabled = false; btn.innerText = "Save Score";
};

// Copy link functionality
document.getElementById('copy-link-btn').onclick = () => {
    const linkInput = document.getElementById('share-link');
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value);
    document.getElementById('copy-link-btn').innerText = "Copied!";
};

async function saveToLeaderboard(name, newScore) {
    try {
        const { error } = await supabaseClient
            .from('leaderboard')
            .insert([{ 
                player_name: name, 
                score: newScore, 
                solves: totalSolves, 
                max_combo: maxCombo, // NEW: Sending the combo
                game_mode: currentMode 
            }]);
            
        if (error) throw error;
    } catch (error) {
        console.error("Supabase Error:", error.message);
    }
}

async function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    const displayTitle = MODES[currentMode].name; // Use mode name dynamically
    document.getElementById('leaderboard-title').innerText = `${displayTitle} Leaderboard`;
    list.innerHTML = '<li>Loading scores...</li>';
    
    try {
        const { data, error } = await supabaseClient
            .from('leaderboard')
            .select('player_name, score, solves, max_combo') // NEW: Select max_combo
            .eq('game_mode', currentMode)
            .order('score', { ascending: false })
            .limit(5); 
            
        if (error) throw error;
        
        if (data.length === 0) {
            list.innerHTML = '<li>No scores yet. Be the first!</li>';
        } else {
            list.innerHTML = data.map((entry, i) => {
                const solveText = entry.solves ? `${entry.solves} solves` : '';
                const comboText = entry.max_combo ? ` | Max Combo: ${entry.max_combo}x` : '';
                return `<li>#${i+1} - <strong>${entry.player_name}</strong>: ${entry.score} pts <br> <small>(${solveText}${comboText})</small></li>`;
            }).join('');
        }
    } catch (error) {
        console.error("Supabase Error:", error.message);
        list.innerHTML = '<li>Failed to load leaderboard.</li>';
    }
}


document.getElementById('restart-btn').onclick = startGame;

// --- Menu Modal Logic ---
document.getElementById('menu-btn').onclick = () => {
    document.getElementById('info-modal').classList.remove('hidden');
};

document.getElementById('close-info-btn').onclick = () => {
    document.getElementById('info-modal').classList.add('hidden');
    
    // Resume audio if needed
    musicEngine.resume(); 
};

// NEW: Quit and Save early
document.getElementById('quit-save-btn').onclick = () => {
    // Hide the menu modal
    document.getElementById('info-modal').classList.add('hidden');
    
    // Trigger the exact same Game Over flow as the timer running out
    endGame(); 
};

document.getElementById('skip-btn').onclick = () => {
    if (!gameStarted) return; 
    
    // Check if skipping causes a negative score
    if (score - 200 < 0) {
        endGame("Game Over! Try Again");
        return;
    }
    
    score -= 200;
    consecutiveSolves = 0;
    updateBackground(); 
    
    // Fix Red floating "-" bug by targeting the stage center instead of the score
    const el = document.createElement('div');
    el.className = 'reward-float';
    el.innerText = "-200 (Skip)";
    el.style.color = "#c44949"; 
    
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    el.style.top = `${stageRect.top}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);

    timeLeft = 100;
    document.getElementById('timer').innerText = `${timeLeft}s`;
    document.getElementById('solve-count').innerText = `Solves: ${totalSolves}`;
    document.getElementById('combo-count').innerText = `Combo: ${consecutiveSolves}`;
    
    render(); 
    currentQuestionIndex++;
    generateTiles();
    render();
};

document.getElementById('hint-btn').onclick = () => {
    if (hintUsedThisRound) return;
    
    consecutiveSolves = 0;
    document.getElementById('combo-count').innerText = `Combo: ${consecutiveSolves}`;
    updateBackground();
    
    hintUsedThisRound = true;
    document.getElementById('hint-btn').classList.add('hidden');
    
    // Grab the final step of the master solution that equals 50
    const finalStep = currentSolutionSteps[currentSolutionSteps.length - 1];
    
    const hintDisplay = document.getElementById('hint-display');
    hintDisplay.innerText = `Hint: ${finalStep.aVal} ${finalStep.op} ${finalStep.bVal} = ${finalStep.resVal}`;
    hintDisplay.classList.remove('hidden');
};

// --- Music Toggle Logic ---
document.getElementById('music-btn').onclick = () => {
    musicEngine.resume(); 
    
    isMusicEnabled = !isMusicEnabled; 
    localStorage.setItem('make50_music_pref', isMusicEnabled);
    const musicBtn = document.getElementById('music-btn');
    
    if (isMusicEnabled) {
        musicBtn.classList.remove('muted'); // Removes the strike-through
        if (gameStarted) musicEngine.start(); 
    } else {
        musicBtn.classList.add('muted');    // Adds the strike-through
        musicEngine.stop(); 
    }
};


// Initialize
if (!isMusicEnabled) {
    document.getElementById('music-btn').classList.add('muted');
}

// Check for a challenge link on load
if (urlChallengeId) {
    currentMode = 'challenge';
    loadChallengeData(urlChallengeId);
} else {
    startGame();
}

async function loadChallengeData(id) {
    document.getElementById('instruction-overlay').innerText = "Loading challenge...";
    const { data, error } = await supabaseClient.from('challenges').select('*').eq('id', id).single();
    if (data) {
        challengeQuestions = data.questions;
        challengeCreatorName = data.creator_name;
        
        MODES.challenge.name = `${challengeCreatorName}'s Challenge`;
        
        // NEW: Update the on-screen instruction text for the challenger!
        MODES.challenge.instr = `${challengeCreatorName}'s challenge!`; 
        
        startGame();
    } else {
        alert("This challenge has expired or doesn't exist!");
        urlChallengeId = null;
        currentMode = 'make50';
        startGame();
    }
}
// --- NEW: Fetch and Display Challenge-Specific Scores ---
async function renderChallengeLeaderboard(challengeId) {
    const list = document.getElementById('leaderboard-list');
    
    // Set a custom title so players know they are looking at the specific challenge
    const displayTitle = challengeCreatorName ? `${challengeCreatorName}'s Challenge` : "Challenge Leaderboard";
    document.getElementById('leaderboard-title').innerText = displayTitle;
    
    list.innerHTML = '<li>Loading scores...</li>';
    
    try {
        // Query the dedicated challenge_scores table using the specific challenge URL ID
        const { data, error } = await supabaseClient
            .from('challenge_scores')
            .select('player_name, score, solves, max_combo') 
            .eq('challenge_id', challengeId)
            .order('score', { ascending: false })
            .limit(10); // Show top 10 friends
            
        if (error) throw error;
        
        if (data.length === 0) {
            list.innerHTML = '<li>No scores yet. Be the first to dominate!</li>';
        } else {
            list.innerHTML = data.map((entry, i) => {
                const solveText = entry.solves ? `${entry.solves} solves` : '';
                const comboText = entry.max_combo ? ` | Max Combo: ${entry.max_combo}x` : '';
                return `<li>#${i+1} - <strong>${entry.player_name}</strong>: ${entry.score} pts <br> <small>(${solveText}${comboText})</small></li>`;
            }).join('');
        }
    } catch (error) {
        console.error("Supabase Error:", error.message);
        list.innerHTML = '<li>Failed to load challenge leaderboard.</li>';
    }
}

// --- Universal Screenshot Logic ---
document.getElementById('screenshot-btn').onclick = async () => {
    const btn = document.getElementById('screenshot-btn');
    btn.innerText = "📸 Snapping photo...";

    // 1. Target the modal wrapper
    const targetElement = document.querySelector('#game-over-modal .modal-content');
    
    // 2. Save original states so we can restore them
    const titleEl = document.querySelector('#game-over-modal h2');
    const originalTitle = titleEl.innerText;
    
    // Elements to temporarily hide from the screenshot
    const elementsToHide = [
        document.querySelector('.end-game-actions'),     // FIX: Hides the entire button row at once!
        document.getElementById('share-link-container'), // Hide the URL box
        document.getElementById('score-submission')      // Hide the Name Input
    ];

    // 3. Inject the "Hype" Annotation dynamically based on the mode!
    if (currentMode === 'challenge') {
        const creator = challengeCreatorName ? challengeCreatorName : "this";
        titleEl.innerText = `I dominated ${creator}'s Challenge! 👑`;
    } else {
        // Automatically grabs "Make 50" or "Practice 2", etc.
        const modeName = MODES[currentMode].name; 
        titleEl.innerText = `I scored ${score} pts in ${modeName}! 🧠`;
    }
    
    // Hide the interactive UI buttons
    elementsToHide.forEach(el => { if(el) el.style.display = 'none'; });

    // 4. Inject the Promotional Tagline
    const promoTag = document.createElement('p');
    promoTag.innerText = "Think you can do better? Try it at www.bigwgames.com/make50";
    promoTag.style.fontWeight = "800";
    promoTag.style.color = "#4a90e2"; 
    promoTag.style.marginTop = "20px";
    promoTag.style.fontSize = "1.1rem";
    targetElement.appendChild(promoTag);

    // 5. Take the high-res picture
    try {
        const canvas = await html2canvas(targetElement, {
            backgroundColor: "#ffffff",
            scale: 2 // Crisp Retina resolution
        });
        
        // Download to device
        const image = canvas.toDataURL("image/png");
        const link = document.createElement('a');
        link.download = `Make50_${currentMode}_Score.png`;
        link.href = image;
        link.click();
    } catch (err) {
        console.error("Screenshot failed:", err);
        alert("Oops! Couldn't capture the screenshot.");
    }

    // 6. Restore UI
    titleEl.innerText = originalTitle;
    elementsToHide.forEach(el => { if(el) el.style.display = ''; });
    promoTag.remove(); 
    
    btn.innerText = "📸 Camera Roll";
};