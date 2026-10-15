import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { SEA_LEVEL, WORLD_SIZE } from '../config';
import { Noise2D } from '../util/noise';
import { Rng } from '../util/rng';
import { smoothstep } from '../util/math';
import { ScatterSet, type ScatterItem } from '../land/Scatter';
import { ISLE_POS } from '../rival/RivalVisuals';
import { cliffMaterial, cliffSlabGeometry, cliffStackGeometry, cliffUniforms } from '../coast/cliffMaterial';

/**
 * v0.6 coast (decorative only; the height field is untouched): layered sea-cliff slabs along the rockier stretches
 * of shore, a few small waterfalls where high ground meets the sea, and rock stacks and islets offshore near the
 * island. Shore slabs and stacks are one ScatterSet (one draw call, culled around the camera target).
 */
const fin = (n: number, d = 0) => (Number.isFinite(n) ? n : d);
const WHITE = [new THREE.Color(1, 1, 1), new THREE.Color(0.93, 0.9, 0.86), new THREE.Color(1.04, 1.0, 0.95)];

const fallMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { uT: cliffUniforms.uCliffTime },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uT;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main() {
      float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
      float streak = n(vec2(vUv.x * 9.0, vUv.y * 3.0 + uT * 2.2)) * 0.6 + n(vec2(vUv.x * 19.0 + 5.0, vUv.y * 5.0 + uT * 3.4)) * 0.4;
      float a = edge * (0.45 + 0.55 * streak) * smoothstep(0.0, 0.08, vUv.y);
      vec3 c = mix(vec3(0.55, 0.78, 0.92), vec3(0.97, 0.99, 1.0), streak);
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
      if (!(gl_FragColor.a == gl_FragColor.a)) gl_FragColor = vec4(0.0);
    }
  `,
});
const spray = new THREE.MeshBasicMaterial({ color: 0xf6fbff, transparent: true, opacity: 0.38, depthWrite: false, fog: true });
const poolMat = new THREE.MeshBasicMaterial({ color: 0x7ec3dd, transparent: true, opacity: 0.85, depthWrite: false });
const pineMat = new THREE.MeshStandardMaterial({ color: 0x2f6a46, roughness: 0.9, flatShading: true });

export function install(game: Game): GamePlugin {
  const T = game.terrain;
  const noise = new Noise2D(4242);
  let root: THREE.Group | null = null;
  let set: ScatterSet | null = null;
  let stackSet: ScatterSet | null = null;
  let built = false;
  const sprays: { m: THREE.Mesh; ph: number }[] = [];

  const water = (x: number, z: number, r: number, depth: number) => {
    for (let a = 0; a < 6; a++) if (T.heightAt(x + Math.cos(a * 1.047) * r, z + Math.sin(a * 1.047) * r) > SEA_LEVEL - depth) return false;
    return T.heightAt(x, z) < SEA_LEVEL - depth;
  };

  function build() {
    built = true;
    const home = game.villages.find((v) => v.isHome);
    const hx = fin(home?.center.x ?? 0), hz = fin(home?.center.z ?? 0);
    const jetty = (game as unknown as { waterJetty?: THREE.Vector3 }).waterJetty;
    const rng = new Rng(9021);
    const items: ScatterItem[] = [];
    const stacks: ScatterItem[] = [];
    const shore: { x: number; z: number; ox: number; oz: number; top: number; hin: number }[] = [];
    const half = Math.min(WORLD_SIZE / 2 - 20, 380);
    const STEP = 4;

    // ---- shore slabs
    for (let gz = -half; gz < half; gz += STEP) {
      for (let gx = -half; gx < half; gx += STEP) {
        if (items.length > 1800) break;
        const x = gx + rng.next() * STEP, z = gz + rng.next() * STEP;
        const h = fin(T.heightAt(x, z), -9);
        if (h < 0.6 || h > 4.2) continue;
        const dx = fin(T.heightAt(x + 1.5, z) - T.heightAt(x - 1.5, z)), dz = fin(T.heightAt(x, z + 1.5) - T.heightAt(x, z - 1.5));
        const gl = Math.hypot(dx, dz);
        if (gl < 0.02) continue;
        const ox = -dx / gl, oz = -dz / gl; // seaward
        const cliffy = smoothstep(-0.45, 0.15, noise.noise(x * 0.018 + 17, z * 0.018));
        if (rng.next() > 0.2 + 0.8 * cliffy) continue;
        // Walk seaward to the waterline, then stand the slab's face right there.
        let d = 0;
        while (d < 16 && T.heightAt(x + ox * d, z + oz * d) > 0.45) d += 1;
        if (d >= 16 || T.heightAt(x + ox * (d + 7), z + oz * (d + 7)) > SEA_LEVEL - 0.2) continue;
        const depth = 4 + rng.next() * 2.6;
        const width = 6.5 + rng.next() * 5;
        const cx = x + ox * (d - depth * 0.5), cz = z + oz * (d - depth * 0.5);
        if (jetty && Math.hypot(cx - jetty.x, cz - jetty.z) < 17) continue;
        const gc = fin(T.heightAt(cx, cz), h);
        const top = Math.max(gc, 0.8) + 1.3 + cliffy * 2.6 + rng.next() * 1.0;
        const base = -2.5;
        const inl = fin(T.heightAt(x - ox * 16, z - oz * 16), h);
        items.push({ x: cx, y: base, z: cz, yaw: Math.atan2(ox, oz) + (rng.next() - 0.5) * 0.25, sx: width, sy: top - base, sz: depth, tint: rng.int(0, 2) });
        shore.push({ x: cx, z: cz, ox, oz, top, hin: inl });
      }
    }

    // ---- waterfalls: tall slabs where much higher ground sits just inland, nearest the home village first
    root = new THREE.Group();
    root.name = 'coast';
    const falls = shore
      .filter((s) => s.hin - s.top > 2.5)
      .sort((a, b) => Math.hypot(a.x - hx, a.z - hz) - Math.hypot(b.x - hx, b.z - hz));
    const chosen: typeof shore = [];
    for (const s of falls) {
      if (chosen.length >= 3) break;
      if (Math.hypot(s.x - hx, s.z - hz) > 420) break;
      if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 60)) chosen.push(s);
    }
    for (const s of chosen) {
      const top = Math.min(s.hin - 0.6, s.top + 6);
      const depth = 6, width = 9;
      const cx = s.x, cz = s.z;
      const yaw = Math.atan2(s.ox, s.oz);
      items.push({ x: cx, y: -2.5, z: cz, yaw, sx: width, sy: top + 2.5, sz: depth, tint: 1 });
      const fx = cx + s.ox * (depth * 0.5 + 0.12), fz = cz + s.oz * (depth * 0.5 + 0.12);
      const fh = top - 0.1;
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(3.2, fh + 0.2), fallMat);
      rib.position.set(fx, fh / 2 - 0.1, fz);
      rib.rotation.y = yaw;
      rib.renderOrder = 3;
      root.add(rib);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 14), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(cx - s.ox * 0.3, top + 0.04, cz - s.oz * 0.3);
      root.add(pool);
      for (let i = 0; i < 2; i++) {
        const sp = new THREE.Mesh(new THREE.CircleGeometry(1.1 + i * 0.8, 16), spray);
        sp.rotation.x = -Math.PI / 2;
        sp.position.set(fx + s.ox * (0.8 + i), 0.12 + i * 0.02, fz + s.oz * (0.8 + i));
        sp.renderOrder = 3;
        root.add(sp);
        sprays.push({ m: sp, ph: i * 2 + chosen.indexOf(s) });
      }
    }

    // ---- offshore: rock stacks and larger islets, close enough to read from the default and mid views
    const sites: { x: number; z: number; big: boolean }[] = [];
    const tryPick = (s: { x: number; z: number; ox: number; oz: number }, dmin: number, dmax: number, big: boolean) => {
      for (let k = 0; k < 6; k++) {
        const d = dmin + rng.next() * (dmax - dmin), sd = (rng.next() - 0.5) * 30;
        const x = s.x + s.ox * d - s.oz * sd, z = s.z + s.oz * d + s.ox * sd;
        if (Math.abs(x) > 380 || Math.abs(z) > 380) continue;
        if (!water(x, z, big ? 16 : 9, big ? 3 : 2.5)) continue;
        if (Math.hypot(x - ISLE_POS.x, z - ISLE_POS.z) < (big ? 85 : 60)) continue; // keep clear of Vexahl's isle and its claws (src/rival)
        if (sites.some((o) => Math.hypot(o.x - x, o.z - z) < (big ? 60 : 26))) continue;
        sites.push({ x, z, big });
        return true;
      }
      return false;
    };
    const order = shore.map((s, i) => ({ s, i })).sort((a, b) => Math.hypot(a.s.x - hx, a.s.z - hz) - Math.hypot(b.s.x - hx, b.s.z - hz));
    let bigs = 0, smalls = 0;
    for (let n = 0; n < order.length && (bigs < 4 || smalls < 11); n += 3) {
      const s = order[n].s;
      if (Math.hypot(s.x - hx, s.z - hz) > 340) break;
      if (bigs < 4 && n % 9 === 0 && tryPick(s, 38, 75, true)) bigs++;
      else if (smalls < 11 && tryPick(s, 16, 55, false)) smalls++;
    }
    for (const o of sites) {
      const a = rng.next() * 6.28;
      if (o.big) {
        const w = 20 + rng.next() * 9, hgt = 9 + rng.next() * 5;
        stacks.push({ x: o.x, y: -3, z: o.z, yaw: a, sx: w, sy: hgt + 3, sz: w * (0.7 + rng.next() * 0.3), tint: 0 });
        stacks.push({ x: o.x + Math.cos(a) * w * 0.55, y: -3, z: o.z + Math.sin(a) * w * 0.55, yaw: a + 1, sx: w * 0.5, sy: hgt * 0.6 + 3, sz: w * 0.45, tint: 2 });
        for (let t = 0; t < 3; t++) {
          const th = 3.5 + rng.next() * 2.5;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(th * 0.4, th, 6), pineMat);
          const ta = rng.next() * 6.28, td = rng.next() * w * 0.22;
          cone.position.set(o.x + Math.cos(ta) * td, hgt + th / 2 - 0.3, o.z + Math.sin(ta) * td);
          cone.castShadow = true;
          root.add(cone);
        }
      } else {
        const w = 6 + rng.next() * 5, hgt = 6 + rng.next() * 8;
        stacks.push({ x: o.x, y: -3, z: o.z, yaw: a, sx: w, sy: hgt + 3, sz: w * (0.7 + rng.next() * 0.4), tint: rng.int(0, 2) });
        if (rng.next() < 0.6) stacks.push({ x: o.x + Math.cos(a) * w * 0.8, y: -3, z: o.z + Math.sin(a) * w * 0.8, yaw: a, sx: w * 0.6, sy: hgt * 0.55 + 3, sz: w * 0.55, tint: 1 });
      }
    }

    const mat = cliffMaterial();
    set = new ScatterSet(game.scene, cliffSlabGeometry(31), mat, items, WHITE, 'coast-cliffs');
    stackSet = new ScatterSet(game.scene, cliffStackGeometry(57), mat, stacks, WHITE, 'coast-stacks');
    game.scene.add(root);
  }

  return {
    name: 'coast',
    frame() {
      const t = fin(game.realTime);
      cliffUniforms.uCliffTime.value = t;
      cliffUniforms.uCliffSea.value = SEA_LEVEL;
      if (!built) {
        const home = game.villages.find((v) => v.isHome);
        if (home && (game as unknown as { waterJetty?: unknown }).waterJetty !== undefined) build();
        else if (home && t > 1.5) build();
      }
      if (!set) return;
      const cam = game.godCam;
      const dist = fin(cam.distance, 100);
      set.update(fin(cam.target.x), fin(cam.target.z), Math.min(1100, dist * 2.6 + 160));
      set.mesh.castShadow = dist < 260;
      if (stackSet) { stackSet.update(fin(cam.target.x), fin(cam.target.z), 1500); stackSet.mesh.castShadow = dist < 400; }
      for (const s of sprays) s.m.scale.setScalar(1 + 0.12 * Math.sin(t * 1.7 + s.ph));
    },
  };
}
