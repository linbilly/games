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
    easy:   { tiles: 3, target: 10, ops: ['+', '-'] },
    medium: { tiles: 3, target: 20, ops: ['+', '-', '*', '/'] },
    make50: { tiles: 5, target: 50, ops: ['+', '-', '*', '/'] }
};

let currentMode = 'make50';
let score = 0;
let timeLeft = 100;
let timerInterval;
let activeTiles = [];
let history = []; 
let currentSolutionStr = ""; // Tracks the solution equation

let selectedTileId = null;
let selectedOp = null;

let lastTapTime = 0;      // NEW: Tracks double-taps
let lastTapTileId = null; // NEW: Tracks double-taps

// --- Logic: Math Solver (Now returns the equation string) ---
function findSolution(arr, target, allowedOps) {
    if (arr.length === 1) {
        if (Math.abs(arr[0].val - target) < 0.001) return arr[0].exp;
        return null; // Return null if not a match
    }
    
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
            if (i === j) continue;
            
            let remaining = arr.filter((_, idx) => idx !== i && idx !== j);
            let a = arr[i], b = arr[j];
            let results = [];
            
            // Build the expression strings using proper math symbols
            if (allowedOps.includes('+')) results.push({ val: a.val + b.val, exp: `(${a.exp} + ${b.exp})` });
            if (allowedOps.includes('-')) results.push({ val: a.val - b.val, exp: `(${a.exp} − ${b.exp})` });
            if (allowedOps.includes('*')) results.push({ val: a.val * b.val, exp: `(${a.exp} × ${b.exp})` });
            if (allowedOps.includes('/') && Math.abs(b.val) > 0.001) results.push({ val: a.val / b.val, exp: `(${a.exp} ÷ ${b.exp})` });
            
            for (let res of results) {
                let solution = findSolution([...remaining, res], target, allowedOps);
                if (solution) return solution; // Bubble the successful string up
            }
        }
    }
    return null;
}

// --- Logic: Question Generation ---
function generateTiles() {
    const params = MODES[currentMode];
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10];
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

        // Prepare objects for the solver: { val: 5, exp: "5" }
        let testArr = numbers.map(n => ({ val: n, exp: n.toString() }));
        foundSolution = findSolution(testArr, params.target, params.ops);

        if (onesAndTwos <= 3 && foundSolution) {
            validSet = true;
            // Clean up the outer parentheses for cleaner display
            if (foundSolution.startsWith('(') && foundSolution.endsWith(')')) {
                foundSolution = foundSolution.slice(1, -1);
            }
            currentSolutionStr = `${foundSolution} = ${params.target}`;
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
}
// --- Logic: Math Solver ---
function canReachTarget(arr, target, allowedOps) {
    return false;
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
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    
    const params = MODES[currentMode];

    activeTiles.forEach(tile => {
        const el = document.createElement('div');
        
        let isGold = (activeTiles.length === 1 && tile.value === params.target && tile.comboCount === params.tiles);
        let comboClass = tile.comboCount <= 5 ? `combo-${tile.comboCount}` : 'combo-5';
        
        el.className = `tile ${comboClass} ${isGold ? 'gold' : ''} ${tile.id === selectedTileId ? 'selected' : ''}`;
        el.innerText = Number.isInteger(tile.value) ? tile.value : parseFloat(tile.value.toFixed(2));
        
        // REPLACE your old el.onclick and el.ondblclick with this:
        
        el.onclick = (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;
            
            // If tapped twice within 300 milliseconds on the same tile
            if (tapLength < 300 && tapLength > 0 && lastTapTileId === tile.id) {
                e.preventDefault(); 
                breakUpTile(tile.id);
                lastTapTime = 0; // Reset the timer
            } else {
                // Otherwise, treat it as a single tap
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
    if (audioCtx.state === 'suspended') audioCtx.resume(); // Unlock audio on first interaction
    
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
    
    playUndoSound(); // Play breaking apart sound
    render();
}

// Global Undo Button
document.getElementById('undo-btn').onclick = () => {
    if (history.length > 0) {
        activeTiles = history.pop();
        selectedTileId = null;
        selectedOp = null;
        playUndoSound();
        render();
    }
};

// --- Game Loop & Win/Loss ---
function checkWinCondition() {
    const params = MODES[currentMode];
    if (activeTiles.length === 1 && activeTiles[0].value === params.target && activeTiles[0].comboCount === params.tiles) {
        score += params.target + timeLeft; 
        playWinSound(); // Play sparkly win sound!
        render(); 
        
        setTimeout(() => {
            timeLeft = 100; 
            document.getElementById('timer').innerText = `${timeLeft}s`; 
            generateTiles(); 
            render(); 
        }, 800); 
    }
}

function startGame() {
    clearInterval(timerInterval);
    score = 0;
    timeLeft = 100;
    
    // Hide Modals and Solution
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('score-submission').classList.remove('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
    document.getElementById('solution-display').classList.add('hidden'); // NEW
    document.getElementById('player-name').value = '';

    updateUIForMode();
    generateTiles();
    render();

    timerInterval = setInterval(() => {
        timeLeft--;
        document.getElementById('timer').innerText = `${timeLeft}s`;
        if (timeLeft <= 0) endGame();
    }, 1000);
}

function endGame() {
    clearInterval(timerInterval);
    document.getElementById('final-score').innerText = score;
    
    // NEW: Inject the solution string and show the box
    document.getElementById('solution-text').innerText = currentSolutionStr;
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
                game_mode: currentMode 
            }]);
            
        if (error) throw error;
    } catch (error) {
        console.error("Supabase Error:", error.message);
        alert("Couldn't save to the online leaderboard. Check your connection.");
    }
}

async function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    const displayTitle = currentMode === 'make50' ? 'Make 50' : currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
    document.getElementById('leaderboard-title').innerText = `${displayTitle} Leaderboard`;
    list.innerHTML = '<li>Loading scores...</li>';
    
    try {
        const { data, error } = await supabaseClient
            .from('leaderboard')
            .select('player_name, score')
            .eq('game_mode', currentMode)
            .order('score', { ascending: false })
            .limit(5); // Get top 5
            
        if (error) throw error;
        
        if (data.length === 0) {
            list.innerHTML = '<li>No scores yet. Be the first!</li>';
        } else {
            list.innerHTML = data.map((entry, i) => `<li>#${i+1} - <strong>${entry.player_name}</strong>: ${entry.score} pts</li>`).join('');
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

// Initialize
startGame();