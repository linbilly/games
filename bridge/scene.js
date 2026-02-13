import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 6.2, 10.5);
  camera.lookAt(0, 0.9, 0);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x0f1420, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  let lastT = performance.now();
  let raf = 0;

  function start(onFrame) {
    const loop = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      onFrame(t, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function render() {
    renderer.render(scene, camera);
  }

  return { THREE, renderer, scene, camera, start, render };
}
