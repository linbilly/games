export function createFireworks(world, { onComplete } = {}) {
  const { THREE, scene } = world;
  let firework = null;

  function trigger(origin) {
    if (firework) {
      scene.remove(firework.points);
      firework = null;
    }

    const count = 120;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;

      const v = new THREE.Vector3(
        (Math.random() * 2 - 1),
        (Math.random() * 2 - 0.2),
        (Math.random() * 2 - 1)
      ).normalize().multiplyScalar(1.6 + Math.random() * 1.4);

      velocities[i * 3 + 0] = v.x;
      velocities[i * 3 + 1] = v.y;
      velocities[i * 3 + 2] = v.z;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.08,
      transparent: true,
      opacity: 1.0,
      depthWrite: false
    });

    const points = new THREE.Points(geom, mat);
    scene.add(points);

    firework = { points, geom, mat, velocities, age: 0, life: 1.2 };
  }

  function update(dt) {
    if (!firework) return;

    firework.age += dt;

    const posAttr = firework.geom.getAttribute("position");
    const p = posAttr.array;
    const v = firework.velocities;

    const gravity = -2.4;
    for (let i = 0; i < p.length; i += 3) {
      v[i + 1] += gravity * dt;
      p[i + 0] += v[i + 0] * dt;
      p[i + 1] += v[i + 1] * dt;
      p[i + 2] += v[i + 2] * dt;
    }

    posAttr.needsUpdate = true;

    const t = firework.age / firework.life;
    firework.mat.opacity = Math.max(0, 1 - t);

    if (firework.age >= firework.life) {
      scene.remove(firework.points);
      firework = null;
      if (typeof onComplete === "function") onComplete();
    }
  }

  function reset() {
    if (firework) {
      scene.remove(firework.points);
      firework = null;
    }
  }

  function isActive() {
    return !!firework;
  }

  return { trigger, update, reset, isActive };
}
