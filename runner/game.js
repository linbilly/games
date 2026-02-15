// Make 5 / Make 10 Runner (Vertical Holes + Click-to-Move + Click-to-Grab/Drop + Audio)
// Pure HTML Canvas + minimal DOM (no libraries)

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const levelLabel = document.getElementById('levelLabel');
  const coinsEl = document.getElementById('coins');
  const banner = document.getElementById('banner');

  const btnRestart = document.getElementById('btnRestart');
  const btnHelp = document.getElementById('btnHelp');
  const helpModal = document.getElementById('helpModal');
  const closeHelp = document.getElementById('closeHelp');

  // Touch buttons remain available, but primary control is click/touch in the playfield.
  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');
  const jumpBtn = document.getElementById('jumpBtn');

  // Game constants
  const TILE = 36;
  const GROUND_Y = 420;
  const EARTH_DEPTH_TILES = 8;   // earth blocks 8 deep (deeper than holes)

  const GRAVITY = 2100;
  const MAX_FALL = 2600;
  const MOVE_ACC = 3400;
  const MOVE_FRICTION = 2800;
  const MAX_SPEED = 340;
  const JUMP_V = 760;

  const COYOTE_TIME = 0.11;
  const JUMP_BUFFER = 0.13;

  // Camera
  let camX = 0;
  let camShake = 0;

  // Input (keyboard still works; click/touch is primary)
  const keys = { left:false, right:false };
  let jumpPressedAt = -999;

  // Click-to-move intent
  let moveTargetX = null;          // world x to walk toward
  let pendingPickup = null;        // pickup we intend to grab
  let pendingDropHole = null;      // hole we intend to drop into

  // Carrying brick
  let carriedN = null;

  // Game state
  let coins = 0;
  let levelIndex = 0;
  let lastBannerAt = -999;

  
  // Equation overlay (shown only after dropping a block into a hole)
  const eqOverlay = {
    fullText: '',
    shownChars: 0,
    showUntil: -999,
    kind: 'none' // 'correct' | 'wrong'
  };

  function showEquation(text, kind='correct') {
    eqOverlay.fullText = text;
    eqOverlay.shownChars = 0;
    eqOverlay.kind = kind;
    eqOverlay.showUntil = nowS() + 1.6; // visible duration after fully written
  }

// Audio (WebAudio oscillator)
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
  }
  function beep(freq, dur=0.10, type='sine', vol=0.06) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
  function soundPickup(){ beep(740, 0.08, 'square', 0.05); }
  function soundCorrect(){ beep(660, 0.09, 'sine', 0.06); setTimeout(()=>beep(880,0.10,'sine',0.06), 90); }
  function soundWrong(){ beep(180, 0.14, 'sawtooth', 0.05); }

  // Levels (vertical holes)
  function makeLevel(target, holeW, holeH) {
    const rng = mulberry32(target * 1000 + holeW * 31 + holeH * 17 + 42);
    const holes = [];
    let x = 10; // tiles
    for (let i = 0; i < 7; i++) {
      x += 6 + Math.floor(rng() * 6);
      const filled = Math.max(1, Math.min(target - 1, 1 + Math.floor(rng() * (target - 1))));
      holes.push({
        id: `h${target}_${i}`,
        xTile: x,
        wTile: holeW,
        hTile: holeH,
        target,
        filled,
        solved: false,
        previewAdd: 0,
        previewUntil: -999,
        previewStart: -999,
        lastResultText: ''
      });
    }
    const endX = (x + 18) * TILE;
    return { target, holes, endX };
  }

  const levels = [
    makeLevel(5, 1, 5),
    makeLevel(10, 2, 5),
  ];

  // Player
  const player = {
    x: 5 * TILE,
    y: GROUND_Y - 52,
    w: 28,
    h: 46,
    vx: 0,
    vy: 0,
    onGround: false,
    lastOnGroundAt: 0,
  };

  // Floating pickups (clickable)
  /** @type {{id:string, holeRef:any, n:number, x:number, y:number, w:number, h:number, taken:boolean}[]} */
  let pickups = [];

  function resetLevel(i) {
    levelIndex = i;
    const lvl = levels[levelIndex];

    coins = 0;
    carriedN = null;
    moveTargetX = null;
    pendingPickup = null;
    pendingDropHole = null;

    player.x = 5 * TILE;
    player.y = GROUND_Y - player.h;
    player.vx = 0;
    player.vy = 0;

    camX = 0;
    camShake = 0;

    for (const h of lvl.holes) {
      h.solved = false;
      h.previewAdd = 0;
      h.previewUntil = -999;
      h.previewStart = -999;
      h.lastResultText = '';
    }
    pickups = [];

    updateHUD();
    showBanner(levelIndex === 0 ? 'LEVEL 1: MAKE 5' : 'LEVEL 2: MAKE 10');
  }

  function updateHUD() {
    levelLabel.textContent = levelIndex === 0 ? 'Level 1: Make 5' : 'Level 2: Make 10';
    coinsEl.textContent = `Coins: ${coins}`;
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove('hidden');
    lastBannerAt = nowS();
    setTimeout(() => {
      if (nowS() - lastBannerAt > 0.6) banner.classList.add('hidden');
    }, 900);
  }

  // Keyboard input
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') { keys.left = true; moveTargetX = null; }
    if (e.code === 'ArrowRight') { keys.right = true; moveTargetX = null; }
    if (e.code === 'Space') { ensureAudio(); jumpPressedAt = nowS(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'ArrowRight') keys.right = false;
  });

  // Touch buttons
  bindHold(leftBtn,  () => { ensureAudio(); keys.left  = true; moveTargetX = null; },  () => keys.left  = false);
  bindHold(rightBtn, () => { ensureAudio(); keys.right = true; moveTargetX = null; }, () => keys.right = false);
  jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); jumpPressedAt = nowS(); });

  function bindHold(btn, onDown, onUp) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
    btn.addEventListener('pointerup',   (e) => { e.preventDefault(); onUp(); });
    btn.addEventListener('pointercancel', onUp);
    btn.addEventListener('pointerleave',  onUp);
  }

  // Help + restart
  btnRestart.addEventListener('click', () => resetLevel(levelIndex));
  btnHelp.addEventListener('click', () => helpModal.classList.remove('hidden'));
  closeHelp.addEventListener('click', () => helpModal.classList.add('hidden'));

  // Click/touch control in playfield
  canvas.addEventListener('pointerdown', (e) => {
    ensureAudio();

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const wx = sx + camX;
    const wy = sy;

    // only allow targets ahead of player
    const playerCenterX = player.x + player.w*0.5;
    if (wx < playerCenterX - 6) return;

    const p = pickupAtPoint(wx, wy);
    if (p && !p.taken) {
      pendingPickup = p;
      pendingDropHole = null;
      moveTargetX = p.x + p.w*0.5 - player.w*0.5;
      tryAutoJumpForPickup();
      return;
    }

    const h = holeAtPoint(wx, wy);
    if (h && !h.solved) {
      pendingDropHole = h;
      pendingPickup = null;
      moveTargetX = (h.xTile + h.wTile*0.5) * TILE - player.w*0.5;
      tryAutoDrop();
      return;
    }

    moveTargetX = wx - player.w*0.5;
    pendingPickup = null;
    pendingDropHole = null;
  }, {passive:false});

  function pickupAtPoint(wx, wy) {
    for (const p of pickups) {
      if (p.taken) continue;
      const bob = Math.sin(nowS()*3 + hash01(p.id)*6.28) * 4;
      const x0 = p.x;
      const y0 = p.y + bob;
      if (wx >= x0 && wx <= x0 + p.w && wy >= y0 && wy <= y0 + p.h) return p;
    }
    return null;
  }

  function holeAtPoint(wx, wy) {
    const lvl = levels[levelIndex];
    for (const h of lvl.holes) {
      if (h.solved) continue;
      const hx0 = h.xTile * TILE;
      const hx1 = (h.xTile + h.wTile) * TILE;
      const hy0 = GROUND_Y;
      const hy1 = GROUND_Y + h.hTile * TILE;
      if (wx >= hx0 && wx <= hx1 && wy >= hy0 && wy <= hy1) return h;
    }
    return null;
  }

  // World helpers
  function holeAtSurfaceTile(tx) {
    const lvl = levels[levelIndex];
    for (const h of lvl.holes) {
      if (h.solved) continue;
      if (tx >= h.xTile && tx < h.xTile + h.wTile) return h;
    }
    return null;
  }

  function holeUnderPoint(px, py) {
    const lvl = levels[levelIndex];
    for (const h of lvl.holes) {
      if (h.solved) continue;
      const hx0 = h.xTile * TILE;
      const hx1 = (h.xTile + h.wTile) * TILE;
      const hy0 = GROUND_Y;
      const hy1 = GROUND_Y + h.hTile * TILE;
      if (px >= hx0 && px < hx1 && py >= hy0 && py < hy1) return h;
    }
    return null;
  }

  function groundSolidAt(px, py) {
    if (py < GROUND_Y) return false;
    const h = holeUnderPoint(px, py);
    return !h;
  }

  // Spawn floating brick pickups near hole; position them in front of/over the hole.
  function ensurePickupsForHole(hole) {
    if (pickups.some(p => p.holeRef === hole)) return;

    const missing = hole.target - hole.filled;
    const opts = buildOptions(missing, hole.target);

    // Place choices to the LEFT of the hole so the player reaches them before the pit.
    // Shapes are built from the same TILE blocks as the hole.
    const holeLeftX = hole.xTile * TILE;
    const blockW = hole.wTile * TILE;

    const gap = 0.6 * TILE;
    const leftStartX = holeLeftX - (opts.length * (blockW + gap)) - 0.8 * TILE;

    const baseY = GROUND_Y - 4.2 * TILE; // floating height reachable by a jump

    for (let i = 0; i < opts.length; i++) {
      const n = opts[i];
      const rows = Math.ceil(n / hole.wTile);
      const w = blockW;
      const h = rows * TILE;

      pickups.push({
        id: `${hole.id}_p${i}`,
        holeRef: hole,
        n,
        rows,
        x: leftStartX + i * (blockW + gap),
        y: baseY - (i % 2) * 0.4 * TILE,
        w,
        h,
        taken: false
      });
    }
  }

  function buildOptions(correct, target) {
    const set = new Set([correct]);
    const max = target - 1;
    const near = [correct - 1, correct + 1, correct + 2, correct - 2].filter(n => n >= 1 && n <= max);
    shuffleInPlace(near);
    const wanted = (target === 5 ? 3 : 4);
    for (const n of near) {
      if (set.size >= wanted) break;
      set.add(n);
    }
    while (set.size < wanted) set.add(1 + Math.floor(Math.random() * max));
    const arr = Array.from(set);
    shuffleInPlace(arr);
    return arr;
  }

  // Intent helpers
  function tryAutoJumpForPickup() {
    if (!pendingPickup || pendingPickup.taken) return;
    const targetCx = pendingPickup.x + pendingPickup.w*0.5;
    const playerCx = player.x + player.w*0.5;
    if (Math.abs(playerCx - targetCx) < 18 && player.onGround) {
      jumpPressedAt = nowS();
    }
  }

  function tryAutoDrop() {
    if (!pendingDropHole) return;
    if (carriedN == null) return;

    const hole = pendingDropHole;
    const holeCx = (hole.xTile + hole.wTile*0.5) * TILE;
    const playerCx = player.x + player.w*0.5;
    if (Math.abs(playerCx - holeCx) < 20 && player.onGround) {
      dropCarriedIntoHole(hole);
      pendingDropHole = null;
      moveTargetX = null;
    }
  }

  function pickupCollides(p) {
    const px0 = player.x, py0 = player.y;
    const px1 = player.x + player.w, py1 = player.y + player.h;
    const bob = Math.sin(nowS()*3 + hash01(p.id)*6.28) * 4;
    const bx0 = p.x, by0 = p.y + bob;
    const bx1 = bx0 + p.w, by1 = by0 + p.h;
    return (px0 < bx1 && px1 > bx0 && py0 < by1 && py1 > by0);
  }

  function collectPickup(p) {
    carriedN = p.n;
    p.taken = true;
    pendingPickup = null;
    moveTargetX = null;
    soundPickup();
  }

  function dropCarriedIntoHole(hole) {
    if (carriedN == null) return;

    const before = hole.filled;
    const target = hole.target;
    const missing = target - before;
    const n = carriedN;

    // Place as preview regardless (visual fit feedback)
    hole.previewAdd = n;
    hole.previewStart = nowS();
    hole.previewUntil = nowS() + 0.75;
    hole.lastResultText = (n === missing) ? 'PERFECT!' : (n > missing ? 'TOO BIG' : 'TOO SMALL');

    // Show equation ONLY after the player drops the block
    if (n === missing) {
      // Correct equation
      showEquation(`${before} + ${n} = ${target}`, 'correct');

      hole.solved = true;
      hole.filled = target;
      hole.previewAdd = 0;
      hole.previewUntil = -999;
      hole.lastResultText = '';
      coins += 1;
      updateHUD();
      showBanner('NICE!');
      soundCorrect();

      // Remove pickups for this hole
      pickups = pickups.filter(p => p.holeRef !== hole);
      // After a correct fit, auto-continue a bit to the right toward the next hole
      pendingDropHole = null;
      pendingPickup = null;
      moveTargetX = player.x + 6 * TILE;
    } else {
      // Incorrect equation
      showEquation(`${before} + ${n} ≠ ${target}`, 'wrong');

      showBanner(hole.lastResultText);
      soundWrong();
      coins = Math.max(0, coins - 1);
      updateHUD();

      // After preview ends, refresh pickups for this hole
      setTimeout(() => {
        pickups = pickups.filter(p => p.holeRef !== hole);
        ensurePickupsForHole(hole);
      }, 820);

      shakeCamera();
    }

    // Brick is consumed either way
    carriedN = null;
  }


    // Brick is consumed either way
    carriedN = null;
  }

  // Update loop
  function update(dt) {
    if (helpModal && !helpModal.classList.contains('hidden')) return;

    const lvl = levels[levelIndex];

    const nearHole = findNearestUnsolvedHoleWithin(3.6 * TILE);
    if (nearHole) ensurePickupsForHole(nearHole);

    // Movement desire
    let want = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (want === 0 && moveTargetX != null) {
      const dx = (moveTargetX - player.x);
      if (Math.abs(dx) < 2) moveTargetX = null;
      else want = dx > 0 ? 1 : -1;
    }

    if (want !== 0) player.vx += want * MOVE_ACC * dt;
    else {
      if (player.vx > 0) player.vx = Math.max(0, player.vx - MOVE_FRICTION * dt);
      else if (player.vx < 0) player.vx = Math.min(0, player.vx + MOVE_FRICTION * dt);
    }
    player.vx = clamp(player.vx, -MAX_SPEED, MAX_SPEED);

    // Jump buffer + coyote
    const t = nowS();
    const canCoyote = (t - player.lastOnGroundAt) <= COYOTE_TIME;
    const wantsJump = (t - jumpPressedAt) <= JUMP_BUFFER;
    if (wantsJump && (player.onGround || canCoyote)) {
      player.vy = -JUMP_V;
      player.onGround = false;
      jumpPressedAt = -999;
    }

    // Gravity
    player.vy += GRAVITY * dt;
    player.vy = Math.min(player.vy, MAX_FALL);

    // Integrate
    player.x = Math.max(0, player.x + player.vx * dt);
    player.y += player.vy * dt;

    // Ground collision
    const footX = player.x + player.w * 0.5;
    const footY = player.y + player.h;

    if (groundSolidAt(footX, footY)) {
      player.y = GROUND_Y - player.h;
      player.vy = 0;
      if (!player.onGround) player.onGround = true;
      player.lastOnGroundAt = t;
    } else {
      player.onGround = false;
    }

    // Auto-jump for clicked pickup
    tryAutoJumpForPickup();

    // Pickup collision
    for (const p of pickups) {
      if (p.taken) continue;
      if (pendingPickup && p !== pendingPickup) continue;
      if (pickupCollides(p)) collectPickup(p);
    }

    // Auto-drop for clicked hole
    tryAutoDrop();

    // Falling into hole => respawn
    const hole = holeUnderPoint(footX, footY);
    if (hole && !hole.solved) {
      if (player.y > GROUND_Y + 40) respawnBeforeHole(hole);
    }

    // Camera: keep character centered; world scrolls
    camX = player.x + player.w*0.5 - canvas.width*0.5;
    camX = Math.max(0, camX);
    updateHolePreviews();

    // End
    if (player.x > lvl.endX) {
      if (levelIndex === 0) {
        resetLevel(1);
        showBanner('LEVEL UP!');
        soundCorrect();
      } else {
        showBanner('YOU WIN!');
        soundCorrect();
        setTimeout(() => resetLevel(0), 1100);
      }
    }
  }

  function findNearestUnsolvedHoleWithin(maxDistPx) {
    const lvl = levels[levelIndex];
    const px = player.x + player.w*0.5;
    let best = null;
    let bestD = 1e9;
    for (const h of lvl.holes) {
      if (h.solved) continue;
      const hx = (h.xTile + h.wTile*0.5) * TILE;
      const d = Math.abs(px - hx);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best && bestD <= maxDistPx && player.onGround) return best;
    return null;
  }

  function respawnBeforeHole(hole) {
    player.vx = 0;
    player.vy = 0;
    player.y = GROUND_Y - player.h;
    player.x = hole.xTile * TILE - 2.2 * TILE;
    camX = Math.max(0, player.x + player.w*0.5 - canvas.width*0.5);
    moveTargetX = null;
    pendingPickup = null;
    pendingDropHole = null;
    carriedN = null;
    showBanner('TRY AGAIN');
    soundWrong();
  }

  function updateHolePreviews() {
    const lvl = levels[levelIndex];
    const t = nowS();
    for (const h of lvl.holes) {
      if (h.previewUntil > 0 && t >= h.previewUntil) {
        h.previewAdd = 0;
        h.previewUntil = -999;
        h.previewStart = -999;
        h.lastResultText = '';
      }
    }
  }

  // Rendering
  function shakeCamera() { camShake = 10; }

  function draw() {
    const lvl = levels[levelIndex];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSky();

    const shakeX = camShake > 0 ? (Math.random() - 0.5) * camShake : 0;
    const shakeY = camShake > 0 ? (Math.random() - 0.5) * camShake : 0;
    camShake = Math.max(0, camShake - 0.9);

    ctx.save();
    ctx.translate(-camX + shakeX, shakeY);

    drawGround(lvl);
    drawFlag(lvl.endX);

    // Pickups on top (in front)
    drawPickups();

    drawPlayer();
    drawCarried();

    ctx.restore();

    drawEquationOverlay();
    drawHint(lvl);
  }

  function drawSky() {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    for (let i = 0; i < 6; i++) {
      const x = (i * 170 + (nowS()*16) ) % (canvas.width + 260) - 160;
      const y = 70 + (i%3)*28;
      roundRect(ctx, x, y, 120, 32, 16);
      ctx.fill();
    }
  }

  function drawGround(lvl) {
    const startTile = Math.floor(camX / TILE) - 2;
    const endTile = startTile + Math.ceil(canvas.width / TILE) + 6;

    for (let tx = startTile; tx < endTile; tx++) {
      const hole = holeAtSurfaceTile(tx);
      if (!hole) {
        drawTile(tx, 0, 'surface');
        for (let ty = 1; ty < EARTH_DEPTH_TILES; ty++) drawTile(tx, ty, 'dirt');
      }
    }

    for (const h of lvl.holes) {
      if (h.solved) continue;
      const hx = h.xTile * TILE;
      const hw = h.wTile * TILE;
      if (hx + hw < camX - 100 || hx > camX + canvas.width + 100) continue;
      drawVerticalHole(h);
    }

    for (let i = 0; i < 6; i++) {
      const x = (Math.floor(camX/90)*90 + i*160) % 2400;
      drawBush(x + 80, GROUND_Y - 18);
    }
  }

  function drawVerticalHole(h) {
    const x0 = h.xTile * TILE;
    const y0 = GROUND_Y;
    const w = h.wTile * TILE;
    const hh = h.hTile * TILE;

    ctx.fillStyle = 'rgba(2,6,23,0.65)';
    ctx.fillRect(x0, y0, w, hh);

    ctx.fillStyle = 'rgba(15,23,42,0.55)';
    ctx.fillRect(x0, y0, 4, hh);
    ctx.fillRect(x0 + w - 4, y0, 4, hh);

    const baseFilled = clampInt(h.filled, 0, h.target);
    const tNow = nowS();
    const isPreview = (h.previewUntil > 0 && tNow < h.previewUntil);
    const add = isPreview ? clampInt(h.previewAdd, 0, h.target) : 0;
    // If wrong, blink twice during preview window
    const isWrongPreview = isPreview && h.lastResultText && h.lastResultText !== 'PERFECT!';
    let blinkOn = true;
    if (isWrongPreview && h.previewStart > 0) {
      const elapsed = tNow - h.previewStart;
      blinkOn = (Math.floor(elapsed * 6) % 2) === 0;
    }

    const desired = baseFilled + add;
    const shown = clampInt(desired, 0, h.target);

    const missing = h.target - baseFilled;
    const overflow = isPreview ? Math.max(0, desired - h.target) : 0;

    const cols = h.wTile;
    const rows = h.hTile;

    for (let i = 0; i < (isPreview ? desired : shown); i++) {
      if (isWrongPreview && !blinkOn && i >= baseFilled) continue;
      const rowFromBottom = Math.floor(i / cols);
      const col = i % cols;
      const row = (rows - 1) - rowFromBottom;
      if (row < 0) continue;

      const bx = x0 + col * TILE;
      const by = y0 + row * TILE;

      let color = '#fbbf24';
      if (overflow > 0) {
        const overflowStart = baseFilled + (add - overflow);
        if (isPreview && i >= overflowStart) color = '#fb7185';
      }
      if (isPreview && add > 0 && i >= baseFilled && (Math.floor(nowS()*12) % 2 === 0)) {
        color = (h.lastResultText === 'PERFECT!') ? '#fde68a' : '#fda4af';
      }

      drawBlock(bx, by, TILE, TILE, color);
      // embedded number on newly-placed preview tiles
      if (isPreview && i >= baseFilled && add > 0) {
        ctx.fillStyle = 'rgba(2,6,23,0.80)';
        ctx.font = '900 18px system-ui';
        ctx.fillText(String(add), bx + 10, by + 24);
      }
    }

    ctx.strokeStyle = 'rgba(226,232,240,0.14)';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.strokeRect(x0 + c*TILE, y0 + r*TILE, TILE, TILE);
      }
    }

    if (isPreview && h.lastResultText) {
      ctx.fillStyle = 'rgba(2,6,23,0.55)';
      roundRect(ctx, x0 - 10, y0 - 44, w + 20, 30, 12);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '800 14px system-ui';
      ctx.fillText(h.lastResultText, x0 + 10, y0 - 23);
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      if (p.taken) continue;
      const hole = p.holeRef;
      if (!hole || hole.solved) continue;

      const bob = Math.sin(nowS()*3 + hash01(p.id)*6.28) * 4;
      const x = p.x;
      const y = p.y + bob;

      const isTarget = (pendingPickup === p);

      // subtle glow if targeted
      if (isTarget) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = 'rgba(59,130,246,1)';
        ctx.lineWidth = 6;
        roundRect(ctx, x-6, y-6, p.w+12, p.h+12, 10);
        ctx.stroke();
        ctx.restore();
      }

      // Draw brick made of the same TILE squares as the hole (packed left-to-right, bottom-to-top)
      const cols = hole.wTile;
      const n = p.n;
      const rows = Math.ceil(n / cols);

      // shadow plate
      ctx.fillStyle = 'rgba(2,6,23,0.28)';
      roundRect(ctx, x-8, y-8, p.w+16, p.h+16, 12);
      ctx.fill();

      for (let i = 0; i < n; i++) {
        const rowFromBottom = Math.floor(i / cols);
        const col = i % cols;
        const row = (rows - 1) - rowFromBottom;

        const bx = x + col * TILE;
        const by = y + row * TILE;

        drawBlock(bx, by, TILE, TILE, '#fbbf24');
        // embedded number
        ctx.fillStyle = 'rgba(2,6,23,0.75)';
        ctx.font = '800 18px system-ui';
        ctx.fillText(String(n), bx + 12, by + 24);

      }

      // label
      ctx.fillStyle = 'rgba(226,232,240,0.95)';
      ctx.font = '800 14px system-ui';
      // label removed (numbers embedded in tiles)
    }
  }

  function drawCarried() {
    if (carriedN == null) return;
    const x = player.x + player.w*0.5;
    const y = player.y - 24;

    ctx.fillStyle = 'rgba(2,6,23,0.45)';
    roundRect(ctx, x - 22, y - 18, 44, 34, 10);
    ctx.fill();

    const n = carriedN;
    const sq = 8, gap = 2;
    const totalH = n*sq + (n-1)*gap;
    const sy = y - totalH/2 + 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = '#fbbf24';
      roundRect(ctx, x - sq/2, sy + i*(sq+gap), sq, sq, 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(226,232,240,0.95)';
    ctx.font = '700 11px system-ui';
    ctx.fillText(`+${n}`, x - 12, y + 12);
  }

  function drawTile(tx, ty, kind) {
    const x = tx * TILE;
    const y = GROUND_Y + ty * TILE;
    if (kind === 'surface') {
      drawBlock(x, y, TILE, TILE, '#22c55e');
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x+2, y+2, TILE-4, 6);
    } else {
      drawBlock(x, y, TILE, TILE, '#a16207');
    }
  }

  function drawBlock(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, y + h - 6, w, 6);
    ctx.strokeStyle = 'rgba(2,6,23,0.25)';
    ctx.strokeRect(x+0.5, y+0.5, w-1, h-1);
  }

  function drawBush(x, y) {
    ctx.fillStyle = 'rgba(34,197,94,0.35)';
    roundRect(ctx, x, y, 46, 20, 12);
    ctx.fill();
  }

  function drawFlag(x) {
    const baseY = GROUND_Y - 68;
    ctx.strokeStyle = 'rgba(2,6,23,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, GROUND_Y - 6);
    ctx.stroke();

    ctx.fillStyle = 'rgba(239,68,68,0.9)';
    ctx.fillRect(x, baseY + 6, 40, 22);

    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText('END', x + 8, baseY + 22);
    ctx.lineWidth = 1;
  }

  function drawPlayer() {
    const px = player.x;
    const py = player.y;

    ctx.fillStyle = 'rgba(30,41,59,0.65)';
    roundRect(ctx, px-4, py-6, player.w+8, player.h+12, 10);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, px, py, player.w, player.h, 8);
    ctx.fill();

    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.fillRect(px + 6, py + 14, 6, 6);
    ctx.fillRect(px + 16, py + 14, 6, 6);

    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    ctx.fillRect(px + 3, py + player.h - 6, 10, 6);
    ctx.fillRect(px + 15, py + player.h - 6, 10, 6);

    if (moveTargetX != null) {
      ctx.strokeStyle = 'rgba(226,232,240,0.35)';
      ctx.beginPath();
      ctx.moveTo(moveTargetX + player.w*0.5, GROUND_Y - 12);
      ctx.lineTo(moveTargetX + player.w*0.5, GROUND_Y + 10);
      ctx.stroke();
    }
  }


  function drawEquationOverlay() {
    if (!eqOverlay.fullText) return;
    const t = nowS();
    // animate typing until full length
    const cps = 26; // chars per second
    const targetChars = Math.min(eqOverlay.fullText.length, Math.floor((t - (eqOverlay._startAt ?? (eqOverlay._startAt = t))) * cps));
    eqOverlay.shownChars = Math.max(eqOverlay.shownChars, targetChars);

    // hide shortly after fully written
    const fullyWritten = eqOverlay.shownChars >= eqOverlay.fullText.length;
    if (fullyWritten && t > eqOverlay.showUntil) {
      eqOverlay.fullText = '';
      eqOverlay.shownChars = 0;
      eqOverlay.kind = 'none';
      eqOverlay._startAt = undefined;
      return;
    }

    const text = eqOverlay.fullText.slice(0, eqOverlay.shownChars);

    // Small, non-blocking top strip
    const pad = 10;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(2,6,23,0.50)';
    roundRect(ctx, canvas.width/2 - 170, 64, 340, 44, 12);
    ctx.fill();

    // Color hint
    ctx.font = '800 22px system-ui';
    ctx.fillStyle = (eqOverlay.kind === 'correct') ? 'rgba(226,232,240,0.98)' : 'rgba(254,202,202,0.98)';
    ctx.fillText(text, canvas.width/2 - 150, 94);

    ctx.restore();
  }

  function drawHint(lvl) {
    ctx.fillStyle = 'rgba(2,6,23,0.45)';
    roundRect(ctx, 14, 14, 780, 46, 12);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 14px system-ui';
    ctx.fillText(`Tap/click ahead to move • Tap a floating brick to jump+grab • Tap the hole to drop • Make ${lvl.target}!`, 26, 42);
  }

  // Helpers
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clampInt(v, a, b) { return Math.max(a, Math.min(b, v|0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function nowS() { return performance.now() / 1000; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  function hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
  }

  // Main loop
  let lastT = nowS();
  function loop() {
    const t = nowS();
    const dt = Math.min(0.033, t - lastT);
    lastT = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  updateHUD();
  resetLevel(0);
  requestAnimationFrame(loop);
})();
