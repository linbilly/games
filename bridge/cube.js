// cube.js
export function makeBaseCube(world, size = 1.0, { sideFaceColors = {} } = {}) {
  const { THREE } = world;
  const geom = new THREE.BoxGeometry(size, size, size);

  // Face order: +X, -X, +Y, -Y, +Z, -Z
  const baseMat = new THREE.MeshStandardMaterial({
  color: 0xf4f7ff,
  roughness: 0.55,
  metalness: 0.02,
  emissive: 0x101018,
  emissiveIntensity: 0.25,
});

const bottomMat = new THREE.MeshStandardMaterial({
  color: 0xe9eefc,
  roughness: 0.60,
  metalness: 0.02,
  emissive: 0x0b0b10,
  emissiveIntensity: 0.18,
});

const matFor = (hex) => new THREE.MeshStandardMaterial({
  color: hex,
  roughness: 0.45,
  metalness: 0.0,
  emissive: hex,
  emissiveIntensity: 0.18, // makes colors vibrant without neon
});


  const mats = [
    sideFaceColors.PX != null ? matFor(sideFaceColors.PX) : baseMat, // +X
    sideFaceColors.NX != null ? matFor(sideFaceColors.NX) : baseMat, // -X
    baseMat,                                                         // +Y (top)
    bottomMat,                                                       // -Y (bottom)
    sideFaceColors.PZ != null ? matFor(sideFaceColors.PZ) : baseMat, // +Z
    sideFaceColors.NZ != null ? matFor(sideFaceColors.NZ) : baseMat, // -Z
  ];

  const mesh = new THREE.Mesh(geom, mats);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
  );
  mesh.add(edges);

  // Store for logic checks (even if some are null)
  mesh.userData.sideFaceColors = {
    PX: sideFaceColors.PX ?? null,
    NX: sideFaceColors.NX ?? null,
    PZ: sideFaceColors.PZ ?? null,
    NZ: sideFaceColors.NZ ?? null,
  };

  return mesh;
}


// Bits for top-face connectivity in *cube local frame*
// N,E,S,W as 4 bits.
export const DIR = { N: 1 << 0, E: 1 << 1, S: 1 << 2, W: 1 << 3 };

export function rotateMaskQuarter(mask, q) {
  // Rotate top mask around +Y by q quarter turns.
  // N->E->S->W->N for +90°.
  q = ((q % 4) + 4) % 4;
  let m = mask;
  for (let i = 0; i < q; i++) {
    const n = (m & DIR.N) ? DIR.E : 0;
    const e = (m & DIR.E) ? DIR.S : 0;
    const s = (m & DIR.S) ? DIR.W : 0;
    const w = (m & DIR.W) ? DIR.N : 0;
    m = n | e | s | w;
  }
  return m;
}

function addRoadStraightOverlay(world, group, size) {
  const { THREE } = world;

  // Straight road along local +Z (forward/back) by default
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(0.40 * size, 0.01 * size, 0.95 * size),
    new THREE.MeshStandardMaterial({ color: 0x202633, roughness: 0.7, metalness: 0.0 })
  );
  road.position.set(0, size / 2 + 0.006 * size, 0);
  group.add(road);

  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf7d76a, roughness: 0.6, metalness: 0.0 });
  const dashCount = 5;
  for (let i = 0; i < dashCount; i++) {
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.06 * size, 0.01 * size, 0.10 * size),
      dashMat
    );
    const z = (-0.38 + i * 0.19) * size;
    dash.position.set(0, size / 2 + 0.012 * size, z);
    group.add(dash);
  }
}

function addRoadTurnOverlay(world, group, size) {
  const { THREE } = world;

  // Turn tile connects local N (−Z) to local E (+X) by default (an L-shape)
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x202633, roughness: 0.7, metalness: 0.0 });
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf7d76a, roughness: 0.6, metalness: 0.0 });

  // Leg 1: from center towards -Z (N)
  const legN = new THREE.Mesh(
    new THREE.BoxGeometry(0.40 * size, 0.01 * size, 0.55 * size),
    roadMat
  );
  legN.position.set(0, size / 2 + 0.006 * size, -0.22 * size);
  group.add(legN);

  // Leg 2: from center towards +X (E)
  const legE = new THREE.Mesh(
    new THREE.BoxGeometry(0.55 * size, 0.01 * size, 0.40 * size),
    roadMat
  );
  legE.position.set(0.22 * size, size / 2 + 0.006 * size, 0);
  group.add(legE);

  // A couple of dashes on each leg
  const d1 = new THREE.Mesh(new THREE.BoxGeometry(0.06 * size, 0.01 * size, 0.10 * size), dashMat);
  d1.position.set(0, size / 2 + 0.012 * size, -0.30 * size);
  group.add(d1);

  const d2 = new THREE.Mesh(new THREE.BoxGeometry(0.10 * size, 0.01 * size, 0.06 * size), dashMat);
  d2.position.set(0.30 * size, size / 2 + 0.012 * size, 0);
  group.add(d2);
}

export function addTileOverlayToTopFace(world, cube, { tile = "straight", rotQuarter = 0, size = 1.0 } = {}) {
  const { THREE } = world;

  const roadGroup = new THREE.Group();
  roadGroup.name = "RoadOverlay";

  if (tile === "straight") addRoadStraightOverlay(world, roadGroup, size);
  else addRoadTurnOverlay(world, roadGroup, size);

  // Rotate the overlay within the cube's local top face (around local +Y)
  roadGroup.rotation.y = rotQuarter * (Math.PI / 2);

  cube.add(roadGroup);

  // Store local connectivity mask in cube.userData for logic checks
  const baseMask = (tile === "straight")
    ? (DIR.N | DIR.S)   // straight default is N-S (along local Z)
    : (DIR.N | DIR.E);  // turn default is N-E

  cube.userData.tile = tile;
  cube.userData.rotQuarter = ((rotQuarter % 4) + 4) % 4;
  cube.userData.maskLocal = rotateMaskQuarter(baseMask, cube.userData.rotQuarter);

  return cube;
}

export function makeTileCube(world, size = 1.0, { tile = "straight", rotQuarter = 0, sideFaceColors = {} } = {}) {
  const c = makeBaseCube(world, size, { sideFaceColors });
  addTileOverlayToTopFace(world, c, { tile, rotQuarter, size });
  return c;
}


