// main.js
import { createWorld } from "./scene.js";
import { createUI } from "./ui.js";
import { createGame } from "./game.js";
import { addHappyWorld } from "./worldDecor.js";
import { createInput } from "./input.js";

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";

const world = createWorld();
const ui = createUI();

// --- Ensure canvas exists + is attached + is interactive ---
const canvas = world?.renderer?.domElement;
if (!canvas) {
  console.error("No renderer.domElement found. Did createWorld() create a renderer?");
} else {
  if (!canvas.parentElement) document.body.appendChild(canvas);

  // Fullscreen canvas behind UI
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.zIndex = "0";
  canvas.style.display = "block";

  // Critical for iPad drag gestures
  canvas.style.touchAction = "none";
  canvas.style.pointerEvents = "auto";

  // Optional: make canvas focusable (helps if you later move key handling off window)
  canvas.tabIndex = 0;
  canvas.style.outline = "none";
  canvas.addEventListener("pointerdown", () => canvas.focus(), { passive: true });
}

// Keep UI above canvas (and don’t block pointer events outside controls)
const uiRoot = document.getElementById("ui") || document.querySelector(".ui");
if (uiRoot) {
  uiRoot.style.position = "fixed";
  uiRoot.style.left = "0";
  uiRoot.style.top = "0";
  uiRoot.style.zIndex = "10";

  // Let the canvas receive drags except on actual UI controls
  uiRoot.style.pointerEvents = "none";
  uiRoot.querySelectorAll("button, input, select, a").forEach((el) => {
    el.style.pointerEvents = "auto";
  });
}

// Renderer defaults
if (world?.renderer) {
  world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  world.renderer.setClearColor(0x87cefa, 1);
}

// Camera sanity (don’t clip the sky dome)
if (world?.camera) {
  world.camera.near = 0.1;
  world.camera.far = 2000;
  world.camera.position.set(4.5, 4.2, 7.5);
  world.camera.lookAt(0, 0.9, 0);
  world.camera.updateProjectionMatrix();
}

// Decor + game
const decor = addHappyWorld(world);
const game = createGame({ world, ui, decor });

// Tap anywhere while the bot is walking to advance to next level.
// Ignore taps on UI elements.
window.addEventListener("pointerdown", (e) => {
  const uiEl = document.getElementById("ui");
  if (uiEl && uiEl.contains(e.target)) return;

  if (game?.isWalking?.()) {
    game.goNextLevel();
  }
}, { passive: true });


// ✅ INPUT WIRING (this is what was missing)
if (canvas) createInput({ canvas, world, game });

// Resize (true updates drawing buffer)
function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);

  world?.renderer?.setSize(w, h, true);

  if (world?.camera) {
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
  }
}
window.addEventListener("resize", resize, { passive: true });
resize();

// Loop
let lastNow = performance.now();
function loop(now) {
  requestAnimationFrame(loop);

  const dt = Math.min(0.033, (now - lastNow) / 1000);
  lastNow = now;

  decor?.update?.(dt, now / 1000);
  game?.update?.(now, dt);

  world?.renderer?.render(world.scene, world.camera);
}
requestAnimationFrame(loop);
