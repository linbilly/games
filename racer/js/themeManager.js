import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export function makeThemeManager({ scene, renderer, roadMat, grassMat }) {
  const propsGroup = new THREE.Group();
  scene.add(propsGroup);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.25, 0.45, 1.6, 10);

  const THEMES = {
    K:  { sky:0x0b1020, fog:{near:10,far:95},  road:0x2a2f3f, grass:0x10203a, prop:0x4fd1ff },
    G1: { sky:0x071a17, fog:{near:12,far:105}, road:0x223a2e, grass:0x0f2a22, prop:0x44ff88 },
    G2: { sky:0x151024, fog:{near:14,far:115}, road:0x2c2346, grass:0x1b1431, prop:0xffd95a },
    G3: { sky:0x1a0c10, fog:{near:16,far:125}, road:0x3a101a, grass:0x240b14, prop:0xff5577 },
  };

  function themeFor(id) {
    if (id.startsWith("K")) return THEMES.K;
    if (id.startsWith("G1")) return THEMES.G1;
    if (id.startsWith("G2")) return THEMES.G2;
    return THEMES.G3;
  }

  function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

  function buildProps(theme) {
    clearGroup(propsGroup);
    const mat = new THREE.MeshStandardMaterial({ color: theme.prop, roughness: 0.9 });
    const count = theme === THEMES.K ? 10 : theme === THEMES.G1 ? 14 : theme === THEMES.G2 ? 18 : 22;

    for (let i=0;i<count;i++){
      const z = -12 - i*8;
      const left = new THREE.Mesh(i%2===0?cylGeo:boxGeo, mat);
      left.scale.set(1.0, i%2===0?1.0:1.6, 1.0);
      left.position.set(-11.5, 0.8, z);
      propsGroup.add(left);

      const right = new THREE.Mesh(i%2===0?cylGeo:boxGeo, mat);
      right.scale.set(1.0, i%2===0?1.0:1.6, 1.0);
      right.position.set(11.5, 0.8, z-4);
      propsGroup.add(right);
    }
  }

  function applyTheme(levelId, fog) {
    const t = themeFor(levelId);
    fog.near = t.fog.near;
    fog.far = t.fog.far;
    renderer.setClearColor(t.sky, 1);
    roadMat.color.setHex(t.road);
    grassMat.color.setHex(t.grass);
    buildProps(t);
  }

  return { applyTheme };
}
