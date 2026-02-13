// game.js
// HARD-CODED LEVELS + HARD-CODED "CORRECT" ORIENTATION
// A level is solved if the loose cube's orientation matches the level's target orientation
// (within the 24 cube orientations).
//
// You also asked: per level, one side-color "skin" for ALL cubes, and the exact 3D orientation
// of each of the 8 bridge cubes.
//
// Notes:
// - We rotate the WHOLE cube mesh (quaternion). We do NOT rotate the road overlay via rotQuarter.
//   This keeps roads + side colors consistent.
// - Bridge cubes are placed at integer grid coords (x,z) around a gap at (0,0).
// - The loose cube floats above the gap while dragging; when "locked" it snaps into the gap.
//
// input.js compatibility:
// - Exposes: update(now, dt), looseCube, startSnapAndPlace(now), applyWorldQuarterTurn(axis, dir), cancelSnap()

import { buildCubeOrientations, snapToNearestCubeOrientation, easeOutCubic } from "./math3d.js";
import { makeTileCube } from "./cube.js";
import { makeCuteBot, animateBot } from "./character.js";
import { createFireworks } from "./effects.js";

// ----------------------------
// Level Authoring
// ----------------------------
//
// rot format:
//   rot: { x:0..3, y:0..3, z:0..3 } quarter turns about WORLD X/Y/Z.
// applied as q = Qz * Qy * Qx.
//
// To author a level:
// 1) Set `skin` (side colors) for all cubes
// 2) Provide exactly 8 bridge cubes with {x,z,tile,rot}
// 3) Provide loose cube {tile,startRot}
// 4) Provide `targetRot` (the "correct" orientation). If loose matches this, level is solved.
//
// OPTIONAL: If you want the loose cube to be correct after snapping to nearest 24 orientations,
// make sure targetRot is one of the 24 (any combination of quarter-turn rotations is).
//
const LEVELS = [
    
    

  {
    name: "Level 1: Line Up the Road",
    skin: { PX: 0x2d7dff, NX: 0xff3b3b, PZ: 0x2ee59d, NZ: 0xb56bff },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 0, y: 0, z: 0 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 1, z: 0 },
  },

  {
    name: "Level 2: Line Up the Road",
    skin: { PX: 0x7b61ff, NX: 0xffd400, PZ: 0x00d084, NZ: 0xff5a5f },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 0, y: 0, z: 0 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 1, z: 0 },
  },
    {
    name: "Level 3: Line Up the Road",
    skin:   { PX: 0x2d7dff, NX: 0xff3b3b, PZ: 0x2ee59d, NZ: 0xb56bff },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 1, y: 1, z: 3 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 1, z: 0 },
  },

  {
    name: "Level 3: Where's the road?",
    skin: { PX: 0xf5426f, NX: 0x2dd4ff, PZ: 0xffd166, NZ: 0x9dff7c },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 0, y: 0, z: 1 },
    },

    targetRot: { x: 2, y: 1, z: 0 },
  },
    
    {
    name: "Level 4: Where's the road?",
    skin: { PX: 0xff7a00, NX: 0x00c2ff, PZ: 0xff2d95, NZ: 0x7cff00 },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 2, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 1, y: 0, z: 1 },
    },

    targetRot: { x: 2, y: 1, z: 0 },
  },

{
    name: "Level 5: Find the Pattern",
    skin: { PX: 0x7b61ff, NX: 0xffd400, PZ: 0x00d084, NZ: 0xff5a5f },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 1, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 0, y: 0, z: 0 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 1, z: 0 },
  },

  {
    name: "Level 6: Find the Pattern",
    skin: { PX: 0x7b61ff, NX: 0xffd400, PZ: 0x00d084, NZ: 0xff5a5f },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 0, z: 1 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 2, y: 0, z: 0 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 2, z: 0 },
  },

  {
    name: "Level 7: Find the Pattern",
    skin: { PX: 0x7b61ff, NX: 0xffd400, PZ: 0x00d084, NZ: 0xff5a5f },

    bridge: [
      { x: -4, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x: -3, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x: -2, z: 0, tile: "straight", rot: { x: 0, y: 3, z: 1 } },
      { x: -1, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x:  1, z: 0, tile: "straight", rot: { x: 0, y: 3, z: 1 } },
      { x:  2, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x:  3, z: 0, tile: "straight", rot: { x: 0, y: 2, z: 0 } },
      { x:  4, z: 0, tile: "straight", rot: { x: 0, y: 3, z: 1 } },
    ],

    loose: {
      tile: "straight",
      startRot: { x: 2, y: 0, z: 0 },
    },

    // ✅ Winning orientation (you set this)
    targetRot: { x: 0, y: 2, z: 0 },
  },

];

// ----------------------------
// Game
// ----------------------------
export function createGame({ world, ui, decor }) {
  const { THREE, scene } = world;

  // Groups
  const bridgeGroup = new THREE.Group();
  const gapGroup = new THREE.Group();
  const looseGroup = new THREE.Group();
  const characterGroup = new THREE.Group();
  scene.add(bridgeGroup, gapGroup, looseGroup, characterGroup);

  // Constants
  const CUBE_SIZE = 1.0;
  const BRIDGE_Y = 0.5;
  const GAP_GLOW_Y = 0.02;

  const BRIDGE_TOP_Y = BRIDGE_Y + CUBE_SIZE / 2;
  const BOT_WALK_Y = BRIDGE_TOP_Y + 0.06;

  const HOVER_Y = 1.25;
  const BOB_AMP = 0.06;
  const BOB_FREQ = 0.50;

  const SNAP_MS = 150;

  // 24 cube orientations (snap targets)
  const ORIENTATIONS = buildCubeOrientations(THREE);

  // Gap visuals
  const gapGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.75, 48),
    new THREE.MeshBasicMaterial({ color: 0x7cff9b, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  gapGlow.rotation.x = -Math.PI / 2;
  gapGlow.position.set(0, GAP_GLOW_Y, 0);
  gapGroup.add(gapGlow);

  // State
  let levelIndex = 0;
  let moves = 0;
  let placed = false;

  let bridgeMap = new Map();

  const gapPos = new THREE.Vector3(0, BRIDGE_Y, 0);
  const gapHoverPos = new THREE.Vector3(0, HOVER_Y, 0);

  let looseCube = null;

  // Snap easing state
  let snapActive = false;
  let snapStartTime = 0;
  const snapFromQ = new THREE.Quaternion();
  const snapToQ = new THREE.Quaternion();
  let snapQueuedTryPlace = false;

  // Time
  let tAccum = 0;

  // Character
  const bot = makeCuteBot(world);
  characterGroup.add(bot);
  let characterPhase = "WAIT"; // WAIT -> WALK -> DONE
  let pathPoints = [];
  let pathSeg = 0;

  // Effects
  const fireworks = createFireworks(world, {
    onComplete: () => {
      if (characterPhase === "DONE") {
        levelIndex = (levelIndex + 1) % LEVELS.length;
        loadLevel(levelIndex);
      }
    },
  });

  // Stable API object (input.js holds reference)
  let api = null;

  // ----------------------------
  // Helpers
  // ----------------------------
  function clearGroup(g) {
    while (g.children.length) g.remove(g.children[0]);
  }

  function setMoves(n) {
    moves = n;
    ui.setMoves(moves);
  }

  function gridToWorld(x, z) {
    return new THREE.Vector3(x * CUBE_SIZE, BRIDGE_Y, z * CUBE_SIZE);
  }


  function quatFromQuarterRot(rot) {
    const rx = ((rot?.x ?? 0) % 4 + 4) % 4;
    const ry = ((rot?.y ?? 0) % 4 + 4) % 4;
    const rz = ((rot?.z ?? 0) % 4 + 4) % 4;

    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx * (Math.PI / 2));
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry * (Math.PI / 2));
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz * (Math.PI / 2));

    const q = new THREE.Quaternion();
    q.multiplyQuaternions(qz, qy).multiply(qx);
    return q.normalize();
  }

  function setQuarterRotation(obj, rot) {
    obj.quaternion.copy(quatFromQuarterRot(rot));
  }

  function sameOrientation(a, b) {
    // quaternions are equivalent up to sign; compare |dot| near 1
    const d = Math.abs(a.dot(b));
    return d > 0.9995; // tight because we only use snapped quarter-turn orientations
  }

  function computePathFromBridge() {
    const coords = Array.from(bridgeMap.keys()).map((k) => k.split(",").map(Number));
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;

    if (coords.length) {
      minX = Math.min(...coords.map(([x]) => x));
      maxX = Math.max(...coords.map(([x]) => x));
      minZ = Math.min(...coords.map(([, z]) => z));
      maxZ = Math.max(...coords.map(([, z]) => z));
    }

    const spanX = Math.abs(maxX - minX);
    const spanZ = Math.abs(maxZ - minZ);

    if (spanX >= spanZ) {
      pathPoints = [
        new THREE.Vector3((minX - 1) * CUBE_SIZE, BOT_WALK_Y, 0),
        new THREE.Vector3(minX * CUBE_SIZE, BOT_WALK_Y, 0),
        new THREE.Vector3(0, BOT_WALK_Y, 0),
        new THREE.Vector3(maxX * CUBE_SIZE, BOT_WALK_Y, 0),
        new THREE.Vector3((maxX + 1) * CUBE_SIZE, BOT_WALK_Y, 0),
      ];
    } else {
      pathPoints = [
        new THREE.Vector3(0, BOT_WALK_Y, (minZ - 1) * CUBE_SIZE),
        new THREE.Vector3(0, BOT_WALK_Y, minZ * CUBE_SIZE),
        new THREE.Vector3(0, BOT_WALK_Y, 0),
        new THREE.Vector3(0, BOT_WALK_Y, maxZ * CUBE_SIZE),
        new THREE.Vector3(0, BOT_WALK_Y, (maxZ + 1) * CUBE_SIZE),
      ];
    }

    pathSeg = 0;
    characterGroup.position.copy(pathPoints[0]);
    characterPhase = "WAIT";
  }

  // ----------------------------
  // Hard-coded correctness rule: compare against targetRot
  // ----------------------------
  function isCorrectNow(levelDef) {
    const targetQ = quatFromQuarterRot(levelDef.targetRot);
    const currentQ = looseCube.quaternion.clone().normalize();

    // since we snap to the 24 orientations, normalize current to nearest target set first:
    const snappedCurrent = snapToNearestCubeOrientation(currentQ, ORIENTATIONS);

    return sameOrientation(snappedCurrent, targetQ);
  }

  function tryPlaceIntoGap() {
    if (placed) {
      decor?.onSolve?.();
      return;
    }
    const def = LEVELS[levelIndex];

    if (!isCorrectNow(def)) {
      ui.setMsg("❌ Not the right orientation.");
      looseCube.position.copy(gapHoverPos);
      return;
    }

    placed = true;
    ui.setMsg("✅ Locked!");
    gapGlow.material.opacity = 0.10;

    const lockedQ = looseCube.quaternion.clone();
    looseCube.position.set(gapPos.x, BRIDGE_Y, gapPos.z);
    looseCube.quaternion.copy(lockedQ);

    characterPhase = "WALK";
    pathSeg = 0;
  }

  // ----------------------------
  // Build level scene
  // ----------------------------
  function buildBridgeFromLevel(def) {
    clearGroup(bridgeGroup);
    bridgeMap = new Map();

    if (!def.bridge || def.bridge.length !== 8) {
      console.warn("Level must define exactly 8 bridge cubes. Got:", def.bridge?.length);
    }

    for (const b of def.bridge) {
      const cube = makeTileCube(world, CUBE_SIZE, {
        tile: b.tile,
        rotQuarter: 0,        // overlay stays default
        sideFaceColors: def.skin,
      });

      cube.position.copy(gridToWorld(b.x, b.z));
      setQuarterRotation(cube, b.rot);

      bridgeGroup.add(cube);
      bridgeMap.set(`${b.x},${b.z}`, cube);
    }
  }

  function rebuildLooseFromLevel(def) {
    if (looseCube) looseGroup.remove(looseCube);

    looseCube = makeTileCube(world, CUBE_SIZE, {
      tile: def.loose.tile,
      rotQuarter: 0,
      sideFaceColors: def.skin,
    });

    looseCube.position.copy(gapHoverPos);
    setQuarterRotation(looseCube, def.loose.startRot);

    looseGroup.add(looseCube);
    if (api) api.looseCube = looseCube;
  }

  function loadLevel(idx) {
    const def = LEVELS[idx];

    ui.clearMsg();
    ui.setMoves(0);
    setMoves(0);
    placed = false;

    gapGlow.material.opacity = 0.35;
    gapGlow.position.set(0, GAP_GLOW_Y, 0);

    // Reset effects / snap
    fireworks.reset();
    snapActive = false;
    snapQueuedTryPlace = false;

    // Build scene
    buildBridgeFromLevel(def);
    rebuildLooseFromLevel(def);

    // Character path
    computePathFromBridge();

    characterPhase = "WAIT";
    ui.setMsg(def.name ? def.name : `Level ${idx + 1}`);
  }

  // ----------------------------
  // Input-facing rotation / snap
  // ----------------------------
  function startSnapAndPlace(now) {
    if (placed) return;

    snapFromQ.copy(looseCube.quaternion).normalize();
    snapToQ.copy(snapToNearestCubeOrientation(looseCube.quaternion, ORIENTATIONS)).normalize();
    snapStartTime = now;
    snapActive = true;
    snapQueuedTryPlace = true;

    setMoves(moves + 1);
  }

  function cancelSnap() {
    snapActive = false;
    snapQueuedTryPlace = false;
  }

  function applyWorldQuarterTurn(axis, dir) {
    if (placed) return;

    const axisVec =
      axis === "x" ? new THREE.Vector3(1, 0, 0) :
      axis === "y" ? new THREE.Vector3(0, 1, 0) :
      new THREE.Vector3(0, 0, 1);

    const dq = new THREE.Quaternion().setFromAxisAngle(axisVec, dir * (Math.PI / 2));
    const q = looseCube.quaternion.clone();
    q.premultiply(dq);

    looseCube.quaternion.copy(snapToNearestCubeOrientation(q, ORIENTATIONS));

    ui.clearMsg();
    setMoves(moves + 1);
  }

  // ----------------------------
  // Update loop pieces
  // ----------------------------
  function updateSnap(now) {
    if (!snapActive) return;

    const elapsed = now - snapStartTime;
    const t = Math.min(1, elapsed / 150);
    const eased = easeOutCubic(t);

    looseCube.quaternion.copy(snapFromQ).slerp(snapToQ, eased);

    if (t >= 1) {
      snapActive = false;
      looseCube.quaternion.copy(snapToQ);

      if (snapQueuedTryPlace) {
        snapQueuedTryPlace = false;
        tryPlaceIntoGap();
      }
    }
  }

  function updateHover() {
    if (placed) return;
    const bob = Math.sin(tAccum * Math.PI * 2 * BOB_FREQ) * BOB_AMP;
    looseCube.position.set(gapHoverPos.x, gapHoverPos.y + bob, gapHoverPos.z);
  }

  function updateCharacter(dt) {
    if (characterPhase === "WAIT" || characterPhase === "DONE") return;

    const speed = 1.6;
    const curr = characterGroup.position.clone();
    const target = pathPoints[Math.min(pathSeg + 1, pathPoints.length - 1)];
    const to = target.clone().sub(curr);
    const dist = to.length();

    // bob
    const s = tAccum * 8.0;
    const bob = Math.abs(Math.sin(s)) * 0.06;
    characterGroup.position.y = BOT_WALK_Y + bob;

    if (dist < 0.03) {
      pathSeg += 1;
    } else {
      to.normalize();
      characterGroup.position.x += to.x * speed * dt;
      characterGroup.position.z += to.z * speed * dt;
    }

    // face direction
    const dirXZ = new THREE.Vector3(target.x - curr.x, 0, target.z - curr.z);
    if (dirXZ.lengthSq() > 1e-6) {
      dirXZ.normalize();
      bot.rotation.y = Math.atan2(dirXZ.x, dirXZ.z);
    }

    animateBot(bot, tAccum);

    if (pathSeg >= pathPoints.length - 1) {
      characterPhase = "DONE";
      ui.setMsg("🎉 Safe crossing!");
      const end = pathPoints[pathPoints.length - 1];
      fireworks.trigger(new THREE.Vector3(end.x, 1.8, end.z));
    }
  }

  function update(now, dt) {
    tAccum += dt;

    if (!placed) {
      gapGlow.material.opacity = 0.25 + Math.sin(tAccum * 3) * 0.10;
    }

    updateHover();
    updateSnap(now);
    updateCharacter(dt);
    fireworks.update(dt);
  }

  // ----------------------------
  // UI hooks
  // ----------------------------
  ui.onNew(() => {
    levelIndex = (levelIndex + 1) % LEVELS.length;
    loadLevel(levelIndex);
  });

  ui.onReset(() => {
    loadLevel(levelIndex);
  });

  ui.onCheck(() => {
    const ok = isCorrectNow(LEVELS[levelIndex]);
    ui.setMsg(ok ? "✅ Correct orientation!" : "❌ Not the right orientation.");
  });

  // ----------------------------
  // API
  // ----------------------------
  api = {
    update,
    looseCube,

    gapPos,
    gapHoverPos,
    isPlaced: () => placed,
    ui,

    cancelSnap,
    startSnapAndPlace,
    applyWorldQuarterTurn,
  };

  // Init
  loadLevel(levelIndex);
  api.looseCube = looseCube;

  return api;
}
