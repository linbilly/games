import { LEVELS } from "./levels.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const elLevelTitle = document.getElementById("levelTitle");
const elTarget = document.getElementById("target");
const elRows = document.getElementById("rows");
const elCols = document.getElementById("cols");
const elArea = document.getElementById("area");
const elEq = document.getElementById("eq");
const elPrompt = document.getElementById("prompt");
const elMsg = document.getElementById("msg");

const btnReset = document.getElementById("reset");
const chkGrid = document.getElementById("showGrid");

// Modal
const modal = document.getElementById("modal");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");

// 10×10 grid
const GRID_W = 10;
const GRID_H = 10;
const TILE = 56;
const ORIGIN = { x: 60, y: 70 };

// Holding map (inventory grid above board)
const HOLD_COLS = 10;
const HOLD_CELL = 20;
const HOLD_ORIGIN = { x: ORIGIN.x + 140, y: ORIGIN.y - 52 };

let holdSlots = [];
let holdUsed = [];

// Disallow repeating exact same rectangle dimensions (order-sensitive)
// 2x3 and 3x2 are different, but 2x3 twice is not allowed.
const usedShapes = new Set(); // keys like "2x3"

// Level state
let levelIndex = 0;
let level = LEVELS[0];
let target = level.target;
let crop = level.crop;

// --- Move garden state ---
let movingGarden = false;
let moveOffset = { dx: 0, dy: 0 };
let moveGhostRect = null;
let moveGardenIndex = -1; 

let SFX_ON = true;
let audioCtx = null;

// Drag state
let dragging = false;
let dragStart = null;
let dragNow = null;
let ghostRect = null;

// Board truth state (persists across levels if refresh=false)
let plowed = new Uint8Array(GRID_W * GRID_H);   // 1 = dirt
let planted = new Uint8Array(GRID_W * GRID_H);  // 1 = planted crop
let cropTypeMap = new Array(GRID_W * GRID_H).fill(null); // store crop type per tile
let gardens = []; // [{rect:{x0,y0,w,h}, crop:string}]

// Reward animation particles
let flying = []; // [{slotIndex,x0,y0,x,y,tx,ty,t0,dur,cell,launched,done}]
let awaitingOk = false;
let nextOnOk = false;

// Static tile decorations (so field doesn't shimmer)
const grassDeco = Array.from({ length: GRID_W * GRID_H }, () => {
  const patches = Array.from({ length: 3 }, () => ({
    w: 10 + Math.random() * 18,
    h: 6 + Math.random() * 14,
    x: 6 + Math.random() * (TILE - 24),
    y: 6 + Math.random() * (TILE - 24),
    a: 0.10 + Math.random() * 0.10,
  }));
  const blades = Array.from({ length: 4 }, () => ({
    x: 6 + Math.random() * (TILE - 12),
    y: 10 + Math.random() * (TILE - 18),
  }));
  return { patches, blades };
});
const dirtDeco = Array.from({ length: GRID_W * GRID_H }, () => ({
  speckles: Array.from({ length: 8 }, () => ({
    x: 6 + Math.random() * (TILE - 16),
    y: 6 + Math.random() * (TILE - 16),
  }))
}));

// Helpers
const idx = (x, y) => y * GRID_W + x;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const nowMs = () => performance.now();
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function gridFromMouse(mx, my) {
  const gx = Math.floor((mx - ORIGIN.x) / TILE);
  const gy = Math.floor((my - ORIGIN.y) / TILE);
  return { gx: clamp(gx, 0, GRID_W - 1), gy: clamp(gy, 0, GRID_H - 1) };
}

function rectFromTwoPoints(a, b) {
  const x0 = Math.min(a.gx, b.gx);
  const y0 = Math.min(a.gy, b.gy);
  const x1 = Math.max(a.gx, b.gx);
  const y1 = Math.max(a.gy, b.gy);
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function rectArea(r){ return r.w * r.h; }

function rectOverlapsExisting(r){
  for(let y=r.y0; y<r.y0+r.h; y++){
    for(let x=r.x0; x<r.x0+r.w; x++){
      if(plowed[idx(x,y)] === 1) return true;
    }
  }
  return false;
}

function setHUD(r) {
  if (!r) {
    elRows.textContent = "-";
    elCols.textContent = "-";
    elArea.textContent = "-";
    elEq.textContent = "-";
    return;
  }
  elRows.textContent = String(r.h);
  elCols.textContent = String(r.w);
  elArea.textContent = String(rectArea(r));
  elEq.textContent = `${r.h} × ${r.w} = ${rectArea(r)}`;
}

function setMessage(text, tone="muted"){
  elMsg.textContent = text;
  if (tone === "ok") elMsg.style.color = "var(--ok)";
  else if (tone === "bad") elMsg.style.color = "var(--bad)";
  else elMsg.style.color = "var(--muted)";
}

function tileCenter(gx, gy){
  return {
    x: ORIGIN.x + gx * TILE + TILE * 0.5,
    y: ORIGIN.y + gy * TILE + TILE * 0.5
  };
}

function cellsInside(r){
  const out = [];
  for(let y=r.y0; y<r.y0+r.h; y++){
    for(let x=r.x0; x<r.x0+r.w; x++){
      out.push({x,y});
    }
  }
  return out;
}

function pointInRect(gx, gy, r){
  return gx >= r.x0 && gx < r.x0 + r.w && gy >= r.y0 && gy < r.y0 + r.h;
}

function clampRectToBoard(r){
  const x0 = clamp(r.x0, 0, GRID_W - r.w);
  const y0 = clamp(r.y0, 0, GRID_H - r.h);
  return { ...r, x0, y0 };
}


function buildHoldingMap(){
  holdSlots = [];
  holdUsed = Array(target).fill(false);
  for(let i=0;i<target;i++){
    const row = Math.floor(i / HOLD_COLS);
    const col = i % HOLD_COLS;
    holdSlots.push({
      x: HOLD_ORIGIN.x + col * HOLD_CELL,
      y: HOLD_ORIGIN.y + row * HOLD_CELL
    });
  }
}

function clearTransient(){
  flying = [];
  ghostRect = null;
  dragging = false;
  dragStart = null;   // ✅ add
  dragNow = null;     // ✅ add
  awaitingOk = false;
  nextOnOk = false;
  setHUD(null);
}


function clearBoard(){
  plowed = new Uint8Array(GRID_W * GRID_H);
  planted = new Uint8Array(GRID_W * GRID_H);
  cropTypeMap = new Array(GRID_W * GRID_H).fill(null);
  gardens = [];
  usedShapes.clear();

}

function loadLevel(i, {preserveBoard} = {preserveBoard:true}){
  levelIndex = clamp(i, 0, LEVELS.length - 1);
  level = LEVELS[levelIndex];
  target = level.target;
  crop = level.crop;

  if(!preserveBoard){
    clearBoard();
  }

  buildHoldingMap();
  clearTransient();

  elLevelTitle.textContent = level.title;
  elTarget.textContent = String(target);
  elPrompt.textContent = level.prompt;

  setMessage("Drag a rectangle to make a field.", "muted");
}

// ----------------- Drawing (procedural sprites) -----------------
function drawGrassTile(px, py, seed){
  ctx.fillStyle = "rgba(72, 187, 120, 0.35)";
  ctx.fillRect(px, py, TILE-1, TILE-1);

  const deco = grassDeco[seed];
  for(const p of deco.patches){
    ctx.fillStyle = `rgba(50, 160, 90, ${p.a})`;
    ctx.fillRect(px + p.x, py + p.y, p.w, p.h);
  }

  ctx.strokeStyle = "rgba(220, 255, 220, 0.08)";
  ctx.lineWidth = 2;
  for(const b of deco.blades){
    const x = px + b.x;
    const y = py + b.y;
    ctx.beginPath();
    ctx.moveTo(x, y+10);
    ctx.lineTo(x+2, y);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawDirtTile(px, py, seed){
  ctx.fillStyle = "rgba(165, 108, 66, 0.40)";
  ctx.fillRect(px, py, TILE-1, TILE-1);

  ctx.strokeStyle = "rgba(95, 55, 35, 0.35)";
  for(let i=0;i<4;i++){
    const y = py + 10 + i*12;
    ctx.beginPath();
    ctx.moveTo(px + 6, y);
    ctx.lineTo(px + TILE - 10, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(80, 45, 25, 0.18)";
  const deco = dirtDeco[seed];
  for(const s of deco.speckles){
    ctx.fillRect(px + s.x, py + s.y, 2, 2);
  }
}

function drawFenceBorder(r){
  const x = ORIGIN.x + r.x0 * TILE;
  const y = ORIGIN.y + r.y0 * TILE;
  const w = r.w * TILE;
  const h = r.h * TILE;

  ctx.save();
  ctx.translate(0.5, 0.5);
  ctx.strokeStyle = "rgba(199, 160, 95, 0.9)";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.strokeRect(x, y, w, h);

  ctx.strokeStyle = "rgba(150, 115, 60, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x+4, y+4, w-8, h-8);

  ctx.strokeStyle = "rgba(199, 160, 95, 0.85)";
  ctx.lineWidth = 5;
  for(let i=0;i<=r.w;i++){
    const px = x + i*TILE;
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, y+h-14); ctx.lineTo(px, y+h); ctx.stroke();
  }
  for(let j=0;j<=r.h;j++){
    const py = y + j*TILE;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x+14, py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+w-14, py); ctx.lineTo(x+w, py); ctx.stroke();
  }
  ctx.restore();
}

function drawCropSprite(type, cx, cy, scale=1.0, alpha=1.0){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);

  if(type === "carrot"){
    ctx.rotate(-0.35);
    ctx.strokeStyle = "rgba(70, 210, 120, 0.95)";
    ctx.lineWidth = 3*scale;
    ctx.beginPath();
    ctx.moveTo(-6*scale, -10*scale); ctx.lineTo(-12*scale, -22*scale);
    ctx.moveTo(-2*scale, -10*scale); ctx.lineTo(-2*scale, -26*scale);
    ctx.moveTo(2*scale, -10*scale);  ctx.lineTo(10*scale, -22*scale);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 153, 51, 0.95)";
    ctx.beginPath();
    ctx.moveTo(-6*scale, -8*scale);
    ctx.lineTo(6*scale, -8*scale);
    ctx.lineTo(0*scale, 18*scale);
    ctx.closePath();
    ctx.fill();
  } else if(type === "strawberry"){
    ctx.fillStyle = "rgba(255, 77, 109, 0.95)";
    ctx.beginPath();
    ctx.moveTo(0, 16*scale);
    ctx.bezierCurveTo(14*scale, 10*scale, 14*scale, -6*scale, 0, -10*scale);
    ctx.bezierCurveTo(-14*scale, -6*scale, -14*scale, 10*scale, 0, 16*scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(70, 210, 120, 0.95)";
    ctx.beginPath();
    ctx.moveTo(-10*scale, -8*scale);
    ctx.lineTo(0, -16*scale);
    ctx.lineTo(10*scale, -8*scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255, 240, 160, 0.6)";
    for(let i=0;i<10;i++){
      const a = (i/10)*Math.PI*2;
      const rx = Math.cos(a)*7*scale;
      const ry = Math.sin(a)*7*scale;
      ctx.fillRect(rx-1*scale, ry-1*scale, 2*scale, 2*scale);
    }
  } else if(type === "corn"){
    ctx.rotate(-0.15);
    ctx.fillStyle = "rgba(255, 214, 74, 0.95)";
    ctx.beginPath();
    ctx.ellipse(0, 2*scale, 9*scale, 16*scale, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 240, 170, 0.35)";
    for(let y=-10; y<=12; y+=6){
      for(let x=-4; x<=4; x+=4){
        ctx.fillRect(x*scale, y*scale, 2*scale, 2*scale);
      }
    }

    ctx.strokeStyle = "rgba(70, 210, 120, 0.9)";
    ctx.lineWidth = 3*scale;
    ctx.beginPath();
    ctx.moveTo(-9*scale, 10*scale);
    ctx.lineTo(-14*scale, 20*scale);
    ctx.moveTo(9*scale, 10*scale);
    ctx.lineTo(14*scale, 20*scale);
    ctx.stroke();
  } else if(type === "grape"){
    ctx.fillStyle = "rgba(167, 107, 255, 0.95)";
    const pts = [[-6,-6],[6,-6],[0,2],[-6,10],[6,10],[0,18]];
    for(const [x,y] of pts){
      ctx.beginPath();
      ctx.arc(x*scale, y*scale, 6*scale, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(70, 210, 120, 0.95)";
    ctx.beginPath();
    ctx.moveTo(-2*scale, -16*scale);
    ctx.lineTo(6*scale, -12*scale);
    ctx.lineTo(2*scale, -6*scale);
    ctx.closePath();
    ctx.fill();
  } else if(type === "orange"){
    ctx.fillStyle = "rgba(255, 164, 72, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 4*scale, 14*scale, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 220, 160, 0.35)";
    ctx.beginPath();
    ctx.arc(-4*scale, 0, 5*scale, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "rgba(70, 210, 120, 0.95)";
    ctx.beginPath();
    ctx.ellipse(8*scale, -10*scale, 8*scale, 4*scale, -0.4, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.restore();
}

function drawInventory(){
  ctx.fillStyle = "rgba(233,236,255,0.85)";
  ctx.font = "12px system-ui";
  const label = ({
    carrot: "Carrots",
    strawberry: "Strawberries",
    corn: "Corn",
    grape: "Grapes",
    orange: "Oranges"
  })[crop] || "Crops";
  ctx.fillText(`${label} to plant:`, HOLD_ORIGIN.x, HOLD_ORIGIN.y - 10);

  const rows = Math.ceil(target / HOLD_COLS);
  const w = HOLD_COLS * HOLD_CELL;
  const h = rows * HOLD_CELL;

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.strokeRect(HOLD_ORIGIN.x - 8, HOLD_ORIGIN.y - 14, w + 16, h + 18);

  for(let i=0;i<holdSlots.length;i++){
    if(holdUsed[i]) continue;
    const s = holdSlots[i];
    drawCropSprite(crop, s.x, s.y, 0.50, 0.95);
  }
}

// ----------------- Planting animation using displayed inventory -----------------
function startPlantingAnimation(r){
  const cells = cellsInside(r);

  for(const c of cells){
    plowed[idx(c.x,c.y)] = 1;
  }
  gardens.push({ rect: { ...r }, crop });

  const t0 = nowMs();
  flying = cells.slice(0, target).map((c, i) => {
    const to = tileCenter(c.x, c.y);
    const src = holdSlots[i];
    return {
      slotIndex: i,
      x0: src.x, y0: src.y,
      x: src.x,  y: src.y,
      tx: to.x,  ty: to.y,
      t0: t0 + i * 260, // slower, one-by-one
      dur: 2000,
      cell: c,
      launched: false,
      done: false
    };
  });
}

// ----------------- Modal -----------------
function showModal(text, {goNext}){
  modalText.textContent = text;
  modal.classList.remove("hidden");
  awaitingOk = true;
  nextOnOk = !!goNext;
}
function hideModal(){
  modal.classList.add("hidden");
  awaitingOk = false;
}

modalOk.addEventListener("click", () => {
  const goNext = nextOnOk;          // ✅ capture decision FIRST
  const prevIndex = levelIndex;     // ✅ level that just finished

  hideModal();
  nextOnOk = false;                // ✅ consume + clear here (one place only)

  if (goNext) {
    const preserve = !LEVELS[prevIndex].refresh;
    const nextIndex = (prevIndex + 1) % LEVELS.length;

    loadLevel(nextIndex, { preserveBoard: preserve });
    return;
  }

  // Incorrect branch: stay on same level
  buildHoldingMap();
  flying = [];
  ghostRect = null;
  dragging = false;
  movingGarden = false;
  moveGhostRect = null;
  moveGardenIndex = -1;
  setHUD(null);
  setMessage("Try again: drag a rectangle to make a field.", "muted");
});




function findGardenAtGrid(gx, gy){
  for(let i=gardens.length-1; i>=0; i--){
    if(pointInRect(gx, gy, gardens[i].rect)) return i;
  }
  return -1;
}

function rectOverlapsGardens(r, ignoreIndex = -1){
  for(let i=0;i<gardens.length;i++){
    if(i === ignoreIndex) continue;
    const a = gardens[i].rect;
    const overlap = !(r.x0 + r.w <= a.x0 || a.x0 + a.w <= r.x0 || r.y0 + r.h <= a.y0 || a.y0 + a.h <= r.y0);
    if(overlap) return true;
  }
  return false;
}

function shapeKey(r){
  return `${r.h}x${r.w}`; // order-sensitive by design
}

function isShapeUsed(r){
  return usedShapes.has(shapeKey(r));
}


// Rebuild plowed/planted/cropTypeMap from gardens after any move
function rebuildBoardFromGardens(){
  plowed = new Uint8Array(GRID_W * GRID_H);
  planted = new Uint8Array(GRID_W * GRID_H);
  cropTypeMap = new Array(GRID_W * GRID_H).fill(null);

  for(const g of gardens){
    const r = g.rect;
    for(let y=r.y0; y<r.y0+r.h; y++){
      for(let x=r.x0; x<r.x0+r.w; x++){
        const k = idx(x,y);
        plowed[k] = 1;
        planted[k] = 1;
        cropTypeMap[k] = g.crop;
      }
    }
  }
}


// ----------------- Update & Draw Loop -----------------
function update(){
  if(flying.length){
    const t = nowMs();
    for(const p of flying){
      if(p.done) continue;

      const local = (t - p.t0) / p.dur;
      if(local <= 0) continue;

      if(!p.launched){
        p.launched = true;
        holdUsed[p.slotIndex] = true;
      }

      const tt = clamp(local, 0, 1);
      const e = easeOutCubic(tt);
      p.x = lerp(p.x0, p.tx, e);
      p.y = lerp(p.y0, p.ty, e);

      if(tt >= 1){
        // sfx("land");
        p.done = true;
        const k = idx(p.cell.x, p.cell.y);
        planted[k] = 1;
        cropTypeMap[k] = crop;
      }
    }

    if(flying.every(p => p.done)){
      flying = [];
      const lastGarden = gardens[gardens.length - 1];
      const r = lastGarden?.rect;
      showModal(`Correct! ${r.h} × ${r.w} = ${rectArea(r)}.`, { goNext: true });
    }
  }
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  drawInventory();

  // tiles
  for(let y=0;y<GRID_H;y++){
    for(let x=0;x<GRID_W;x++){
      const px = ORIGIN.x + x*TILE;
      const py = ORIGIN.y + y*TILE;
      const k = idx(x,y);

      if(plowed[k]) drawDirtTile(px, py, k);
      else drawGrassTile(px, py, k);

      if(chkGrid.checked){
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.strokeRect(px, py, TILE, TILE);
      }
    }
  }

  // moving preview
  if (movingGarden && moveGhostRect) {
    const px = ORIGIN.x + moveGhostRect.x0 * TILE;
    const py = ORIGIN.y + moveGhostRect.y0 * TILE;
    const pw = moveGhostRect.w * TILE;
    const ph = moveGhostRect.h * TILE;

    const overlap = rectOverlapsGardens(moveGhostRect, moveGardenIndex);

    ctx.fillStyle = overlap ? "rgba(251,113,133,0.10)" : "rgba(54,211,153,0.10)";
    ctx.fillRect(px, py, pw, ph);

    ctx.lineWidth = 4;
    ctx.strokeStyle = overlap ? "rgba(251,113,133,0.95)" : "rgba(54,211,153,0.95)";
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    ctx.lineWidth = 1;
  }



  // fences
  for(const g of gardens){
    drawFenceBorder(g.rect);
  }

  // planted crops
  for(let y=0;y<GRID_H;y++){
    for(let x=0;x<GRID_W;x++){
      const k = idx(x,y);
      if(planted[k]){
        const c = tileCenter(x,y);
        drawCropSprite(cropTypeMap[k] || "carrot", c.x, c.y+2, 0.85, 1.0);
      }
    }
  }

  // ghost selection
  if(ghostRect && !flying.length && !awaitingOk){
    const px = ORIGIN.x + ghostRect.x0*TILE;
    const py = ORIGIN.y + ghostRect.y0*TILE;
    const pw = ghostRect.w*TILE;
    const ph = ghostRect.h*TILE;

    const a = rectArea(ghostRect);
    const okArea = (a === target);
    const overlap = rectOverlapsExisting(ghostRect);

    ctx.fillStyle = (okArea && !overlap) ? "rgba(54,211,153,0.12)" : "rgba(251,113,133,0.10)";
    ctx.fillRect(px, py, pw, ph);

    ctx.lineWidth = 3;
    ctx.strokeStyle = (okArea && !overlap) ? "rgba(54,211,153,0.9)" : "rgba(251,113,133,0.9)";
    ctx.strokeRect(px+1, py+1, pw-2, ph-2);
    ctx.lineWidth = 1;

    ctx.fillStyle = "rgba(233,236,255,0.95)";
    ctx.font = "bold 16px system-ui";
    ctx.fillText(`${ghostRect.h}×${ghostRect.w} = ${a}`, px+8, py+22);
  }

  // flying crops
  for(const p of flying){
    if(p.done) continue;
    const t = nowMs();
    const tt = clamp((t - p.t0)/p.dur, 0, 1);
    const s = 0.85 + 0.10 * Math.sin(tt*Math.PI);
    drawCropSprite(crop, p.x, p.y, s, 1.0);
  }

  // label
  ctx.fillStyle = "rgba(233,236,255,0.85)";
  ctx.font = "bold 14px system-ui";
  ctx.fillText("10×10 Farm Map", ORIGIN.x, ORIGIN.y - 18);
}

// ----------------- Input -----------------
function onDown(e){
  if(flying.length) return;        // don't move while carrots are flying
  if(awaitingOk) return;           // if you have modal gating
  // allow move ONLY if a garden exists
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const g = gridFromMouse(mx, my);

  // If click inside an existing garden, start moving it
  const gi = findGardenAtGrid(g.gx, g.gy);
  if(gi >= 0){
    movingGarden = true;
    moveGardenIndex = gi;

    const gr = gardens[gi].rect;
    moveOffset.dx = g.gx - gr.x0;
    moveOffset.dy = g.gy - gr.y0;
    moveGhostRect = { ...gr };

    sfx("pick");
    return;
  }


  // Otherwise: start drawing a new rectangle (your existing logic)
  // if(gardens.length) return; // keep your “only 1 garden allowed” rule


  dragging = true;
  dragStart = g;
  dragNow = g;
  ghostRect = rectFromTwoPoints(dragStart, dragNow);
  setHUD(ghostRect);
  sfx("drag"); // optional
}

function onMove(e){
  if(awaitingOk) return;
  if(flying.length) return;
    // ✅ IMPORTANT: do nothing unless user is actively dragging OR moving a field
  if(!dragging && !movingGarden) return;

  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const g = gridFromMouse(mx, my);

  if(movingGarden){
    const base = gardens[moveGardenIndex].rect;

    let candidate = {
      x0: g.gx - moveOffset.dx,
      y0: g.gy - moveOffset.dy,
      w: base.w,
      h: base.h
    };
    candidate = clampRectToBoard(candidate);
    moveGhostRect = candidate;

    const overlap = rectOverlapsGardens(candidate, moveGardenIndex);
    setHUD(candidate);
    setMessage(overlap ? "Can’t move here: overlaps another field." : "Release to place the field.", overlap ? "bad" : "ok");
    return;
  }


  dragNow = gridFromMouse(mx, my);
  ghostRect = rectFromTwoPoints(dragStart, dragNow);
  setHUD(ghostRect);

  const a = rectArea(ghostRect);
  const overlap = rectOverlapsExisting(ghostRect);

  if(a === target && !overlap) {
    setMessage("Perfect size! Release to create the garden.", "ok");
  }
  else if(overlap) setMessage("That overlaps an existing garden. Try a different spot.", "bad");
  else setMessage(`Make a field that holds ${target}. (Currently ${a})`, "muted");
}

function onUp(){
  if(awaitingOk) return;
  if(flying.length) return;

  // Handle moving fields FIRST (even though dragging=false)
  if(movingGarden){
    const candidate = moveGhostRect;
    const overlap = rectOverlapsGardens(candidate, moveGardenIndex);

    if(!overlap){
      gardens[moveGardenIndex].rect = { ...candidate };
      rebuildBoardFromGardens();
      sfx("drop");
      setMessage("Field moved.", "ok");
    } else {
      sfx("error");
      setMessage("Can’t place there (overlap).", "bad");
    }

    movingGarden = false;
    moveGardenIndex = -1;
    moveGhostRect = null;
    dragStart = null;   // ✅ add
    dragNow = null;     // ✅ add

    setHUD(null);
    return;
  }

  // Existing draw-to-create logic continues here...
  if(!dragging) return;

  dragging = false;

  if(!ghostRect) return;
  const a = rectArea(ghostRect);
  const overlap = rectOverlapsExisting(ghostRect);

  if(a === target && !overlap){
    if(isShapeUsed(ghostRect)){
      sfx("error");
      showModal("Try again with a different shape.", { goNext: false });
    } else {
      // record this shape as used
      usedShapes.add(shapeKey(ghostRect));
      sfx("success");
      setMessage("✅ Garden created! Planting…", "ok");
      startPlantingAnimation(ghostRect);
    }
  } 
  else {
    sfx("error");
    if(overlap){
      showModal(`Sorry! ${ghostRect.h} × ${ghostRect.w} = ${a}, but it overlaps an existing garden.`, { goNext: false });
    } else {
      showModal(`Sorry! ${ghostRect.h} × ${ghostRect.w} = ${a}, not ${target}.`, { goNext: false });
    }
  }

  ghostRect = null;
  setHUD(null);
}


function ensureAudio(){
  if(!SFX_ON) return null;
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if(audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
  return audioCtx;
}

function sfx(type){
  const ac = ensureAudio();
  if(!ac) return;

  const presets = {
    pick:   { f: 520, dur: 0.06, wave: "square",   gain: 0.05 },
    drop:   { f: 420, dur: 0.08, wave: "square",   gain: 0.05 },
    drag:   { f: 240, dur: 0.03, wave: "sine",     gain: 0.02 },
    land:   { f: 740, dur: 0.03, wave: "sine",     gain: 0.02 },
    success:{ f: 660, dur: 0.12, wave: "triangle", gain: 0.06 },
    error:  { f: 180, dur: 0.18, wave: "sawtooth", gain: 0.05 },
  };
  const p = presets[type] || presets.drag;

  const t0 = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = p.wave;
  o.frequency.setValueAtTime(p.f, t0);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(p.gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);

  o.connect(g);
  g.connect(ac.destination);
  o.start(t0);
  o.stop(t0 + p.dur + 0.02);
}

// Press M to mute/unmute
window.addEventListener("keydown", (e)=>{
  if(e.key && e.key.toLowerCase() === "m") SFX_ON = !SFX_ON;
});

// Buttons
btnReset.addEventListener("click", () => {
  clearBoard();
  loadLevel(levelIndex, { preserveBoard: false });
});

// Mouse + touch
canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

canvas.addEventListener("touchstart", (e)=>{
  const t = e.touches[0];
  onDown({ clientX:t.clientX, clientY:t.clientY });
  e.preventDefault();
},{passive:false});

window.addEventListener("touchmove", (e)=>{
  if(!dragging && !movingGarden) return;
  const t = e.touches[0];
  onMove({ clientX:t.clientX, clientY:t.clientY });
  e.preventDefault();
},{passive:false});

window.addEventListener("touchend", ()=>onUp());

// Boot
(function init(){
  // roundRect polyfill
  if(!CanvasRenderingContext2D.prototype.roundRect){
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      const rr = Math.min(r, w/2, h/2);
      this.beginPath();
      this.moveTo(x+rr, y);
      this.arcTo(x+w, y, x+w, y+h, rr);
      this.arcTo(x+w, y+h, x, y+h, rr);
      this.arcTo(x, y+h, x, y, rr);
      this.arcTo(x, y, x+w, y, rr);
      this.closePath();
      return this;
    };
  }

  loadLevel(0, { preserveBoard: false });

  function loop(){
    update();
    draw();
    requestAnimationFrame(loop);
  }
  loop();
})();
