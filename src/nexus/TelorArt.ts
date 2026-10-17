import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, merge, paint, treeGeometry } from '../art/Models';
import { Rng } from '../util/rng';

/**
 * Telor's buildings (the last age, src/nexus/Telor.ts): the ancient-future city the three villages grow into around
 * the Nexus. Warm stone, cream and ochre plaster, terracotta and slate roofs, arched windows lit gold, balconies,
 * colonnades, a few slender towers with gold caps, walls of warm stone with gates, lamps and fountains.
 * Everything faces +z (the street) and stands on a stone footing that runs down into the ground (no floating on a
 * slope). Geometries with a lit part come as two groups: [0] the body on MAT.base, [1] the glow on TELOR_GLOW.
 */

/** Window panes and lanterns: warm gold, brighter at night (the age sets the intensity). */
export const TELOR_GLOW = new THREE.MeshStandardMaterial({ color: 0x4a3418, emissive: 0xffb050, emissiveIntensity: 0.6, roughness: 0.5 });
export const TELOR_MATS: THREE.Material[] = [MAT.base, TELOR_GLOW];

const SAND = [0xdcc196, 0xd2b484, 0xe4cca2, 0xcdb08a];
const PLASTER = [0xf2e6cc, 0xead7b0, 0xf0dfc0, 0xe6c995, 0xdcb48c, 0xf4ecdc];
const TERRACOTTA = [0xb5582f, 0xa84c2b, 0xbf6a3c, 0x9e4a2c];
const SLATE = [0x56607a, 0x4e5872, 0x5e6884];
const SHUTTER = [0x2c3e6a, 0x3f7a7a, 0x4a6a3a, 0x8a3a2a, 0x2a4a6a];
const TRIM = 0xc9b18a;
const IRON = 0x2b2a2e;
const GOLD = 0xd9b25a;
const NAVY = 0x1f2f5a;
const VERDIGRIS = 0x5f9a8a;

type Parts = THREE.BufferGeometry[];

function box(p: Parts, w: number, h: number, d: number, x: number, y: number, z: number, col: THREE.ColorRepresentation, jit = 0, rng?: Rng) {
  p.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, jit, rng));
}

function withGlow(body: Parts, glow: Parts): THREE.BufferGeometry {
  const a = merge(body);
  if (!glow.length) {
    // Keep two groups so every building takes the same material pair.
    a.addGroup(0, a.attributes.position.count, 0);
    return a;
  }
  const g = mergeGeometries([a, merge(glow)], true);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeBoundingSphere();
  return g;
}

/** A hipped roof over w x d at height y (a four-sided pyramid, flattened to the footprint), with eaves. */
function hipRoof(p: Parts, w: number, d: number, y: number, h: number, col: number, rng: Rng) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  g.scale(w + 0.9, h, d + 0.9).translate(0, y + h / 2, 0);
  p.push(paint(g, col, 0.1, rng));
}

/** A gable roof along x, its eaves at y, ridge at y + h. */
function gableRoof(p: Parts, w: number, d: number, y: number, h: number, col: number, rng: Rng) {
  const D = d / 2 + 0.45;
  const len = Math.hypot(D, h);
  const ang = Math.atan2(h, D);
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(w + 0.7, 0.22, len).rotateX(s * ang).translate(0, y + h / 2, (s * D) / 2);
    p.push(paint(g, col, 0.12, rng));
  }
  // The gable ends.
  const tri = new THREE.BufferGeometry();
  const hw = w / 2;
  const v = new Float32Array([
    -hw, y, -d / 2, -hw, y, d / 2, -hw, y + h - 0.1, 0,
    hw, y, d / 2, hw, y, -d / 2, hw, y + h - 0.1, 0,
  ]);
  tri.setAttribute('position', new THREE.BufferAttribute(v, 3));
  tri.computeVertexNormals();
  p.push(paint(tri, rng.pick(PLASTER)));
}

/** An arched window on a wall facing +z (or -z with `back`): frame, pane (glow), shutters, maybe a flower box. */
function win(p: Parts, glow: Parts, x: number, y: number, z: number, rng: Rng, opts: { back?: boolean; side?: number; shutters?: number; flowers?: boolean; w?: number; h?: number } = {}) {
  const w = opts.w ?? 0.9;
  const h = opts.h ?? 1.35;
  const parts: Parts = [];
  const gl: Parts = [];
  box(parts, w + 0.3, h + 0.35, 0.16, 0, -0.18, 0.06, TRIM);
  gl.push(paint(new THREE.BoxGeometry(w, h * 0.78, 0.1).translate(0, h * 0.39, 0.14), 0xffffff));
  gl.push(paint(new THREE.CylinderGeometry(w / 2, w / 2, 0.1, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, h * 0.78, 0.14), 0xffffff));
  if (opts.shutters !== undefined) {
    for (const s of [-1, 1]) box(parts, w * 0.5, h * 0.85, 0.08, s * (w * 0.5 + 0.3), 0, 0.12, SHUTTER[opts.shutters % SHUTTER.length]);
  }
  if (opts.flowers) {
    box(parts, w + 0.3, 0.26, 0.4, 0, -0.42, 0.3, 0x7a5a38);
    for (let i = 0; i < 4; i++) parts.push(paint(new THREE.IcosahedronGeometry(0.16, 0).translate(-w / 2 + (i + 0.5) * (w / 4), -0.08, 0.32), [0xe85a6a, 0xf2c84a, 0xf4f0e6, 0xb070d8][rng.int(0, 3)]));
  }
  const place = (g: THREE.BufferGeometry) => {
    if (opts.back) g.rotateY(Math.PI);
    if (opts.side) g.rotateY((opts.side * Math.PI) / 2);
    return g.translate(x, y, z);
  };
  for (const g of parts) p.push(place(g));
  for (const g of gl) glow.push(place(g));
}

/**
 * A townhouse: two or three floors over a warm stone arcade, plastered upper floors with cornices, arched lit windows
 * with shutters and flower boxes, a balcony, a terracotta or slate roof, a chimney or a gold finial. ~7-9 x 7 m.
 */
export function townhouseGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const glow: Parts = [];
  const w = rng.range(7, 9);
  const d = rng.range(6.6, 7.8);
  const floors = rng.next() < 0.45 ? 3 : 2;
  const gH = 3.6;
  const fH = 3.1;
  const sand = rng.pick(SAND);
  const plaster = rng.pick(PLASTER);
  const shutters = rng.int(0, SHUTTER.length - 1);
  // Footing into the ground.
  box(p, w + 0.5, 3.6, d + 0.5, 0, -3.3, 0, 0x9a8a6e, 0.06, rng);
  // Ground floor: warm stone with an arcade of three arches on the street.
  box(p, w, gH, d, 0, 0, 0, sand, 0.05, rng);
  const arches = Math.max(2, Math.round(w / 2.8));
  for (let i = 0; i < arches; i++) {
    const x = -w / 2 + (i + 0.5) * (w / arches);
    box(p, 1.5, 2.3, 0.2, x, 0, d / 2 + 0.02, 0x4a3a2c);
    p.push(paint(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, 2.3, d / 2 + 0.02), 0x4a3a2c));
    // A warm light inside the arch (a shop, a door).
    glow.push(paint(new THREE.BoxGeometry(1.1, 1.6, 0.06).translate(x, 0.9, d / 2 + 0.1), 0xffffff));
    box(p, 0.3, gH, 0.3, -w / 2 + i * (w / arches), 0, d / 2 + 0.06, TRIM);
  }
  box(p, 0.3, gH, 0.3, w / 2, 0, d / 2 + 0.06, TRIM);
  // Upper floors: plaster with a stone cornice between.
  let y = gH;
  for (let f = 0; f < floors - 1; f++) {
    box(p, w + 0.35, 0.3, d + 0.35, 0, y, 0, TRIM);
    box(p, w, fH, d, 0, y + 0.3, 0, plaster, 0.04, rng);
    const n = Math.max(2, Math.round(w / 2.3));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      win(p, glow, x, y + 1.25, d / 2, rng, { shutters, flowers: f === 0 && rng.next() < 0.6 });
      win(p, glow, x, y + 1.25, -d / 2, rng, { back: true });
    }
    for (const s of [-1, 1]) win(p, glow, (s * w) / 2, y + 1.25, 0, rng, { side: s });
    y += fH + 0.3;
  }
  // A balcony on the first floor.
  if (rng.next() < 0.65) {
    box(p, w * 0.55, 0.18, 1.1, 0, gH + 0.3, d / 2 + 0.55, TRIM);
    box(p, w * 0.55, 0.9, 0.08, 0, gH + 0.48, d / 2 + 1.08, IRON);
  }
  box(p, w + 0.5, 0.35, d + 0.5, 0, y, 0, TRIM);
  // Roof.
  const roofCol = rng.next() < 0.72 ? rng.pick(TERRACOTTA) : rng.pick(SLATE);
  if (rng.next() < 0.5) hipRoof(p, w, d, y + 0.35, rng.range(2.4, 3.2), roofCol, rng);
  else gableRoof(p, w, d, y + 0.35, rng.range(2.6, 3.4), roofCol, rng);
  if (rng.next() < 0.6) {
    box(p, 0.8, 2.6, 0.8, w * 0.28, y + 0.6, -d * 0.2, sand);
    box(p, 1, 0.2, 1, w * 0.28, y + 3.2, -d * 0.2, TRIM);
  } else p.push(paint(new THREE.ConeGeometry(0.22, 1.4, 6).translate(0, y + 3.7, 0), GOLD));
  return withGlow(p, glow);
}

/**
 * A hall: a broad building on a stepped plinth with a colonnade along the street and a dome (gold or verdigris) or a
 * pediment roof. ~15 x 11 m. The guild halls, the library, the meeting house.
 */
export function hallGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const glow: Parts = [];
  const w = rng.range(14, 16);
  const d = rng.range(10, 12);
  const H = 6.4;
  box(p, w + 2, 3.6, d + 2, 0, -3.3, 0, 0x9a8a6e, 0.05, rng);
  box(p, w + 1.6, 0.35, d + 2.4, 0, 0.0, 0.3, TRIM);
  box(p, w + 0.8, 0.35, d + 1.6, 0, 0.35, 0.3, 0xd8c7a2);
  box(p, w, H, d, 0, 0.7, -0.4, rng.pick(SAND), 0.04, rng);
  // The colonnade.
  const cols = 6;
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + 0.8 + (i * (w - 1.6)) / (cols - 1);
    p.push(paint(new THREE.CylinderGeometry(0.36, 0.42, H - 0.6, 10).translate(x, 0.7 + (H - 0.6) / 2, d / 2 + 0.9), 0xf0e6d2));
    box(p, 1, 0.3, 1, x, 0.7 + H - 0.6, d / 2 + 0.9, TRIM);
  }
  box(p, w + 0.4, 0.7, 2.2, 0, 0.7 + H - 0.3, d / 2 + 0.6, TRIM);
  // Tall arched windows, lit.
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (i + 0.5) * (w / 4);
    win(p, glow, x, 2.2, d / 2 - 0.4, rng, { w: 1.4, h: 2.8 });
    win(p, glow, x, 2.2, -d / 2 - 0.4, rng, { back: true, w: 1.4, h: 2.8 });
  }
  // A great door.
  glow.push(paint(new THREE.BoxGeometry(2.2, 3.2, 0.08).translate(0, 0.7 + 1.6, d / 2 - 0.32), 0xffffff));
  const top = 0.7 + H + 0.4;
  if (rng.next() < 0.6) {
    // A drum and a dome.
    p.push(paint(new THREE.CylinderGeometry(d * 0.36, d * 0.38, 2, 20).translate(0, top - 0.4 + 1, -0.4), rng.pick(PLASTER)));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      glow.push(paint(new THREE.BoxGeometry(0.6, 1, 0.1).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * d * 0.37, top + 0.7, -0.4 + Math.sin(a) * d * 0.37), 0xffffff));
    }
    p.push(paint(new THREE.SphereGeometry(d * 0.36, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, top + 1.6, -0.4), rng.next() < 0.5 ? GOLD : VERDIGRIS, 0.04, rng));
    p.push(paint(new THREE.ConeGeometry(0.3, 2.2, 8).translate(0, top + 1.6 + d * 0.36 + 1, -0.4), GOLD));
  } else {
    gableRoof(p, w + 0.4, d + 0.4, top - 0.4, 2.8, rng.pick(TERRACOTTA), rng);
  }
  // Navy banners with a gold mark either side of the door.
  for (const s of [-1, 1]) {
    box(p, 1.2, 3.4, 0.06, s * 2.6, 2.2, d / 2 + 2.05, NAVY);
    box(p, 0.5, 0.5, 0.07, s * 2.6, 4.2, d / 2 + 2.06, GOLD);
  }
  return withGlow(p, glow);
}

/** A slender tower: stone shaft with bands, a lit lantern room, a steep slate cap and a gold spire. ~5 x 5 x 20 m. */
export function towerGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const glow: Parts = [];
  const s = 4.4;
  const H = rng.range(14, 17);
  box(p, s + 1, 3.6, s + 1, 0, -3.3, 0, 0x9a8a6e);
  box(p, s + 0.6, 1.2, s + 0.6, 0, 0, 0, TRIM);
  box(p, s, H, s, 0, 1.2, 0, rng.pick(SAND), 0.04, rng);
  for (const y of [5, 9.5]) box(p, s + 0.3, 0.3, s + 0.3, 0, y, 0, TRIM);
  for (let k = 0; k < 4; k++) win(p, glow, 0, 6.2, s / 2, rng, { side: k, w: 0.7, h: 1.4 });
  const top = 1.2 + H;
  box(p, s + 0.8, 0.4, s + 0.8, 0, top, 0, TRIM);
  // The lantern room: four lit openings between corner posts.
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(p, 0.5, 2.4, 0.5, (x * s) / 2.3, top + 0.4, (z * s) / 2.3, TRIM);
  glow.push(paint(new THREE.BoxGeometry(s * 0.75, 2.2, s * 0.75).translate(0, top + 1.5, 0), 0xffffff));
  const cap = new THREE.ConeGeometry(s * 0.78, 5, 4).rotateY(Math.PI / 4).translate(0, top + 2.8 + 2.5, 0);
  p.push(paint(cap, rng.pick(SLATE)));
  p.push(paint(new THREE.CylinderGeometry(0.06, 0.12, 3, 6).translate(0, top + 2.8 + 5 + 1.5, 0), GOLD));
  p.push(paint(new THREE.SphereGeometry(0.32, 10, 8).translate(0, top + 2.8 + 5 + 0.3, 0), GOLD));
  return withGlow(p, glow);
}

/** One metre of city wall along x (scaled along x per segment): warm stone, a coping, and a footing into the ground. */
export function wallGeometry(): THREE.BufferGeometry {
  const rng = new Rng(4401);
  const p: Parts = [];
  box(p, 1.02, 7.2, 1.3, 0, -3.4, 0, 0xc4ab84, 0.06, rng);
  box(p, 1.04, 0.35, 1.6, 0, 3.8, 0, 0xd8c39c);
  box(p, 1.02, 0.6, 0.35, 0, 4.15, 0.6, 0xc9b08a);
  return withGlow(p, []);
}

/** A gate tower: square, crenellated, a navy banner with a gold mark, a lantern each side. */
export function gateTowerGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  const glow: Parts = [];
  box(p, 5.4, 3.6, 5.4, 0, -3.3, 0, 0x9a8a6e);
  box(p, 5, 9, 5, 0, 0, 0, 0xc9b08a, 0.05, rng);
  box(p, 5.6, 0.5, 5.6, 0, 9, 0, 0xd8c39c);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(p, 1, 1, 0.6, -1.9 + i * 1.27, 9.5, s * 2.5, 0xc9b08a);
  box(p, 1.6, 4.2, 0.06, 0, 3.6, 2.56, NAVY);
  p.push(paint(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 12).rotateX(Math.PI / 2).translate(0, 6.6, 2.6), GOLD));
  for (const s of [-1, 1]) {
    box(p, 0.4, 0.4, 0.4, s * 1.6, 3.5, 2.7, IRON);
    glow.push(paint(new THREE.BoxGeometry(0.36, 0.6, 0.36).translate(s * 1.6, 3.9, 2.7), 0xffffff));
  }
  win(p, glow, 0, 5.6, -2.5, rng, { back: true, w: 0.7, h: 1.2 });
  return withGlow(p, glow);
}

/** A street lamp: a stone foot, a slim iron post with a crook, and a lantern. 4.2 m. The glow sprite sits at (0.55, 3.7). */
export function lampGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  const glow: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(0.32, 0.4, 0.5, 8).translate(0, 0.0, 0), 0xb5a383));
  p.push(paint(new THREE.CylinderGeometry(0.07, 0.09, 4, 6).translate(0, 2.2, 0), IRON));
  box(p, 0.7, 0.08, 0.08, 0.3, 4.1, 0, IRON);
  box(p, 0.42, 0.08, 0.42, 0.55, 4.05, 0, IRON);
  p.push(paint(new THREE.ConeGeometry(0.34, 0.3, 4).rotateY(Math.PI / 4).translate(0.55, 4.25, 0), GOLD));
  glow.push(paint(new THREE.BoxGeometry(0.32, 0.5, 0.32).translate(0.55, 3.75, 0), 0xffffff));
  return withGlow(p, glow);
}
export const LAMP_HEAD = new THREE.Vector3(0.55, 3.75, 0);

/** A round fountain: a stone basin, water, a column with a gold bowl and an orb. ~6 m across. */
export function fountainGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  const glow: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(3.2, 3.4, 1, 24).translate(0, -0.2, 0), 0xc9b690));
  p.push(paint(new THREE.CylinderGeometry(2.8, 2.8, 0.1, 24).translate(0, 0.32, 0), 0x4f9ab8));
  p.push(paint(new THREE.CylinderGeometry(0.4, 0.55, 2.4, 10).translate(0, 1.2, 0), 0xd8c7a2));
  p.push(paint(new THREE.CylinderGeometry(1.1, 0.3, 0.5, 14).translate(0, 2.6, 0), GOLD));
  glow.push(paint(new THREE.SphereGeometry(0.42, 12, 8).translate(0, 3.2, 0), 0xffffff));
  return withGlow(p, glow);
}

/** A planter of warm stone with a young tree. */
export function planterGeometry(seed: number): THREE.BufferGeometry {
  const p: Parts = [];
  box(p, 2.2, 0.8, 2.2, 0, -0.2, 0, 0xc9b690);
  box(p, 1.9, 0.1, 1.9, 0, 0.6, 0, 0x5a3e26);
  const t = treeGeometry(seed).geo.clone();
  t.scale(0.6, 0.6, 0.6).translate(0, 0.6, 0);
  p.push(t.index ? t.toNonIndexed() : t);
  return withGlow(p, []);
}

/** A banner pole: navy cloth with the gold mark, on a tall pole with a gold finial. */
export function bannerGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  p.push(paint(new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8), 0xb5a383));
  p.push(paint(new THREE.CylinderGeometry(0.06, 0.07, 7, 6).translate(0, 3.6, 0), IRON));
  p.push(paint(new THREE.SphereGeometry(0.18, 8, 6).translate(0, 7.2, 0), GOLD));
  box(p, 1.3, 3.4, 0.05, 0.7, 3.4, 0, NAVY);
  box(p, 1.3, 0.16, 0.06, 0.7, 6.6, 0, GOLD);
  p.push(paint(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 14).rotateX(Math.PI / 2).translate(0.7, 5.4, 0.03), GOLD));
  box(p, 0.06, 1.6, 0.07, 0.7, 3.9, 0.03, GOLD);
  return withGlow(p, []);
}

/** A market stall under a striped awning in `color` (the villages' own colours). */
export function stallGeometry(seed: number, color: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const p: Parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(p, 0.14, sz < 0 ? 2.7 : 2.3, 0.14, sx * 1.4, 0, sz * 0.9, 0x5a3b22);
  box(p, 3.0, 0.14, 1.3, 0, 0.9, 0.25, 0x8a5a34);
  const goods = [0xd9a24a, 0xc9502a, 0x7aa83a, 0xe8d8b0, 0x8a5fb0, 0xb0602a];
  for (let i = 0; i < 6; i++) p.push(paint(new THREE.IcosahedronGeometry(0.2, 0).scale(1, 0.75, 1).translate(-1.2 + i * 0.48, 1.16, 0.25), rng.pick(goods)));
  for (let i = 0; i < 6; i++) {
    const x = -1.65 + (3.3 * (i + 0.5)) / 6;
    p.push(paint(new THREE.BoxGeometry(0.56, 0.08, 2.4).rotateX(0.2).translate(x, 2.5, 0), i % 2 ? 0xf0e6d2 : color));
  }
  return withGlow(p, []);
}

/** A little stone bench. */
export function benchGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  box(p, 2.4, 0.18, 0.7, 0, 0.45, 0, 0xd8c7a2);
  for (const s of [-1, 1]) box(p, 0.3, 0.45, 0.6, s * 0.9, 0, 0, 0xb5a383);
  return withGlow(p, []);
}

