import * as THREE from 'three';
import { merge, paint } from '../art/Models';
import { Rng } from '../util/rng';

/**
 * The things the after-loop adds to Telor (src/after): kitchen gardens at the city's edge, the newcomers' boat, and the
 * festivals' props (poles for the lantern strings, the feast's long tables and their food, the midwinter woodpiles,
 * paper lanterns). Low-poly and vertex-coloured on the shared material, like Telor (src/nexus/TelorArt.ts).
 * Everything faces +z and stands on y = 0.
 */

type Parts = THREE.BufferGeometry[];

function box(p: Parts, w: number, h: number, d: number, x: number, y: number, z: number, col: THREE.ColorRepresentation, jit = 0, rng?: Rng) {
  p.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, jit, rng));
}

const WOOD = [0x8a5a32, 0x7a4a2a, 0x946236, 0x6b4527];
const SOIL = 0x5a3e26;
const BED = 0x6b4a2e;
const LEAF = [0x4f8a3a, 0x5f9a3e, 0x3f7a34, 0x6aa046];
const BLOOM = [0xf2a3c0, 0xffd36a, 0xf6f0e0, 0xe86a5a, 0xb48cff];
const GOLD = 0xd9b25a;
const STONE = [0xb9a888, 0xa69676, 0xc4b394];

/**
 * A kitchen garden behind a house at the city's edge: a low wattle fence with a gate toward the house (+z), three raised
 * beds of cabbages, carrots and beans on poles, a row of flowers and a water butt. ~8 x 6 m.
 */
export function gardenGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const W = 7.6;
  const D = 5.6;
  // Soil, running down into the ground so a slope never shows a gap.
  box(p, W, 1.4, D, 0, -1.2, 0, SOIL, 0.05, rng);
  for (let r = 0; r < 3; r++) {
    const z = -1.75 + r * 1.75;
    box(p, W - 1.2, 0.26, 1.05, 0, 0.2, z, BED, 0.08, rng);
    const kind = (r + seed) % 3;
    for (let x = -W / 2 + 1.05; x < W / 2 - 0.9; x += 0.68) {
      const jx = x + rng.range(-0.08, 0.08);
      if (kind === 0) {
        // Cabbages.
        p.push(paint(new THREE.IcosahedronGeometry(rng.range(0.24, 0.3), 0).scale(1, 0.75, 1).translate(jx, 0.6, z), rng.pick(LEAF), 0.1, rng));
      } else if (kind === 1) {
        // Carrot tops.
        p.push(paint(new THREE.ConeGeometry(0.16, 0.5, 5).translate(jx, 0.7, z), rng.pick(LEAF), 0.12, rng));
      } else {
        // Beans on poles.
        p.push(paint(new THREE.CylinderGeometry(0.03, 0.04, 1.5, 4).translate(jx, 1.2, z), 0x8a6a42));
        p.push(paint(new THREE.IcosahedronGeometry(0.2, 0).scale(1, 1.8, 1).translate(jx, 1.15, z), rng.pick(LEAF), 0.12, rng));
      }
    }
  }
  // A row of flowers along the gate side.
  for (let x = -W / 2 + 0.8; x < W / 2 - 0.6; x += 0.5) {
    if (Math.abs(x) < 0.9) continue;
    p.push(paint(new THREE.IcosahedronGeometry(0.14, 0).translate(x, 0.42, D / 2 - 0.45), rng.pick(BLOOM)));
  }
  // The wattle fence: posts and two rails, a gate gap in the middle of the +z side.
  const post = (x: number, z: number) => p.push(paint(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 5).translate(x, 0.5, z), rng.pick(WOOD)));
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.45, 0.85]) p.push(paint(new THREE.BoxGeometry(0.06, 0.08, len).rotateY(a).translate((x0 + x1) / 2, y, (z0 + z1) / 2), 0x9a7448, 0.1, rng));
  };
  const hw = W / 2;
  const hd = D / 2;
  for (let x = -hw; x <= hw + 0.01; x += W / 6) {
    post(x, -hd);
    if (Math.abs(x) > 0.8) post(x, hd);
  }
  for (let z = -hd + D / 4; z < hd - 0.01; z += D / 4) {
    post(-hw, z);
    post(hw, z);
  }
  rail(-hw, -hd, hw, -hd);
  rail(-hw, -hd, -hw, hd);
  rail(hw, -hd, hw, hd);
  rail(-hw, hd, -0.8, hd);
  rail(0.8, hd, hw, hd);
  // A water butt in a corner.
  p.push(paint(new THREE.CylinderGeometry(0.42, 0.38, 0.9, 10).translate(hw - 0.5, 0.45, hd - 0.55), 0x6b4527));
  p.push(paint(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 10).translate(hw - 0.5, 0.88, hd - 0.55), 0x3f6f8f));
  return merge(p);
}

/**
 * The newcomers' boat: a broad little sailing boat with a painted hull, a cream sail with a stripe in `stripe`, their
 * belongings in bundles amidships and a lantern on a post at the bow. ~9 m long, the bow toward +z. The lantern's
 * light (a sprite) sits at BOAT_LANTERN.
 */
export function boatGeometry(stripe: number, hull = 0x2f5f7f): THREE.BufferGeometry {
  const p: Parts = [];
  const S = 2.1;
  const sh = new THREE.Shape();
  sh.moveTo(0, 2.3);
  sh.quadraticCurveTo(1.05, 1.4, 1.0, 0.2);
  sh.lineTo(0.85, -1.75);
  sh.lineTo(-0.85, -1.75);
  sh.lineTo(-1.0, 0.2);
  sh.quadraticCurveTo(-1.05, 1.4, 0, 2.3);
  const hullGeo = (depth: number) => {
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2).rotateY(Math.PI);
    return g;
  };
  // The hull: dark paint below, a wooden strake above, a deck inside.
  p.push(paint(hullGeo(0.55).translate(0, -0.25, 0), hull));
  p.push(paint(hullGeo(0.22).scale(1.02, 1, 1.02).translate(0, 0.3, 0), 0x9a6a3e));
  p.push(paint(hullGeo(0.05).scale(0.86, 1, 0.86).translate(0, 0.32, 0), 0xb08050));
  // Benches.
  for (const z of [-0.9, 0.5]) box(p, 1.6, 0.08, 0.32, 0, 0.42, -z, 0x8a5a32);
  // Mast, boom and sail (thin, so both sides show).
  p.push(paint(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 6).translate(0, 2.6, 0.35), 0x5b3b22));
  p.push(paint(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5).rotateX(Math.PI / 2).translate(0, 1.05, -0.65), 0x5b3b22));
  const sail = new THREE.BufferGeometry();
  const sv = new Float32Array([0, 1.1, 0.3, 0, 4.7, 0.3, 0, 1.1, -1.75]);
  sail.setAttribute('position', new THREE.BufferAttribute(sv, 3));
  const thick = (g: THREE.BufferGeometry, dx: number) => {
    const a = g.clone();
    a.translate(dx, 0, 0);
    a.computeVertexNormals();
    return a;
  };
  // Two faces of the sail, one each way, so the low-poly material shows it from both sides.
  const back = sail.clone();
  const bp = back.attributes.position.array as Float32Array;
  [bp[3], bp[4], bp[5], bp[6], bp[7], bp[8]] = [bp[6], bp[7], bp[8], bp[3], bp[4], bp[5]];
  p.push(paint(thick(sail, 0.03), 0xf3e7cf), paint(thick(back, -0.03), 0xf3e7cf));
  // The stripe across the sail.
  const stripeGeo = new THREE.BufferGeometry();
  stripeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 2.0, 0.3, 0, 2.6, 0.3, 0, 2.0, -1.33, 0, 2.6, 0.3, 0, 2.6, -1.05, 0, 2.0, -1.33]), 3));
  const stripeBack = stripeGeo.clone();
  const sb = stripeBack.attributes.position.array as Float32Array;
  for (let t = 0; t < 2; t++) {
    const o = t * 9;
    [sb[o + 3], sb[o + 4], sb[o + 5], sb[o + 6], sb[o + 7], sb[o + 8]] = [sb[o + 6], sb[o + 7], sb[o + 8], sb[o + 3], sb[o + 4], sb[o + 5]];
  }
  p.push(paint(thick(stripeGeo, 0.045), stripe), paint(thick(stripeBack, -0.045), stripe));
  // Belongings: bundles, a chest and a little potted tree for the new garden.
  box(p, 0.6, 0.4, 0.45, -0.35, 0.34, -0.1, 0xb59a6c);
  box(p, 0.5, 0.45, 0.42, 0.4, 0.34, 0.15, 0x7a4a2a);
  p.push(paint(new THREE.IcosahedronGeometry(0.26, 0).translate(0.3, 0.95, -1.25), 0x4f8a3a));
  p.push(paint(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 6).translate(0.3, 0.55, -1.25), 0xb5582f));
  // The bow lantern on its post.
  p.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).translate(0, 0.75, 1.95), 0x2b2a2e));
  p.push(paint(new THREE.BoxGeometry(0.2, 0.26, 0.2).translate(0, 1.27, 1.95), 0xffd890));
  const g = merge(p);
  g.scale(S, S, S);
  return g;
}
export const BOAT_LANTERN = new THREE.Vector3(0, 1.27 * 2.1, 1.95 * 2.1);

/** A festival pole for the lantern strings: a stone foot, a tall wooden pole wound with a ribbon, a gold finial. 6 m. */
export function poleGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(0.34, 0.42, 0.45, 8), 0xb5a383));
  p.push(paint(new THREE.CylinderGeometry(0.08, 0.11, 6, 6).translate(0, 3.2, 0), 0x6b4527));
  for (let i = 0; i < 6; i++) {
    p.push(paint(new THREE.TorusGeometry(0.12, 0.035, 4, 8).rotateX(Math.PI / 2 + 0.35).translate(0, 1.2 + i * 0.75, 0), i % 2 ? 0xf6f0e0 : 0xc9502a));
  }
  p.push(paint(new THREE.SphereGeometry(0.2, 8, 6).translate(0, 6.3, 0), GOLD));
  return merge(p);
}
/** Where a lantern string hangs from a pole (top, a little below the finial). */
export const POLE_TOP = 5.7;

/** A long trestle table for the feast, with a cream cloth and a runner, and a bench either side. ~5.2 x 2.6 m, along x. */
export function tableGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  const L = 5.2;
  box(p, L, 0.1, 1.1, 0, 0.82, 0, 0x8a5a34);
  box(p, L + 0.1, 0.03, 1.2, 0, 0.92, 0, 0xf0e6d2);
  box(p, L + 0.12, 0.035, 0.36, 0, 0.93, 0, 0xc9502a);
  for (const s of [-1, 1]) {
    box(p, 0.12, 0.82, 0.9, s * (L / 2 - 0.4), 0, 0, 0x5a3b22);
    box(p, L - 0.4, 0.08, 0.36, 0, 0.42, s * 0.95, 0x8a5a34);
    for (const e of [-1, 1]) box(p, 0.1, 0.42, 0.3, e * (L / 2 - 0.6), 0, s * 0.95, 0x5a3b22);
  }
  return merge(p);
}

/** The feast on a table (set on when the food has come): loaves, pies, fruit bowls, jugs and a great round cheese. */
export function feastGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const y = 0.95;
  for (let x = -2.25; x <= 2.3; x += 0.62) {
    const z = rng.range(-0.28, 0.28);
    const k = rng.int(0, 4);
    if (k === 0) p.push(paint(new THREE.SphereGeometry(0.17, 8, 5).scale(1.6, 0.8, 1).translate(x, y + 0.1, z), 0xc8873e, 0.1, rng));
    else if (k === 1) {
      p.push(paint(new THREE.CylinderGeometry(0.24, 0.2, 0.1, 12).translate(x, y + 0.05, z), 0xd9a24a));
      p.push(paint(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 12).translate(x, y + 0.11, z), 0xa8402a));
    } else if (k === 2) {
      p.push(paint(new THREE.CylinderGeometry(0.22, 0.12, 0.12, 10).translate(x, y + 0.06, z), 0xe8dcc0));
      for (let i = 0; i < 4; i++) p.push(paint(new THREE.IcosahedronGeometry(0.08, 0).translate(x + Math.cos(i * 1.6) * 0.09, y + 0.17, z + Math.sin(i * 1.6) * 0.09), [0xc9302a, 0xe8a030, 0x7aa83a, 0x8a3fb0][i]));
    } else if (k === 3) {
      p.push(paint(new THREE.CylinderGeometry(0.1, 0.13, 0.36, 8).translate(x, y + 0.18, z), 0x9a6a3e));
    } else p.push(paint(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12).translate(x, y + 0.08, z), 0xf2d27a));
  }
  return merge(p);
}

/**
 * A midwinter woodpile: a ring of hearth stones and a cone of logs leaning together, ready to light. ~2.4 m tall.
 */
export function firePileGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    p.push(paint(new THREE.DodecahedronGeometry(rng.range(0.24, 0.32), 0).scale(1, 0.7, 1).translate(Math.cos(a) * 1.25, 0.12, Math.sin(a) * 1.25), rng.pick(STONE), 0.1, rng));
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const len = rng.range(2.3, 2.7);
    const lean = 0.42;
    const g = new THREE.CylinderGeometry(0.1, 0.13, len, 5).translate(0, len / 2, 0).rotateZ(lean).rotateY(-a);
    g.translate(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95);
    p.push(paint(g, rng.pick(WOOD), 0.12, rng));
  }
  for (let i = 0; i < 4; i++) p.push(paint(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 5).rotateZ(Math.PI / 2).rotateY(i * 0.8).translate(0, 0.18 + i * 0.05, 0), rng.pick(WOOD)));
  return merge(p);
}

/** A paper lantern (drawn unlit-bright, so each one glows in its own colour). */
export function lanternGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.26, 0.26, 0.36, 8, 1);
  const top = new THREE.CylinderGeometry(0.12, 0.26, 0.1, 8, 1).translate(0, 0.23, 0);
  const bot = new THREE.CylinderGeometry(0.26, 0.12, 0.1, 8, 1).translate(0, -0.23, 0);
  const m = merge([g.toNonIndexed(), top.toNonIndexed(), bot.toNonIndexed()].map((x) => {
    x.deleteAttribute('uv');
    x.deleteAttribute('normal');
    return x;
  }));
  return m;
}
