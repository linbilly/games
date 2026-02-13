export function buildCubeOrientations(THREE) {
  const results = [];
  const seen = new Set();
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];

  const keyOf = (q) => {
    const qq = q.clone().normalize();
    let arr = [qq.x, qq.y, qq.z, qq.w].map((v) => Math.round(v * 1e6));
    const sign = arr[3] < 0 ? -1 : 1;
    arr = arr.map((v) => v * sign);
    return arr.join(",");
  };

  const queue = [new THREE.Quaternion()]; // identity
  while (queue.length) {
    const q = queue.shift().clone().normalize();
    const k = keyOf(q);
    if (seen.has(k)) continue;
    seen.add(k);
    results.push(q);

    for (const axis of axes) {
      for (const dir of [-1, +1]) {
        const dq = new THREE.Quaternion().setFromAxisAngle(axis, dir * (Math.PI / 2));
        const next = q.clone();
        next.premultiply(dq); // world-axis quarter turn
        queue.push(next);
      }
    }
  }
  return results; // should be 24
}

export function snapToNearestCubeOrientation(quat, orientations) {
  const q = quat.clone().normalize();
  let best = orientations[0];
  let bestDot = -1;
  for (const cand of orientations) {
    const dot = Math.abs(q.dot(cand));
    if (dot > bestDot) { bestDot = dot; best = cand; }
  }
  return best.clone();
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
