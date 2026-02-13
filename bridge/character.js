export function makeCuteBot(world) {
  const { THREE } = world;
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7fe3ff, roughness: 0.35, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xeaf2ff, roughness: 0.35, metalness: 0.02 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.8, metalness: 0.0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xffd86b, roughness: 0.5, metalness: 0.0 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.25, 6, 12), bodyMat);
  body.position.y = 0.32;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), headMat);
  head.position.y = 0.62;
  g.add(head);

  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.20, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.55, metalness: 0.0 })
  );
  face.scale.set(1.0, 0.75, 0.65);
  face.position.set(0, 0.60, 0.12);
  g.add(face);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), accentMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.07, 0.62, 0.22);
  eyeR.position.set(+0.07, 0.62, 0.22);
  g.add(eyeL, eyeR);

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.015, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xeaf2ff, roughness: 0.7, metalness: 0.0 })
  );
  mouth.position.set(0, 0.56, 0.24);
  g.add(mouth);

  const armGeom = new THREE.CapsuleGeometry(0.04, 0.12, 4, 10);
  const armL = new THREE.Mesh(armGeom, bodyMat);
  const armR = new THREE.Mesh(armGeom, bodyMat);
  armL.position.set(-0.22, 0.36, 0.0);
  armR.position.set(+0.22, 0.36, 0.0);
  armL.rotation.z = 0.9;
  armR.rotation.z = -0.9;
  g.add(armL, armR);

  const footMat = new THREE.MeshStandardMaterial({ color: 0xcfd7e6, roughness: 0.8, metalness: 0.0 });
  const footGeom = new THREE.BoxGeometry(0.16, 0.05, 0.20);
  const footL = new THREE.Mesh(footGeom, footMat);
  const footR = footL.clone();
  footL.position.set(-0.10, 0.06, 0.02);
  footR.position.set(+0.10, 0.06, 0.02);
  g.add(footL, footR);

  const antStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 12), darkMat);
  antStem.position.set(0, 0.86, 0);
  g.add(antStem);

  const antBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), accentMat);
  antBall.position.set(0, 0.96, 0);
  g.add(antBall);

  g.userData.parts = { head, eyeL, eyeR, armL, armR, footL, footR, antBall };

  return g;
}

export function animateBot(bot, tAccum) {
  const s = tAccum * 8.0;

  bot.rotation.z = -0.08 * Math.sin(s);

  const { head, eyeL, eyeR, armL, armR, footL, footR, antBall } = bot.userData.parts;
  armL.rotation.x = 0.6 * Math.sin(s);
  armR.rotation.x = -0.6 * Math.sin(s);

  footL.rotation.x = -0.35 * Math.sin(s);
  footR.rotation.x = 0.35 * Math.sin(s);

  head.position.y = 0.62 + 0.03 * Math.sin(s * 0.5);
  antBall.position.y = 0.96 + 0.02 * Math.sin(s * 1.2);

  const blink = (Math.sin(tAccum * 2.2) > 0.985);
  const eyeScaleY = blink ? 0.18 : 1.0;
  eyeL.scale.y = eyeScaleY;
  eyeR.scale.y = eyeScaleY;
}
