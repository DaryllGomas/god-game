import * as THREE from 'three';
import { merge, paint, jitterVerts } from '../art/Models';
import { Rng } from '../util/rng';

/**
 * Low-poly art for the prayer place's four ages, in the style of art/Models.ts (vertex colours, flat
 * shading, one shared material), with warm stone and gold accents:
 *  - the totem: a carved pole with a gold sprout-in-a-ring emblem, a fire and a dance circle;
 *  - the stone circle: twelve standing stones (three trilithons) carved with gold glyph discs;
 *  - the pyramid: a smooth sandstone pyramid on a plinth with a gold capstone, a pylon gate and two
 *    obelisks, its faces carved with glowing murals of the visitor in the sky;
 *  - the temple: white columns between the old stones carrying a ring with a glyph frieze, and the
 *    capstone lifted off to float, turning, over a small sun with two gold orbit rings.
 * Local space: origin at the prayer place's centre on the ground, the front (the gate) toward +z,
 * which the worship site turns to face its village.
 */

// ------------------------------------------------------------------ layout

export const SHRINE = {
  /** The paved court of the later ages. */
  court: 12,
  stones: { count: 12, r: 10.6, w: 1.5, d: 0.85 },
  /** Square pyramid: half-width at its base, base height (top of the plinth), height to the apex, capstone height. */
  pyr: { hw: 5.0, y: 1.35, h: 8.4, cap: 1.25 },
  /** Temple columns (on the stone ring, between the stones) and the ring they carry. */
  col: { r: 10.6, h: 7.4, base: 0.35 },
  ring: { inner: 10.3, outer: 10.9, y: 8.32, h: 0.48 },
  /** Where the lifted capstone hangs, and the little sun under it. */
  crown: { cap: 12.6, orb: 11.5 },
  /** Obelisks framing the way in, just outside the court. */
  obelisk: { x: 2.2, z: 12.35, h: 6.2 },
};

const P = SHRINE.pyr;
/** Half-width of the pyramid at height y (above its base). */
const hwAt = (y: number) => P.hw * (1 - (y - P.y) / P.h);
const CAP_Y = P.y + P.h - P.cap;

// ---------------------------------------------------------------- materials

/**
 * Gold accents (emblems, glyph discs, capstone, capitals): warm in daylight, glowing softly at dusk.
 * The shrines plugin raises its glow at night (see Shrines.frame).
 */
export const SHRINE_GOLD = new THREE.MeshStandardMaterial({
  color: 0xf0c25a,
  emissive: 0xffa632,
  emissiveIntensity: 0.3,
  roughness: 0.38,
  metalness: 0.15,
  flatShading: true,
});
/** The little sun at the temple's crown. */
export const SHRINE_SUN = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c8, emissiveIntensity: 2.2, roughness: 0.3 });
/** A tall, faint column of light over a temple at night. */
export const SHRINE_BEAM = new THREE.MeshBasicMaterial({
  color: 0xffe3a8,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
});

// ------------------------------------------------------------------ helpers

const STONE = [0xb5a58a, 0xa8977c, 0xbfae92] as const;
const SAND = 0xdcbd8a;
const SAND_DARK = 0xc6a676;
const PAVE = 0xc4ad86;
const PAVE_LIGHT = 0xd8c6a2;
const EARTH = 0xa08660;
const MARBLE = 0xf2eadb;
const MARBLE_SHADE = 0xe6dac2;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, jitter = 0, rng?: Rng) {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, jitter, rng);
}
function cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: number, jitter = 0, rng?: Rng) {
  return paint(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), color, jitter, rng);
}
/** A square frustum with faces on the x/z axes: half-widths at the bottom and top, from y0 to y1. */
function frustum(hwBottom: number, hwTop: number, y0: number, y1: number, color: number, jitter = 0, rng?: Rng) {
  const g = new THREE.CylinderGeometry(hwTop * Math.SQRT2, hwBottom * Math.SQRT2, y1 - y0, 4, 1).rotateY(Math.PI / 4).translate(0, (y0 + y1) / 2, 0);
  return paint(g, color, jitter, rng);
}
/** A flat annulus (r0..r1) from y0 to y1. */
function ring(r0: number, r1: number, y0: number, y1: number, seg: number, color: number, jitter = 0, rng?: Rng) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r0, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: seg });
  g.rotateX(-Math.PI / 2).translate(0, y0, 0);
  return paint(g, color, jitter, rng);
}
/** Point on the stone ring at angle a (radians from +x toward +z). */
const onRing = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
/** Turn a part built facing -z (toward the centre from +r) to stand on the ring at angle a. */
const faceIn = (a: number) => Math.PI / 2 - a;

// ------------------------------------------------------------------ the totem

/** Earth dance circle with its ring of little stones (the first age). */
export function totemFloorGeometry(): THREE.BufferGeometry {
  const rng = new Rng(11);
  const parts: THREE.BufferGeometry[] = [cyl(8, 8.4, 0.2, 20, 0, 0.1, 0, EARTH, 0.05, rng)];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const h = rng.range(1.4, 2.4);
    parts.push(paint(new THREE.BoxGeometry(0.8, h, 0.6).rotateY(a).translate(Math.cos(a) * 9.5, h / 2, Math.sin(a) * 9.5), 0x8d8983, 0.15, rng));
  }
  return merge(parts);
}

const TOTEM_SEGMENTS = [1.5, 1.35, 1.6, 1.3, 1.45];
const TOTEM_COLORS = [0x8a4a2a, 0x3a6a8a, 0xc9a24a, 0x8a2a2a, 0x2a6a4a];

/** The carved pole, its wings and the fire pit in front of it. */
export function totemGeometry(): THREE.BufferGeometry {
  const rng = new Rng(12);
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  TOTEM_SEGMENTS.forEach((h, i) => {
    const seg = i % 2 === 0 ? new THREE.CylinderGeometry(0.7, 0.8, h, 8) : new THREE.BoxGeometry(1.4, h, 1.4);
    parts.push(paint(seg.translate(0, y + h / 2, 0), TOTEM_COLORS[i], 0.1, rng));
    y += h;
  });
  parts.push(box(4, 0.4, 0.5, 0, y - 0.6, 0, 0xc9a24a));
  parts.push(box(0.7, 0.9, 0.3, 0, y + 0.25, 0, 0x8a4a2a, 0.1, rng));
  // The fire pit, toward the front.
  parts.push(cyl(1.1, 0.8, 0.7, 8, 0, 0.35, 4.2, 0x55504a));
  return merge(parts);
}

/** The gold emblem carved into the totem's front: a sprout in a ring (the TEND mark's sprout and orb). */
export function totemEmblemGeometry(): THREE.BufferGeometry {
  const y = TOTEM_SEGMENTS[0] + TOTEM_SEGMENTS[1] + TOTEM_SEGMENTS[2] * 0.5;
  const z = 0.76;
  return merge(emblem(0.5, 0.06).map((g) => g.translate(0, y, z)));
}

/** Glyph parts in the xy-plane, facing +z: a ring with a sprout rising through it. */
function emblem(r: number, t: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.TorusGeometry(r, t, 4, 20), 0xffffff));
  parts.push(box(t * 1.4, r * 1.7, t, 0, -r * 0.05, 0, 0xffffff));
  for (const s of [-1, 1]) {
    const leaf = new THREE.TorusGeometry(r * 0.42, t * 0.9, 3, 8, Math.PI * 0.55);
    leaf.rotateZ(s > 0 ? -0.1 : Math.PI - Math.PI * 0.55 + 0.1).translate(s * r * 0.02, r * 0.18, 0);
    parts.push(paint(leaf, 0xffffff));
  }
  return parts;
}

// ----------------------------------------------------------- the stone circle

/** Stone heights: the two by the way in are tallest, the three trilithon pairs carry lintels. */
const TRILITHONS: [number, number][] = [
  [5, 6],
  [8, 9],
  [11, 0],
];
function stoneHeight(i: number): number {
  if (i === 2 || i === 3) return 5.2;
  if (TRILITHONS.some(([a, b]) => a === i || b === i)) return 5.0;
  return 4.0 + ((i * 7) % 5) * 0.16;
}
export const stoneAngle = (i: number) => ((i + 0.5) / SHRINE.stones.count) * Math.PI * 2;

/** The paved court of the later ages: a skirt down into the hill, flagstones, and an earth dance floor. */
export function courtGeometry(earthFloor: boolean): THREE.BufferGeometry {
  const rng = new Rng(13);
  const R = SHRINE.court;
  const parts: THREE.BufferGeometry[] = [cyl(R, R + 0.4, 3, 40, 0, -1.35, 0, PAVE, 0.04, rng)];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + 0.04;
    const [x, z] = onRing(a, R - 0.9);
    parts.push(paint(new THREE.BoxGeometry(1.55, 0.12, 1.2).rotateY(faceIn(a)).translate(x, 0.2, z), i % 3 ? 0xb39d78 : 0xbfa983, 0.08, rng));
  }
  if (earthFloor) parts.push(cyl(8.2, 8.4, 0.12, 24, 0, 0.21, 0, EARTH, 0.05, rng));
  else {
    parts.push(cyl(9.4, 9.6, 0.1, 32, 0, 0.2, 0, PAVE_LIGHT, 0.03, rng));
    // Radiating joints in the inner paving.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const [x, z] = onRing(a, 7.3);
      parts.push(paint(new THREE.BoxGeometry(0.08, 0.04, 4.2).rotateY(faceIn(a)).translate(x, 0.26, z), 0xb8a27c));
    }
  }
  return merge(parts);
}

/** A gold inlay ring on the court: the path the dancers walk round the pyramid. */
export function danceInlayGeometry(): THREE.BufferGeometry {
  return merge([ring(8.45, 8.7, 0.25, 0.28, 64, 0xffffff)]);
}

/** Twelve standing stones and three lintels. */
export function stonesGeometry(): THREE.BufferGeometry {
  const { count, r, w, d } = SHRINE.stones;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const rng = new Rng(300 + i);
    const a = stoneAngle(i);
    const h = stoneHeight(i);
    const [x, z] = onRing(a, r);
    const lean = rng.range(-0.025, 0.025);
    const s = jitterVerts(new THREE.BoxGeometry(w, h, d, 1, 3, 1), 0.07, rng).translate(0, h / 2, 0).rotateZ(lean);
    parts.push(paint(s.rotateY(faceIn(a)).translate(x, 0, z), rng.pick(STONE), 0.12, rng));
    // A rough footing block, half sunk.
    parts.push(paint(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.4).rotateY(faceIn(a)).translate(x, 0.1, z), 0x8f846f, 0.1, rng));
  }
  const step = (Math.PI * 2) / count;
  const chord = 2 * r * Math.sin(step / 2);
  for (const [i] of TRILITHONS) {
    const rng = new Rng(400 + i);
    const mid = stoneAngle(i) + step / 2;
    const [x, z] = onRing(mid, r * Math.cos(step / 2) + 0.15);
    const lintel = jitterVerts(new THREE.BoxGeometry(chord + 1.3, 0.7, d + 0.1, 3, 1, 1), 0.06, rng);
    parts.push(paint(lintel.rotateY(faceIn(mid)).translate(x, stoneHeight(i) + 0.33, z), 0x9e927d, 0.1, rng));
  }
  return merge(parts);
}

/** The gold glyph disc on each stone's inner face: a sun cross, a sprout, a four-point star, an orb in orbit. */
export function stoneGlyphGeometry(): THREE.BufferGeometry {
  const { count, r, d } = SHRINE.stones;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = stoneAngle(i);
    const h = stoneHeight(i);
    const y = h * 0.62;
    const g: THREE.BufferGeometry[] = [];
    const t = 0.055;
    switch (i % 4) {
      case 0:
        g.push(paint(new THREE.TorusGeometry(0.42, t, 4, 18), 0xffffff), box(t * 1.4, 0.84, t, 0, 0, 0, 0xffffff), box(0.84, t * 1.4, t, 0, 0, 0, 0xffffff));
        break;
      case 1:
        g.push(...emblem(0.42, t));
        break;
      case 2:
        g.push(paint(new THREE.OctahedronGeometry(0.5).scale(0.22, 1, 0.08), 0xffffff), paint(new THREE.OctahedronGeometry(0.5).scale(1, 0.22, 0.08), 0xffffff));
        g.push(paint(new THREE.TorusGeometry(0.62, t * 0.7, 3, 18), 0xffffff));
        break;
      default:
        g.push(paint(new THREE.SphereGeometry(0.14, 8, 6), 0xffffff));
        g.push(paint(new THREE.TorusGeometry(0.42, t * 0.8, 3, 20).scale(1, 0.5, 1).rotateZ(0.35), 0xffffff));
        g.push(paint(new THREE.TorusGeometry(0.42, t * 0.8, 3, 20).scale(1, 0.5, 1).rotateZ(-0.35), 0xffffff));
    }
    // Built facing +z; the stone's inner face looks toward the centre.
    const [x, z] = onRing(a, r - d / 2 - 0.03);
    for (const p of g) parts.push(p.rotateY(Math.PI).rotateY(faceIn(a)).translate(x, y, z));
  }
  return merge(parts);
}

// ---------------------------------------------------------------- the pyramid

/** The plinth (two slabs on a skirt that reaches into the hill). */
export function plinthGeometry(): THREE.BufferGeometry {
  const rng = new Rng(51);
  return merge([
    box(11.8, 3, 11.8, 0, -1.35, 0, 0xbfa47a, 0.04, rng),
    box(11.6, 0.6, 11.6, 0, 0.45, 0, 0xd2bb92, 0.04, rng),
    box(11.0, 0.6, 11.0, 0, 1.05, 0, 0xdcc7a0, 0.04, rng),
    // A landing before the gate, and a step up to it.
    box(4.4, 1.2, 1.5, 0, 0.75, 5.95, 0xdcc7a0, 0.04, rng),
    box(3.6, 0.6, 0.55, 0, 0.45, 6.95, 0xd2bb92, 0.04, rng),
  ]);
}

/** The pyramid's body (without its capstone), its masonry courses, and the pylon gate before it. */
export function pyramidGeometry(): THREE.BufferGeometry {
  const rng = new Rng(52);
  const parts: THREE.BufferGeometry[] = [frustum(P.hw, hwAt(CAP_Y), P.y, CAP_Y, SAND, 0.05, rng)];
  // Courses: thin, slightly proud bands that give the faces their scale.
  for (const y of [P.y + 1.8, P.y + 3.6, P.y + 5.3]) parts.push(frustum(hwAt(y) + 0.06, hwAt(y + 0.14) + 0.06, y, y + 0.14, SAND_DARK));
  // A flat platform where the capstone sits.
  parts.push(frustum(hwAt(CAP_Y) + 0.05, hwAt(CAP_Y) + 0.05, CAP_Y - 0.06, CAP_Y + 0.02, SAND_DARK));
  // The pylon gate: two tapering towers with a cornice, a lower middle with a dark doorway.
  const gz = P.hw + 0.05;
  for (const s of [-1, 1]) {
    const tower = new THREE.CylinderGeometry(0.5 * Math.SQRT2 * 0.84, 0.5 * Math.SQRT2, 3.8, 4).rotateY(Math.PI / 4).scale(1.8, 1, 1.4);
    parts.push(paint(tower.translate(s * 1.75, P.y + 1.9, gz), 0xd4b483, 0.05, rng));
    parts.push(box(1.7, 0.25, 1.32, s * 1.75, P.y + 3.92, gz, 0xe2cba0));
    parts.push(cyl(0.5, 0.32, 0.36, 8, s * 1.75, P.y + 4.22, gz, 0x6a5238));
  }
  parts.push(box(1.75, 2.9, 1.15, 0, P.y + 1.45, gz, 0xcfae7e, 0.05, rng));
  parts.push(box(1.95, 0.3, 1.25, 0, P.y + 3.0, gz, 0xe2cba0));
  parts.push(box(0.95, 2.05, 0.06, 0, P.y + 1.03, gz + 0.58, 0x2a2018));
  return merge(parts);
}

/** Gold on the pyramid: the winged sun over its gate. (The capstone is its own mesh: it lifts off later.) */
export function pyramidGoldGeometry(): THREE.BufferGeometry {
  const z = P.hw + 0.05 + 0.6;
  const parts: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 16).rotateX(Math.PI / 2).translate(0, P.y + 2.45, z), 0xffffff)];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const w = 0.95 - k * 0.22;
      parts.push(box(w, 0.09, 0.05, s * (0.38 + w / 2), P.y + 2.55 - k * 0.13, z, 0xffffff));
    }
  }
  return merge(parts);
}

/** The gold capstone, with its base at y = 0 (the visual places it). */
export function capstoneGeometry(): THREE.BufferGeometry {
  const hw = hwAt(CAP_Y) + 0.03;
  return merge([paint(new THREE.ConeGeometry(hw * Math.SQRT2, P.cap, 4).rotateY(Math.PI / 4).translate(0, P.cap / 2, 0), 0xffffff)]);
}
export const CAPSTONE_Y = CAP_Y;

/** Two obelisks framing the way in (their tips are gold: see obeliskTipGeometry). */
export function obelisksGeometry(): THREE.BufferGeometry {
  const rng = new Rng(53);
  const { x, z, h } = SHRINE.obelisk;
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(box(1.1, 0.55, 1.1, s * x, 0.1, z, 0xb8a07a, 0.06, rng));
    parts.push(frustum(0.36, 0.26, 0.35, 0.35 + h, 0xd8bf92, 0.05, rng).translate(s * x, 0, z));
  }
  return merge(parts);
}
export function obeliskTipGeometry(): THREE.BufferGeometry {
  const { x, z, h } = SHRINE.obelisk;
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) parts.push(paint(new THREE.ConeGeometry(0.27 * Math.SQRT2, 0.6, 4).rotateY(Math.PI / 4).translate(s * x, 0.35 + h + 0.3, z), 0xffffff));
  return merge(parts);
}

// ------------------------------------------------------------------ the temple

/** Angles of the temple's columns: between the stones, leaving the way in (+z) open. */
export function columnAngles(): number[] {
  const out: number[] = [];
  for (let k = 0; k < SHRINE.stones.count; k++) if (k !== 3) out.push((k / SHRINE.stones.count) * Math.PI * 2);
  return out;
}

/** Column bases (they stand from the start of the work). */
export function columnBasesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const a of columnAngles()) {
    const [x, z] = onRing(a, SHRINE.col.r);
    parts.push(box(1.15, SHRINE.col.base, 1.15, x, 0.15 + SHRINE.col.base / 2, z, MARBLE_SHADE));
  }
  return merge(parts);
}

/** Column shafts, from the base to just under the capitals (they rise as the work goes on). */
export function columnShaftsGeometry(): THREE.BufferGeometry {
  const rng = new Rng(71);
  const y0 = 0.15 + SHRINE.col.base;
  const parts: THREE.BufferGeometry[] = [];
  for (const a of columnAngles()) {
    const [x, z] = onRing(a, SHRINE.col.r);
    parts.push(paint(new THREE.CylinderGeometry(0.44, 0.52, SHRINE.col.h, 10).translate(x, y0 + SHRINE.col.h / 2, z), MARBLE, 0.03, rng));
    // Fluting: a slim band near the foot and one near the head.
    parts.push(paint(new THREE.CylinderGeometry(0.56, 0.56, 0.18, 10).translate(x, y0 + 0.5, z), MARBLE_SHADE));
  }
  return merge(parts);
}
/** Bottom of the shafts, so the build visual can scale them up from there. */
export const SHAFT_Y0 = 0.15 + SHRINE.col.base;

/** The ring the columns carry, with a cornice. */
export function templeRingGeometry(): THREE.BufferGeometry {
  const { inner, outer, y, h } = SHRINE.ring;
  const rng = new Rng(72);
  return merge([ring(inner, outer, y, y + h, 72, 0xefe6d2, 0.03, rng), ring(inner - 0.1, outer + 0.14, y + h, y + h + 0.14, 72, 0xf7f0e2, 0.02, rng)]);
}

/** Gold on the temple: the capitals and two bands round the ring. */
export function templeGoldGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = SHAFT_Y0 + SHRINE.col.h;
  for (const a of columnAngles()) {
    const [x, z] = onRing(a, SHRINE.col.r);
    parts.push(paint(new THREE.CylinderGeometry(0.72, 0.48, 0.42, 10).translate(x, top + 0.2, z), 0xffffff));
  }
  const { outer, y, h } = SHRINE.ring;
  parts.push(ring(outer - 0.02, outer + 0.07, y + 0.02, y + 0.1, 72, 0xffffff));
  parts.push(ring(outer - 0.02, outer + 0.07, y + h - 0.1, y + h - 0.02, 72, 0xffffff));
  return merge(parts);
}

/** Two thin gold orbit rings round the little sun (each its own geometry so they can turn). */
export function orbitRingGeometry(r: number): THREE.BufferGeometry {
  return paint(new THREE.TorusGeometry(r, 0.09, 4, 72), 0xffffff);
}

/** The soft column of light over the temple at night. */
export function beamGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(1.0, 0.35, 70, 16, 1, true).translate(0, 35, 0);
}

// ------------------------------------------------------------------ murals

/**
 * Murals: gold line drawings carved into the pyramid's faces and round the temple's frieze, of the
 * people looking up at a visitor in their sky (the ancient-astronaut thread of the storyboard). No
 * words: star points, orbits, the TEND sprout and cradle, little figures with their arms raised.
 * Drawn once onto canvases and shared.
 */
export type MuralId = 'visitor' | 'mark' | 'ages' | 'sky';
export const MURALS: MuralId[] = ['visitor', 'mark', 'ages', 'sky'];

const textures = new Map<string, THREE.CanvasTexture>();

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  return { c, g };
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, thin = 0.22) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * thin;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function orbits(g: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number) {
  g.lineWidth = lw;
  g.beginPath();
  g.arc(x, y, r * 0.32, 0, Math.PI * 2);
  g.fill();
  for (const rot of [0.45, -0.45]) {
    g.beginPath();
    g.ellipse(x, y, r, r * 0.38, rot, 0, Math.PI * 2);
    g.stroke();
  }
}

/** A little person, arms raised toward the sky. */
function figure(g: CanvasRenderingContext2D, x: number, y: number, s: number, lw: number) {
  g.lineWidth = lw;
  g.beginPath();
  g.arc(x, y - s * 1.55, s * 0.24, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(x, y - s * 1.25);
  g.lineTo(x, y - s * 0.45);
  g.moveTo(x - s * 0.42, y);
  g.lineTo(x, y - s * 0.45);
  g.lineTo(x + s * 0.42, y);
  g.moveTo(x - s * 0.55, y - s * 1.75);
  g.lineTo(x, y - s * 1.05);
  g.lineTo(x + s * 0.55, y - s * 1.75);
  g.stroke();
}

/** A sprout in a cradle with an orb: the TEND mark's anatomy, as a glyph. */
function tend(g: CanvasRenderingContext2D, x: number, y: number, s: number, lw: number) {
  g.lineWidth = lw;
  g.beginPath();
  g.arc(x, y, s, 0.15 * Math.PI, 0.85 * Math.PI); // cradle
  g.stroke();
  g.beginPath();
  g.arc(x, y - s * 0.15, s * 0.42, 0, Math.PI * 2); // orb
  g.stroke();
  g.beginPath();
  g.moveTo(x, y + s * 0.25);
  g.lineTo(x, y - s * 1.25); // stem and star axis
  g.stroke();
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(x, y - s * 0.75);
    g.quadraticCurveTo(x + d * s * 0.55, y - s * 1.15, x + d * s * 0.62, y - s * 0.62);
    g.stroke();
  }
  star(g, x, y - s * 1.45, s * 0.28);
}

/** A row of small dots along the bottom: the carved base line of a panel (no frame, so it reads as carving, not a sign). */
function baseline(g: CanvasRenderingContext2D, w: number, h: number, lw: number) {
  for (let x = w * 0.08; x <= w * 0.92; x += lw * 3.2) {
    g.beginPath();
    g.arc(x, h * 0.965, lw * 0.5, 0, Math.PI * 2);
    g.fill();
  }
}

function drawMural(id: MuralId, g: CanvasRenderingContext2D, w: number, h: number) {
  const lw = 12;
  baseline(g, w, h, lw);
  if (id === 'visitor') {
    // The visitor crosses the sky; the people below raise their arms.
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(w * 0.08, h * 0.42);
    g.bezierCurveTo(w * 0.3, h * 0.12, w * 0.55, h * 0.14, w * 0.74, h * 0.26);
    g.stroke();
    g.lineWidth = lw * 0.45;
    g.beginPath();
    g.moveTo(w * 0.1, h * 0.5);
    g.bezierCurveTo(w * 0.32, h * 0.22, w * 0.55, h * 0.22, w * 0.72, h * 0.32);
    g.stroke();
    orbits(g, w * 0.8, h * 0.28, h * 0.12, lw * 0.6);
    star(g, w * 0.8, h * 0.28, h * 0.14);
    for (let i = 0; i < 6; i++) figure(g, w * (0.16 + i * 0.12), h * 0.86, h * 0.18, lw * 0.75);
    g.lineWidth = lw * 0.6;
    g.beginPath();
    g.moveTo(w * 0.08, h * 0.9);
    g.lineTo(w * 0.92, h * 0.9);
    g.stroke();
  } else if (id === 'mark') {
    tend(g, w * 0.5, h * 0.62, h * 0.26, lw);
    for (const [x, y, r] of [
      [0.16, 0.22, 0.05], [0.26, 0.48, 0.035], [0.12, 0.7, 0.03], [0.84, 0.22, 0.05], [0.74, 0.46, 0.035], [0.88, 0.7, 0.03],
    ] as const) star(g, w * x, h * y, h * r * 1.6);
    g.lineWidth = lw * 0.5;
    for (const d of [-1, 1]) {
      g.beginPath();
      g.arc(w * 0.5, h * 0.55, h * 0.4, d > 0 ? -0.9 : Math.PI - 0.5, d > 0 ? 0.5 : Math.PI + 0.9);
      g.stroke();
    }
  } else if (id === 'ages') {
    // Four ages in a row, with the visitor's arc passing over each.
    const ys = h * 0.78;
    const xs = [0.17, 0.39, 0.61, 0.83].map((f) => w * f);
    g.lineWidth = lw;
    // Totem.
    g.beginPath();
    g.moveTo(xs[0], ys);
    g.lineTo(xs[0], ys - h * 0.36);
    g.moveTo(xs[0] - h * 0.1, ys - h * 0.3);
    g.lineTo(xs[0] + h * 0.1, ys - h * 0.3);
    g.stroke();
    // Stone circle.
    for (let i = 0; i < 5; i++) g.fillRect(xs[1] - h * 0.15 + i * h * 0.075 - 4, ys - h * (i % 2 ? 0.2 : 0.24), 9, h * (i % 2 ? 0.2 : 0.24));
    g.fillRect(xs[1] - h * 0.17, ys - h * 0.28, h * 0.34, 8);
    // Pyramid.
    g.beginPath();
    g.moveTo(xs[2] - h * 0.18, ys);
    g.lineTo(xs[2], ys - h * 0.3);
    g.lineTo(xs[2] + h * 0.18, ys);
    g.closePath();
    g.stroke();
    // Temple: columns under a ring, a star above.
    for (let i = 0; i < 4; i++) g.fillRect(xs[3] - h * 0.15 + i * h * 0.1 - 4, ys - h * 0.22, 8, h * 0.22);
    g.beginPath();
    g.ellipse(xs[3], ys - h * 0.25, h * 0.2, h * 0.05, 0, 0, Math.PI * 2);
    g.stroke();
    star(g, xs[3], ys - h * 0.38, h * 0.06);
    g.lineWidth = lw * 0.55;
    g.beginPath();
    g.moveTo(w * 0.06, h * 0.32);
    g.bezierCurveTo(w * 0.3, h * 0.08, w * 0.7, h * 0.08, w * 0.94, h * 0.32);
    g.stroke();
    for (const f of [0.28, 0.5, 0.72]) star(g, w * f, h * (0.17 - (f === 0.5 ? 0.03 : 0)), h * 0.05);
    g.lineWidth = lw * 0.5;
    g.beginPath();
    g.moveTo(w * 0.06, ys + 6);
    g.lineTo(w * 0.94, ys + 6);
    g.stroke();
  } else {
    // The sky: a constellation round an orb in orbit.
    const pts: [number, number][] = [[0.14, 0.3], [0.27, 0.18], [0.36, 0.38], [0.22, 0.62], [0.64, 0.2], [0.76, 0.4], [0.86, 0.24], [0.8, 0.7], [0.6, 0.78], [0.38, 0.8]];
    g.lineWidth = lw * 0.35;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(w * x, h * y) : g.moveTo(w * x, h * y)));
    g.stroke();
    for (const [x, y] of pts) star(g, w * x, h * y, h * 0.045);
    orbits(g, w * 0.5, h * 0.5, h * 0.2, lw * 0.75);
    star(g, w * 0.5, h * 0.5, h * 0.12);
  }
}

/** Mural texture (white lines on transparent; the material tints them gold). */
export function muralTexture(id: MuralId): THREE.CanvasTexture {
  const hit = textures.get(id);
  if (hit) return hit;
  const { c, g } = canvas(512, 352);
  drawMural(id, g, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(id, t);
  return t;
}

/** The frieze round the temple's ring: a repeating run of glyphs (wraps round 12 times). */
export function friezeTexture(): THREE.CanvasTexture {
  const hit = textures.get('frieze');
  if (hit) return hit;
  const { c, g } = canvas(1024, 96);
  const h = c.height;
  const lw = 8;
  g.lineWidth = lw * 0.6;
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(c.width, 8);
  g.moveTo(0, h - 8);
  g.lineTo(c.width, h - 8);
  g.stroke();
  const cells = 8;
  for (let i = 0; i < cells; i++) {
    const x = (i + 0.5) * (c.width / cells);
    const y = h * 0.55;
    switch (i % 4) {
      case 0:
        star(g, x, y, h * 0.3);
        break;
      case 1:
        orbits(g, x, y, h * 0.3, lw * 0.6);
        break;
      case 2:
        figure(g, x, h * 0.86, h * 0.36, lw * 0.6);
        break;
      default:
        tend(g, x, h * 0.66, h * 0.2, lw * 0.6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(12, 1);
  t.anisotropy = 4;
  textures.set('frieze', t);
  return t;
}

/** A material for carved gold lines: lit like stone by day, glowing softly at night. One per shrine so each can fade in on its own. */
export function muralMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffd98a,
    emissive: 0xffb347,
    emissiveMap: map,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Where each face's mural sits: [face (0 front +z, then counter-clockwise seen from above), mural, centre height, width, height]. */
const MURAL_PLACES: [number, MuralId, number, number, number][] = [
  [0, 'visitor', P.y + 4.75, 2.9, 2.0],
  [1, 'mark', P.y + 3.0, 3.9, 2.69],
  [2, 'ages', P.y + 3.0, 3.9, 2.69],
  [3, 'sky', P.y + 3.0, 3.9, 2.69],
];

/** One plane per pyramid face, lying on the face. */
export function muralPlanes(): { id: MuralId; geo: THREE.BufferGeometry }[] {
  const tilt = Math.atan2(P.hw, P.h);
  return MURAL_PLACES.map(([face, id, y, w, h]) => {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-tilt);
    const d = hwAt(y) + 0.09;
    geo.translate(0, y, d);
    geo.rotateY((face * Math.PI) / 2);
    return { id, geo };
  });
}

/** The frieze band round the outside of the temple's ring. */
export function friezeGeometry(): THREE.BufferGeometry {
  const { outer, y, h } = SHRINE.ring;
  return new THREE.CylinderGeometry(outer + 0.04, outer + 0.04, h - 0.22, 96, 1, true).translate(0, y + h / 2, 0);
}

// ---------------------------------------------------------------- the visitor

/** A soft round glow with four long points: the head of the streak of light (and nothing else uses it). */
export function starSpriteTexture(): THREE.CanvasTexture {
  const hit = textures.get('star');
  if (hit) return hit;
  const { c, g } = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,250,235,0.9)');
  grd.addColorStop(0.35, 'rgba(255,225,170,0.25)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, hh] of [
    [3, 60],
    [60, 3],
  ]) {
    const lg = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    lg.addColorStop(0, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(64, 64, w, hh, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set('star', t);
  return t;
}
