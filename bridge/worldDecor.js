// worldDecor.js
// 3D “Happy Puzzle Valley” (NO audio):
// - gradient sky dome (shader)
// - gentle sunlight + soft hemisphere light
// - rolling hills + ground plane
// - subtle moving clouds (parallax + wrap)
// - ambient birds (visual only)
// - onSolve() rainbow-tint pulse

export function addHappyWorld(world) {
  const { THREE, scene } = world;

  // -----------------------
  // Lights (gentle + warm)
  // -----------------------
  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0xa8e6a3, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d2, 1.05);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  // -----------------------
  // Sky dome (gradient shader)
  // -----------------------
  const skyGeo = new THREE.SphereGeometry(120, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(0.55, 0.82, 1.0) },   // light blue
      uBot: { value: new THREE.Color(1.0, 0.88, 0.70) },   // warm peach
      uTint: { value: new THREE.Color(1, 1, 1) },          // rainbow pulse tint
      uTintAmt: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 uTop;
      uniform vec3 uBot;
      uniform vec3 uTint;
      uniform float uTintAmt;

      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 base = mix(uBot, uTop, smoothstep(-0.2, 0.85, h));
        vec3 col = mix(base, base * uTint, uTintAmt);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = "SkyDome";
  scene.add(sky);

  // -----------------------
  // Ground
  // -----------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({
      color: 0xa8e6a3,
      roughness: 0.95,
      metalness: 0.0,
    })
  );
  ground.name = "Ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  // -----------------------
  // Rolling hills (soft spheres)
  // -----------------------
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7dd3a7, roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(22, 28, 28), hillMat);
    hill.scale.y = 0.35;
    hill.position.set((i - 2.5) * 28, -6, -55 - i * 10);
    hill.name = `Hill${i}`;
    scene.add(hill);
  }

  // -----------------------
  // Clouds (moving)
  // -----------------------
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
  });

  const clouds = [];

  function makeCloud(x, y, z, scale = 1, speed = 0.5) {
    const g = new THREE.Group();
    g.name = "Cloud";
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 14), cloudMat);
      puff.position.set(
        (Math.random() - 0.5) * 5.5,
        Math.random() * 1.8,
        (Math.random() - 0.5) * 3.0
      );
      puff.scale.setScalar(0.8 + Math.random() * 0.7);
      g.add(puff);
    }
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    scene.add(g);

    clouds.push({ g, speed });
    return g;
  }

  // parallax: farther => slower
  makeCloud(-28, 16, -38, 1.2, 0.35);
  makeCloud(6, 18, -44, 1.4, 0.25);
  makeCloud(30, 15, -34, 1.1, 0.40);
  makeCloud(-10, 22, -62, 1.8, 0.18);

  // -----------------------
  // Birds (visual only)
  // -----------------------
  const birds = [];
  const birdMat = new THREE.LineBasicMaterial({
    color: 0x2b2b2b,
    transparent: true,
    opacity: 0.45,
  });

  function makeBird() {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -0.25, 0, 0,  0, 0.18, 0,
       0, 0.18, 0,  0.25, 0, 0,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    const line = new THREE.LineSegments(geo, birdMat);
    line.name = "Bird";

    const y = 14 + Math.random() * 10;
    const z = -35 - Math.random() * 45;
    const x = -40 + Math.random() * 80;

    line.position.set(x, y, z);
    line.scale.setScalar(2.2 + Math.random() * 2.2);

    const vx = 0.6 + Math.random() * 0.8;
    const wob = 0.7 + Math.random() * 0.8;
    const phase = Math.random() * 10;
    const baseY = y;

    scene.add(line);
    birds.push({ line, vx, wob, phase, baseY });
  }

  for (let i = 0; i < 7; i++) makeBird();

  // -----------------------
  // Solve reaction (sky tint pulse)
  // -----------------------
  let solvePulse = 0; // 0..1

  function onSolve() {
    solvePulse = 1.0;
    // pick a friendly random hue
    const tint = new THREE.Color().setHSL(Math.random(), 0.55, 1.0);
    skyMat.uniforms.uTint.value.copy(tint);
    skyMat.uniforms.uTintAmt.value = 0.0;
  }

  // -----------------------
  // Update
  // -----------------------
  function update(dt, nowSec) {
    // cloud drift in +X with wrap
    for (const c of clouds) {
      c.g.position.x += c.speed * dt;
      if (c.g.position.x > 60) c.g.position.x = -60;
    }

    // birds glide + gentle flap wobble
    for (const b of birds) {
      b.line.position.x += b.vx * dt;
      if (b.line.position.x > 55) b.line.position.x = -55;

      const w = Math.sin((nowSec + b.phase) * 3.2) * 0.15;
      b.line.scale.y = b.line.scale.x * (0.85 + w);
      b.line.position.y = b.baseY + Math.sin((nowSec + b.phase) * 0.9) * b.wob;
    }

    // tint pulse on solve (bell curve)
    if (solvePulse > 0) {
      solvePulse = Math.max(0, solvePulse - dt * 1.2);
      const amt = Math.sin((1 - solvePulse) * Math.PI) * 0.35;
      skyMat.uniforms.uTintAmt.value = amt;
    } else {
      skyMat.uniforms.uTintAmt.value = 0.0;
    }
  }

  return {
    update,
    onSolve,
  };
}
