import { CAMPAIGN_LEVELS, clamp, normalizeLevelObject } from "./levels.js";
import { EduAudioEngine } from "../lib/EduAudioEngine.js";

export const audio = new EduAudioEngine({
  baseUrl: "../lib/",     // where /audio/ lives relative to the game page
  volume: 0.8,
  sfxVolume: 1.0
});


(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // --- Sprites (SVG) ---
  function loadSprite(url){
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  const sprites = { player:null, alien:null };
  (async () => {
    sprites.player = await loadSprite("./assets/player-ship.png");
    sprites.alien  = await loadSprite("./assets/alien.png");
  })();


  const elHearts = document.getElementById("hearts");
  const elScore = document.getElementById("score");
  const elLevel = document.getElementById("level");
  const elLevelMax = document.getElementById("levelMax");
  const elCheckpoint = document.getElementById("checkpoint");
  const elLevelName = document.getElementById("levelName");

  const btnRestart = document.getElementById("btnRestart");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");

  const DIRS = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 }
  ];

  // Unlock + preload on first user gesture:
window.addEventListener("pointerdown", async () => {
  await audio.init();
  await audio.preloadAll();
}, { once: true });


  function choice(arr){ return arr[(Math.random()*arr.length)|0]; }
  
  function realNow(){ return performance.now(); }

  // Game-time clock that freezes during hit-stop
  function now(){
    const t = state.time;
    const r = realNow();

    // still in hit-stop: freeze game time
    if(r < t.hitStopEnd){
      return t.frozenGameTime;
    }

    // if hit-stop just ended and not applied, remove that duration from game time
    if(!t.applied){
      t.offset += (t.hitStopEnd - t.hitStopStartReal);
      t.applied = true;
      t.hitStopEnd = 0;
    }

    return r - t.offset;
  }

  function requestHitStop(ms){
    const t = state.time;
    const r = realNow();
    const end = r + ms;

    if(r < t.hitStopEnd){
      // extend existing hit-stop
      if(end > t.hitStopEnd) t.hitStopEnd = end;
      return;
    }

    // start new hit-stop
    t.hitStopStartReal = r;
    t.hitStopEnd = end;
    t.frozenGameTime = r - t.offset;
    t.applied = false;
  }


  const state = {
    campaignIndex: 0,
    checkpointIndex: 0,

    size: 8,
    grid: [],
    alienRow: 0,
    playerRow: 0,

    hearts: 3,
    score: 0,

    turn: "player",
    dragging: false,
    dragOffsetY: 0,

    laser: null,
    banner: null,
    explosions: [],
    // arcade feel
    time: { offset: 0, hitStopEnd: 0, hitStopStartReal: 0, frozenGameTime: 0, applied: true },
    shake: { t0: 0, dur: 0, mag: 0 },
    debris: [],


  };

  function setBanner(text){
    state.banner = { text, t0: now(), dur: 900 };
  }

  // --- Explosion particles ---
  function spawnExplosion(x, y, colorA, colorB){
    const t0 = now();
    const parts = [];
    const n = 18;

    for(let i=0;i<n;i++){
      const ang = (Math.PI*2) * (i/n) + (Math.random()*0.35);
      const spd = 140 + Math.random()*220;

      parts.push({
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd,
        r: 2 + Math.random()*4,
        c: (Math.random()<0.55 ? colorA : colorB),
        drag: 2.6 + Math.random()*1.6
      });
    }

    state.explosions.push({
      x, y,
      t0,
      dur: 520,
      parts
    });
  }

  function drawExplosions(){
    if(!state.explosions.length) return;

    const t = now();

    for(let i=state.explosions.length-1; i>=0; i--){
      const ex = state.explosions[i];
      const u = (t - ex.t0) / ex.dur;

      if(u >= 1){
        state.explosions.splice(i,1);
        continue;
      }

      const ease = x => 1 - Math.pow(1-x,3);
      const k = ease(Math.max(0, Math.min(1, u)));
      const alpha = 1 - k;

      // flash ring
      ctx.save();
      ctx.globalAlpha = 0.35 * alpha;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, 8 + 28*k, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();

      // particles
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.95*alpha);

      for(const p of ex.parts){
        const dd = Math.exp(-p.drag * k);
        const px = ex.x + (p.vx * k * 0.18) * dd;
        const py = ex.y + (p.vy * k * 0.18) * dd;
        const rr = Math.max(0.5, p.r * (1 - 0.65*k));

        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI*2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // --- Screen shake ---
  function addShake(mag, dur){
    state.shake.t0 = now();
    state.shake.mag = Math.max(state.shake.mag, mag);
    state.shake.dur = Math.max(state.shake.dur, dur);
  }

  function getShakeOffset(){
    const s = state.shake;
    if(!s.dur) return {x:0,y:0};

    const u = (now() - s.t0) / s.dur;
    if(u >= 1){ s.dur = 0; s.mag = 0; return {x:0,y:0}; }

    const falloff = 1 - u;
    const m = s.mag * falloff;
    return {
      x: (Math.random()*2 - 1) * m,
      y: (Math.random()*2 - 1) * m
    };
  }

  // --- Debris ---
  function spawnDebris(x, y, colorA, colorB){
    const t0 = now();
    const pieces = [];
    const n = 12;

    for(let i=0;i<n;i++){
      const ang = Math.random() * Math.PI * 2;
      const spd = 120 + Math.random()*260;

      pieces.push({
        x, y,
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd,
        w: 3 + Math.random()*6,
        h: 2 + Math.random()*5,
        rot: Math.random()*Math.PI*2,
        vr: (Math.random()*2 - 1) * 8,
        c: (Math.random()<0.5 ? colorA : colorB),
        drag: 2.3 + Math.random()*2.2
      });
    }

    state.debris.push({ t0, dur: 650, pieces });
  }

  function drawDebris(){
    if(!state.debris.length) return;

    const t = now();
    for(let i=state.debris.length-1;i>=0;i--){
      const D = state.debris[i];
      const u = (t - D.t0) / D.dur;
      if(u >= 1){ state.debris.splice(i,1); continue; }

      const k = 1 - Math.pow(1-u, 3); // ease out
      const alpha = 1 - k;

      ctx.save();
      ctx.globalAlpha = 0.9 * alpha;

      for(const p of D.pieces){
        const dd = Math.exp(-p.drag * k);
        const px = p.x + (p.vx * k * 0.18) * dd;
        const py = p.y + (p.vy * k * 0.18) * dd + (18*k*k); // slight gravity feel
        const rot = p.rot + p.vr * k;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  window.MirrorMazeSFX = {
    enabled: true,
    play: (name) => audio.play(name)
  };


  function playSfx(name){
    const s = window.MirrorMazeSFX;
    if(!s || !s.enabled || typeof s.play !== "function") return;
    s.play(name);
  }



  function geom(){
    const w = canvas.width, h = canvas.height;
    const pad = 26;

    const shipLane = Math.floor(w * 0.18);
    const gridW = w - pad*2 - shipLane*2;
    const gridH = h - pad*2;

    const cell = Math.floor(Math.min(gridW / state.size, gridH / state.size));
    const realW = cell * state.size;
    const realH = cell * state.size;

    const gridX = Math.floor((w - realW) / 2);
    const gridY = Math.floor((h - realH) / 2);

    const shipXLeft  = gridX - Math.floor(cell * 0.90);
    const shipXRight = gridX + realW + Math.floor(cell * 0.90);

    return { w,h,cell,gridX,gridY,realW,realH,shipXLeft,shipXRight };
  }

  function rowCenterY(row){
    const g = geom();
    return g.gridY + (row + 0.5) * g.cell;
  }

  function getCell(x,y){
    if(y<0||y>=state.size||x<0||x>=state.size) return ".";
    return state.grid[y][x];
  }

  function reflect(dir, mirror){
    if(mirror === "/"){
      if(dir===0) return 3;
      if(dir===1) return 2;
      if(dir===2) return 1;
      if(dir===3) return 0;
    }
    if(mirror === "\\"){
      if(dir===0) return 1;
      if(dir===3) return 2;
      if(dir===2) return 3;
      if(dir===1) return 0;
    }
    return dir;
  }

  function trace(fromSide, startRow){
    let x = (fromSide==="left") ? 0 : state.size-1;
    let y = clamp(startRow, 0, state.size-1);
    let dir = (fromSide==="left") ? 0 : 2;

    const path = [];
    const seen = new Set();

    while(true){
      if(x < 0) return { exit:{side:"left", row:y}, path };
      if(x >= state.size) return { exit:{side:"right", row:y}, path };
      if(y < 0) return { exit:{side:"top", row:y}, path };
      if(y >= state.size) return { exit:{side:"bottom", row:y}, path };

      const key = `${x},${y},${dir}`;
      if(seen.has(key)) return { exit:{side:"loop", row:y}, path };
      seen.add(key);

      const m = getCell(x,y);
      path.push({x,y,mirror:m,dir});

      if(m === "/" || m === "\\") dir = reflect(dir, m);
      x += DIRS[dir].dx;
      y += DIRS[dir].dy;
    }
  }

  function buildLaserPoints(fromSide, row, path, exit){
    const g = geom();
    const pts = [];

    if(fromSide === "left"){
      pts.push({ px: g.shipXLeft + g.cell*0.35, py: rowCenterY(row) });
    } else {
      pts.push({ px: g.shipXRight - g.cell*0.35, py: rowCenterY(row) });
    }

    for(const c of path){
      pts.push({
        px: g.gridX + (c.x + 0.5) * g.cell,
        py: g.gridY + (c.y + 0.5) * g.cell
      });
    }

    if(exit.side === "right"){
      pts.push({ px: g.gridX + g.realW + g.cell*0.65, py: rowCenterY(exit.row) });
    } else if(exit.side === "left"){
      pts.push({ px: g.gridX - g.cell*0.65, py: rowCenterY(exit.row) });
    } else {
      const last = pts[pts.length-1] || {px:g.gridX, py:g.gridY};
      pts.push({ px:last.px, py:last.py });
    }
    return pts;
  }

  function reachableRightExitRows(){
    const set = new Set();
    for(let r=0; r<state.size; r++){
      const { exit } = trace("left", r);
      if(exit.side === "right" && exit.row >= 0 && exit.row < state.size){
        set.add(exit.row);
      }
    }
    return Array.from(set);
  }

  function ensureAlienRowSolvable(preferredRow){
    const reachable = reachableRightExitRows();
    if(reachable.length === 0) return null;
    if(typeof preferredRow === "number" && reachable.includes(preferredRow)) return preferredRow;
    return choice(reachable);
  }

  function loadLevel(levelObj, bannerText){
    const L = normalizeLevelObject(levelObj);
    state.size = L.size;
    state.grid = L.grid;
    state.playerRow = clamp(state.playerRow|0, 0, state.size-1);

    const placed = ensureAlienRowSolvable(L.alienRow);
    state.alienRow = (placed == null) ? Math.floor(state.size/2) : placed;

    if(bannerText) setBanner(bannerText);
  }

  function syncHUD(){
    elHearts.textContent = String(state.hearts);
    elScore.textContent = String(state.score);
    elLevel.textContent = String(state.campaignIndex + 1);
    elLevelMax.textContent = String(CAMPAIGN_LEVELS.length);
    elCheckpoint.textContent = String(state.checkpointIndex + 1);

    const name = CAMPAIGN_LEVELS[state.campaignIndex]?.name || "—";
    elLevelName.textContent = `Level: ${name}   |   Grid: ${state.size}×${state.size}`;
  }

  function startCampaign(){
    state.campaignIndex = 0;
    state.checkpointIndex = 0;
    state.score = 0;
    state.hearts = 3;
    state.turn = "player";
    state.laser = null;
    state.banner = null;

    loadLevel(CAMPAIGN_LEVELS[state.campaignIndex], "LEVEL 1");
    if(CAMPAIGN_LEVELS[state.campaignIndex].checkpoint) state.checkpointIndex = 0;
    syncHUD();
  }

  function goToLevel(idx, banner){
    const i = clamp(idx, 0, CAMPAIGN_LEVELS.length-1);
    state.campaignIndex = i;
    state.turn = "player";
    state.laser = null;

    loadLevel(CAMPAIGN_LEVELS[i], banner || null);

    if(CAMPAIGN_LEVELS[i].checkpoint){
      state.checkpointIndex = Math.max(state.checkpointIndex, i);
    }
    syncHUD();
  }

  function nextLevel(){
    playSfx("level_up");

    if(state.campaignIndex >= CAMPAIGN_LEVELS.length-1){
      setBanner("CAMPAIGN CLEAR!");
      return;
    }
    goToLevel(state.campaignIndex + 1, "LEVEL UP!");
  }

  function dropToCheckpoint(){
    goToLevel(state.checkpointIndex, "BACK TO CHECKPOINT");
  }

  function startLaserAnim(fromSide, row, stroke, onDone){
    const { exit, path } = trace(fromSide, row);
    const pts = buildLaserPoints(fromSide, row, path, exit);

    state.laser = {
      pts, stroke,
      t0: now(),
      dur: Math.max(360, 130 + pts.length*52),
      onDone: () => onDone({ exit })
    };
  }

  function firePlayer(){
    playSfx("shoot_player");

    if(state.turn !== "player") return;

    state.turn = "anim";
    startLaserAnim("left", state.playerRow, "rgba(0,255,208,0.95)", ({exit}) => {
      state.laser = null;

      const hit = (exit.side === "right" && exit.row === state.alienRow);
      if(hit){
        const g = geom();
        spawnExplosion(g.shipXRight, rowCenterY(state.alienRow),
          "rgba(255,85,119,0.95)", "rgba(255,204,77,0.95)"
        );
        spawnDebris(g.shipXRight, rowCenterY(state.alienRow),
          "rgba(255,85,119,0.95)", "rgba(255,255,255,0.85)"
        );
        addShake(10, 180);
        requestHitStop(90);
        playSfx("hit_alien");

        state.score += 1;
        syncHUD();
        nextLevel();
        state.turn = "player";
        return;
      }



      if(exit.side === "right") state.alienRow = clamp(exit.row, 0, state.size-1);

      state.turn = "alien";
      setTimeout(() => fireAlien(), 140);
    });
  }

  function fireAlien(){
    playSfx("shoot_alien");

    if(state.turn !== "alien") return;

    state.turn = "anim";
    startLaserAnim("right", state.alienRow, "rgba(255,85,119,0.95)", ({exit}) => {
      state.laser = null;

      const hit = (exit.side === "left" && exit.row === state.playerRow);
      if(hit){
        const g = geom();
        spawnExplosion(g.shipXLeft, rowCenterY(state.playerRow),
          "rgba(0,255,208,0.95)", "rgba(124,77,255,0.95)"
        );
        spawnDebris(g.shipXLeft, rowCenterY(state.playerRow),
          "rgba(0,255,208,0.95)", "rgba(255,255,255,0.85)"
        );
        addShake(14, 220);
        requestHitStop(110);
        playSfx("hit_player");

        state.hearts = Math.max(0, state.hearts - 1);
        syncHUD();
      }


      dropToCheckpoint();
      state.turn = "player";
    });
  }

  function movePlayer(delta){
    if(state.turn !== "player") return;
    state.playerRow = clamp(state.playerRow + delta, 0, state.size-1);
  }

  window.addEventListener("keydown", (e) => {
    if(e.key === "ArrowUp"){ e.preventDefault(); movePlayer(-1); }
    if(e.key === "ArrowDown"){ e.preventDefault(); movePlayer(1); }
  }, {passive:false});

  function toCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    return {mx,my};
  }

  function playerShipHit(mx,my){
    const g = geom();
    const x = g.shipXLeft;
    const y = rowCenterY(state.playerRow);
    const rx = g.cell*0.55, ry = g.cell*0.32;
    const dx = (mx-x)/rx, dy=(my-y)/ry;
    return (dx*dx + dy*dy) <= 1;
  }

  let pointerDown = null;

  canvas.addEventListener("pointerdown", (e) => {
    const {mx,my} = toCanvasXY(e);
    pointerDown = {mx,my,t:now()};
    if(state.turn !== "player") return;

    if(playerShipHit(mx,my)){
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
    state.playerRow = clamp(row, 0, state.size-1);
  });

  canvas.addEventListener("pointerup", (e) => {
    if(state.dragging){
      state.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    }
    const {mx,my} = toCanvasXY(e);
    if(!pointerDown) return;
    const dist = Math.hypot(mx-pointerDown.mx, my-pointerDown.my);
    const dt = now() - pointerDown.t;
    pointerDown = null;

    if(dist < 8 && dt < 400 && state.turn === "player" && playerShipHit(mx,my)){
      firePlayer();
    }
  });

  function drawStars(){
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for(let i=0;i<120;i++){
      const x = (i*97) % canvas.width;
      const y = (i*57 + 23) % canvas.height;
      ctx.fillRect(x, y, 1, 1);
    }
  }

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
    for(let y=0;y<=state.size;y++){
      ctx.beginPath();
      ctx.moveTo(g.gridX, g.gridY + y*g.cell);
      ctx.lineTo(g.gridX + g.realW, g.gridY + y*g.cell);
      ctx.stroke();
    }
    for(let x=0;x<=state.size;x++){
      ctx.beginPath();
      ctx.moveTo(g.gridX + x*g.cell, g.gridY);
      ctx.lineTo(g.gridX + x*g.cell, g.gridY + g.realH);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(0,255,208,0.75)";
    ctx.lineWidth = Math.max(2, Math.floor(g.cell*0.10));
    ctx.lineCap = "round";

    for(let y=0;y<state.size;y++){
      for(let x=0;x<state.size;x++){
        const m = getCell(x,y);
        if(m !== "/" && m !== "\\") continue;

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

  function drawShip(x, row, label, accent, img){
    const g = geom();
    const y = rowCenterY(row);
    const w = g.cell*0.88;
    const h = g.cell*0.88;

    // If sprite loaded, draw it
    if(img){
      ctx.save();
      ctx.translate(x, y);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, -w/2, -h/2, w, h);
      // small label
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `900 ${Math.max(12, Math.floor(g.cell*0.18))}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(label, 0, -h/2 - 10);
      ctx.restore();
      return;
    }

    // Fallback vector ship
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, -w/2, -h/2, w, h*0.55, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(0, 0, w*0.18, h*0.22, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.font = `900 ${Math.max(12, Math.floor(g.cell*0.18))}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -h/2 - 10);

    ctx.restore();
  }

  function drawLaser(){
    if(!state.laser) return;
    const L = state.laser;
    const t = (now() - L.t0) / L.dur;
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
    const t = (now() - b.t0) / b.dur;
    if(t >= 1){ state.banner = null; return; }

    const easeOut = x => 1 - Math.pow(1-x, 3);
    const s = 0.95 + 0.20 * (1 - Math.abs(0.5 - t)*2);
    const alpha = 1 - easeOut(Math.max(0, (t - 0.12) / 0.88));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(canvas.width/2, canvas.height*0.16);
    ctx.scale(s, s);

    const text = b.text;
    ctx.font = "900 44px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const padX = 26, padY = 14;
    const w = ctx.measureText(text).width + padX*2;
    const h = 56 + padY*2;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, -w/2, -h/2, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.shadowColor = "rgba(0,255,208,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const sh = getShakeOffset();
    ctx.save();
    ctx.translate(sh.x, sh.y);

    drawStars();
    drawGrid();

    const g = geom();
    drawShip(g.shipXLeft, state.playerRow, "YOU", "rgba(0,255,208,0.35)", sprites.player);
    drawShip(g.shipXRight, state.alienRow, "ALIEN", "rgba(255,85,119,0.35)", sprites.alien);

    drawLaser();
    drawDebris();
    drawExplosions();
    drawBanner();


    ctx.restore();

    requestAnimationFrame(render);
  }

  btnRestart.addEventListener("click", startCampaign);
  btnPrev.addEventListener("click", () => goToLevel(state.campaignIndex - 1, "LEVEL"));
  btnNext.addEventListener("click", () => goToLevel(state.campaignIndex + 1, "LEVEL"));

  elLevelMax.textContent = String(CAMPAIGN_LEVELS.length);
  state.playerRow = 0;
  startCampaign();
  render();
})();
