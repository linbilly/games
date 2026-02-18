import { LEVELS } from "./levels.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

// HUD elements
const elTarget = document.getElementById("targetArea");
const elRows = document.getElementById("rows");
const elCols = document.getElementById("cols");
const elArea = document.getElementById("area");
const elEq = document.getElementById("eq");
const elMsg = document.getElementById("msg");

const btnNew = document.getElementById("newMission"); // we'll repurpose this to "Next Level"
const btnReset = document.getElementById("reset");

// --- Grid config (10x10 drawing pad) ---
const GRID_W = 10;
const GRID_H = 10;
const TILE = 45; // pixels
const ORIGIN = { x: 45, y: 45 };

// Map state: 0 empty, 2 building (no roads/obstacles)
const map = new Uint8Array(GRID_W * GRID_H);

let buildings = []; // list of { x0, y0, w, h }

let draggingBuilding = false;
let dragBuildingIndex = -1;
let dragOffset = { dx: 0, dy: 0 }; // pointer-to-top-left offset in grid coords
let buildingGhost = null;          // ghost rect while moving


// Level state
let levelIndex = 0;
let targetArea = 6;

// Drag state
let dragging = false;
let dragStart = null;
let dragNow = null;
let ghostRect = null;

// ----------------- Helpers -----------------
const idx = (x, y) => y * GRID_W + x;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function gridFromMouse(mx, my) {
  const gx = Math.floor((mx - ORIGIN.x) / TILE);
  const gy = Math.floor((my - ORIGIN.y) / TILE);
  return {
    gx: clamp(gx, 0, GRID_W - 1),
    gy: clamp(gy, 0, GRID_H - 1),
  };
}

function rectFromTwoPoints(a, b) {
  const x0 = Math.min(a.gx, b.gx);
  const y0 = Math.min(a.gy, b.gy);
  const x1 = Math.max(a.gx, b.gx);
  const y1 = Math.max(a.gy, b.gy);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  return { x0, y0, w, h };
}

function rectArea(r) {
  return r.w * r.h;
}

function rectOverlaps(r) {
  for (let y = r.y0; y < r.y0 + r.h; y++) {
    for (let x = r.x0; x < r.x0 + r.w; x++) {
      if (map[idx(x, y)] !== 0) return true;
    }
  }
  return false;
}

function placeBuilding(r) {
  for (let y = r.y0; y < r.y0 + r.h; y++) {
    for (let x = r.x0; x < r.x0 + r.w; x++) {
      map[idx(x, y)] = 2;
    }
  }
}

function pointInRect(gx, gy, r) {
  return gx >= r.x0 && gx < r.x0 + r.w && gy >= r.y0 && gy < r.y0 + r.h;
}

function rebuildMap() {
  map.fill(0);
  for (const b of buildings) {
    for (let y = b.y0; y < b.y0 + b.h; y++) {
      for (let x = b.x0; x < b.x0 + b.w; x++) {
        map[idx(x, y)] = 2;
      }
    }
  }
}

function rectOverlapsBuildings(r, ignoreIndex = -1) {
  for (let i = 0; i < buildings.length; i++) {
    if (i === ignoreIndex) continue;
    const b = buildings[i];

    // axis-aligned rectangle overlap test
    const noOverlap =
      r.x0 + r.w <= b.x0 ||
      b.x0 + b.w <= r.x0 ||
      r.y0 + r.h <= b.y0 ||
      b.y0 + b.h <= r.y0;

    if (!noOverlap) return true;
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

function setMessage(text, tone = "muted") {
  elMsg.textContent = text;
  if (tone === "ok") elMsg.style.color = "var(--ok)";
  else if (tone === "bad") elMsg.style.color = "var(--bad)";
  else elMsg.style.color = "var(--muted)";
}

// ----------------- Levels -----------------
function loadLevel(i) {
  levelIndex = clamp(i, 0, LEVELS.length - 1);
  const L = LEVELS[levelIndex];

  targetArea = L.targetArea;
  elTarget.textContent = String(targetArea);

  // Put title in the message too (simple + minimal)
  setMessage(`${L.title}: ${L.prompt}`, "muted");

  // Button label behavior
  btnNew.textContent = levelIndex < LEVELS.length - 1 ? "Next Level" : "Restart Levels";
}

function nextLevel() {
  if (levelIndex < LEVELS.length - 1) {
    loadLevel(levelIndex + 1);
  } else {
    // restart
    loadLevel(0);
  }
}

// ----------------- Reset -----------------
function resetCity() {
  buildings = [];
  rebuildMap();

  ghostRect = null;
  buildingGhost = null;
  dragging = false;
  draggingBuilding = false;
  dragBuildingIndex = -1;
  setHUD(null);

  const L = LEVELS[levelIndex];
  setMessage(`${L.title}: ${L.prompt}`, "muted");
}


// ----------------- Drawing -----------------
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // background
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // grid cells
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const px = ORIGIN.x + x * TILE;
      const py = ORIGIN.y + y * TILE;

      // base tile
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(px, py, TILE - 1, TILE - 1);

      // building fill
      if (map[idx(x, y)] === 2) {
        ctx.fillStyle = "rgba(54,211,153,0.22)";
        ctx.fillRect(px, py, TILE - 1, TILE - 1);
      }

      // grid line
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.strokeRect(px, py, TILE, TILE);
    }
  }

  
  // Persistent outlines for all buildings
  if (buildings.length) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(233,236,255,0.95)";

    for (const r of buildings) {
      const px = ORIGIN.x + r.x0 * TILE;
      const py = ORIGIN.y + r.y0 * TILE;
      const pw = r.w * TILE;
      const ph = r.h * TILE;
      ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
    }

    ctx.lineWidth = 1;
  }

  // Ghost while moving an existing building
  if (buildingGhost) {
    const px = ORIGIN.x + buildingGhost.x0 * TILE;
    const py = ORIGIN.y + buildingGhost.y0 * TILE;
    const pw = buildingGhost.w * TILE;
    const ph = buildingGhost.h * TILE;

    const overlap = rectOverlapsBuildings(buildingGhost, dragBuildingIndex);

    ctx.fillStyle = overlap ? "rgba(251,113,133,0.14)" : "rgba(54,211,153,0.18)";
    ctx.fillRect(px, py, pw, ph);

    ctx.lineWidth = 3;
    ctx.strokeStyle = overlap ? "rgba(251,113,133,0.9)" : "rgba(54,211,153,0.9)";
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    ctx.lineWidth = 1;
  }

  // Ghost selection rectangle (on top)
  if (ghostRect) {
    const px = ORIGIN.x + ghostRect.x0 * TILE;
    const py = ORIGIN.y + ghostRect.y0 * TILE;
    const pw = ghostRect.w * TILE;
    const ph = ghostRect.h * TILE;

    const a = rectArea(ghostRect);
    const okArea = a === targetArea;
    const overlap = rectOverlaps(ghostRect);

    ctx.fillStyle =
      okArea && !overlap ? "rgba(54,211,153,0.18)" : "rgba(251,113,133,0.14)";
    ctx.fillRect(px, py, pw, ph);

    ctx.lineWidth = 3;
    ctx.strokeStyle =
      okArea && !overlap ? "rgba(54,211,153,0.9)" : "rgba(251,113,133,0.9)";
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    ctx.lineWidth = 1;

    ctx.fillStyle = "rgba(233,236,255,0.95)";
    ctx.font = "bold 16px system-ui";
    ctx.fillText(`${ghostRect.h}×${ghostRect.w} = ${a}`, px + 8, py + 22);
  }

  // label
  ctx.fillStyle = "rgba(233,236,255,0.85)";
  ctx.font = "bold 14px system-ui";
  ctx.fillText("City Drawing Pad (10×10)", ORIGIN.x, ORIGIN.y - 18);

  requestAnimationFrame(draw);
}

// ----------------- Input -----------------
function onDown(e) {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  const g = gridFromMouse(mx, my);

  // 1) If clicking inside an existing building -> start moving it
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (pointInRect(g.gx, g.gy, b)) {
      draggingBuilding = true;
      dragBuildingIndex = i;

      // store offset from building top-left so it "sticks" under your cursor
      dragOffset.dx = g.gx - b.x0;
      dragOffset.dy = g.gy - b.y0;

      buildingGhost = { ...b };
      setHUD(buildingGhost);
      setMessage("Drag to move the building. Release to drop.", "muted");
      return;
    }
  }

  // 2) Otherwise, start drawing a new rectangle
  dragging = true;
  dragStart = g;
  dragNow = g;

  ghostRect = rectFromTwoPoints(dragStart, dragNow);
  setHUD(ghostRect);
}


function onMove(e) {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const g = gridFromMouse(mx, my);

  // Moving an existing building
  if (draggingBuilding) {
    const b = buildings[dragBuildingIndex];

    // new top-left based on cursor position minus offset
    let nx0 = g.gx - dragOffset.dx;
    let ny0 = g.gy - dragOffset.dy;

    // clamp so building stays within grid
    nx0 = clamp(nx0, 0, GRID_W - b.w);
    ny0 = clamp(ny0, 0, GRID_H - b.h);

    buildingGhost = { x0: nx0, y0: ny0, w: b.w, h: b.h };
    setHUD(buildingGhost);

    const overlap = rectOverlapsBuildings(buildingGhost, dragBuildingIndex);
    if (overlap) setMessage("Can't drop here — overlaps another building.", "bad");
    else setMessage("Release to drop the building.", "ok");
    return;
  }

  // Drawing a new rectangle (existing logic)
  if (!dragging) return;

  dragNow = g;
  ghostRect = rectFromTwoPoints(dragStart, dragNow);
  setHUD(ghostRect);

  const a = rectArea(ghostRect);
  const overlap = rectOverlapsBuildings(ghostRect, -1);

  if (a === targetArea) {
    if (overlap) setMessage("Right area, but it overlaps a building.", "bad");
    else setMessage("Perfect! Release to place the building.", "ok");
  } else {
    setMessage(`Draw an area of ${targetArea} squares. (Currently ${a})`, "muted");
  }
}


function onUp() {
  // Dropping a moved building
  if (draggingBuilding) {
    const overlap = buildingGhost
      ? rectOverlapsBuildings(buildingGhost, dragBuildingIndex)
      : true;

    if (buildingGhost && !overlap) {
      buildings[dragBuildingIndex] = { ...buildingGhost };
      rebuildMap();
      setMessage("Building moved!", "ok");
    } else {
      setMessage("Move cancelled — overlaps another building.", "bad");
    }

    draggingBuilding = false;
    dragBuildingIndex = -1;
    buildingGhost = null;
    setHUD(null);
    return;
  }

  // Existing placement logic...
  if (!dragging) return;
  dragging = false;
  if (!ghostRect) return;

  const a = rectArea(ghostRect);
  const overlap = rectOverlapsBuildings(ghostRect, -1);

  if (a === targetArea && !overlap) {
    buildings.push({ ...ghostRect });
    rebuildMap();
    setMessage(`Built! ${ghostRect.h} × ${ghostRect.w} = ${a}`, "ok");
  } else if (overlap) {
    setMessage("Can't build there — overlaps a building.", "bad");
  } else {
    setMessage(`Not quite. That covers ${a} squares; need ${targetArea}.`, "bad");
  }

  ghostRect = null;
  setHUD(null);
}


// ----------------- Buttons -----------------
btnNew.addEventListener("click", () => nextLevel());
btnReset.addEventListener("click", () => resetCity());

// Mouse
canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

// Touch (minimal)
canvas.addEventListener(
  "touchstart",
  (e) => {
    const t = e.touches[0];
    onDown({ clientX: t.clientX, clientY: t.clientY });
    e.preventDefault();
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    onMove({ clientX: t.clientX, clientY: t.clientY });
    e.preventDefault();
  },
  { passive: false }
);

window.addEventListener("touchend", () => onUp());

// ----------------- Boot -----------------
(function init() {
  // label the button as Next Level / Restart Levels
  loadLevel(0);
  resetCity();
  requestAnimationFrame(draw);
})();
