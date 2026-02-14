// main.js (Landing Room)
// - Circular room with 10 static doors
// - Door names rendered ON the door (CanvasTexture label)
// - Drag to look around (same-direction drag)
// - Tap (not drag-release) selects a door
// - After drag ends, camera snaps slightly toward nearest door
// - Camera starts facing the first game door
// - Clicking a door pans to THAT door (not opposite) and stays locked on it
// - Removed Reset/Check buttons (landing room has only spin + center UI)
// - Small guide figure in the center

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// ---- EDIT THESE: your games ----
const GAMES = [
  { title: "Fix the Bridge", url: "./bridge/" },
  { title: "Math Ninja", url: "./ninja/" },
  { title: "Game 3", url: "./games/game3/" },
  { title: "Game 4", url: "./games/game4/" },
  { title: "Game 5", url: "./games/game5/" },
  { title: "Game 6", url: "./games/game6/" },
  { title: "Game 7", url: "./games/game7/" },
  { title: "Game 8", url: "./games/game8/" },
  { title: "Game 9", url: "./games/game9/" },
  { title: "Game 10", url: "./games/game10/" },
];

// ---- DOM ----
const canvas = document.getElementById("c");
const toast = document.getElementById("toast");

// Optional buttons in your landing index.html (spin + center)
const btnSpinLeft = document.getElementById("spinLeft");
const btnSpinRight = document.getElementById("spinRight");
const btnHome = document.getElementById("home");

// Accessibility/fallback links
const links = document.getElementById("links");
if (links) {
  links.innerHTML = "";
  GAMES.forEach((g, i) => {
    const a = document.createElement("a");
    a.href = g.url;
    a.textContent = `${i + 1}. ${g.title}`;
    links.appendChild(a);
  });
}

// ---- Three.js setup ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x87cffa, 1);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(0, 2.3, 9.5);
camera.lookAt(0, 1.6, 0);

// Lights
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xb6f0c2, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d2, 1.0);
sun.position.set(6, 10, 4);
scene.add(sun);

// Floor
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(22, 64),
  new THREE.MeshStandardMaterial({ color: 0xf7f3ff, roughness: 0.95, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// Room wall (inverted cylinder)
const wall = new THREE.Mesh(
  new THREE.CylinderGeometry(18, 18, 8.5, 64, 1, true),
  new THREE.MeshStandardMaterial({
    color: 0xd9f3ff,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.BackSide,
  })
);
wall.position.y = 4.25;
scene.add(wall);

// Ceiling ring (subtle motion)
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(18, 0.18, 18, 100),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 })
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 8.2;
scene.add(ring);

// Center pedestal
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.0, 1.2, 0.35, 32),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
);
pedestal.position.y = 0.18;
scene.add(pedestal);

// ---- Small guide figure ----
function addCenterGuideFigure() {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.55, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.75 })
  );
  body.position.y = 0.85;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xfff2d2, roughness: 0.7 })
  );
  head.position.y = 1.35;
  group.add(head);

  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.26, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x7bb6ff, roughness: 0.6 })
  );
  pack.position.set(0, 0.92, -0.22);
  group.add(pack);

  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.75 })
  );
  arm.position.set(0.35, 1.05, 0.0);
  arm.rotation.z = -0.9;
  arm.rotation.x = 0.2;
  group.add(arm);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), eyeMat);
  const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), eyeMat);
  e1.position.set(-0.08, 1.38, 0.24);
  e2.position.set(0.08, 1.38, 0.24);
  group.add(e1, e2);

  scene.add(group);
  return group;
}
const guide = addCenterGuideFigure();

// ---- Doors ----
const doorGroup = new THREE.Group();
scene.add(doorGroup);

const doors = [];
const DOOR_COUNT = GAMES.length;

const R = 15.6;
const DOOR_Y = 1.25;
const DOOR_W = 2.6;
const DOOR_H = 4.0;
const DOOR_D = 0.25;

// Static door color (no changing)
const DOOR_PANEL_MAT = new THREE.MeshStandardMaterial({
  color: 0x6bb7ff,
  roughness: 0.55,
  metalness: 0.05,
});

function createLabelTexture(text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");

  // Transparent label with rounded white plate
  ctx.clearRect(0, 0, c.width, c.height);

  const pad = 22;
  const r = 28;
  const w = c.width - pad * 2;
  const h = c.height - pad * 2;

  // rounded rect
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.lineTo(pad + w - r, pad);
  ctx.quadraticCurveTo(pad + w, pad, pad + w, pad + r);
  ctx.lineTo(pad + w, pad + h - r);
  ctx.quadraticCurveTo(pad + w, pad + h, pad + w - r, pad + h);
  ctx.lineTo(pad + r, pad + h);
  ctx.quadraticCurveTo(pad, pad + h, pad, pad + h - r);
  ctx.lineTo(pad, pad + r);
  ctx.quadraticCurveTo(pad, pad, pad + r, pad);
  ctx.closePath();
  ctx.fill();

  // text (auto shrink a bit if long)
  const maxChars = 14;
  let fontSize = 64;
  if (text.length > maxChars) fontSize = 52;

  ctx.fillStyle = "#000000";
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

for (let i = 0; i < DOOR_COUNT; i++) {
  const angle = (i / DOOR_COUNT) * Math.PI * 2;

  const door = new THREE.Group();
  door.userData = { index: i, url: GAMES[i].url, title: GAMES[i].title };

  // frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W + 0.18, DOOR_H + 0.22, DOOR_D + 0.06),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.08 })
  );
  frame.position.y = DOOR_H / 2;
  door.add(frame);

  // panel
  const panel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, DOOR_D), DOOR_PANEL_MAT);
  panel.position.y = DOOR_H / 2;
  panel.position.z = 0.03;
  door.add(panel);

  // label
  const labelTex = createLabelTexture(GAMES[i].title);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_W * 0.86, DOOR_H * 0.36),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
  );
  label.position.set(0, DOOR_H * 0.68, 0.16);
  door.add(label);

  // knob
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xffd36a, roughness: 0.35, metalness: 0.25 })
  );
  knob.position.set(DOOR_W * 0.35, DOOR_H * 0.45, 0.18);
  door.add(knob);

  // place around circle facing inward
  door.position.set(Math.sin(angle) * R, DOOR_Y, Math.cos(angle) * R);
  door.lookAt(0, DOOR_Y + 1.6, 0);

  doorGroup.add(door);
  doors.push(door);
}

// ---- Camera orbit controls ----
let yaw = 0;
let pitch = 0.10;
const PITCH_MIN = -0.08;
const PITCH_MAX = 0.36;
const CAM_R = 9.5;

// Always look to center
function updateCamera() {
  const y = 1.9 + pitch * 6.0;
  const x = Math.sin(yaw) * CAM_R;
  const z = Math.cos(yaw) * CAM_R;
  camera.position.set(x, y, z);
  camera.lookAt(0, 1.6, 0);
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function nearestDoorFacingYaw() {
  let bestYaw = yaw;
  let bestDist = Infinity;

  for (const d of doors) {
    const p = d.position;
    const target = normalizeAngle(Math.atan2(p.x, p.z) + Math.PI); // camera faces door
    const dist = Math.abs(normalizeAngle(target - yaw));

    if (dist < bestDist) {
      bestDist = dist;
      bestYaw = target;
    }
  }
  return bestYaw;
}


// Snap state (slight snap)
let snapActive = false;
let snapFromYaw = 0;
let snapToYaw = 0;
let snapT = 0;
const SNAP_TIME = 0.18;      // seconds

// Tap-vs-drag logic
let dragging = false;
let lastX = 0;
let lastY = 0;

let downX = 0;
let downY = 0;
let downTime = 0;
const TAP_MAX_MOVE = 10; // px
const TAP_MAX_MS = 300;  // ms

let cameraLocked = false;

// Raycast
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Enter animation (pan to door then navigate)
let entering = false;
let enterT = 0;
let enterFromYaw = 0;
let enterToYaw = 0;
let enterUrl = "#";

function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 850);
}

function startEnterDoor(door) {
  if (entering) return;

  const p = door.position.clone();

  // IMPORTANT: camera must be opposite the door to face it
  const targetYaw = normalizeAngle(Math.atan2(p.x, p.z) + Math.PI);

  entering = true;
  enterT = 0;
  enterFromYaw = yaw;

  // shortest rotation
  let d = normalizeAngle(targetYaw - yaw);
  enterToYaw = normalizeAngle(yaw + d);

  enterUrl = door.userData.url;
  showToast(`Entering: ${door.userData.title}`);

  cameraLocked = true;
  snapActive = false;
}

function attemptDoorPick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  mouse.set(x, y);

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(doorGroup.children, true);
  if (!hits.length) return;

  // climb to top-level door group under doorGroup
  let obj = hits[0].object;
  while (obj && obj.parent && obj.parent !== doorGroup) obj = obj.parent;
  if (obj) startEnterDoor(obj);
}

// Pointer controls: drag to rotate, tap to select door
function onDown(e) {
  snapActive = false;
  cameraLocked = false; // user is taking control

  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;

  downX = e.clientX;
  downY = e.clientY;
  downTime = performance.now();

  canvas.setPointerCapture(e.pointerId);
}

function onMove(e) {
  if (!dragging) return;
  if (entering) return;
  if (cameraLocked) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  // Same-direction drag feel
  yaw += dx * 0.006;
  pitch += dy * 0.003;
  pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));

  updateCamera();
}

function onUp(e) {
  if (!dragging) return;
  dragging = false;

  try { canvas.releasePointerCapture(e.pointerId); } catch {}

  // TAP detection (separate from drag-release)
  const upTime = performance.now();
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  const dist = Math.hypot(dx, dy);
  const dt = upTime - downTime;
  const isTap = dist <= TAP_MAX_MOVE && dt <= TAP_MAX_MS;

  if (isTap && !entering) {
    attemptDoorPick(e);
    return;
  }

  // After drag ends, gently snap slightly toward nearest door
  if (!entering && !cameraLocked) {
    snapActive = true;
    snapT = 0;
    snapFromYaw = yaw;

    snapToYaw = nearestDoorFacingYaw(); // snap directly to facing the nearest door

  }
}

canvas.addEventListener("pointerdown", onDown, { passive: true });
canvas.addEventListener("pointermove", onMove, { passive: true });
canvas.addEventListener("pointerup", onUp, { passive: true });
canvas.addEventListener("pointercancel", onUp, { passive: true });
canvas.style.touchAction = "none";

// Buttons
btnSpinLeft?.addEventListener("click", () => { cameraLocked = false; snapActive = false; yaw += Math.PI / 5; updateCamera(); });
btnSpinRight?.addEventListener("click", () => { cameraLocked = false; snapActive = false; yaw -= Math.PI / 5; updateCamera(); });
btnHome?.addEventListener("click", () => { cameraLocked = false; snapActive = false; yaw = 0; pitch = 0.10; updateCamera(); });

// Resize
function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize, { passive: true });
resize();

// Start facing first door
{
  const p0 = doors[0].position.clone();
  yaw = normalizeAngle(Math.atan2(p0.x, p0.z) + Math.PI);
  pitch = 0.12;
  updateCamera();
}

// Animation
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // subtle life: ceiling ring + guide sway
  ring.rotation.z += dt * 0.15;
  guide.rotation.y = Math.sin(now * 0.001) * 0.15;
  guide.position.y = Math.abs(Math.sin(now * 0.0012)) * 0.03;

  // Gentle yaw snap after drag ends
  if (snapActive && !entering && !cameraLocked) {
    snapT = Math.min(1, snapT + dt / SNAP_TIME);
    const s = snapT * snapT * (3 - 2 * snapT);

    const d = normalizeAngle(snapToYaw - snapFromYaw);
    yaw = normalizeAngle(snapFromYaw + d * s);
     pitch = 0.12; // optional but nice

    updateCamera();

    if (snapT >= 1) snapActive = false;
  }

  // Enter animation: rotate to door then navigate
  if (entering) {
    enterT = Math.min(1, enterT + dt / 0.35);
    const t = enterT;
    const s = t * t * (3 - 2 * t);

    const d = normalizeAngle(enterToYaw - enterFromYaw);
    yaw = normalizeAngle(enterFromYaw + d * s);

    // keep pitch stable
    pitch = 0.12;
    updateCamera();

    if (enterT >= 1) {
      yaw = enterToYaw;
      updateCamera();
      entering = false;

      if (enterUrl && enterUrl !== "#") window.location.href = enterUrl;
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
