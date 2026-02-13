export function createInput({ canvas, world, game }) {
  const { THREE } = world;

  // Smooth rotation feel while dragging
  const ROT_SPEED_Y = 0.010;
  const ROT_SPEED_X = 0.010;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function pointerDown(e) {
    if (game.isPlaced()) return;
    e.preventDefault();

    // Cancel any snap easing when user grabs again
    game.cancelSnap();

    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;

    game.ui.clearMsg();
    canvas.setPointerCapture(e.pointerId);
  }

  function pointerMove(e) {
    if (!dragging || game.isPlaced()) return;
    e.preventDefault();

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const dqY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * ROT_SPEED_Y);
    const dqX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * ROT_SPEED_X);

    // world-axis rotation
    game.looseCube.quaternion.premultiply(dqX);
    game.looseCube.quaternion.premultiply(dqY);
  }

  function pointerUp(e) {
    if (!dragging) return;
    e.preventDefault();

    dragging = false;

    // Start 150ms snap easing and place when done
    game.startSnapAndPlace(performance.now());

    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  canvas.addEventListener("pointerdown", pointerDown, { passive: false });
  canvas.addEventListener("pointermove", pointerMove, { passive: false });
  canvas.addEventListener("pointerup", pointerUp, { passive: false });
  canvas.addEventListener("pointercancel", pointerUp, { passive: false });

  // Keyboard: arrows rotate/flip; Enter attempts place (via snap+place)
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft")  { e.preventDefault(); game.applyWorldQuarterTurn("y", -1); }
    if (e.key === "ArrowRight") { e.preventDefault(); game.applyWorldQuarterTurn("y", +1); }
    if (e.key === "ArrowUp")    { e.preventDefault(); game.applyWorldQuarterTurn("x", -1); }
    if (e.key === "ArrowDown")  { e.preventDefault(); game.applyWorldQuarterTurn("x", +1); }
    if (e.key === "Enter")      { e.preventDefault(); game.startSnapAndPlace(performance.now()); }
  });
}
