// --- Audio System (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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
    normal: { tiles: 5, target: 50, ops: ['+', '-', '*', '/'] }
};

let currentMode = 'normal';
let score = 0;
let timeLeft = 100;
let timerInterval;
let activeTiles = [];
let history = []; 

let selectedTileId = null;
let selectedOp = null;

// --- Logic: Math Solver ---
function canReachTarget(arr, target, allowedOps) {
    if (arr.length === 1) return Math.abs(arr[0] - target) < 0.001;
    
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
            if (i === j) continue;
            
            let remaining = arr.filter((_, idx) => idx !== i && idx !== j);
            let a = arr[i], b = arr[j];
            let results = [];
            
            if (allowedOps.includes('+')) results.push(a + b);
            if (allowedOps.includes('-')) results.push(a - b);
            if (allowedOps.includes('*')) results.push(a * b);
            if (allowedOps.includes('/') && b !== 0) results.push(a / b);
            
            for (let res of results) {
                if (canReachTarget([...remaining, res], target, allowedOps)) return true;
            }
        }
    }
    return false;
}

// --- Logic: Question Generation ---
function generateTiles() {
    const params = MODES[currentMode];
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10];
    let validSet = false;
    let numbers = [];

    while (!validSet) {
        numbers = [];
        let onesAndTwos = 0;
        
        for (let i = 0; i < params.tiles; i++) {
            let num = pool[Math.floor(Math.random() * pool.length)];
            if (num === 1 || num === 2) onesAndTwos++;
            numbers.push(num);
        }

        if (onesAndTwos <= 3 && canReachTarget(numbers, params.target, params.ops)) {
            validSet = true;
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

// --- UI & Interactions ---
function updateUIForMode() {
    const params = MODES[currentMode];
    document.getElementById('game-title').innerText = `Make ${params.target}`;
    document.getElementById('game-desc').innerText = `Use the math operators to combine the numbers to make ${params.target}`;
    
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
        
        el.onclick = () => handleTileClick(tile.id);
        
        // Double Click to Undo (Break apart tile)
        el.ondblclick = (e) => { 
            e.preventDefault(); 
            breakUpTile(tile.id); 
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
    
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('score-submission').classList.remove('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
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
    document.getElementById('game-over-modal').classList.remove('hidden');
}

// --- Leaderboard & Nickname Submit ---
document.getElementById('submit-score-btn').onclick = () => {
    let name = document.getElementById('player-name').value.trim();
    if (!name) name = "Anonymous";
    
    saveToLeaderboard(name, score);
    
    document.getElementById('score-submission').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.remove('hidden');
    
    renderLeaderboard();
};

function saveToLeaderboard(name, newScore) {
    const boardKey = `math50Leaderboard_${currentMode}`;
    let board = JSON.parse(localStorage.getItem(boardKey) || '[]');
    
    board.push({ name: name, score: newScore });
    board.sort((a, b) => b.score - a.score); 
    board = board.slice(0, 5); 
    
    localStorage.setItem(boardKey, JSON.stringify(board));
}

function renderLeaderboard() {
    const boardKey = `math50Leaderboard_${currentMode}`;
    let board = JSON.parse(localStorage.getItem(boardKey) || '[]');
    const list = document.getElementById('leaderboard-list');
    
    document.getElementById('leaderboard-title').innerText = `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)} Leaderboard`;
    
    list.innerHTML = board.map((entry, i) => `<li>#${i+1} - <strong>${entry.name}</strong>: ${entry.score} pts</li>`).join('');
}

document.getElementById('restart-btn').onclick = startGame;

// Initialize
startGame();