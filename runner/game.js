(() => {
  'use strict';

  // ---- Canvas ----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // HiDPI
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  // ---- UI ----
  const modal = document.getElementById('modal');
  const btnStart = document.getElementById('btnStart');
  const statusEl = document.getElementById('status');
  const levelInfoEl = document.getElementById('levelInfo');

  btnStart.addEventListener('click', () => {
    modal.classList.add('hidden');
    ensureAudio();
  });

  // ---- World constants ----
  const TILE = 36;
  const SKY_H = 220;
  const EARTH_DEPTH = 8;
  const GROUND_Y = 360;

  // ---- Runner ----
  const runner = {
    x: 4 * TILE,
    y: GROUND_Y - 46,
    w: 28,
    h: 46,
    vx: 0,
    runSpeed: 160,   // px/s
    state: 'run',    // 'run' | 'stop' | 'happy'
    happyUntil: 0
  };

  // Camera keeps runner centered
  let camX = 0;

  // ---- Levels ----
  const levels = [
    // Level 1: make 5, vertical 1x5 holes
    { title: 'Make 5', hole: { w: 1, h: 5, target: 5 }, spacingTiles: 12, holes: 4 },
    // Level 2: make 10, 2x5 holes (area 10)
    { title: 'Make 10', hole: { w: 2, h: 5, target: 10 }, spacingTiles: 14, holes: 4 },
    // Level 3: make 10, 2x5 holes (area 10)
    { title: 'Make 10, no labels', hole: { w: 2, h: 5, target: 10 }, spacingTiles: 14, holes: 4 },
    // Level 4: Make 20, 5x4 holes 
    { title: 'Make 20 (No Labels)', hole: { w: 5, h: 4, target: 20 }, spacingTiles: 18, holes: 4 },
    // Level 5: Mystery hole (Make 10) — shows text only, no graphic fill info
    { title: 'Mystery Make 10', hole: { w: 2, h: 5, target: 10 }, spacingTiles: 12, holes: 4, mystery: true },
  // Level 6: Mystery hole (Make 20) — shows text only, no graphic fill info
    { title: 'Mystery Make 20', hole: { w: 5, h: 4, target: 20 }, spacingTiles: 18, holes: 4, mystery: true },



  ];
  let levelIndex = 0;
  function labelsEnabled() {
    return levelIndex <= 1; // Level 1 + Level 2 ON, Level 3+ OFF
  }



  // Current puzzle state
  let holes = [];
  let activeHole = null;    // hole we are stopped at
  let dragBlocks = [];      // draggable option blocks (screen-space UI)
  let dragging = null;      // {block, ox, oy}
  let feedback = null;      // {kind, text, until, blinkUntil, show:boolean, placedN, before, target, overflow}

  // ---- Audio (simple oscillator beeps) ----
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  function beep(freq=440, dur=0.09, type='sine', gain=0.06) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    correct(){ beep(880,0.08,'triangle',0.07); setTimeout(()=>beep(1320,0.08,'triangle',0.06), 85); },
    wrong(){ beep(180,0.13,'sawtooth',0.06); },
    drop(){ beep(520,0.06,'square',0.04); }
  };

  // ---- Helpers ----
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  function rr(min,max){ return min + Math.random()*(max-min); }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  // ---- Level build ----
  function buildLevel(idx){
    const L = levels[idx];
    levelInfoEl.textContent = `Level ${idx+1}/${levels.length}`;
    statusEl.textContent = 'Drag the correct block into the hole.';
    document.getElementById('title').textContent = `${L.title} Runner`;

    holes = [];
    const startTile = 16;
    for (let i=0;i<L.holes;i++){
      const xTile = startTile + i*L.spacingTiles;
      const isMystery = !!L.mystery;

      // Normal levels: random filled 1..target-1 (as you had)
      let filled = Math.floor(rr(1, L.hole.target - 1));

      // Mystery: choose how many blocks are needed (1..target)
      // and set filled so that missing == required
      let required = null;
      if (isMystery) {
        required = 1 + Math.floor(Math.random() * L.hole.target); // 1..20
        filled = L.hole.target - required;                        // so missing == required
      }

      holes.push({
        id: `h${idx}_${i}`,
        xTile,
        yTile: 0,
        wTile: L.hole.w,
        hTile: L.hole.h,
        target: L.hole.target,
        filled,
        solved: false,

        // Mystery data
        mystery: isMystery,
        required, // 1..target

        previewN: 0,
        previewUntil: -999,
        previewBlinkStart: -999,
        lastResult: ''
      });

    }

    activeHole = null;
    dragBlocks = [];
    dragging = null;
    feedback = null;

    runner.x = 4*TILE;
    runner.y = GROUND_Y - runner.h;
    runner.vx = runner.runSpeed;
    runner.state = 'run';
  }

  // Build options for a hole: include correct + two distractors
  function optionsForHole(h){
    const correct = h.mystery ? h.required : (h.target - h.filled);
    let opts = new Set([correct]);


    // Add distractors close-by, clamped
    const candidates = [];
    for (let d=-3; d<=3; d++){
      const v = correct + d;
      if (v>=1 && v<=h.target-1 && v!==correct) candidates.push(v);
    }
    while (opts.size < Math.min(3, h.target-1) && candidates.length){
      const pick = candidates.splice(Math.floor(Math.random()*candidates.length),1)[0];
      opts.add(pick);
    }
    // If still short (tiny targets), fill with random
    while (opts.size < Math.min(3, h.target-1)){
      opts.add(1 + Math.floor(Math.random()*(h.target-1)));
    }

    // Shuffle
    const arr = Array.from(opts);
    for (let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }

  // Create draggable blocks in screen space (free floating)
  function spawnDragBlocks(h){
    dragBlocks = [];
    const opts = optionsForHole(h);

    // Center blocks directly above the active hole, with spacing that scales to hole width.
    const hr = holeScreenRect(h);
    const centerX = hr.x + hr.w * 0.5;

    // Visual tuning
    const bottomY = 300; // bottoms aligned along this y
    const blockW = h.wTile * TILE;
    const gapX = Math.max(26, Math.floor(blockW * 0.22)); // wider holes => more spacing

    // Measure total row width so we can center it
    const totalW = opts.length * blockW + (opts.length - 1) * gapX;
    let curX = centerX - totalW * 0.5;

    for (let i = 0; i < opts.length; i++){
      const n = opts[i];
      const rows = Math.ceil(n / h.wTile);
      const w = blockW;
      const hPx = rows * TILE;

      const x = curX;
      const y = bottomY - hPx;

      dragBlocks.push({
        id: `b_${h.id}_${i}`,
        n,
        w,
        h: hPx,
        x, y,
        homeX: x,
        homeY: y,
        returning: false
      });

      curX += w + gapX;
    }
  }


  // Convert world x to screen x
  function wxToSx(wx){ return wx - camX + canvas.getBoundingClientRect().width*0.5 - (runner.x + runner.w*0.5); }
  // Actually simpler: we render in "screen units" (CSS px) because ctx is scaled by setTransform(dpr)
  function camToScreenX(wx){ return wx - camX; }

  function updateCam(){
    // keep runner centered
    camX = runner.x + runner.w*0.5 - (canvas.width / (window.devicePixelRatio||1))*0.5;
    camX = Math.max(0, camX);
  }

  function holeWorldRect(h){
    const x = h.xTile * TILE;
    const y = GROUND_Y;
    const w = h.wTile * TILE;
    const hPx = h.hTile * TILE;
    return {x,y,w,h:hPx};
  }

  function holeScreenRect(h){
    const r = holeWorldRect(h);
    return { x: r.x - camX, y: r.y, w: r.w, h: r.h };
  }

  // ---- Game flow ----
  function nearestHoleAhead(){
    let best = null;
    for (const h of holes){
      if (h.solved) continue;
      const hx = h.xTile * TILE;
      if (hx < runner.x - 30) continue;
      if (!best || hx < best.xTile*TILE) best = h;
    }
    return best;
  }

  function stopAtHole(h){
    activeHole = h;
    runner.state = 'stop';
    runner.vx = 0;
    // stop at left edge
    const hx = h.xTile * TILE;
    runner.x = hx - runner.w - 2;
    spawnDragBlocks(h);
    if (h.mystery) {
      statusEl.textContent = `${h.required} blocks needed`;
    } else {
      statusEl.textContent = `Fill it: ${h.filled} + ? = ${h.target}`;
    }

  }

  function resumeRunHappy(){
    runner.state = 'happy';
    runner.happyUntil = nowS() + 0.65;
    runner.vx = 0;
    statusEl.textContent = 'Nice! Running to the next hole...';
    sfx.correct();
  }

  function nowS(){ return performance.now() / 1000; }

  function setFeedback(kind, text, duration, blink, meta=null){
    feedback = {
      kind, text,
      until: nowS() + duration,
      blinkUntil: nowS() + blink,
      meta
    };
  }

  function tryPlaceBlock(h, block){
    const needed = h.mystery ? h.required : (h.target - h.filled);
    const before = h.filled;
    const n = block.n;

    sfx.drop();

    // Always show a placement preview in the hole (including overflow/underfill cues)
    h.previewN = n;
    h.previewBlinkStart = nowS();
    h.previewUntil = nowS() + 2.0;

    if (n === needed) {
      // correct
      h.filled = h.target;
      h.solved = true;
      h.previewN = 0;
      h.previewUntil = -999;
      h.lastResult = '';
      if (h.mystery) {
        setFeedback('correct', `${n} blocks ✔`, 0.9, 0.0, { n, target: h.target });
      } else {
        setFeedback('correct', `${before} + ${n} = ${h.target}`, 0.9, 0.0, { before, n, target: h.target });
      }
      dragBlocks = [];
      dragging = null;
      activeHole = null;
      resumeRunHappy();
      return true;
    } else {
      // wrong
      const too = (n > needed) ? 'Too big' : 'Too small';
      h.lastResult = too.toUpperCase();
      if (h.mystery) {
        setFeedback('wrong', `${n} blocks ✖ (${too})`, 3.0, 3.0, { n, target: h.target });
      } else {
        setFeedback('wrong', `${before} + ${n} ≠ ${h.target} (${too})`, 3.0, 3.0, { before, n, target: h.target });
      }
      
      sfx.wrong();

      // return the dragged block to home after a short delay
      setTimeout(() => {
        block.x = block.homeX;
        block.y = block.homeY;
      }, 220);

      return false;
    }
  }

  // ---- Input (drag) ----
  function pointerToCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top)
    };
  }

  function hitBlock(x,y){
    for (let i=dragBlocks.length-1;i>=0;i--){
      const b = dragBlocks[i];
      if (x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b;
    }
    return null;
  }

  function bringToFront(b){
    const i = dragBlocks.indexOf(b);
    if (i>=0){
      dragBlocks.splice(i,1);
      dragBlocks.push(b);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!modal.classList.contains('hidden')) return;
    ensureAudio();
    const pt = pointerToCanvasXY(e);
    const b = hitBlock(pt.x, pt.y);
    if (!b) return;
    bringToFront(b);
    dragging = { block: b, ox: pt.x - b.x, oy: pt.y - b.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const pt = pointerToCanvasXY(e);
    const b = dragging.block;
    b.x = pt.x - dragging.ox;
    b.y = pt.y - dragging.oy;
  });

  function endDrag(e){
    if (!dragging) return;
    const b = dragging.block;
    dragging = null;

    if (activeHole){
      const hr = holeScreenRect(activeHole);
      const cx = b.x + b.w*0.5;
      const cy = b.y + b.h*0.5;
      const inHole = (cx>=hr.x && cx<=hr.x+hr.w && cy>=hr.y && cy<=hr.y+hr.h);
      if (inHole){
        // snap to hole top area visually (we render preview in hole anyway)
        tryPlaceBlock(activeHole, b);
        return;
      }
    }

    // Not placed: return to home
    b.x = b.homeX;
    b.y = b.homeY;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Drawing ----
  function drawSky(){
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    // gradient
    const g = ctx.createLinearGradient(0,0,0,SKY_H);
    g.addColorStop(0,'#60a5fa');
    g.addColorStop(1,'#bae6fd');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    // clouds
    const t = nowS();
    ctx.globalAlpha = 0.75;
    for (let i=0;i<6;i++){
      const cx = ((i*260) + (t*28)) % (w+340) - 160;
      const cy = 50 + (i%3)*30;
      cloud(cx, cy, 1.0 + (i%2)*0.2);
    }
    ctx.globalAlpha = 1;
  }

  function cloud(x,y,s){
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(x, y, 38*s, 22*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+30*s, y-10*s, 42*s, 26*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+70*s, y, 36*s, 20*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+35*s, y+10*s, 44*s, 24*s, 0, 0, Math.PI*2);
    ctx.fill();
  }

  function drawGround(){
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    // surface grass strip
    for (let tx=-4; tx< Math.ceil((w+camX)/TILE)+6; tx++){
      const wx = tx*TILE;
      const sx = wx - camX;
      // check if this column is a hole column (unsolved only)
      const holeHere = holes.some(hh => !hh.solved && hh.xTile===tx);
      if (!holeHere){
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(sx, GROUND_Y, TILE, TILE);
        ctx.strokeStyle = 'rgba(2,6,23,0.65)';
        ctx.strokeRect(sx, GROUND_Y, TILE, TILE);
      }
      // earth depth
      for (let ty=1; ty<=EARTH_DEPTH; ty++){
        ctx.fillStyle = '#a16207';
        ctx.fillRect(sx, GROUND_Y + ty*TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(2,6,23,0.55)';
        ctx.strokeRect(sx, GROUND_Y + ty*TILE, TILE, TILE);
      }
    }
  }

  function drawHole(h){

    const r = holeScreenRect(h);

    // Mystery hole: show a fully gray-filled pit + text only (no graphic info about what's missing)
    if (h.mystery) {
      const cols = h.wTile;
      const totalTiles = h.target;

      // Fill entire capacity with gray blocks
      for (let i = 0; i < totalTiles; i++) {
        const rowFromBottom = Math.floor(i / cols);
        const col = i % cols;
        const row = (h.hTile - 1) - rowFromBottom;
        const x = r.x + col * TILE;
        const y = r.y + row * TILE;

        ctx.fillStyle = '#94a3b8'; // gray
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = 'rgba(2,6,23,0.65)';
        ctx.strokeRect(x, y, TILE, TILE);
      }

      // Big centered text label
      ctx.fillStyle = 'rgba(2,6,23,0.85)';
      ctx.font = '900 22px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${h.required} blocks needed`, r.x + r.w * 0.5, r.y + r.h * 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Still allow preview feedback (wrong/correct cue) to show? If you want it, remove this return.
      return;
    }

    
    // pit
    ctx.fillStyle = '#020617';
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // glow when active
    if (activeHole === h){
      ctx.save();
      ctx.strokeStyle = 'rgba(59,130,246,1)';
      ctx.lineWidth = 5;
      ctx.shadowColor = 'rgba(59,130,246,0.75)';
      ctx.shadowBlur = 10;
      ctx.strokeRect(r.x-2, r.y-2, r.w+4, r.h+4);
      ctx.restore();
    }

    // filled blocks: render as stacked from bottom (packed)
    const totalTiles = h.target; // 5 or 10
    const cols = h.wTile;
    const baseFilled = h.filled;

    function drawTile(i, color, label){
      const rowFromBottom = Math.floor(i / cols);
      const col = i % cols;
      const row = (h.hTile - 1) - rowFromBottom;
      const x = r.x + col*TILE;
      const y = r.y + row*TILE;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(2,6,23,0.75)';
      ctx.strokeRect(x, y, TILE, TILE);
      if (label){
        ctx.fillStyle = 'rgba(2,6,23,0.75)';
        ctx.font = '900 18px system-ui';
        ctx.fillText(String(label), x + 10, y + 24);
      }
    }

    for (let i=0;i<baseFilled;i++){
      drawTile(i, '#fbbf24', labelsEnabled() ? h.filled : null);
    }

    // preview wrong/cue
    const t = nowS();
    const isPreview = (h.previewUntil > 0 && t < h.previewUntil);
    if (isPreview && h.previewN>0){
      const desired = baseFilled + h.previewN;
      const blinkOn = (Math.floor((t - h.previewBlinkStart)*2) % 2) === 0;

      for (let i=baseFilled; i<desired; i++){
        if (!blinkOn) continue;
        const isOverflow = i >= totalTiles;
        // overflow: draw above the pit
        const rowFromBottom = Math.floor(i / cols);
        const col = i % cols;
        const row = (h.hTile - 1) - rowFromBottom;
        const x = r.x + col*TILE;
        const y = r.y + row*TILE;

        const color = isOverflow ? '#fb7185' : '#fda4af';
        ctx.fillStyle = color;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = 'rgba(2,6,23,0.75)';
        ctx.strokeRect(x, y, TILE, TILE);

        // if overflow, y may be above pit; still draw
        if (labelsEnabled()) {
          ctx.fillStyle = 'rgba(2,6,23,0.85)';
          ctx.font = '900 18px system-ui';
          ctx.fillText(String(h.previewN), x + 10, y + 24);
        }

      }

      // too small cue: show empty gap at top (if desired < target)
      if (desired < totalTiles){
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = 'rgba(248,250,252,0.55)';
        ctx.setLineDash([6,6]);
        // draw dashed rect for missing area
        const missing = totalTiles - desired;
        const rowsMissing = Math.ceil(missing / cols);
        const yTop = r.y;
        ctx.strokeRect(r.x+2, yTop+2, r.w-4, rowsMissing*TILE-4);
        ctx.restore();
      }
    }

    // // label: "filled/target"
    // ctx.fillStyle = 'rgba(248,250,252,0.95)';
    // ctx.font = '900 22px system-ui';
    // ctx.fillText(`${baseFilled}/${h.target}`, r.x - 8, r.y - 16);
  }

  function drawRunner(){
    const sx = runner.x - camX;
    const y = runner.y;

    // simple body
    ctx.save();
    // happy bounce
    const t = nowS();
    let bob = 0;
    if (runner.state === 'happy'){
      const p = clamp((runner.happyUntil - t) / 0.65, 0, 1);
      bob = -Math.sin((1-p)*Math.PI) * 10;
    } else if (runner.state === 'run'){
      bob = Math.sin(t*10) * 2;
    }

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(sx + runner.w*0.5, GROUND_Y + 22, 18, 7, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // head/body
    ctx.fillStyle = '#e2e8f0';
    roundRect(sx, y + bob, runner.w, runner.h, 8);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sx+6, y+14 + bob, 6, 6);
    ctx.fillRect(sx+runner.w-12, y+14 + bob, 6, 6);

    // mouth
    ctx.fillStyle = '#0f172a';
    if (runner.state === 'happy'){
      ctx.fillRect(sx+9, y+30 + bob, runner.w-18, 4);
    } else {
      ctx.fillRect(sx+11, y+32 + bob, runner.w-22, 3);
    }

    ctx.restore();
  }

  function drawDragBlocks(){
    for (const b of dragBlocks){
      // plate shadow
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#020617';
      roundRect(b.x-10, b.y-10, b.w+20, b.h+20, 14);
      ctx.fill();
      ctx.restore();

      // draw tiles bottom-up packed to width = hole.wTile
      const cols = (activeHole ? activeHole.wTile : 1);
      const n = b.n;
      const rows = Math.ceil(n / cols);

      for (let i=0;i<n;i++){
        const rowFromBottom = Math.floor(i / cols);
        const col = i % cols;
        const row = (rows - 1) - rowFromBottom;
        const x = b.x + col*TILE;
        const y = b.y + row*TILE;
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x,y,TILE,TILE);
        ctx.strokeStyle = 'rgba(2,6,23,0.75)';
        ctx.strokeRect(x,y,TILE,TILE);

        // embedded number
        if (labelsEnabled()) {
          ctx.fillStyle = 'rgba(2,6,23,0.75)';
          ctx.font = '900 18px system-ui';
          ctx.fillText(String(n), x + 10, y + 24);
        }

      }
    }
  }

  function drawFeedback(){
    if (!feedback) return;
    const t = nowS();
    if (t > feedback.until){
      feedback = null;
      return;
    }
    const w = canvas.getBoundingClientRect().width;
    const boxW = 420;
    const x = w/2 - boxW/2;
    const y = 70;

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    roundRect(x, y, boxW, 44, 12);
    ctx.fill();

    ctx.font = '900 22px system-ui';
    ctx.fillStyle = (feedback.kind === 'correct') ? 'rgba(226,232,240,0.98)' : 'rgba(254,202,202,0.98)';
    ctx.fillText(feedback.text, x + 14, y + 29);
    ctx.restore();
  }

  // ---- Update loop ----
  let lastT = performance.now();
  function tick(tMs){
    const dt = Math.min(0.033, (tMs - lastT) / 1000);
    lastT = tMs;

    update(dt);
    render();

    requestAnimationFrame(tick);
  }

  function update(dt){
    const t = nowS();

    // Happy -> resume run
    if (runner.state === 'happy' && t > runner.happyUntil){
      runner.state = 'run';
      runner.vx = runner.runSpeed;
    }

    // Auto-run
    if (runner.state === 'run'){
      runner.x += runner.vx * dt;
      // stop at next hole edge
      const h = nearestHoleAhead();
      if (h){
        const hx = h.xTile * TILE;
        if (runner.x + runner.w >= hx - 2){
          stopAtHole(h);
        }
      }
    }

    updateCam();
  }

  function render(){
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    ctx.clearRect(0,0,w,h);

    drawSky();
    drawGround();

    // holes
    for (const ho of holes){
      if (!ho.solved) drawHole(ho);
      else {
        // solved holes become ground with bricks fill visible as a pillar flush to ground
        const r = holeScreenRect(ho);
        // fill as blocks on surface, then earth below already drawn; show bricks in hole area
        const total = ho.target;
        const cols = ho.wTile;
        for (let i=0;i<total;i++){
          const rowFromBottom = Math.floor(i / cols);
          const col = i % cols;
          const row = (ho.hTile - 1) - rowFromBottom;
          const x = r.x + col*TILE;
          const y = r.y + row*TILE;
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(x,y,TILE,TILE);
          ctx.strokeStyle = 'rgba(2,6,23,0.75)';
          ctx.strokeRect(x,y,TILE,TILE);
        }
      }
    }

    drawRunner();

    if (runner.state === 'stop' && activeHole){
      drawDragBlocks();
    }

    drawFeedback();
  }

  // Start
  resize();
  buildLevel(levelIndex);
  requestAnimationFrame(tick);

  // Level advance
  function maybeAdvanceLevel(){
    if (holes.every(h=>h.solved)){
      levelIndex = (levelIndex + 1) % levels.length;
      buildLevel(levelIndex);
      modal.classList.add('hidden');
    }
  }

  // Hook: when a hole becomes solved, check for level completion
  const _resumeRunHappy = resumeRunHappy;
  resumeRunHappy = function(){
    _resumeRunHappy();
    setTimeout(maybeAdvanceLevel, 350);
  };
})();
