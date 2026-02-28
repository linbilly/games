let score = 0;
let timeLeft = 100;
let timerInterval;
let activeTiles = [];
let history = []; // For global undo

let selectedTileId = null;
let selectedOp = null;

// --- Logic: Math Solver ---
function canReach50(arr) {
    if (arr.length === 1) return Math.abs(arr[0] - 50) < 0.001;
    
    // Test all pairs in the array
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
            if (i === j) continue;
            
            let remaining = arr.filter((_, idx) => idx !== i && idx !== j);
            let a = arr[i], b = arr[j];
            let results = [a + b, a - b, a * b];
            if (b !== 0) results.push(a / b);
            
            for (let res of results) {
                if (canReach50([...remaining, res])) return true;
            }
        }
    }
    return false;
}

// --- Logic: Question Generation ---
function generateTiles() {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]; // 10 is 3x more frequent
    let validSet = false;
    let numbers = [];

    while (!validSet) {
        numbers = [];
        let onesAndTwos = 0;
        
        for (let i = 0; i < 5; i++) {
            let num = pool[Math.floor(Math.random() * pool.length)];
            if (num === 1 || num === 2) onesAndTwos++;
            numbers.push(num);
        }

        if (onesAndTwos <= 3 && canReach50(numbers)) {
            validSet = true;
        }
    }

    activeTiles = numbers.map(num => ({
        id: Math.random().toString(36).substr(2, 9),
        value: num,
        comboCount: 1,
        leftChild: null,  // Used for breaking apart tiles
        rightChild: null
    }));
    
    history = [];
    selectedTileId = null;
    selectedOp = null;
}

// --- UI & Interactions ---
function render() {
    document.getElementById('score').innerText = `Score: ${score}`;
    const stage = document.getElementById('stage');
    stage.innerHTML = '';

    activeTiles.forEach(tile => {
        const el = document.createElement('div');
        let isGold = (activeTiles.length === 1 && tile.value === 50 && tile.comboCount === 5);
        let comboClass = tile.comboCount <= 5 ? `combo-${tile.comboCount}` : 'combo-5';
        
        el.className = `tile ${comboClass} ${isGold ? 'gold' : ''} ${tile.id === selectedTileId ? 'selected' : ''}`;
        
        // Show integers cleanly, round decimals to 2 places to prevent layout breaking
        el.innerText = Number.isInteger(tile.value) ? tile.value : parseFloat(tile.value.toFixed(2));
        
        // Click to select
        el.onclick = () => handleTileClick(tile.id);
        
        // Double click to break apart
        el.ondblclick = (e) => {
            e.preventDefault(); // Stop normal selection behavior
            breakUpTile(tile.id);
        };
        
        stage.appendChild(el);
    });

    document.querySelectorAll('.op-btn').forEach(btn => {
        btn.classList.toggle('selected-op', btn.dataset.op === selectedOp);
    });
}

function handleTileClick(id) {
    if (!selectedOp) {
        // Change selection
        selectedTileId = selectedTileId === id ? null : id;
    } else {
        // We have an operation and a previously selected tile. Time to merge!
        if (selectedTileId === id) return; // Can't merge with itself
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
    saveHistory(); // Save state before merging

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

    checkWinCondition();
}

function breakUpTile(id) {
    const tile = activeTiles.find(t => t.id === id);
    if (!tile || tile.comboCount === 1) return; // Can't break a base tile
    
    saveHistory();
    activeTiles = activeTiles.filter(t => t.id !== id);
    activeTiles.push(tile.leftChild, tile.rightChild);
    
    selectedTileId = null;
    selectedOp = null;
    render();
}

// --- History & Global Undo ---
function saveHistory() {
    // Deep clone the current state of tiles
    history.push(JSON.parse(JSON.stringify(activeTiles)));
}

document.getElementById('undo-btn').onclick = () => {
    if (history.length > 0) {
        activeTiles = history.pop();
        selectedTileId = null;
        selectedOp = null;
        render();
    }
};

// --- Game Loop & Win/Loss ---
function checkWinCondition() {
    // Check if there is 1 tile left, it equals 50, and it is a Level 5 combination
    if (activeTiles.length === 1 && activeTiles[0].value === 50 && activeTiles[0].comboCount === 5) {
        score += 50 + timeLeft;
        
        // Render immediately so the player sees the Gold Sparkly tile
        render(); 
        
        // Pause for 800ms to admire the gold tile, then reset the board and timer
        setTimeout(() => {
            timeLeft = 100; // Reset timer to 100
            document.getElementById('timer').innerText = `${timeLeft}s`; // Update UI
            
            generateTiles(); // Generate new puzzle
            render(); // Render new tiles
        }, 800); 
    }
}

function startGame() {
    score = 0;
    timeLeft = 100;
    document.getElementById('game-over-modal').classList.add('hidden');
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
    updateLeaderboard(score);
}

// --- Leaderboard (Local Storage) ---
function updateLeaderboard(newScore) {
    let board = JSON.parse(localStorage.getItem('math50Leaderboard') || '[]');
    board.push(newScore);
    board.sort((a, b) => b - a); // Highest first
    board = board.slice(0, 5); // Keep top 5
    localStorage.setItem('math50Leaderboard', JSON.stringify(board));

    const list = document.getElementById('leaderboard-list');
    list.innerHTML = board.map((s, i) => `<li>#${i+1} - ${s} pts</li>`).join('');
}

document.getElementById('restart-btn').onclick = startGame;

// Initialize
startGame();