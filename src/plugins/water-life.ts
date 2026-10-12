import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { SEA_LEVEL } from '../config';

/**
 * v0.6 water's edge dressing (decorative only): a few rocky islets with a grassy cap offshore, a small jetty on the
 * home village's shore and two little sailboats that bob beside it. Sits on top of src/world/Water.ts's sea.
 */
const rock = new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 0.95, flatShading: true });
const rockDark = new THREE.MeshStandardMaterial({ color: 0x5b5650, roughness: 0.95, flatShading: true });
const grass = new THREE.MeshStandardMaterial({ color: 0x86b24a, roughness: 0.9, flatShading: true });
const pine = new THREE.MeshStandardMaterial({ color: 0x2f6a46, roughness: 0.9, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.85, flatShading: true });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.9, flatShading: true });
const sailMat = new THREE.MeshStandardMaterial({ color: 0xf3e7cf, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
const hullMat = new THREE.MeshStandardMaterial({ color: 0x3a6f8f, roughness: 0.8, flatShading: true });
const foamTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,240,0.0)');
  g.addColorStop(0.38, 'rgba(255,250,240,0.0)');
  g.addColorStop(0.5, 'rgba(255,250,240,0.85)');
  g.addColorStop(0.68, 'rgba(255,250,240,0.25)');
  g.addColorStop(1, 'rgba(255,250,240,0.0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.8, depthWrite: false, fog: true });

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const fin = (n: number, d = 0) => (Number.isFinite(n) ? n : d);

function islet(seed: number, size: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const s = size * (i === 0 ? 1 : 0.35 + r() * 0.4);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), i % 2 ? rockDark : rock);
    const a = r() * 6.28;
    const d = i === 0 ? 0 : size * (0.7 + r() * 0.5);
    m.position.set(Math.cos(a) * d, s * 0.25, Math.sin(a) * d);
    m.scale.set(1 + r() * 0.3, 0.7 + r() * 0.4, 1 + r() * 0.3);
    m.rotation.y = r() * 6.28;
    g.add(m);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.7, size * 0.85, size * 0.26, 7), grass);
  cap.position.y = size * 0.82;
  g.add(cap);
  const trees = size > 5 ? 3 : 1;
  for (let i = 0; i < trees; i++) {
    const h = size * (0.55 + r() * 0.5);
    const t = new THREE.Mesh(new THREE.ConeGeometry(h * 0.38, h, 6), pine);
    const a = r() * 6.28, d = i === 0 ? 0 : size * 0.3;
    t.position.set(Math.cos(a) * d, size * 0.9 + h / 2, Math.sin(a) * d);
    g.add(t);
  }
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(size * 4.2, size * 4.2), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = 0.2;
  foam.name = 'foam';
  foam.renderOrder = 2;
  g.add(foam);
  return g;
}

function boat(): THREE.Group {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(0, 2.4); sh.lineTo(0.95, 0.9); sh.lineTo(0.8, -1.7); sh.lineTo(-0.8, -1.7); sh.lineTo(-0.95, 0.9); sh.closePath();
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false });
  hg.rotateX(-Math.PI / 2); // shape y -> world -z... flip so the bow points +z
  hg.rotateY(Math.PI);
  const hull = new THREE.Mesh(hg, hullMat);
  hull.position.y = -0.1;
  g.add(hull);
  const rim = new THREE.Mesh(hg, wood);
  rim.scale.set(0.8, 0.25, 0.8);
  rim.position.y = 0.6;
  g.add(rim);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 5), woodDark);
  mast.position.set(0, 2.4, 0.3);
  g.add(mast);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.9, 0.2, 0, 4.4, 0.2, 0, 0.9, -1.6], 3));
  sg.computeVertexNormals();
  g.add(new THREE.Mesh(sg, sailMat));
  return g;
}

export function install(game: Game): GamePlugin {
  let key = '';
  let root: THREE.Group | null = null;
  const bobbers: { o: THREE.Object3D; ph: number; amp: number; base: number }[] = [];
  const foams: THREE.Object3D[] = [];
  const isl: THREE.Vector3[] = [];
  (game as unknown as { waterIslets?: THREE.Vector3[] }).waterIslets = isl;

  function build() {
    if (root) { game.scene.remove(root); root = null; }
    bobbers.length = 0; foams.length = 0; isl.length = 0;
    const home = game.villages.find((v) => v.isHome);
    if (!home) return;
    const hx = fin(home.center.x), hz = fin(home.center.z);
    key = hx + ',' + hz;
    root = new THREE.Group();
    root.name = 'water-life';
    const T = game.terrain;

    // Nearest sea in a spread of directions: shore bearing for the jetty and boats.
    let best: THREE.Vector3 | null = null;
    for (let rr = 40; rr <= 300 && !best; rr += 20) best = game.findWaterNear(hx, hz, rr);
    if (best) {
      const dx = best.x - hx, dz = best.z - hz, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      // Walk back toward the village until the ground rises above the waterline: the shore.
      let sx = best.x, sz = best.z;
      for (let i = 0; i < 40 && T.heightAt(sx, sz) < SEA_LEVEL + 0.4; i++) { sx -= ux * 1.5; sz -= uz * 1.5; }
      const jetty = new THREE.Group();
      const len = 21;
      for (let i = 0; i < 14; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 1.3), i % 2 ? wood : woodDark);
        p.position.set(0, 0, i * 1.5 - 1);
        jetty.add(p);
      }
      for (const sgn of [-1, 1]) for (let i = 0; i <= 3; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 5), woodDark);
        post.position.set(sgn * 1.4, -0.5, i * (len / 3.4) - 0.5);
        jetty.add(post);
      }
      jetty.position.set(sx + ux * 1.5, SEA_LEVEL + 0.55, sz + uz * 1.5);
      jetty.rotation.y = Math.atan2(ux, uz);
      root.add(jetty);
      (game as unknown as { waterJetty?: THREE.Vector3 }).waterJetty = new THREE.Vector3(sx + ux * 12, 0, sz + uz * 12);
      // Two boats a little off the end of the jetty, one at each side.
      const px = -uz, pz = ux;
      [[len + 6, 10, 0.4], [len + 12, -12, 2.1]].forEach(([fwd, side, ph], i) => {
        const bx = sx + ux * fwd + px * side, bz = sz + uz * fwd + pz * side;
        if (T.heightAt(bx, bz) > SEA_LEVEL - 1.5) return;
        const b = boat();
        b.scale.setScalar(2);
        b.position.set(bx, SEA_LEVEL, bz);
        b.rotation.y = Math.atan2(ux, uz) + Math.PI / 2 + (i ? 0.7 : -0.4);
        root!.add(b);
        bobbers.push({ o: b, ph, amp: 0.14, base: SEA_LEVEL - 0.05 });
      });
    }

    // Islets: on a ring around the world edge of the coast, only where it's properly deep.
    const r = rng(7);
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 7; tries++) {
      const a = r() * Math.PI * 2, d = 120 + r() * 300;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) > 340 || Math.abs(z) > 340) continue;
      if (T.heightAt(x, z) > SEA_LEVEL - 9) continue;
      let ok = true;
      for (let k = 0; k < 8; k++) {
        const ax = Math.cos(k * 0.785) * 22, az = Math.sin(k * 0.785) * 22;
        if (T.heightAt(x + ax, z + az) > SEA_LEVEL - 3) { ok = false; break; }
      }
      if (!ok) continue;
      const size = 3.5 + r() * 5;
      const g = islet(11 + placed * 13, size);
      g.position.set(x, SEA_LEVEL, z);
      g.rotation.y = r() * 6;
      root.add(g);
      foams.push(g.getObjectByName('foam')!);
      isl.push(g.position.clone());
      placed++;
    }
    game.scene.add(root);
  }

  return {
    name: 'water-life',
    frame() {
      const home = game.villages.find((v) => v.isHome);
      if (home && key !== fin(home.center.x) + ',' + fin(home.center.z)) build();
      const t = game.realTime;
      for (const b of bobbers) {
        b.o.position.y = b.base + Math.sin(t * 1.1 + b.ph) * b.amp;
        b.o.rotation.z = Math.sin(t * 0.9 + b.ph * 2) * 0.05;
        b.o.rotation.x = Math.sin(t * 0.7 + b.ph) * 0.04;
      }
      for (const f of foams) f.scale.setScalar(1 + Math.sin(t * 0.8 + f.id) * 0.06);
    },
  };
}
