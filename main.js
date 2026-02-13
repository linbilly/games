import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// ---- Edit these: your 10 games ----
const GAMES = [
  { title: "Fix the Bridge", url: "./bridge/" },
  { title: "Math Ninja", url: "./ninja/" },
  { title: "Game 3", url: "#" },
  { title: "Game 4", url: "#" },
  { title: "Game 5", url: "#" },
  { title: "Game 6", url: "#" },
  { title: "Game 7", url: "#" },
  { title: "Game 8", url: "#" },
  { title: "Game 9", url: "#" },
  { title: "Game 10", url: "#" },
];

const DOOR_COLORS = [
  0x6bb7ff, 0x6bb7ff, 0x6bb7ff, 0x6bb7ff, 0x6bb7ff,
  0x6bb7ff, 0x6bb7ff, 0x6bb7ff, 0x6bb7ff, 0x6bb7ff,
];


const canvas = document.getElementById("c");
const toast = document.getElementById("toast");

// Accessibility/fallback links
const links = document.getElementById("links");
GAMES.forEach((g, i) => {
  const a = document.createElement("a");
  a.href = g.url;
  a.textContent = `${i + 1}. ${g.title}`;
  links.appendChild(a);
});

// Scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x87cffa, 1);

const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(0, 2.3, 9.5);
camera.lookAt(0, 1.6, 0);

let yaw = 0;
let pitch = 0.10;
const PITCH_MIN = -0.08;
const PITCH_MAX = 0.36;
const CAM_R = 9.5;

function updateCamera() {
  const y = 1.9 + pitch * 6.0;
  const x = Math.sin(yaw) * CAM_R;
  const z = Math.cos(yaw) * CAM_R;
  camera.position.set(x, y, z);
  camera.lookAt(0, 1.6, 0);
}


// Lights (warm + soft)
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xb6f0c2, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d2, 1.0);
sun.position.set(6, 10, 4);
scene.add(sun);

// Floor (friendly)
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(22, 64),
  new THREE.MeshStandardMaterial({ color: 0xf7f3ff, roughness: 0.95, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// Circular room wall (inverted cylinder)
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

// Decorative “ceiling ring”
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(18, 0.18, 18, 100),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 })
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 8.2;
scene.add(ring);

// ---- Door group ----
const doorGroup = new THREE.Group();
scene.add(doorGroup);

const doors = [];
const DOOR_COUNT = GAMES.length;
const R = 15.6;
const DOOR_Y = 1.25;
const DOOR_W = 2.6;
const DOOR_H = 4.0;
const DOOR_D = 0.25;

function makeDoorMaterial(i) {
  const hues = [0.62, 0.98, 0.10, 0.40, 0.78, 0.16, 0.52, 0.88, 0.30, 0.70];
  const c = new THREE.Color().setHSL(hues[i % hues.length], 0.55, 0.62);
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.55,
    metalness: 0.05,
  });
}

// Create a canvas texture for door label
function createLabelTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 64px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

for (let i = 0; i < DOOR_COUNT; i++) {
  const angle = (i / DOOR_COUNT) * Math.PI * 2;

  const door = new THREE.Group();
  door.userData = {
    index: i,
    url: GAMES[i].url,
    title: GAMES[i].title,
  };

  // Door frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W + 0.18, DOOR_H + 0.22, DOOR_D + 0.06),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  frame.position.y = DOOR_H / 2;
  door.add(frame);

  // Door panel
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W, DOOR_H, DOOR_D),
    makeDoorMaterial(i)
  );
  panel.position.y = DOOR_H / 2;
  panel.position.z = 0.03;
  panel.name = "DoorPanel";
  door.add(panel);

  // Label plane
  const labelTexture = createLabelTexture(GAMES[i].title);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_W * 0.8, DOOR_H * 0.4),
    new THREE.MeshBasicMaterial({ map: labelTexture })
  );
  label.position.set(0, DOOR_H * 0.65, 0.16);
  door.add(label);

  // Knob
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xffd36a })
  );
  knob.position.set(DOOR_W * 0.35, DOOR_H * 0.45, 0.18);
  door.add(knob);

  // Position around circle
  door.position.set(
    Math.sin(angle) * R,
    DOOR_Y,
    Math.cos(angle) * R
  );

  door.lookAt(0, DOOR_Y + 1.6, 0);

  doorGroup.add(door);
  doors.push(door);
}

// Soft “center pedestal” to orient kids
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.0, 1.2, 0.35, 32),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
);
pedestal.position.y = 0.18;
scene.add(pedestal);

// ---- Input: drag to rotate camera around center ----
let dragging = false;
let lastX = 0;
let lastY = 0;

// Tap-vs-drag tracking
let downX = 0;
let downY = 0;
let downTime = 0;
const TAP_MAX_MOVE = 10;   // px
const TAP_MAX_MS = 300;    // ms

// Camera lock after selecting a door
let cameraLocked = false;

function onDown(e) {
  // If user starts dragging after a door selection, unlock camera
  cameraLocked = false;

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
  if (entering) return;         // ignore manual drag during enter animation
  if (cameraLocked) return;     // ignore drag while locked on a door

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  yaw += dx * 0.006;
  pitch += dy * 0.003;
  pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
  updateCamera();
}

function onUp(e) {
  if (!dragging) return;
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}

  // Decide if this was a TAP (not a drag)
  const upTime = performance.now();
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  const dist = Math.hypot(dx, dy);
  const dt = upTime - downTime;

  const isTap = dist <= TAP_MAX_MOVE && dt <= TAP_MAX_MS;

  // Only attempt door selection on a tap (separate click)
  if (isTap && !entering) {
    attemptDoorPick(e);
  }
}

canvas.addEventListener("pointerdown", onDown, { passive: true });
canvas.addEventListener("pointermove", onMove, { passive: true });
canvas.addEventListener("pointerup", onUp, { passive: true });
canvas.addEventListener("pointercancel", onUp, { passive: true });
canvas.style.touchAction = "none";


// ---- Click a door (raycast) ----
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let entering = false;
let enterT = 0;
let enterFromYaw = 0;
let enterToYaw = 0;
let enterUrl = "#";

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 850);
}

function startEnterDoor(door) {
  if (entering) return;
  const p = door.position.clone();

  // desired yaw so camera faces that door
  const targetYaw = Math.atan2(p.x, p.z) + Math.PI; // because doors are on (sin*R, cos*R)

  entering = true;
  enterT = 0;
  enterFromYaw = yaw;
  // choose shortest rotation direction
  let d = targetYaw - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  enterToYaw = yaw + d;

  enterUrl = door.userData.url;
  showToast(`Entering: ${door.userData.title}`);
}

function attemptDoorPick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  mouse.set(x, y);

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(doorGroup.children, true);

  if (!hits.length) return;

  // climb to the top-level door group under doorGroup
  let obj = hits[0].object;
  while (obj && obj.parent && obj.parent !== doorGroup) obj = obj.parent;

  if (obj) {
    startEnterDoor(obj);

    // Lock camera so it stays on the clicked door (no drift)
    cameraLocked = true;
  }
}



// Buttons
document.getElementById("spinLeft").addEventListener("click", () => { yaw += Math.PI / 5; updateCamera(); });
document.getElementById("spinRight").addEventListener("click", () => { yaw -= Math.PI / 5; updateCamera(); });
document.getElementById("home").addEventListener("click", () => {
  cameraLocked = false;
  yaw = 0;
  pitch = 0.10;
  updateCamera();
});

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
updateCamera();

// Animation
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // subtle room “life”
  ring.rotation.z += dt * 0.15;


  // enter animation (turn to door then navigate)
  if (entering) {
    enterT = Math.min(1, enterT + dt / 0.35);
    const t = enterT;
    // smoothstep
    const s = t * t * (3 - 2 * t);
    yaw = enterFromYaw + (enterToYaw - enterFromYaw) * s;
    pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch)); // keep current pitch
    updateCamera();


    if (enterT >= 1) {
      entering = false;
      // navigate
      if (enterUrl && enterUrl !== "#") window.location.href = enterUrl;
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
