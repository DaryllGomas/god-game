import * as THREE from 'three';
import { merge, paint, rockGeometry } from '../art/Models';
import { Rng } from '../util/rng';

/**
 * Low-poly, vertex-coloured art for village projects and the Wonder, in the same style as
 * art/Models.ts. Each village building comes in three layers so it can grow from a scaffold:
 * `base` (the foundation, always standing), `upper` (rises as work progresses) and `glow`
 * (lanterns and braziers that only light up once it is finished).
 */

// ---------------------------------------------------------------- materials

/** Warm lantern / brazier light: the project plugin raises its intensity at dusk. */
export const GLOW = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffa640, emissiveIntensity: 0.4, roughness: 0.6 });
/** Wonder runes: dull slate when asleep, a soft blue-white light when awake. */
export const RUNE_ON = new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0x8fe4ff, emissiveIntensity: 1.6, roughness: 0.4 });
export const RUNE_OFF = new THREE.MeshStandardMaterial({ color: 0x59616c, roughness: 0.9 });
/** The crystal and shards. */
export const CRYSTAL = new THREE.MeshStandardMaterial({ color: 0xe8fbff, emissive: 0x9fe8ff, emissiveIntensity: 1.8, roughness: 0.25, flatShading: true });
/** A tall soft column of light over the finished Wonder. */
export const BEAM = new THREE.MeshBasicMaterial({
  color: 0xbfeeff,
  transparent: true,
  opacity: 0.05,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
});

// ------------------------------------------------------------------ helpers

const WOOD = 0x8a5a32;
const WOOD_DARK = 0x5a3d22;
const STONE = 0x9a948a;
const STONE_LIGHT = 0xd9d2c0;
const THATCH = 0xc9a24a;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, jitter = 0, rng?: Rng) {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, jitter, rng);
}

function cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: number, jitter = 0, rng?: Rng) {
  return paint(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), color, jitter, rng);
}

/** A beam from a to b with a given cross-section (for ribbons, ropes, rails). */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, color: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, t, len);
  const o = new THREE.Object3D();
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.lookAt(b);
  o.updateMatrix();
  g.applyMatrix4(o.matrix);
  return paint(g, color);
}

/** A triangular prism roof: ridge along x, `w` long, `d` wide at the eaves, `h` tall. Sits on y = 0. */
function gable(w: number, h: number, d: number, color: number, y = 0, jitter = 0, rng?: Rng) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.rotateY(Math.PI / 2).translate(-w / 2, y, 0);
  return paint(g, color, jitter, rng);
}

export interface LayeredModel {
  base: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
}

// --------------------------------------------------------------------- well

export function wellModel(): LayeredModel {
  const rng = new Rng(21);
  const base: THREE.BufferGeometry[] = [];
  // Stone ring: eight blocks around a dark shaft with a disc of water.
  base.push(cyl(2.7, 2.9, 3, 8, 0, -1.4, 0, 0x7a746c));
  base.push(cyl(1.55, 1.55, 0.1, 8, 0, 0.55, 0, 0x2a2c30));
  base.push(cyl(1.5, 1.5, 0.06, 8, 0, 0.7, 0, 0x4aa6d8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = new THREE.BoxGeometry(1.5, 1.2, 0.75).rotateY(Math.PI / 2 - a).translate(Math.cos(a) * 1.95, 0.6, Math.sin(a) * 1.95);
    base.push(paint(b, i % 2 ? 0xb8b1a4 : STONE, 0.14, rng));
  }
  // A little ring of flat stones around the foot.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    base.push(box(1.0, 0.18, 0.8, Math.cos(a) * 3.0, 0.09, Math.sin(a) * 3.0, 0xaaa395, 0.12, rng));
  }
  const upper: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) upper.push(box(0.26, 3.6, 0.26, sx * 1.95, 3.0, 0, WOOD_DARK));
  upper.push(box(4.6, 0.26, 0.3, 0, 4.7, 0, WOOD_DARK));
  const roof = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4);
  roof.scale(3.0, 1.5, 2.1);
  roof.translate(0, 5.65, 0);
  upper.push(paint(roof, THATCH, 0.12, rng));
  upper.push(paint(new THREE.CylinderGeometry(0.19, 0.19, 3.7, 6).rotateZ(Math.PI / 2).translate(0, 4.0, 0), WOOD));
  upper.push(box(0.05, 1.4, 0.05, 0.4, 3.25, 0, 0xcdb68a));
  upper.push(cyl(0.3, 0.24, 0.4, 7, 0.4, 2.4, 0, 0x6a4a2a));
  return { base: merge(base), upper: merge(upper), glow: null };
}

// ------------------------------------------------------------------- temple

export function templeModel(): LayeredModel {
  const rng = new Rng(33);
  const base: THREE.BufferGeometry[] = [];
  // Three broad steps on a skirt that reaches down into the hill so slopes never show a gap.
  base.push(box(12.2, 4, 9.2, 0, -1.7, 0, 0xb9b2a2));
  base.push(box(12, 0.5, 9, 0, 0.25, 0, STONE_LIGHT, 0.05, rng));
  base.push(box(10.5, 0.45, 7.6, 0, 0.72, 0, 0xe3dccb, 0.05, rng));
  base.push(box(9.6, 0.4, 6.8, 0, 1.15, 0, 0xece6d6, 0.05, rng));
  const upper: THREE.BufferGeometry[] = [];
  const floor = 1.35;
  const colH = 4.4;
  // Inner room.
  upper.push(box(6.2, colH, 4.2, 0, floor + colH / 2, 0, 0xeadcb8, 0.04, rng));
  upper.push(box(1.5, 2.6, 0.3, 0, floor + 1.3, 2.2, 0x4a3020));
  upper.push(box(1.9, 0.3, 0.45, 0, floor + 2.75, 2.2, 0xd9b45a));
  // Columns: four along the front and back, one at each side.
  const cols: [number, number][] = [];
  for (const x of [-4.2, -1.4, 1.4, 4.2])
    for (const z of [-3, 3]) cols.push([x, z]);
  cols.push([-4.2, 0], [4.2, 0]);
  for (const [x, z] of cols) {
    upper.push(cyl(0.34, 0.4, colH, 8, x, floor + colH / 2, z, 0xf2ecde, 0.04, rng));
    upper.push(box(0.95, 0.22, 0.95, x, floor + 0.11, z, 0xd9d2c0));
    upper.push(box(0.95, 0.25, 0.95, x, floor + colH + 0.12, z, 0xd9d2c0));
  }
  const top = floor + colH + 0.25;
  upper.push(box(10.2, 0.6, 7.4, 0, top + 0.3, 0, 0xd0c8b4));
  upper.push(gable(10.4, 2.8, 7.8, 0xb8573a, top + 0.6, 0.1, rng));
  // Sun disc on the front pediment.
  upper.push(paint(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 10).rotateX(Math.PI / 2).translate(0, top + 1.9, 4.0), 0xf2c14e));
  // A pennant.
  upper.push(box(0.1, 3.4, 0.1, 4.6, top + 2.3, -2.4, WOOD_DARK));
  upper.push(box(1.3, 0.8, 0.05, 5.25, top + 3.5, -2.4, 0x5a8fd0));
  // Lamps by the steps glow once it is finished.
  const glow: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    base.push(cyl(0.22, 0.3, 1.5, 6, sx * 5.2, 1.25, 4.0, 0x8a8478));
    base.push(cyl(0.55, 0.3, 0.3, 7, sx * 5.2, 2.1, 4.0, 0x6a645a));
    glow.push(paint(new THREE.ConeGeometry(0.4, 0.9, 6).translate(sx * 5.2, 2.6, 4.0), 0xffd27a));
  }
  glow.push(paint(new THREE.SphereGeometry(0.5, 8, 6).translate(0, floor + 3.7, 2.3), 0xfff0b0));
  return { base: merge(base), upper: merge(upper), glow: merge(glow) };
}

// ----------------------------------------------------------------- festival

const RIBBONS = [0xf08aa8, 0x7fc4f0, 0xf4cf73, 0x8fe0a0];

export function festivalModel(): LayeredModel {
  const rng = new Rng(47);
  const base: THREE.BufferGeometry[] = [];
  base.push(cyl(8.2, 8.5, 2.4, 20, 0, -1.1, 0, 0xdcc99a, 0.05, rng));
  base.push(cyl(5.4, 5.4, 0.12, 20, 0, 0.12, 0, 0x7fb35a, 0.06, rng));
  // The maypole's base and a ring of stakes where the ribbons are pegged.
  base.push(cyl(0.9, 1.1, 0.5, 8, 0, 0.3, 0, 0x7a746c));
  base.push(cyl(0.3, 0.38, 3.2, 7, 0, 1.9, 0, 0x8a5a32));
  const upper: THREE.BufferGeometry[] = [];
  upper.push(cyl(0.22, 0.3, 5.4, 7, 0, 5.8, 0, 0x8a5a32));
  for (let i = 0; i < 5; i++) upper.push(cyl(0.34, 0.34, 0.4, 7, 0, 1.6 + i * 1.5, 0, i % 2 ? 0xf4f0e4 : 0xc8453a));
  upper.push(paint(new THREE.OctahedronGeometry(0.62).translate(0, 8.6, 0), 0xf2c14e));
  // Eight ribbons from the top down to pegs on the green.
  const top = new THREE.Vector3(0, 8.0, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const peg = new THREE.Vector3(Math.cos(a) * 4.6, 0.5, Math.sin(a) * 4.6);
    upper.push(strut(top, peg, 0.2, 0.03, RIBBONS[i % RIBBONS.length]));
    upper.push(box(0.15, 0.6, 0.15, peg.x, 0.3, peg.z, WOOD_DARK));
  }
  // Lantern posts on the outer ring, with bunting strung between.
  const glow: THREE.BufferGeometry[] = [];
  const posts = 8;
  const pr = 8.0;
  const topPts: THREE.Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.cos(a) * pr;
    const z = Math.sin(a) * pr;
    base.push(box(0.2, 3.4, 0.2, x, 1.7, z, WOOD_DARK));
    upper.push(box(0.55, 0.14, 0.55, x, 3.45, z, 0x5a3d22));
    glow.push(box(0.46, 0.62, 0.46, x, 3.1, z, 0xffe2a8));
    topPts.push(new THREE.Vector3(x, 3.3, z));
  }
  for (let i = 0; i < posts; i++) {
    const a = topPts[i];
    const b = topPts[(i + 1) % posts];
    let prev = a.clone();
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * 0.7;
      upper.push(strut(prev, p, 0.05, 0.05, 0xe8d8b0));
      if (k < 4) {
        const f = new THREE.ConeGeometry(0.22, 0.48, 3).rotateX(Math.PI).translate(p.x, p.y - 0.28, p.z);
        upper.push(paint(f, RIBBONS[(i + k) % RIBBONS.length]));
      }
      prev = p;
    }
  }
  // Two long tables with a cloth and a feast, near the green's edge.
  for (const side of [-1, 1]) {
    const tx = side * 3.2;
    const tz = side * 4.2;
    const rot = side * 0.4;
    const parts: THREE.BufferGeometry[] = [
      box(3.2, 0.12, 1.1, 0, 1.0, 0, 0xf4efe0),
      box(3.3, 0.1, 0.5, 0, 0.96, 0, 0xc8453a),
      box(0.12, 1.0, 0.12, -1.4, 0.5, 0.4, WOOD_DARK),
      box(0.12, 1.0, 0.12, 1.4, 0.5, 0.4, WOOD_DARK),
      box(0.12, 1.0, 0.12, -1.4, 0.5, -0.4, WOOD_DARK),
      box(0.12, 1.0, 0.12, 1.4, 0.5, -0.4, WOOD_DARK),
    ];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.SphereGeometry(0.22, 6, 4).scale(1, 0.8, 1).translate(-1.2 + i * 0.6, 1.2, (i % 2 ? 0.12 : -0.12));
      parts.push(paint(s, [0xd9a24a, 0xc8453a, 0xe0b64a, 0x8fbf5a, 0xd9a24a][i], 0.1, rng));
    }
    const g = merge(parts);
    g.rotateY(rot).translate(tx, 0, tz);
    upper.push(g);
  }
  return { base: merge(base), upper: merge(upper), glow: merge(glow) };
}

// ----------------------------------------------------------- scaffold & heaps

/** Stakes, rails and cloth flags around a site: marks the plot and fades as the building rises. */
export function scaffoldModel(radius: number, height: number, posts = 4): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = radius * 0.92;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2 + Math.PI / posts;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = Math.max(1, radius / 5);
    parts.push(box(0.22 * s, height, 0.22 * s, x, height / 2, z, 0x8a6a42));
    parts.push(box(0.9 * s, 0.5 * s, 0.05, x + 0.45 * s, height - 0.3 * s, z, i % 2 ? 0xe6c34a : 0xd9694a));
    pts.push(new THREE.Vector3(x, height * 0.55, z));
  }
  const t = Math.max(0.12, radius * 0.025);
  for (let i = 0; i < posts; i++) parts.push(strut(pts[i], pts[(i + 1) % posts], t, t, 0x9a7a52));
  return merge(parts);
}

export function stoneHeapGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number][] = [
    [0, 0.5, 0, 0.9],
    [1.1, 0.4, 0.3, 0.7],
    [-0.9, 0.38, 0.5, 0.65],
    [0.2, 1.1, 0.1, 0.55],
  ];
  spots.forEach(([x, y, z, r], i) => parts.push(rockGeometry(90 + i, r).translate(x, y, z)));
  return merge(parts);
}

// ------------------------------------------------------------------- wonder

export const WONDER = {
  stones: 12,
  ringRadius: 13,
  daisTop: 1.8,
  spireSegments: 6,
  segmentHeight: 5,
};

/** Dais with three steps and a rune circle inlaid in the top. */
export function wonderDaisGeometry(): THREE.BufferGeometry {
  const rng = new Rng(61);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(cyl(23, 23.4, 9, 28, 0, -4.5, 0, 0xa59f92, 0.04, rng));
  parts.push(cyl(22, 22, 0.6, 28, 0, 0.3, 0, 0xd8d2c2, 0.05, rng));
  parts.push(cyl(19.5, 19.5, 0.6, 28, 0, 0.9, 0, 0xe3ddcc, 0.05, rng));
  parts.push(cyl(17, 17, 0.6, 28, 0, 1.5, 0, 0xece6d6, 0.05, rng));
  parts.push(cyl(15.6, 15.6, 0.06, 28, 0, 1.83, 0, 0xc9a24a));
  parts.push(cyl(15.0, 15.0, 0.08, 28, 0, 1.85, 0, 0xe9e3d3));
  // Central podium for the spire.
  parts.push(cyl(4.9, 5.4, 1.4, 12, 0, WONDER.daisTop + 0.7, 0, 0xaab3bf, 0.05, rng));
  parts.push(cyl(4.4, 4.4, 0.2, 12, 0, WONDER.daisTop + 1.5, 0, 0xc9a24a));
  return merge(parts);
}

/** Height of standing stone i (pairs share a height so the lintels sit level). */
export function wonderStoneHeight(i: number): number {
  return 7.4 + (Math.floor(i / 2) % 3) * 0.9;
}

/** One standing stone, in its own local space (inner face toward -z). */
export function wonderStoneGeometry(i: number): THREE.BufferGeometry {
  const rng = new Rng(100 + i);
  const h = wonderStoneHeight(i);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(2.6, 0.6, 1.8, 0, 0.3, 0, 0x7d8692, 0.1, rng));
  parts.push(box(2.1, h, 1.2, 0, h / 2, 0, 0x93a0ae, 0.1, rng));
  const cap = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(1.05, 0.9, 0.6).translate(0, h + 0.45, 0);
  parts.push(paint(cap, 0xa8b4c0, 0.08, rng));
  return merge(parts);
}

/** The glyph on a standing stone's inner face: a few light bars, differing per stone. */
export function wonderRuneGeometry(i: number): THREE.BufferGeometry {
  const h = wonderStoneHeight(i);
  const y = h * 0.55;
  const z = -0.66;
  const parts: THREE.BufferGeometry[] = [box(0.2, 1.7, 0.1, 0, y, z, 0xffffff)];
  switch (i % 4) {
    case 0:
      parts.push(box(1.0, 0.2, 0.1, 0, y + 0.45, z, 0xffffff), box(0.2, 0.9, 0.1, 0.4, y - 0.2, z, 0xffffff));
      break;
    case 1:
      parts.push(paint(new THREE.BoxGeometry(0.2, 1.0, 0.1).rotateZ(0.8).translate(-0.25, y + 0.3, z), 0xffffff));
      parts.push(paint(new THREE.BoxGeometry(0.2, 1.0, 0.1).rotateZ(-0.8).translate(0.25, y + 0.3, z), 0xffffff));
      break;
    case 2:
      parts.push(box(1.0, 0.2, 0.1, 0, y - 0.5, z, 0xffffff), box(0.2, 0.6, 0.1, -0.4, y + 0.55, z, 0xffffff));
      break;
    default:
      parts.push(paint(new THREE.OctahedronGeometry(0.34).translate(0, y + 1.1, z), 0xffffff), box(0.9, 0.2, 0.1, 0, y - 0.1, z, 0xffffff));
  }
  return merge(parts);
}

/** A lintel spanning two neighbouring stones, in the dais's local space. */
export function wonderLintelGeometry(): { geo: THREE.BufferGeometry; length: number } {
  const a = (Math.PI * 2) / WONDER.stones;
  const chord = 2 * WONDER.ringRadius * Math.sin(a / 2);
  const length = chord + 1.9;
  return { geo: merge([box(length, 0.9, 1.5, 0, 0.45, 0, 0xa8b4c0, 0.08, new Rng(7))]), length };
}

/** Spire segment i (a tapering octagonal drum) and its glowing band + strips. */
export function wonderSpireGeometry(i: number): { drum: THREE.BufferGeometry; runes: THREE.BufferGeometry; bottom: number; top: number } {
  const rb = 3.4 - i * 0.42;
  const rt = rb - 0.38;
  const h = WONDER.segmentHeight;
  const rng = new Rng(200 + i);
  const drum = merge([cyl(rt, rb, h, 8, 0, h / 2, 0, i % 2 ? 0xd2d9e2 : 0xc3ccd8, 0.06, rng)]);
  const parts: THREE.BufferGeometry[] = [cyl(rb + 0.14, rb + 0.14, 0.3, 8, 0, 0.15, 0, 0xffffff)];
  const rm = (rb + rt) / 2;
  const apo = rm * Math.cos(Math.PI / 8) + 0.05;
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 8 + k * (Math.PI / 2);
    const strip = new THREE.BoxGeometry(0.28, h * 0.6, 0.08).rotateY(th).translate(Math.sin(th) * apo, h * 0.52, Math.cos(th) * apo);
    parts.push(paint(strip, 0xffffff));
  }
  return { drum, runes: merge(parts), bottom: rb, top: rt };
}

export function wonderCapGeometry(): THREE.BufferGeometry {
  const rt = 3.4 - (WONDER.spireSegments - 1) * 0.42 - 0.38;
  return merge([paint(new THREE.ConeGeometry(rt + 0.1, 2.6, 8).translate(0, 1.3, 0), 0xe4eaf1, 0.05, new Rng(9))]);
}

export function crystalGeometry(r = 1.7): THREE.BufferGeometry {
  return paint(new THREE.OctahedronGeometry(r).scale(0.8, 1.35, 0.8), 0xffffff);
}
