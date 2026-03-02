// --- Audio System (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// --- Supabase Setup ---
const SUPABASE_URL = 'https://dxnxwwgamfylqcjahtzv.supabase.co'; // Replace with your URL
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VRwl-Fna636SBgiGpF-yGw_pGqe0VrS'; // Use your new publishable key
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);



function playComboSound(level) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // Pitch goes up based on the combo level (Level 2 is higher than Level 1, etc.)
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300 + (level * 150), audioCtx.currentTime);
    
    // Quick, satisfying "pop" envelope
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
}

function playUndoSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // A lower, duller pop for breaking a tile apart
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(250, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playWinSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    // Play a sparkly ascending arpeggio (A Major chord)
    const notes = [440, 554.37, 659.25, 880]; 
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.1);
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.1);
        gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + i * 0.1 + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.1 + 0.4);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start(audioCtx.currentTime + i * 0.1);
        osc.stop(audioCtx.currentTime + i * 0.1 + 0.4);
    });
}


// --- Game State ---
const MODES = {
    practice1: { name: 'Practice 1', tiles: 3, target: 10, ops: ['+', '-'], instr: 'Make 10 using all numbers' },
    practice2: { name: 'Practice 2', tiles: 3, target: 20, ops: ['+', '-', '*', '/'], instr: 'Make 20 using all numbers' },
    practice3: { name: 'Practice 3', tiles: 4, target: 50, ops: ['+', '-', '*', '/'], instr: 'Make 50 using all numbers', pool: [1, 2, 5, 10] },
    make50:    { name: 'Make 50', tiles: 5, target: 50, ops: ['+', '-', '*', '/'], instr: 'Make 50 using all numbers shown' }
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
            
            if (allowedOps.includes('+')) results.push({ val: a.val + b.val, op: '+' });
            if (allowedOps.includes('-')) results.push({ val: a.val - b.val, op: '−' });
            if (allowedOps.includes('*')) results.push({ val: a.val * b.val, op: '×' });
            if (allowedOps.includes('/') && Math.abs(b.val) > 0.001) results.push({ val: a.val / b.val, op: '÷' });
            
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
    const params = MODES[currentMode];
    // Use the mode's pool if it exists, otherwise default
    const pool = params.pool || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10];
    let validSet = false;
    let numbers = [];
    let foundSolution = null;

    while (!validSet) {
        numbers = [];
        let onesAndTwos = 0;
        
        for (let i = 0; i < params.tiles; i++) {
            let num = pool[Math.floor(Math.random() * pool.length)];
            if (num === 1 || num === 2) onesAndTwos++;
            numbers.push(num);
        }

        let testArr = numbers.map(n => ({ val: n, combo: 1 }));
        let foundSolution = findSolution(testArr, params.target, params.ops);

        if (onesAndTwos <= 3 && foundSolution) {
            validSet = true;
            currentSolutionSteps = foundSolution; // Save the array of steps
        }
    }

    activeTiles = numbers.map(num => ({
        id: Math.random().toString(36).substr(2, 9),
        value: num,
        comboCount: 1,
        leftChild: null,
        rightChild: null
    }));
    
    history = [];
    selectedTileId = null;
    selectedOp = null;
    
    // Reset round-specific trackers
    usedUndoThisRound = false; 
    roundStartTime = Date.now(); 
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
        
        el.className = `tile ${comboClass} ${isGold ? 'gold' : ''} ${tile.id === selectedTileId ? 'selected' : ''}`;
        el.innerText = Number.isInteger(tile.value) ? tile.value : parseFloat(tile.value.toFixed(2));
        
        // --- Drag and Drop Logic ---
        el.draggable = true;
        el.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', index);
            setTimeout(() => el.classList.add('dragging'), 0);
        };
        el.ondragover = (e) => e.preventDefault(); // Required for dropping
        el.ondrop = (e) => {
            e.preventDefault();
            const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (draggedIndex !== index) {
                // Swap the tiles in the array
                const temp = activeTiles[draggedIndex];
                activeTiles[draggedIndex] = activeTiles[index];
                activeTiles[index] = temp;
                render();
            }
        };
        el.ondragend = () => el.classList.remove('dragging');
        
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
        if (audioCtx.state === 'suspended') audioCtx.resume(); // Ensure audio unlocks on click
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        document.getElementById('info-modal').classList.add('hidden');
        startGame(); 
    };
});

function handleTileClick(id) {
    if (audioCtx.state === 'suspended') audioCtx.resume(); 

    // Start timer & hide instructions on first interaction
    if (!gameStarted) {
        gameStarted = true;
        roundStartTime = Date.now();
        document.getElementById('instruction-overlay').classList.add('hidden');
        timerInterval = setInterval(() => {
            timeLeft--;
            document.getElementById('timer').innerText = `${timeLeft}s`;
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

    startBGM();
    
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
    stopBGM();
    
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
    let name = document.getElementById('player-name').value.trim();
    if (!name) name = "Anonymous";
    
    // Disable button to prevent double-submits
    btn.disabled = true;
    btn.innerText = "Saving...";
    
    await saveToLeaderboard(name, score);
    
    document.getElementById('score-submission').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.remove('hidden');
    
    await renderLeaderboard();
    
    // Reset button
    btn.disabled = false;
    btn.innerText = "Save Score";
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
    if (audioCtx.state === 'suspended') audioCtx.resume(); 
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
    generateTiles();
    render();
};

// --- Generative Adaptive Background Music ---
let bgmTimerID;
let isBGMActive = false;
let nextNoteTime = 0;
let bgmStep = 0; 
let sessionMelody = [];

// A bright, happy Major scale (C Major + higher octaves)
const majorScale = [
    261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, // C4 to B4
    523.25, 587.33, 659.25, 698.46, 783.99, 880.00          // C5 to A5
];

// Generates a random happy 8-note melody sequence once per session
function generateSessionMelody() {
    sessionMelody = [];
    for(let i=0; i<8; i++) {
        // Pick random notes favoring the root, third, and fifth for a "happy" sound
        let note = majorScale[Math.floor(Math.random() * majorScale.length)];
        sessionMelody.push(note);
    }
}

function startBGM() {
    if (isBGMActive) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (sessionMelody.length === 0) generateSessionMelody();
    
    isBGMActive = true;
    nextNoteTime = audioCtx.currentTime + 0.1;
    bgmStep = 0;
    scheduleBGM();
}

function stopBGM() {
    isBGMActive = false;
    clearTimeout(bgmTimerID);
}

function playSynth(freq, time, duration, vol) {
    if (!freq) return; 
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'triangle'; // Triangle is round and bubbly
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + duration * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.9);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(time);
    osc.stop(time + duration);
}

function scheduleBGM() {
    if (!isBGMActive) return;
    
    // Starts slow (400ms per note). 
    // Speeds up 10% per combo step: Math.pow(0.9, consecutiveSolves).
    // Caps at a max speed of 120ms so it doesn't turn to mush.
    let currentTempo = 0.40 * Math.pow(0.9, consecutiveSolves);
    currentTempo = Math.max(0.12, currentTempo); 
    
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        let noteToPlay = sessionMelody[bgmStep % sessionMelody.length];
        
        // Play the melody
        playSynth(noteToPlay, nextNoteTime, currentTempo * 1.5, 0.05);
        
        // Add a soft underlying bass note every 4 steps to anchor the harmony
        if (bgmStep % 4 === 0) {
            playSynth(majorScale[0] / 2, nextNoteTime, currentTempo * 3, 0.06);
        }

        nextNoteTime += currentTempo;
        bgmStep++;
    }
    
    bgmTimerID = setTimeout(scheduleBGM, 25);
}

// Initialize
startGame();