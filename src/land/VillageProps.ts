import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, jitterVerts, merge, paint } from '../art/Models';
import { Rng } from '../util/rng';

/**
 * Lived-in village props for the decor layer (village art pass 2026-10-16, after storyboard panel 2: a dense village of
 * barns, sheds, stalls, carts, haystacks and lamps between the homes). Purely visual, drawn instanced by VillageDecor;
 * none of these is a house (they are never counted, entered or lived in). Origin on the ground, front toward +z.
 * Geometries with a lit part come as two groups: [0] the body on MAT.base, [1] the glow on PROP_GLOW.
 */

/** Lamps, workshop windows and the forge: warm, softly lit by day and glowing at dusk (like a lived-in home's windows). */
export const PROP_GLOW = new THREE.MeshStandardMaterial({ color: 0x4a3418, emissive: 0xffa640, emissiveIntensity: 0.9, roughness: 0.6 });
export const PROP_MATS: THREE.Material[] = [MAT.base, PROP_GLOW];

const TIMBER = 0x5a3b22;
const PLANK = [0x8a5a34, 0x7a4e2e, 0x936238];
const STONE = [0xa39a88, 0x9a917f, 0xb0a691, 0x8f877a];
const SHINGLE = [0x7d4a2e, 0x6f4429, 0x8a5634];

type Parts = THREE.BufferGeometry[];

function box(parts: Parts, w: number, h: number, d: number, x: number, y: number, z: number, col: THREE.ColorRepresentation, jit = 0, rng?: Rng) {
  parts.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, jit, rng));
}

/** A gable roof (ridge along x) as two sloped slabs with a ridge beam. */
function gable(parts: Parts, L: number, D: number, yE: number, yR: number, col: number, rng: Rng, thick = 0.18) {
  const len = Math.hypot(D, yR - yE);
  const ang = Math.atan2(yR - yE, D);
  for (const s of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      const t = (r + 0.5) / 3;
      const g = new THREE.BoxGeometry(2 * L, thick, len / 3 + 0.04).rotateX(s * ang).translate(0, yE + (yR - yE) * t + 0.03 * (3 - r), s * D * (1 - t));
      parts.push(paint(g, new THREE.Color(col).multiplyScalar(1 - (r % 2) * 0.08), 0.18, rng));
    }
  }
  box(parts, 2 * L + 0.1, 0.2, 0.3, 0, yR - 0.08, 0, TIMBER);
}

function withGlow(body: Parts, glow: Parts): THREE.BufferGeometry {
  const a = merge(body);
  if (!glow.length) return a;
  const g = mergeGeometries([a, merge(glow)], true);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeBoundingSphere();
  return g;
}

/** A big plank barn: stone footing, wide double doors with cross braces, a deep roof and a vent on the ridge. ~8 x 6 m. */
export function barnGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const w = 8;
  const d = 6;
  const plank = rng.pick([0x8a3e2a, 0x7a4e2e, 0x93603a]);
  box(p, w + 0.3, 1.6, d + 0.3, 0, -0.9, 0, rng.pick(STONE), 0.08, rng);
  box(p, w, 3.6, d, 0, 0.6, 0, plank, 0.06, rng);
  // Vertical boards.
  for (let x = -w / 2 + 0.4; x < w / 2; x += 0.55) for (const s of [-1, 1]) box(p, 0.08, 3.5, 0.06, x, 0.65, s * (d / 2 + 0.02), new THREE.Color(plank).multiplyScalar(0.82));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(p, 0.3, 3.8, 0.3, (sx * w) / 2, 0.5, (sz * d) / 2, TIMBER);
  box(p, w + 0.1, 0.2, d + 0.1, 0, 4.1, 0, TIMBER);
  // Double doors with cross braces.
  box(p, 2.8, 2.9, 0.12, 0, 0.6, d / 2 + 0.08, 0xd9c8a6);
  for (const sx of [-1, 1]) {
    box(p, 1.25, 2.7, 0.1, sx * 0.68, 0.7, d / 2 + 0.14, plank);
    const br = new THREE.BoxGeometry(0.12, 2.9, 0.08).rotateZ(sx * 0.44).translate(sx * 0.68, 2.05, d / 2 + 0.2);
    p.push(paint(br, 0xe8dcc0));
  }
  // Gable ends (both windings, so they read from either side).
  const yE = 4.2;
  const yR = 7.1;
  for (const sx of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([sx * (w / 2), yE, -d / 2, sx * (w / 2), yE, d / 2, sx * (w / 2), yR, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    p.push(paint(g, plank));
    const back = new THREE.BufferGeometry();
    back.setAttribute('position', new THREE.BufferAttribute(new Float32Array([v[0], v[1], v[2], v[6], v[7], v[8], v[3], v[4], v[5]]), 3));
    back.computeVertexNormals();
    p.push(paint(back, plank));
  }
  const roofCol = rng.pick(SHINGLE);
  gable(p, w / 2 + 0.6, d / 2 + 0.7, yE - 0.15, yR, roofCol, rng, 0.22);
  // A cupola vent on the ridge.
  box(p, 0.9, 0.8, 0.9, 0, yR - 0.1, 0, 0xe8dcc0);
  const cap = new THREE.ConeGeometry(0.85, 0.7, 4).rotateY(Math.PI / 4).translate(0, yR + 1.05, 0);
  p.push(paint(cap, roofCol));
  return merge(p);
}

/** An open-fronted woodshed: four posts, a lean-to roof, stacked logs inside. ~4 x 2.4 m. */
export function woodshedGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const w = 4;
  const d = 2.4;
  for (const sx of [-1, 1]) {
    box(p, 0.2, 2.6, 0.2, sx * (w / 2), 0, -d / 2, TIMBER);
    box(p, 0.2, 2.1, 0.2, sx * (w / 2), 0, d / 2, TIMBER);
  }
  box(p, w, 2.5, 0.12, 0, 0, -d / 2 - 0.05, rng.pick(PLANK), 0.08, rng);
  const roof = new THREE.BoxGeometry(w + 0.6, 0.16, d + 0.8).rotateX(-0.2).translate(0, 2.45, 0);
  p.push(paint(roof, rng.pick(SHINGLE), 0.12, rng));
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 7 - (row % 2); i++) {
      const log = new THREE.CylinderGeometry(0.17, 0.17, 1.6, 6).rotateX(Math.PI / 2);
      log.translate(-w / 2 + 0.4 + i * 0.52 + (row % 2) * 0.26, 0.17 + row * 0.32, -0.1);
      p.push(paint(log, rng.pick([0x8a5a32, 0x7a4a2a, 0x946236]), 0.1, rng));
    }
  // Chopping block with an axe.
  box(p, 0.5, 0.5, 0.5, 1.4, 0, d / 2 + 0.9, 0x6e4a2a);
  box(p, 0.06, 0.7, 0.06, 1.4, 0.5, d / 2 + 0.9, 0x946039);
  return merge(p);
}

/** A stone workshop (smithy or bakery) with a big chimney, an open forge glowing at the front, lit windows. ~5.4 x 4.4 m. */
export function workshopGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const glow: Parts = [];
  const w = 5.4;
  const d = 4.4;
  const stone = rng.pick(STONE);
  box(p, w + 0.3, 1.5, d + 0.3, 0, -1, 0, stone, 0.08, rng);
  box(p, w, 3.0, d, 0, 0.4, 0, stone, 0.1, rng);
  for (let r = 0; r < 6; r++)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(p, r % 2 ? 0.5 : 0.3, 0.42, r % 2 ? 0.3 : 0.5, sx * (w / 2 - 0.08), 0.45 + r * 0.48, sz * (d / 2 - 0.08), rng.pick(STONE), 0.1, rng);
  gable(p, w / 2 + 0.5, d / 2 + 0.6, 3.25, 5.4, rng.pick(SHINGLE), rng);
  for (const sx of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([sx * (w / 2), 3.3, -d / 2, sx * (w / 2), 3.3, d / 2, sx * (w / 2), 5.3, 0]), 3));
    g.computeVertexNormals();
    p.push(paint(g, stone));
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(new Float32Array([sx * (w / 2), 3.3, -d / 2, sx * (w / 2), 5.3, 0, sx * (w / 2), 3.3, d / 2]), 3));
    b.computeVertexNormals();
    p.push(paint(b, stone));
  }
  // Big chimney at the back, a forge hood at the front with the fire glowing under it.
  box(p, 1.4, 6.6, 1.4, w / 2 - 1.1, 0, -d / 2 + 0.6, rng.pick(STONE), 0.12, rng);
  box(p, 1.6, 0.25, 1.6, w / 2 - 1.1, 6.6, -d / 2 + 0.6, 0x6e695f);
  box(p, 1.8, 1.0, 1.0, -1.0, 0.4, d / 2 + 0.5, stone, 0.1, rng);
  glow.push(paint(new THREE.BoxGeometry(1.2, 0.35, 0.7).translate(-1.0, 1.55, d / 2 + 0.5), 0xffffff));
  box(p, 2.2, 0.2, 1.4, -1.0, 2.6, d / 2 + 0.5, TIMBER);
  // Anvil.
  box(p, 0.5, 0.5, 0.35, 0.8, 0.4, d / 2 + 0.9, 0x6e4a2a);
  box(p, 0.7, 0.22, 0.3, 0.8, 0.9, d / 2 + 0.9, 0x3a3a3c);
  // Door and lit windows.
  box(p, 1.1, 2.1, 0.14, 1.2, 0.4, d / 2 + 0.05, 0x4a2f1c);
  for (const [x, z, alongZ] of [[0, -d / 2, false], [-w / 2, 0, true], [w / 2, 0.3, true]] as [number, number, boolean][]) {
    const sx = alongZ ? Math.sign(x) : 0;
    const sz = alongZ ? 0 : Math.sign(z);
    const fx = alongZ ? x + sx * 0.06 : x;
    const fz = alongZ ? z : z + sz * 0.06;
    p.push(paint((alongZ ? new THREE.BoxGeometry(0.1, 1.0, 1.1) : new THREE.BoxGeometry(1.1, 1.0, 0.1)).translate(fx, 2.0, fz), TIMBER));
    glow.push(paint((alongZ ? new THREE.BoxGeometry(0.12, 0.8, 0.9) : new THREE.BoxGeometry(0.9, 0.8, 0.12)).translate(fx + sx * 0.03, 2.0, fz + sz * 0.03), 0xffffff));
  }
  return withGlow(p, glow);
}

/** A market stall: a trestle counter of goods under a striped awning in `color` and linen. ~3 x 2 m. */
export function stallGeometry(seed: number, color: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(p, 0.14, sz < 0 ? 2.7 : 2.3, 0.14, sx * 1.4, 0, sz * 0.9, TIMBER);
  box(p, 3.0, 0.14, 1.3, 0, 0.9, 0.25, rng.pick(PLANK));
  box(p, 2.8, 0.85, 0.1, 0, 0.05, 0.85, rng.pick(PLANK), 0.08, rng);
  // Goods: baskets of produce, loaves, cloth bolts, pots.
  const goods = [0xd9a24a, 0xc9502a, 0x7aa83a, 0xe8d8b0, 0x8a5fb0, 0xb0602a];
  for (let i = 0; i < 6; i++) {
    const x = -1.2 + i * 0.48;
    const g = rng.next() < 0.5 ? new THREE.CylinderGeometry(0.2, 0.16, 0.2, 7).translate(x, 1.12, 0.3) : new THREE.IcosahedronGeometry(0.2, 0).scale(1, 0.75, 1).translate(x, 1.16, 0.25);
    p.push(paint(g, rng.pick(goods), 0.15, rng));
  }
  // Awning: alternate stripes of the colour and linen, sloping down to the front.
  const N = 6;
  for (let i = 0; i < N; i++) {
    const x = -1.65 + (3.3 * (i + 0.5)) / N;
    const g = new THREE.BoxGeometry(3.3 / N + 0.01, 0.08, 2.4).rotateX(0.2).translate(x, 2.5, 0);
    p.push(paint(g, i % 2 ? 0xf0e6d2 : color, 0.05, rng));
  }
  // Scalloped valance along the front.
  for (let i = 0; i < N; i++) {
    const x = -1.65 + (3.3 * (i + 0.5)) / N;
    p.push(paint(new THREE.ConeGeometry(0.28, 0.35, 3).rotateX(Math.PI).translate(x, 2.06, 1.2), i % 2 ? 0xf0e6d2 : color));
  }
  // A crate and a sack beside it.
  box(p, 0.7, 0.6, 0.7, 2.0, 0, 0.4, 0x9a7a4a, 0.1, rng);
  p.push(paint(new THREE.IcosahedronGeometry(0.38, 1).scale(1, 1.2, 1).translate(-2.0, 0.42, 0.5), 0xd8c49a, 0.08, rng));
  return merge(p);
}

/** The village well: a round stone wall, two posts, a shingled hood and a windlass with a bucket. */
export function wellGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(1.2, 1.3, 1.0, 12).translate(0, 0.5, 0), rng.pick(STONE), 0.12, rng));
  p.push(paint(new THREE.CylinderGeometry(1.32, 1.32, 0.16, 12).translate(0, 1.02, 0), 0x8d877c));
  p.push(paint(new THREE.CylinderGeometry(0.95, 0.95, 0.05, 12).translate(0, 1.0, 0), 0x2a4a6a));
  for (const sx of [-1, 1]) box(p, 0.18, 2.3, 0.18, sx * 1.05, 1.0, 0, TIMBER);
  box(p, 2.3, 0.14, 0.14, 0, 2.7, 0, TIMBER);
  p.push(paint(new THREE.CylinderGeometry(0.14, 0.14, 1.9, 6).rotateZ(Math.PI / 2).translate(0, 2.2, 0), 0x946039));
  p.push(paint(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 7).translate(0.2, 1.55, 0), 0x7a5230));
  const hood = new THREE.ConeGeometry(1.9, 1.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.8).translate(0, 3.4, 0);
  p.push(paint(hood, rng.pick(SHINGLE), 0.12, rng));
  return merge(p);
}

/** A hand cart: a box bed on two spoked wheels with shafts, sometimes loaded. */
export function cartGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  box(p, 2.2, 0.5, 1.3, 0, 0.75, 0, rng.pick(PLANK), 0.08, rng);
  box(p, 2.3, 0.1, 1.4, 0, 0.7, 0, TIMBER);
  for (const sz of [-1, 1]) {
    p.push(paint(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 12).rotateX(Math.PI / 2).translate(0.1, 0.62, sz * 0.78), 0x6a4a2a));
    p.push(paint(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 8).rotateX(Math.PI / 2).translate(0.1, 0.62, sz * 0.8), 0x3a3a3c));
    box(p, 1.8, 0.1, 0.1, 1.9, 0.6, sz * 0.5, TIMBER);
  }
  const load = rng.int(0, 2);
  if (load === 0) for (let i = 0; i < 3; i++) p.push(paint(new THREE.CylinderGeometry(0.2, 0.2, 2.0, 6).rotateZ(Math.PI / 2).translate(0, 1.2, -0.4 + i * 0.4), 0x8a5a32, 0.1, rng));
  if (load === 1) p.push(paint(jitterVerts(new THREE.IcosahedronGeometry(0.75, 1), 0.1, rng).scale(1.3, 0.6, 0.8).translate(0, 1.25, 0), 0xd8b45e, 0.1, rng));
  if (load === 2) for (let i = 0; i < 4; i++) p.push(paint(new THREE.IcosahedronGeometry(0.3, 1).translate(-0.6 + i * 0.4, 1.2, rng.range(-0.3, 0.3)), rng.pick([0xd8c49a, 0xc9a86a]), 0.08, rng));
  return merge(p);
}

/** A haystack: a rounded golden stack with a darker cap. */
export function haystackGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  p.push(paint(jitterVerts(new THREE.CylinderGeometry(1.1, 1.35, 1.6, 10, 2), 0.08, rng).translate(0, 0.8, 0), 0xd8b45e, 0.1, rng));
  p.push(paint(jitterVerts(new THREE.SphereGeometry(1.15, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.08, rng).scale(1, 0.85, 1).translate(0, 1.55, 0), 0xc9a24a, 0.1, rng));
  p.push(paint(new THREE.ConeGeometry(0.3, 0.5, 6).translate(0, 2.6, 0), 0xa8843a));
  return merge(p);
}

/** A tall lamp post: a stone foot, a timber post, a bracket and a glowing lantern. */
export function lampGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(0.3, 0.36, 0.4, 6).translate(0, 0.2, 0), 0x8d877c));
  box(p, 0.16, 3.0, 0.16, 0, 0.3, 0, TIMBER);
  box(p, 0.7, 0.1, 0.1, 0.3, 3.1, 0, TIMBER);
  box(p, 0.42, 0.08, 0.42, 0.6, 2.95, 0, 0x2f2a26);
  box(p, 0.36, 0.06, 0.36, 0.6, 2.38, 0, 0x2f2a26);
  p.push(paint(new THREE.ConeGeometry(0.32, 0.26, 4).rotateY(Math.PI / 4).translate(0.6, 3.15, 0), 0x2f2a26));
  const glow: Parts = [paint(new THREE.BoxGeometry(0.3, 0.52, 0.3).translate(0.6, 2.68, 0), 0xffffff)];
  return withGlow(p, glow);
}
