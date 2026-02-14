import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { makeMathEngine } from "./mathEngine.js";
import { LEVELS, getLevelIndexById } from "./levels.js";
import { makeDifficultyManager } from "./difficultyManager.js";
import { loadStats, saveStats, resetStats, recordAttempt, computeWeakFacts, getWeakKeys, formatFactKey } from "./stats.js";
import { makeThemeManager } from "./themeManager.js";
import { makeSound } from "./sound.js";
import { CARS, loadGarage, saveGarage, isUnlocked, carById } from "./garage.js";

/* ---------------- UI ---------------- */
const ui = {
  // overlays
  menuOverlay: document.getElementById("menuOverlay"),
  garageOverlay: document.getElementById("garageOverlay"),
  statsOverlay: document.getElementById("statsOverlay"),

  // menu
  startLevel: document.getElementById("startLevel"),
  adaptiveOn: document.getElementById("adaptiveOn"),
  goalMode: document.getElementById("goalMode"),
  recommended: document.getElementById("recommended"),
  btnPlay: document.getElementById("btnPlay"),
  btnGarage: document.getElementById("btnGarage"),
  btnStatsFromMenu: document.getElementById("btnStatsFromMenu"),

  // garage
  btnCloseGarage: document.getElementById("btnCloseGarage"),
  garageSummary: document.getElementById("garageSummary"),
  carGrid: document.getElementById("carGrid"),

  // stats
  btnCloseStats: document.getElementById("btnCloseStats"),
  btnResetStats: document.getElementById("btnResetStats"),
  statsSummary: document.getElementById("statsSummary"),
  weakList: document.getElementById("weakList"),

  // hud
  speed: document.getElementById("speed"),
  score: document.getElementById("score"),
  levelName: document.getElementById("levelName"),
  carName: document.getElementById("carName"),
  question: document.getElementById("question"),
  feedback: document.getElementById("feedback"),
  centerMsg: document.getElementById("centerMsg"),
  btnSound: document.getElementById("btnSound"),
  soundState: document.getElementById("soundState"),
  btnStats: document.getElementById("btnStats"),
  btnMenu: document.getElementById("btnMenu"),

  // input
  touchZone: document.getElementById("touchZone"),
  touchButtons: document.getElementById("touchButtons"),
  btnLeft: document.getElementById("btnLeft"),
  btnRight: document.getElementById("btnRight"),
  btnFullscreen: document.getElementById("btnFullscreen"),
};

/* ---------------- Storage ---------------- */
const PREF_KEY = "mathRacerPrefs_clean_v1";
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { startLevelId: "K4", adaptive: true, goal: "race", soundOn: false };
    const p = JSON.parse(raw);
    return {
      startLevelId: p.startLevelId ?? "K4",
      adaptive: p.adaptive ?? true,
      goal: p.goal ?? "race",
      soundOn: p.soundOn ?? false,
    };
  } catch {
    return { startLevelId: "K4", adaptive: true, goal: "race", soundOn: false };
  }
}
function savePrefs(p) { localStorage.setItem(PREF_KEY, JSON.stringify(p)); }

/* ---------------- Overlay safety ---------------- */
function setOverlayOpen(open) {
  document.body.classList.toggle("overlayOpen", open);
}
function overlaysAnyOpen() {
  const menuOpen = !ui.menuOverlay.classList.contains("hidden") && ui.menuOverlay.style.display !== "none";
  const garageOpen = !ui.garageOverlay.classList.contains("hidden");
  const statsOpen = !ui.statsOverlay.classList.contains("hidden");
  return menuOpen || garageOpen || statsOpen;
}
function closeAllOverlays() {
  ui.garageOverlay.classList.add("hidden");
  ui.statsOverlay.classList.add("hidden");
  ui.menuOverlay.style.display = "none";
  setOverlayOpen(false);
}
function showMenu() {
  ui.statsOverlay.classList.add("hidden");
  ui.garageOverlay.classList.add("hidden");
  ui.menuOverlay.style.display = "grid";
  setOverlayOpen(true);
}
function hideMenu() {
  ui.menuOverlay.style.display = "none";
  setOverlayOpen(overlaysAnyOpen());
}
function showGarage() {
  ui.statsOverlay.classList.add("hidden");
  ui.garageOverlay.classList.remove("hidden");
  setOverlayOpen(true);
}
function hideGarage() {
  ui.garageOverlay.classList.add("hidden");
  setOverlayOpen(overlaysAnyOpen());
}
function showStats() {
  ui.garageOverlay.classList.add("hidden");
  ui.statsOverlay.classList.remove("hidden");
  setOverlayOpen(true);
}
function hideStats() {
  ui.statsOverlay.classList.add("hidden");
  setOverlayOpen(overlaysAnyOpen());
}

/* ---------------- Systems ---------------- */
const engine = makeMathEngine();
const diff = makeDifficultyManager();
const sfx = makeSound();

let stats = loadStats();
let garage = loadGarage();

const state = {
  running: false,
  paused: false,

  levelIndex: 0,
  adaptive: true,
  goal: "race",
  soundOn: false,

  score: 0,
  speed: 18,
  targetSpeed: 18,
  minSpeed: 10,
  maxSpeed: 32,

  carX: 0,
  carVX: 0,
  steer: 0,
  laneX: [-4.0, 0.0, 4.0],

  snapAssist: true,
  snapStrength: 18.0,
  snapDamping: 10.0,

  current: null,
  nextForkIn: 24,
  z: 0,

  shakeT: 0,
  shakeMag: 0,
  flashT: 0,
  flashGood: true,

  keys: { left:false, right:false },
  pointerSteer: { active:false, startX:0, lastX:0 },

  sessionWeakQueue: [],
};

/* ---------------- Three.js world ---------------- */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1020, 12, 120);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 1.25, 2.2);
camera.lookAt(0, 1.05, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x0b1020, 1);
document.getElementById("app").prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xaabbee, 0x111122, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(8, 10, 4);
scene.add(dir);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3f, roughness: 0.95, metalness: 0.05 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x11182a, roughness: 1, metalness: 0 });

const SEG_LEN = 18;
const SEG_COUNT = 10;

const roadGroup = new THREE.Group();
scene.add(roadGroup);
const roadSegments = [];
function makeRoadSegment(width, z) {
  const geo = new THREE.BoxGeometry(width, 0.2, SEG_LEN);
  const mesh = new THREE.Mesh(geo, roadMat);
  mesh.position.set(0, 0, z);
  return mesh;
}
for (let i=0;i<SEG_COUNT;i++){
  const z = -i * SEG_LEN;
  const seg = makeRoadSegment(14, z);
  roadGroup.add(seg);
  roadSegments.push(seg);
}
const groundGeo = new THREE.BoxGeometry(70, 0.25, SEG_LEN * SEG_COUNT);
const ground = new THREE.Mesh(groundGeo, grassMat);
ground.position.set(0, -0.25, -SEG_LEN * SEG_COUNT * 0.5);
scene.add(ground);

// Lane divider markers (dashed road paint)
const markerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.0 });
const markerGeo = new THREE.BoxGeometry(0.12, 0.01, 3.2);
const markers = [];
for (let i=0;i<18;i++){
  // lane dividers (left/right)
  for (const x of [-2.0, 2.0]) {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.position.set(x, 0.105, -i * 6);
    scene.add(m);
    markers.push(m);
  }
  // center dashed line
  const c = new THREE.Mesh(markerGeo, markerMat);
  c.scale.set(0.85, 1, 0.9);
  c.position.set(0.0, 0.105, -i * 6 - 3);
  scene.add(c);
  markers.push(c);
}

// Dashboard
const dashBase = new THREE.Mesh(
  new THREE.BoxGeometry(4.4, 0.5, 1.9),
  new THREE.MeshStandardMaterial({ color: 0x101320, roughness: 0.8 })
);
dashBase.position.set(0, 0.35, 1.4);
scene.add(dashBase);

// Billboards
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function makeBillboard(initialText) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext("2d");

  function draw(label, good=false) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, 8, 8, 240, 112, 18, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 4;
    roundRect(ctx, 8, 8, 240, 112, 18, false, true);
    ctx.fillStyle = good ? "#44ff88" : "#f4f6ff";
    ctx.font = "bold 52px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, canvas.width/2, canvas.height/2);
  }

  draw(initialText, false);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const geo = new THREE.PlaneGeometry(2.2, 1.1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = { tex, draw };
  return mesh;
}
const signL = makeBillboard("0");
const signM = makeBillboard("0");
const signR = makeBillboard("0");
scene.add(signL, signM, signR);

// Cones
const obstacleGroup = new THREE.Group();
scene.add(obstacleGroup);
const coneMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.7 });
const coneGeo = new THREE.ConeGeometry(0.25, 0.7, 14);
function makeCone(x, z) {
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(x, 0.35, z);
  cone.rotation.x = Math.PI;
  return cone;
}

const themeMgr = makeThemeManager({ scene, renderer, roadMat, grassMat });

/* ---------------- Cosmetics ---------------- */
function applyCarCosmetics() {
  const car = carById(garage.selected);
  ui.carName.textContent = car.name;
  dashBase.material.color.setHex(car.dashTint);
}
applyCarCosmetics();

/* ---------------- UI renderers ---------------- */
function setFeedback(msg, kind="neutral") {
  ui.feedback.textContent = msg;
  if (kind === "good") ui.feedback.style.color = "var(--good)";
  else if (kind === "bad") ui.feedback.style.color = "var(--bad)";
  else ui.feedback.style.color = "rgba(244,246,255,0.75)";
}
function showCenterMsg(text, ms=1000) {
  ui.centerMsg.textContent = text;
  ui.centerMsg.classList.remove("hidden");
  window.setTimeout(()=>ui.centerMsg.classList.add("hidden"), ms);
}

function fillLevelSelect() {
  ui.startLevel.innerHTML = "";
  for (const lvl of LEVELS) {
    const opt = document.createElement("option");
    opt.value = lvl.id;
    opt.textContent = `${lvl.id} — ${lvl.name}`;
    ui.startLevel.appendChild(opt);
  }
}
function computeRecommendedLevelId() {
  const total = stats.total.correct + stats.total.wrong;
  if (total < 20) return "K4";
  const acc = stats.total.correct / total;
  if (acc < 0.60) return "K5";
  if (acc < 0.75) return "G1-3";
  if (acc < 0.85) return "G2-1";
  return "G3-1";
}
function renderRecommended() {
  const rec = computeRecommendedLevelId();
  const lvl = LEVELS[getLevelIndexById(rec)];
  ui.recommended.textContent = `Recommended: ${lvl.id} — ${lvl.name}`;
}

function renderGarage() {
  const correctTotal = stats.total.correct;
  ui.garageSummary.textContent = `Total Correct: ${correctTotal}.`;
  ui.carGrid.innerHTML = "";

  for (const car of CARS) {
    const unlocked = isUnlocked(car, correctTotal);
    const selected = garage.selected === car.id;

    const card = document.createElement("div");
    card.className = "carCard";
    card.innerHTML = `
      <div class="name">${car.name}</div>
      <div class="req">${unlocked ? "Unlocked ✅" : `Locked 🔒 — need ${car.req.correctTotal} correct total`}</div>
    `;
    const btn = document.createElement("button");
    btn.textContent = selected ? "Selected" : (unlocked ? "Select" : "Locked");
    if (selected) btn.classList.add("primary");
    btn.disabled = !unlocked;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!unlocked) return;
      garage.selected = car.id;
      saveGarage(garage);
      applyCarCosmetics();
      renderGarage();
    });
    card.appendChild(btn);
    ui.carGrid.appendChild(card);
  }
}

function renderStats() {
  const total = stats.total.correct + stats.total.wrong;
  const acc = total ? Math.round((stats.total.correct / total) * 100) : 0;
  ui.statsSummary.textContent = `Total: ${total} • Accuracy: ${acc}% • Correct: ${stats.total.correct} • Wrong: ${stats.total.wrong}`;

  const weak = computeWeakFacts(stats, 14);
  ui.weakList.innerHTML = "";

  if (weak.length === 0) {
    ui.weakList.innerHTML = `<div class="factRow">No data yet — play a few rounds!</div>`;
    return;
  }

  for (const row of weak) {
    const pct = Math.round(row.acc * 100);
    const el = document.createElement("div");
    el.className = "factRow";

    const left = document.createElement("div");
    left.className = "factLeft";
    left.innerHTML = `
      <div>${formatFactKey(row.key)}</div>
      <div class="factMeta">Attempts: ${row.attempts} • Accuracy: ${pct}% • (C:${row.correct} / W:${row.wrong})</div>
    `;
    const right = document.createElement("div");
    right.textContent = (pct >= 80) ? "🙂" : (pct >= 60 ? "😐" : "⚠️");

    el.appendChild(left);
    el.appendChild(right);
    ui.weakList.appendChild(el);
  }
}

/* ---------------- Gameplay helpers ---------------- */
function cancelInput() {
  state.pointerSteer.active = false;
  state.steer = 0;
  state.keys.left = false;
  state.keys.right = false;
}
function currentLaneFromX(x) {
  const t = 2.0;
  if (x < -t) return "left";
  if (x > t) return "right";
  return "mid";
}
function laneCenterX(lane) {
  if (lane === "left") return state.laneX[0];
  if (lane === "right") return state.laneX[2];
  return state.laneX[1];
}
function nextForkDistance() {
  const base = (state.goal === "practice") ? 30 : 25;
  const hard = THREE.MathUtils.mapLinear(state.speed, state.minSpeed, state.maxSpeed, 0, 10);
  return Math.max((state.goal === "practice") ? 19 : 16, base - hard);
}
function cleanupObstacles() {
  // remove obstacles that passed the camera
  for (let i = obstacleGroup.children.length - 1; i >= 0; i--) {
    const o = obstacleGroup.children[i];
    if (o.position.z > 12) obstacleGroup.remove(o);
  }
}
function spawnForkCones(forkZ, correctLane) {
  cleanupObstacles();
  const wrong = ["left","mid","right"].filter(l => l !== correctLane);
  const lanePos = { left: state.laneX[0], mid: state.laneX[1], right: state.laneX[2] };
  const nearZ = forkZ + 1.6;

  for (const lane of wrong) {
    const x0 = lanePos[lane];
    for (let i=-1;i<=1;i++) obstacleGroup.add(makeCone(x0 + i*0.55, nearZ));
  }
}

/* ---------------- Weak weighting ---------------- */
function pickQuestionWeighted(level) {
  const now = performance.now();

  const due = state.sessionWeakQueue.filter(w => w.nextDueMs <= now);
  if (due.length > 0 && Math.random() < 0.55) {
    const item = due[Math.floor(Math.random() * due.length)];
    item.nextDueMs = now + 12000;
    const q = engine.questionFromKey(item.key);
    if (q && engine.isKeyCompatibleWithLevel(level, q.key)) return q;
  }

  const weakKeys = getWeakKeys(stats, 45).filter(k => engine.isKeyCompatibleWithLevel(level, k));
  if (weakKeys.length > 0 && Math.random() < 0.30) {
    const key = weakKeys[Math.floor(Math.random() * weakKeys.length)];
    const q = engine.questionFromKey(key);
    if (q) return q;
  }

  return engine.pickQuestion(level);
}

/* ---------------- Round logic ---------------- */
function applyLevelVisuals() {
  const lvl = LEVELS[state.levelIndex];
  ui.levelName.textContent = lvl.id;
  themeMgr.applyTheme(lvl.id, scene.fog);
  applyCarCosmetics();
}

function startRound() {
  const level = LEVELS[state.levelIndex];
  const q = pickQuestionWeighted(level);
  const choices = engine.makeChoices3(q);

  // Spawn the fork AHEAD of the camera (negative Z), then move everything toward the camera (+Z)
  const forkZ = -state.nextForkIn;

  state.current = { q, choices, forkZ, answered: false, shownAtMs: performance.now() };

  ui.question.textContent = q.text;
  setFeedback("Steer to the correct lane before the fork!");

  signL.userData.draw(String(choices.left), false); signL.userData.tex.needsUpdate = true;
  signM.userData.draw(String(choices.mid), false);  signM.userData.tex.needsUpdate = true;
  signR.userData.draw(String(choices.right), false);signR.userData.tex.needsUpdate = true;

  signL.position.set(state.laneX[0], 2.0, forkZ);
  signM.position.set(state.laneX[1], 2.0, forkZ);
  signR.position.set(state.laneX[2], 2.0, forkZ);

  spawnForkCones(forkZ, choices.correctLane);

  state.nextForkIn = nextForkDistance();
}

function resolveFork() {
  if (!state.current || state.current.answered) return;

  // When the signs reach near the camera, lock in the lane choice
  if (signM.position.z < -6.0) return;

  state.current.answered = true;

  const chosenLane = currentLaneFromX(state.carX);
  const isCorrect = chosenLane === state.current.choices.correctLane;
  const tSec = (performance.now() - state.current.shownAtMs) / 1000;

  recordAttempt(stats, state.current.q.key, isCorrect);
  saveStats(stats);

  diff.pushResult({ correct: isCorrect, timeSec: tSec });

  if (isCorrect) {
    state.score += 10;
    state.targetSpeed = Math.min(state.maxSpeed, state.targetSpeed + (state.goal === "practice" ? 1.1 : 1.7));
    setFeedback(`✅ Correct! +10  (${tSec.toFixed(1)}s)`, "good");
    state.flashT = 0.25; state.flashGood = true;
    if (state.soundOn) sfx.correctChime();
  } else {
    state.score = Math.max(0, state.score - 5);
    state.targetSpeed = Math.max(state.minSpeed, state.targetSpeed - (state.goal === "practice" ? 2.8 : 4.2));
    setFeedback(`❌ Correct was ${state.current.q.answer}  (${tSec.toFixed(1)}s)`, "bad");
    state.flashT = 0.25; state.flashGood = false;
    state.shakeT = 0.22; state.shakeMag = 0.22;
    if (state.soundOn) sfx.coneHit();

    const now = performance.now();
    const existing = state.sessionWeakQueue.find(x => x.key === state.current.q.key);
    if (existing) existing.nextDueMs = Math.min(existing.nextDueMs, now + 5000);
    else state.sessionWeakQueue.push({ key: state.current.q.key, nextDueMs: now + 5000 });
  }

  if (state.adaptive) {
    const before = state.levelIndex;
    const { newIndex, reason } = diff.maybeAdjustLevel({ levelIndex: state.levelIndex });
    if (newIndex !== before) {
      state.levelIndex = newIndex;
      applyLevelVisuals();
      const lvl = LEVELS[state.levelIndex];
      showCenterMsg(reason === "up" ? `Level Up → ${lvl.id}` : `Level Down → ${lvl.id}`, 900);
    }
  }

  // schedule next fork
  window.setTimeout(() => {
    if (state.running && !overlaysAnyOpen()) startRound();
  }, 520);
}


/* ---------------- Game start/stop ---------------- */
function resetRuntime() {
  state.score = 0;
  state.speed = (state.goal === "practice") ? 16 : 18;
  state.targetSpeed = state.speed;
  state.carX = 0; state.carVX = 0;
  state.z = 0;
  state.nextForkIn = nextForkDistance();
  state.sessionWeakQueue = [];
  diff.resetSession();
}

function startGameFromMenu() {
  cancelInput();

  state.levelIndex = getLevelIndexById(ui.startLevel.value);
  state.adaptive = ui.adaptiveOn.checked;
  state.goal = ui.goalMode.value;

  const prefs = loadPrefs();
  savePrefs({ ...prefs, startLevelId: ui.startLevel.value, adaptive: state.adaptive, goal: state.goal, soundOn: state.soundOn });

  applyLevelVisuals();
  hideStats(); hideGarage(); hideMenu();
  setOverlayOpen(false);

  resetRuntime();
  state.running = true;

  showCenterMsg("3 lanes + snap assist! Drag to steer. Let go to snap into a lane.", 1600);
  if (state.soundOn) sfx.startEngine();
  startRound();
}

function stopToMenu() {
  cancelInput();
  state.running = false;
  if (state.soundOn) sfx.stopEngine();
  renderRecommended();
  showMenu();
}

/* ---------------- Events ---------------- */
// menu buttons
ui.btnPlay.addEventListener("pointerdown", (e) => { e.preventDefault(); startGameFromMenu(); });
ui.btnGarage.addEventListener("pointerdown", (e) => { e.preventDefault(); renderGarage(); showGarage(); });
ui.btnStatsFromMenu.addEventListener("pointerdown", (e) => { e.preventDefault(); renderStats(); showStats(); });

// close buttons
ui.btnCloseGarage.addEventListener("pointerdown", (e) => { e.preventDefault(); hideGarage(); });
ui.btnCloseStats.addEventListener("pointerdown", (e) => { e.preventDefault(); hideStats(); });

// backdrop click closes (escape hatch)
ui.garageOverlay.addEventListener("pointerdown", (e) => { if (e.target === ui.garageOverlay) hideGarage(); });
ui.statsOverlay.addEventListener("pointerdown", (e) => { if (e.target === ui.statsOverlay) hideStats(); });

// hud buttons
ui.btnMenu.addEventListener("pointerdown", (e) => { e.preventDefault(); stopToMenu(); });
ui.btnStats.addEventListener("pointerdown", (e) => { 
  e.preventDefault();
  cancelInput();
  renderStats();
  showStats();
});

// reset stats
ui.btnResetStats.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resetStats();
  stats = loadStats();
  renderStats();
  renderGarage();
});

// sound
ui.btnSound.addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  state.soundOn = !state.soundOn;
  ui.soundState.textContent = state.soundOn ? "On" : "Off";
  savePrefs({ ...loadPrefs(), soundOn: state.soundOn });

  if (state.soundOn) {
    await sfx.resume();
    if (state.running) sfx.startEngine();
  } else {
    sfx.stopEngine();
  }
});

// fullscreen
ui.btnFullscreen.addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {}
});

// keyboard
window.addEventListener("keydown", (e) => {
  if (!state.running || overlaysAnyOpen()) return;
  if (e.key === "ArrowLeft" || e.key === "a") state.keys.left = true;
  if (e.key === "ArrowRight" || e.key === "d") state.keys.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a") state.keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d") state.keys.right = false;
});

// touch/mouse steering (no pointer capture; overlays disable input via body class)
ui.touchZone.addEventListener("pointerdown", (e) => {
  if (!state.running || overlaysAnyOpen()) return;
  state.pointerSteer.active = true;
  state.pointerSteer.startX = e.clientX;
  state.pointerSteer.lastX = e.clientX;
});
ui.touchZone.addEventListener("pointermove", (e) => {
  if (!state.pointerSteer.active) return;
  state.pointerSteer.lastX = e.clientX;
  const dx = state.pointerSteer.lastX - state.pointerSteer.startX;
  state.steer = THREE.MathUtils.clamp(dx / 140, -1, 1);
});
ui.touchZone.addEventListener("pointerup", () => { state.pointerSteer.active = false; state.steer = 0; });
ui.touchZone.addEventListener("pointercancel", () => { state.pointerSteer.active = false; state.steer = 0; });

// big buttons
function setKeySteer(left, right) { state.keys.left = left; state.keys.right = right; }
ui.btnLeft.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!state.running || overlaysAnyOpen()) return; setKeySteer(true,false); });
ui.btnLeft.addEventListener("pointerup", () => setKeySteer(false,false));
ui.btnLeft.addEventListener("pointercancel", () => setKeySteer(false,false));
ui.btnRight.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!state.running || overlaysAnyOpen()) return; setKeySteer(false,true); });
ui.btnRight.addEventListener("pointerup", () => setKeySteer(false,false));
ui.btnRight.addEventListener("pointercancel", () => setKeySteer(false,false));

// resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- Animation loop ---------------- */
let last = performance.now();

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // render even in menu
  if (!state.running || overlaysAnyOpen()) {
    renderer.render(scene, camera);
    return;
  }

  const kbSteer = (state.keys.left ? -1 : 0) + (state.keys.right ? 1 : 0);
  const inputSteer = (kbSteer !== 0) ? kbSteer : state.steer;

  // speed
  state.speed = THREE.MathUtils.damp(state.speed, state.targetSpeed, 3.2, dt);

  if (state.soundOn) {
    sfx.setEngineBySpeed((state.speed - state.minSpeed) / (state.maxSpeed - state.minSpeed));
  }

  // lateral
  const accel = 18.0;
  state.carVX += inputSteer * accel * dt;
  state.carVX *= Math.pow(0.0007, dt);

  const steeringActive = Math.abs(inputSteer) > 0.12 || state.pointerSteer.active;
  if (!steeringActive && state.snapAssist) {
    const lane = currentLaneFromX(state.carX);
    const tx = laneCenterX(lane);
    const ax = (tx - state.carX) * state.snapStrength - state.carVX * state.snapDamping;
    state.carVX += ax * dt;
  }

  state.carX += state.carVX * dt;
  state.carX = THREE.MathUtils.clamp(state.carX, -6.0, 6.0);

  // forward
  state.z -= state.speed * dt;

  for (const seg of roadSegments) {
    seg.position.z += state.speed * dt;
    // wrap segments back in front
    if (seg.position.z > SEG_LEN) seg.position.z -= SEG_LEN * SEG_COUNT;
  }
  for (const m of markers) {
    m.position.z += state.speed * dt;
    if (m.position.z > 6) m.position.z -= 6 * 18;
  }
  for (const o of obstacleGroup.children) o.position.z += state.speed * dt;

  signL.position.z += state.speed * dt;
  signM.position.z += state.speed * dt;
  signR.position.z += state.speed * dt;

  // cone collision
  for (const o of obstacleGroup.children) {
    const dx = o.position.x - state.carX;
    const dz = o.position.z - (camera.position.z - 1.0);
    if (Math.abs(dz) < 0.6 && Math.abs(dx) < 0.6) {
      state.shakeT = 0.18; state.shakeMag = 0.25;
      state.targetSpeed = Math.max(state.minSpeed, state.targetSpeed - 3.5);
      o.position.z += 2.0;
      if (state.soundOn) sfx.coneHit();
      break;
    }
  }

  // camera
  const bob = 0.03 * Math.sin(now * 0.012);
  const roll = THREE.MathUtils.clamp(-state.carVX * 0.02, -0.12, 0.12);
  camera.position.x = THREE.MathUtils.damp(camera.position.x, state.carX * 0.18, 10, dt);
  camera.position.y = 1.25 + bob;
  camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, roll, 10, dt);

  if (state.shakeT > 0) {
    state.shakeT -= dt;
    const s = state.shakeMag * (state.shakeT / 0.2);
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }

  if (state.flashT > 0) {
    state.flashT -= dt;
    const t = state.flashT / 0.25;
    const c = state.flashGood ? 0x0e1f18 : 0x240b14;
    renderer.setClearColor(c, 1 - t * 0.65);
  }

  resolveFork();

  ui.speed.textContent = Math.round(state.speed * 6);
  ui.score.textContent = state.score;

  renderer.render(scene, camera);
}

/* ---------------- Boot ---------------- */
function boot() {
  // never start with stats open
  ui.statsOverlay.classList.add("hidden");
  ui.garageOverlay.classList.add("hidden");
  ui.menuOverlay.style.display = "grid";
  setOverlayOpen(true);

  fillLevelSelect();
  const prefs = loadPrefs();
  ui.startLevel.value = prefs.startLevelId;
  ui.adaptiveOn.checked = prefs.adaptive;
  ui.goalMode.value = prefs.goal;
  state.soundOn = prefs.soundOn;
  ui.soundState.textContent = state.soundOn ? "On" : "Off";

  renderRecommended();
  renderGarage();
  renderStats();

  applyLevelVisuals();
  state.running = false;
  ui.question.textContent = "Choose a level and press Play";
  setFeedback("");

  requestAnimationFrame(step);
}

boot();
