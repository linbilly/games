(function(){
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const heartsEl = document.getElementById("hearts");
  const scoreEl  = document.getElementById("score");
  const levelEl  = document.getElementById("level");
  const cpEl     = document.getElementById("checkpoint");
  const restartBtn = document.getElementById("restartBtn");

  // 0=right,1=down,2=left,3=up
  const dirs = [
    {dx:1, dy:0},
    {dx:0, dy:1},
    {dx:-1, dy:0},
    {dx:0, dy:-1}
  ];

  // Level settings:
  // - mirror density gradually increases
  // - grid size steps up at level thresholds
  const MAX_LEVEL = 15;
  function densityForLevel(lv){
    // gentle ramp: 0.12 -> ~0.52 across levels
    const t = (clamp(lv,1,MAX_LEVEL) - 1) / (MAX_LEVEL - 1);
    return 0.12 + t * 0.40;
  }
  function gridSizeForLevel(lv){
    if(lv <= 5) return 8;
    if(lv <= 10) return 10;
    return 12;
  }

  // Checkpoints: once you reach these levels, you can't drop below them
  const CHECKPOINTS = [1, 4, 7, 10, 13];

  const state = {
    rows: 8,
    cols: 8,
    grid: [],

    score: 0,
    hearts: 3,

    level: 1,
    checkpoint: 1,

    playerRow: 4,
    alienRow: 4,

    turn: "player", // player | anim | alien
    laser: null,    // {pts, t0, dur, stroke, onDone}

    dragging: false,
    dragOffsetY: 0,

    banner: null    // {text, t0, dur}
  };

  // ---------- Utils ----------
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function choice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function currentCheckpointForLevel(lv){
    let cp = 1;
    for(const c of CHECKPOINTS){
      if(lv >= c) cp = c;
    }
    return cp;
  }

  function setBanner(text){
    state.banner = { text, t0: performance.now(), dur: 900 };
  }

  // ---------- Geometry ----------
  function geom(){
    const w = canvas.width, h = canvas.height;
    const pad = 26;

    // Reserve side space for ships
    const shipLane = Math.floor(w * 0.18);
    const gridW = w - pad*2 - shipLane*2;
    const gridH = h - pad*2;

    const cell = Math.floor(Math.min(gridW / state.cols, gridH / state.rows));
    const realW = cell * state.cols;
    const realH = cell * state.rows;

    const gridX = Math.floor((w - realW) / 2);
    const gridY = Math.floor((h - realH) / 2);

    const shipXLeft  = gridX - Math.floor(cell * 0.90);
    const shipXRight = gridX + realW + Math.floor(cell * 0.90);

    return {w,h,pad,cell,gridX,gridY,realW,realH,shipXLeft,shipXRight};
  }

  function rowCenterY(row){
    const g = geom();
    return g.gridY + (row + 0.5) * g.cell;
  }

  // ---------- Mirrors ----------
  function reflect(dir, mirror){
    if(mirror === "/"){
      // R->U, D->L, L->D, U->R
      if(dir===0) return 3;
      if(dir===1) return 2;
      if(dir===2) return 1;
      if(dir===3) return 0;
    }
    if(mirror === "\\"){
      // R->D, U->L, L->U, D->R
      if(dir===0) return 1;
      if(dir===3) return 2;
      if(dir===2) return 3;
      if(dir===1) return 0;
    }
    return dir;
  }

  function generateMazeForLevel(level){
    const density = densityForLevel(level);
    const g = [];
    for(let y=0;y<state.rows;y++){
      const row = [];
      for(let x=0;x<state.cols;x++){
        row.push(Math.random() < density ? (Math.random()<0.5?"/":"\\") : "");
      }
      g.push(row);
    }
    state.grid = g;
  }

  // ---------- Laser tracing ----------
  function trace(fromSide, row){
    let x = (fromSide==="left") ? 0 : state.cols-1;
    let y = row;
    let dir = (fromSide==="left") ? 0 : 2;

    const path = [];
    const seen = new Set();

    while(true){
      if(x < 0) return { exit:{side:"left", row:y}, path };
      if(x >= state.cols) return { exit:{side:"right", row:y}, path };
      if(y < 0) return { exit:{side:"top", row:y}, path };
      if(y >= state.rows) return { exit:{side:"bottom", row:y}, path };

      const key = `${x},${y},${dir}`;
      if(seen.has(key)){
        return { exit:{side:"loop", row:y}, path };
      }
      seen.add(key);

      const mirror = state.grid[y][x];
      path.push({x,y,mirror,dir});

      if(mirror) dir = reflect(dir, mirror);
      x += dirs[dir].dx;
      y += dirs[dir].dy;
    }
  }

  function buildLaserPoints(fromSide, row, path, exit){
    const g = geom();
    const pts = [];

    if(fromSide === "left"){
      pts.push({px: g.shipXLeft + g.cell*0.35, py: rowCenterY(row)});
    } else {
      pts.push({px: g.shipXRight - g.cell*0.35, py: rowCenterY(row)});
    }

    for(const c of path){
      pts.push({
        px: g.gridX + (c.x + 0.5) * g.cell,
        py: g.gridY + (c.y + 0.5) * g.cell
      });
    }

    if(exit.side === "right"){
      pts.push({px: g.gridX + g.realW + g.cell*0.65, py: rowCenterY(exit.row)});
    } else if(exit.side === "left"){
      pts.push({px: g.gridX - g.cell*0.65, py: rowCenterY(exit.row)});
    } else {
      const last = pts[pts.length - 1] || {px: g.gridX, py: g.gridY};
      pts.push({px:last.px, py:last.py});
    }

    return pts;
  }

  // ---------- Solvability ----------
  function reachableRightExitRows(){
    const set = new Set();
    for(let r=0; r<state.rows; r++){
      const { exit } = trace("left", r);
      if(exit.side === "right" && exit.row >= 0 && exit.row < state.rows){
        set.add(exit.row);
      }
    }
    return Array.from(set);
  }

  function setupSolvableMaze(level){
    for(let tries=0; tries<160; tries++){
      generateMazeForLevel(level);
      const reachable = reachableRightExitRows();
      if(reachable.length > 0){
        state.alienRow = choice(reachable);
        return;
      }
    }
    state.alienRow = Math.floor(state.rows/2);
  }

  // ---------- Level + Checkpoint ----------
  function applyGridForLevel(level){
    const size = gridSizeForLevel(level);
    state.rows = size;
    state.cols = size;

    // Keep player/alien rows valid after resize
    state.playerRow = clamp(state.playerRow, 0, state.rows-1);
    state.alienRow  = clamp(state.alienRow,  0, state.rows-1);
  }

  function setLevel(newLevel, showBanner){
    const lv = clamp(newLevel, 1, MAX_LEVEL);
    state.level = lv;

    // Update checkpoint if crossed
    const newCP = currentCheckpointForLevel(lv);
    if(newCP > state.checkpoint){
      state.checkpoint = newCP;
      if(showBanner) setBanner(`CHECKPOINT ${newCP}!`);
    }

    // Resize grid if needed
    const oldSize = state.rows;
    applyGridForLevel(lv);

    // Rebuild a solvable maze for this level
    setupSolvableMaze(lv);

    // If size changed, show a small banner (optional)
    if(showBanner && state.rows !== oldSize){
      setBanner(`${state.rows}×${state.cols} GRID!`);
    }

    syncHUD();
  }

  function nextLevel(){
    setLevel(state.level + 1, true);
    setBanner("LEVEL UP!");
  }

  function prevLevel(){
    const target = Math.max(state.checkpoint, state.level - 1);
    setLevel(target, false);
  }

  // ---------- HUD ----------
  function syncHUD(){
    heartsEl.textContent = String(state.hearts);
    scoreEl.textContent  = String(state.score);
    levelEl.textContent  = String(state.level);
    if(cpEl) cpEl.textContent = String(state.checkpoint);
  }

  // ---------- Gameplay ----------
  function startLaserAnim(fromSide, row, stroke, onDone){
    const {exit, path} = trace(fromSide, row);
    const pts = buildLaserPoints(fromSide, row, path, exit);

    state.laser = {
      pts,
      t0: performance.now(),
      dur: Math.max(360, 130 + pts.length*52),
      stroke,
      onDone: () => onDone({exit})
    };
  }

  function firePlayer(){
    if(state.turn !== "player") return;

    state.turn = "anim";
    startLaserAnim("left", state.playerRow, "rgba(0,255,208,0.95)", ({exit}) => {
      state.laser = null;

      const hit = (exit.side === "right" && exit.row === state.alienRow);

      if(hit){
        state.score++;
        syncHUD();
        nextLevel();
        state.turn = "player";
        return;
      }

      // Miss: alien fires back + drop a level (but not below checkpoint)
      prevLevel();
      // "Alien goes to where you shot" — use exit row if it exited right, otherwise keep it
      if(exit.side === "right"){
        state.alienRow = clamp(exit.row, 0, state.rows-1);
      }
      state.turn = "alien";
      setTimeout(fireAlien, 140);
    });
  }

  function fireAlien(){
    if(state.turn !== "alien") return;

    state.turn = "anim";
    startLaserAnim("right", state.alienRow, "rgba(255,85,119,0.95)", ({exit}) => {
      state.laser = null;

      const hit = (exit.side === "left" && exit.row === state.playerRow);
      if(hit){
        state.hearts = Math.max(0, state.hearts - 1);
        syncHUD();
      }
      state.turn = "player";
    });
  }

  function restart(){
    state.score = 0;
    state.hearts = 3;

    state.level = 1;
    state.checkpoint = 1;

    applyGridForLevel(1);
    state.playerRow = Math.floor(state.rows/2);
    state.turn = "player";
    state.laser = null;
    state.banner = null;

    setupSolvableMaze(1);
    syncHUD();
  }

  restartBtn.addEventListener("click", restart);

  // ---------- Movement ----------
  function movePlayer(delta){
    if(state.turn !== "player") return;
    state.playerRow = clamp(state.playerRow + delta, 0, state.rows-1);
  }

  window.addEventListener("keydown", (e) => {
    if(e.key === "ArrowUp"){ e.preventDefault(); movePlayer(-1); }
    if(e.key === "ArrowDown"){ e.preventDefault(); movePlayer(1); }
  }, {passive:false});

  // ---------- Ship hitbox + dragging ----------
  function playerShipHit(mx, my){
    const g = geom();
    const x = g.shipXLeft;
    const y = rowCenterY(state.playerRow);
    const rx = g.cell*0.55;
    const ry = g.cell*0.32;
    const dx = (mx - x) / rx;
    const dy = (my - y) / ry;
    return (dx*dx + dy*dy) <= 1.0;
  }

  function toCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    return {mx, my};
  }

  canvas.addEventListener("pointerdown", (e) => {
    const {mx, my} = toCanvasXY(e);
    if(playerShipHit(mx,my) && state.turn === "player"){
      state.dragging = true;
      state.dragOffsetY = my - rowCenterY(state.playerRow);
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if(!state.dragging) return;
    const {my} = toCanvasXY(e);
    const g = geom();
    const y = my - state.dragOffsetY;
    const row = Math.round((y - g.gridY) / g.cell - 0.5);
    state.playerRow = clamp(row, 0, state.rows-1);
  });

  canvas.addEventListener("pointerup", (e) => {
    if(!state.dragging) return;
    state.dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  // Click ship to fire (avoid drag-release)
  let downPos = null;
  canvas.addEventListener("pointerdown", (e) => {
    const {mx,my} = toCanvasXY(e);
    downPos = {mx,my,t:performance.now()};
  });

  canvas.addEventListener("pointerup", (e) => {
    const {mx,my} = toCanvasXY(e);
    if(!downPos) return;
    const dx = mx - downPos.mx;
    const dy = my - downPos.my;
    const dist = Math.hypot(dx,dy);
    const dt = performance.now() - downPos.t;
    downPos = null;

    if(dist < 8 && dt < 400){
      if(playerShipHit(mx,my) && state.turn === "player"){
        firePlayer();
      }
    }
  });

  // ---------- Rendering ----------
  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function drawGrid(){
    const g = geom();
    ctx.save();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(g.gridX, g.gridY, g.realW, g.realH);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for(let y=0;y<=state.rows;y++){
      ctx.beginPath();
      ctx.moveTo(g.gridX, g.gridY + y*g.cell);
      ctx.lineTo(g.gridX + g.realW, g.gridY + y*g.cell);
      ctx.stroke();
    }
    for(let x=0;x<=state.cols;x++){
      ctx.beginPath();
      ctx.moveTo(g.gridX + x*g.cell, g.gridY);
      ctx.lineTo(g.gridX + x*g.cell, g.gridY + g.realH);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(0,255,208,0.75)";
    ctx.lineWidth = Math.max(2, Math.floor(g.cell*0.10));
    ctx.lineCap = "round";

    for(let y=0;y<state.rows;y++){
      for(let x=0;x<state.cols;x++){
        const m = state.grid[y][x];
        if(!m) continue;
        const x0 = g.gridX + x*g.cell;
        const y0 = g.gridY + y*g.cell;
        const inset = g.cell*0.18;

        ctx.beginPath();
        if(m === "/"){
          ctx.moveTo(x0 + inset, y0 + g.cell - inset);
          ctx.lineTo(x0 + g.cell - inset, y0 + inset);
        } else {
          ctx.moveTo(x0 + inset, y0 + inset);
          ctx.lineTo(x0 + g.cell - inset, y0 + g.cell - inset);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawShip(x, row, label, fill, accent){
    const g = geom();
    const y = rowCenterY(row);
    const w = g.cell*0.70;
    const h = g.cell*0.36;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = fill;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, -w/2, -h/2, w, h, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(0, 0, w*0.18, h*0.35, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.font = `700 ${Math.max(12, Math.floor(g.cell*0.18))}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -h/2 - 10);

    ctx.restore();
  }

  function drawLaser(){
    if(!state.laser) return;
    const L = state.laser;
    const t = (performance.now() - L.t0) / L.dur;
    const u = clamp(t, 0, 1);

    const pts = L.pts;
    let total = 0;
    const seg = [];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const len = Math.hypot(b.px-a.px, b.py-a.py);
      seg.push(len);
      total += len;
    }

    let remain = total * u;

    ctx.save();
    ctx.strokeStyle = L.stroke;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.shadowColor = L.stroke;
    ctx.shadowBlur = 18;

    ctx.beginPath();
    ctx.moveTo(pts[0].px, pts[0].py);

    for(let i=0;i<seg.length;i++){
      if(remain <= 0) break;
      const a=pts[i], b=pts[i+1];
      const len = seg[i];
      if(remain >= len){
        ctx.lineTo(b.px, b.py);
        remain -= len;
      } else {
        const r = remain / len;
        ctx.lineTo(a.px + (b.px-a.px)*r, a.py + (b.py-a.py)*r);
        remain = 0;
      }
    }
    ctx.stroke();
    ctx.restore();

    if(t >= 1){
      const cb = L.onDone;
      state.laser = null;
      if(cb) cb();
    }
  }

  function drawBanner(){
    if(!state.banner) return;
    const b = state.banner;
    const t = (performance.now() - b.t0) / b.dur;
    if(t >= 1){ state.banner = null; return; }

    // Pop + fade
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    const s = 0.9 + 0.25 * (1 - Math.abs(0.5 - t)*2); // pop mid
    const alpha = 1 - easeOut(Math.max(0, (t - 0.15) / 0.85));

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.translate(canvas.width/2, canvas.height*0.18);
    ctx.scale(s, s);

    const text = b.text;
    ctx.font = "900 44px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // backing plate
    const padX = 26, padY = 14;
    const metrics = ctx.measureText(text);
    const w = metrics.width + padX*2;
    const h = 56 + padY*2;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, -w/2, -h/2, w, h, 16);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // glow text
    ctx.shadowColor = "rgba(0,255,208,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  function drawStars(){
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for(let i=0;i<120;i++){
      const x = (i*97) % canvas.width;
      const y = (i*57 + 23) % canvas.height;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawStars();
    drawGrid();

    const g = geom();
    drawShip(g.shipXLeft,  state.playerRow, "YOU",   "rgba(255,255,255,0.14)", "rgba(0,255,208,0.35)");
    drawShip(g.shipXRight, state.alienRow,  "ALIEN", "rgba(255,255,255,0.14)", "rgba(255,85,119,0.35)");

    drawLaser();
    drawBanner();

    requestAnimationFrame(draw);
  }

  // ---------- Boot ----------
  restart();
  draw();

})();
