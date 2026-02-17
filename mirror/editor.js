import { clamp, normalizeLevelObject, levelToExportPayload, payloadToJSSnippet } from "./levels.js";

(() => {
  "use strict";

  const canvas = document.getElementById("editorCanvas");
  const ctx = canvas.getContext("2d");

  const hudSize = document.getElementById("hudSize");
  const hudAlien = document.getElementById("hudAlien");

  const edName = document.getElementById("edName");
  const edSize = document.getElementById("edSize");
  const edCheckpoint = document.getElementById("edCheckpoint");
  const edClear = document.getElementById("edClear");
  const edTest = document.getElementById("edTest");
  const edSaveLocal = document.getElementById("edSaveLocal");
  const edLoadLocal = document.getElementById("edLoadLocal");

  const edExportJson = document.getElementById("edExportJson");
  const edExportJs = document.getElementById("edExportJs");
  const edOut = document.getElementById("edOut");
  const edIn = document.getElementById("edIn");
  const edImport = document.getElementById("edImport");
  const edStatus = document.getElementById("edStatus");

  const DIRS = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 }
  ];

  function choice(arr){ return arr[(Math.random()*arr.length)|0]; }

  const state = {
    level: makeEmptyLevel(8),
    size: 8,
    grid: [],
    alienRow: 4,

    painting: false,
    paintValue: ".",
    lastCell: null
  };

  function makeEmptyLevel(size){
    return {
      name: "Untitled",
      size,
      checkpoint: false,
      alienRow: Math.floor(size/2),
      grid: Array.from({length:size}, () => ".".repeat(size))
    };
  }

  function syncHud(){
    hudSize.textContent = `${state.size}×${state.size}`;
    hudAlien.textContent = String(state.alienRow);
  }

  function levelToInternal(){
    state.size = state.level.size;
    state.grid = state.level.grid.map(r => r.split(""));
    state.alienRow = clamp(state.level.alienRow|0, 0, state.size-1);
    syncHud();
  }

  function internalToLevel(){
    state.level.size = state.size;
    state.level.grid = state.grid.map(row => row.join(""));
    state.level.alienRow = state.alienRow|0;
  }

  function geom(){
    const w = canvas.width, h = canvas.height;
    const pad = 26;

    const gridW = w - pad*2 - Math.floor(w*0.18)*2;
    const gridH = h - pad*2;

    const cell = Math.floor(Math.min(gridW / state.size, gridH / state.size));
    const realW = cell * state.size;
    const realH = cell * state.size;

    const gridX = Math.floor((w - realW) / 2);
    const gridY = Math.floor((h - realH) / 2);

    const rightMarkersX = gridX + realW + Math.floor(cell * 0.55);

    return {cell,gridX,gridY,realW,realH,rightMarkersX};
  }

  function rowCenterY(row){
    const g = geom();
    return g.gridY + (row + 0.5) * g.cell;
  }

  function getCell(x,y){
    if(y<0||y>=state.size||x<0||x>=state.size) return ".";
    return state.grid[y][x];
  }

  function setCell(x,y,val){
    if(y<0||y>=state.size||x<0||x>=state.size) return;
    state.grid[y][x] = val;
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

    const seen = new Set();

    while(true){
      if(x < 0) return { exit:{side:"left", row:y} };
      if(x >= state.size) return { exit:{side:"right", row:y} };
      if(y < 0) return { exit:{side:"top", row:y} };
      if(y >= state.size) return { exit:{side:"bottom", row:y} };

      const key = `${x},${y},${dir}`;
      if(seen.has(key)) return { exit:{side:"loop", row:y} };
      seen.add(key);

      const m = getCell(x,y);
      if(m === "/" || m === "\\") dir = reflect(dir, m);
      x += DIRS[dir].dx;
      y += DIRS[dir].dy;
    }
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

  function cycleCellValue(cur){
    if(cur === ".") return "/";
    if(cur === "/") return "\\";
    return ".";
  }

  function toCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    return {mx,my};
  }

  function mouseToCell(mx,my){
    const g = geom();
    if(mx < g.gridX || mx >= g.gridX + g.realW) return null;
    if(my < g.gridY || my >= g.gridY + g.realH) return null;
    const x = Math.floor((mx - g.gridX) / g.cell);
    const y = Math.floor((my - g.gridY) / g.cell);
    if(x<0||y<0||x>=state.size||y>=state.size) return null;
    return {x,y};
  }

  function mouseToRightRowMarker(mx,my){
    const g = geom();
    const dx = mx - g.rightMarkersX;
    if(dx < -16 || dx > 26) return null;
    const row = Math.floor((my - g.gridY) / g.cell);
    if(row < 0 || row >= state.size) return null;
    return row;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const {mx,my} = toCanvasXY(e);

    const rr = mouseToRightRowMarker(mx,my);
    if(rr != null){
      state.alienRow = rr;
      internalToLevel();
      syncHud();
      edStatus.textContent = `Alien row set to ${rr}`;
      return;
    }

    const cell = mouseToCell(mx,my);
    if(!cell) return;

    const cur = getCell(cell.x, cell.y);
    const next = cycleCellValue(cur);

    state.painting = true;
    state.paintValue = next;
    state.lastCell = cell;

    setCell(cell.x, cell.y, next);
    internalToLevel();
  });

  canvas.addEventListener("pointermove", (e) => {
    if(!state.painting) return;
    const {mx,my} = toCanvasXY(e);
    const cell = mouseToCell(mx,my);
    if(!cell) return;
    if(state.lastCell && cell.x === state.lastCell.x && cell.y === state.lastCell.y) return;
    state.lastCell = cell;
    setCell(cell.x, cell.y, state.paintValue);
    internalToLevel();
  });

  canvas.addEventListener("pointerup", () => {
    state.painting = false;
    state.lastCell = null;
  });

  function loadUIToLevel(){
    state.level.name = (edName.value || "Untitled").trim().slice(0, 60) || "Untitled";
    state.level.size = Number(edSize.value);
    state.level.checkpoint = (edCheckpoint.value === "true");

    if(state.level.grid.length !== state.level.size){
      state.level.grid = Array.from({length: state.level.size}, () => ".".repeat(state.level.size));
      state.level.alienRow = Math.floor(state.level.size/2);
    }
  }

  function syncUIFromLevel(){
    edName.value = state.level.name || "Untitled";
    edSize.value = String(state.level.size);
    edCheckpoint.value = state.level.checkpoint ? "true" : "false";
  }

  edSize.addEventListener("change", () => {
    const size = Number(edSize.value);
    state.level = makeEmptyLevel(size);
    syncUIFromLevel();
    levelToInternal();
    edStatus.textContent = `New ${size}×${size} canvas.`;
  });

  edClear.addEventListener("click", () => {
    const size = Number(edSize.value);
    const name = (edName.value || "Untitled").trim();
    const cp = (edCheckpoint.value === "true");
    state.level = makeEmptyLevel(size);
    state.level.name = name || "Untitled";
    state.level.checkpoint = cp;
    syncUIFromLevel();
    levelToInternal();
    edStatus.textContent = "Cleared.";
  });

  edTest.addEventListener("click", () => {
    loadUIToLevel();
    internalToLevel();

    const reachable = reachableRightExitRows().sort((a,b)=>a-b);
    const ok = reachable.length > 0;
    const alienOk = reachable.includes(state.alienRow);
    const auto = ensureAlienRowSolvable(state.alienRow);

    edStatus.textContent = ok
      ? `Solvable. Right-exit rows: [${reachable.join(", ")}]. AlienRow=${state.alienRow} (${alienOk?"OK":"NOT reachable"}). Auto-pick: ${auto}`
      : "Not solvable: no left shots exit on the right. Add/remove mirrors.";
  });

  edExportJson.addEventListener("click", () => {
    loadUIToLevel();
    internalToLevel();

    const payload = levelToExportPayload(state.level);
    edOut.value = JSON.stringify(payload, null, 2);
    edStatus.textContent = "Exported JSON.";
  });

  edExportJs.addEventListener("click", () => {
    loadUIToLevel();
    internalToLevel();

    const payload = levelToExportPayload(state.level);
    edOut.value = payloadToJSSnippet(payload);
    edStatus.textContent = "Exported JS snippet.";
  });

  edImport.addEventListener("click", () => {
    try{
      const obj = JSON.parse(edIn.value || "{}");
      const norm = normalizeLevelObject(obj);

      state.level = {
        name: norm.name,
        size: norm.size,
        checkpoint: !!obj.checkpoint,
        alienRow: (Number.isFinite(obj.alienRow) ? clamp(obj.alienRow|0,0,norm.size-1) : Math.floor(norm.size/2)),
        grid: norm.grid.map(r => r.join(""))
      };

      syncUIFromLevel();
      levelToInternal();
      edStatus.textContent = "Imported successfully.";
    }catch(err){
      edStatus.textContent = `Import error: ${err.message || err}`;
    }
  });

  const LS_KEY = "mirrorMazeEditorLevel_v1";

  edSaveLocal.addEventListener("click", () => {
    loadUIToLevel();
    internalToLevel();
    const payload = levelToExportPayload(state.level);
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    edStatus.textContent = "Saved to localStorage.";
  });

  edLoadLocal.addEventListener("click", () => {
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw){ edStatus.textContent = "No local save found."; return; }
      const obj = JSON.parse(raw);
      const norm = normalizeLevelObject(obj);

      state.level = {
        name: norm.name,
        size: norm.size,
        checkpoint: !!obj.checkpoint,
        alienRow: (Number.isFinite(obj.alienRow) ? clamp(obj.alienRow|0,0,norm.size-1) : Math.floor(norm.size/2)),
        grid: norm.grid.map(r => r.join(""))
      };
      syncUIFromLevel();
      levelToInternal();
      edStatus.textContent = "Loaded from localStorage.";
    }catch(err){
      edStatus.textContent = `Load error: ${err.message || err}`;
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

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    for(let r=0;r<state.size;r++){
      const x = g.rightMarkersX;
      const cy = rowCenterY(r);
      ctx.beginPath();
      roundRect(ctx, x-10, cy-10, 20, 20, 6);
      ctx.fill();
      ctx.stroke();

      if(r === state.alienRow){
        ctx.fillStyle = "rgba(255,85,119,0.60)";
        ctx.beginPath();
        ctx.arc(x, cy, 5, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.10)";
      }
    }

    ctx.restore();
  }

  function drawLabel(){
    const g = geom();
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.font = "900 18px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Click/drag to paint mirrors. Click right markers to set alien row.", g.gridX, g.gridY - 10);
    ctx.restore();
  }

  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawStars();
    drawGrid();
    drawLabel();
    requestAnimationFrame(render);
  }

  syncUIFromLevel();
  levelToInternal();
  edStatus.textContent = "Editor ready.";
  render();
})();
