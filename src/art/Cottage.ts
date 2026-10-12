import { HOUSE_SKIRT } from '../world/groundRules';
import * as THREE from 'three';
import { Rng } from '../util/rng';
import { merge, paint } from './Models';

/**
 * v0.6 storyboard cottages: a stone footing, plaster walls in a timber frame, a steep shingled gable
 * roof with an overhang, a stone chimney, shutters and a lintel over the door. Door faces +z; the roof
 * ridge runs along x. Everything is vertex-coloured (one draw call with MAT.base) and the window
 * panes are a separate geometry so they can glow at dusk.
 */

const STONE = [0x8d877c, 0x9a9488, 0x7f7a70];
const PLASTER = [0xeadfc6, 0xe3d2ac, 0xf0e6d2, 0xdfc9a2];
const TIMBER = 0x5a3b22;
const SHINGLE = [0x7d4a2e, 0x8a5634, 0x6f4429, 0x93603a];

/** A quad from four points, wound so its normal faces `out` (a point-away hint). */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3): THREE.BufferGeometry {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const flip = n.dot(out) < 0;
  const p = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
  const arr = new Float32Array(18);
  p.forEach((v, i) => v.toArray(arr, i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

function tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3): THREE.BufferGeometry {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const p = n.dot(out) < 0 ? [a, c, b] : [a, b, c];
  const arr = new Float32Array(9);
  p.forEach((v, i) => v.toArray(arr, i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

export interface Cottage {
  body: THREE.BufferGeometry;
  windows: THREE.BufferGeometry;
  /** Chimney top (local) where the smoke starts. */
  chimney: THREE.Vector3;
  w: number;
  d: number;
}

export function cottageGeometry(seed: number): Cottage {
  const rng = new Rng(seed);
  const w = rng.range(4.4, 5.4);
  const d = rng.range(3.8, 4.6);
  const baseH = 0.85;
  const wallH = 2.9;
  const parts: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, col: number, jit = 0) =>
    parts.push(paint(new THREE.BoxGeometry(bw, bh, bd).translate(x, y + bh / 2, z), col, jit, rng));

  // Stone footing (rubble blocks along it) and plaster walls above.
  // The footing runs down below the floor line (HOUSE_SKIRT) so a house on a slope never shows daylight under it.
  box(w + 0.3, baseH + HOUSE_SKIRT, d + 0.3, 0, -HOUSE_SKIRT, 0, rng.pick(STONE), 0.1);
  for (let i = 0; i < 7; i++) {
    const side = rng.next() < 0.5 ? 1 : -1;
    box(rng.range(0.5, 0.9), rng.range(0.18, 0.3), 0.3, rng.range(-w / 2, w / 2), baseH - 0.05, side * (d / 2 + 0.15), rng.pick(STONE), 0.22);
  }
  box(w, wallH - baseH, d, 0, baseH, 0, rng.pick(PLASTER), 0.04);

  // Timber frame: corner posts, a mid rail, studs on the front.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) box(0.28, wallH - baseH + 0.1, 0.28, (sx * w) / 2, baseH, (sz * d) / 2, TIMBER);
  box(w + 0.1, 0.2, d + 0.1, 0, wallH - 0.2, 0, TIMBER);
  box(w + 0.1, 0.16, d + 0.1, 0, baseH + 0.78, 0, TIMBER);
  for (const x of [-w * 0.5 + 1.1, 0, w * 0.5 - 1.1]) {
    box(0.16, wallH - baseH - 0.4, 0.1, x, baseH + 0.9, d / 2 + 0.04, TIMBER);
    box(0.16, wallH - baseH - 0.4, 0.1, x, baseH + 0.9, -d / 2 - 0.04, TIMBER);
  }

  // Steep shingled gable roof, ridge along x, with a generous overhang.
  const L = w / 2 + 0.55;
  const D = d / 2 + 0.55;
  const yE = wallH - 0.1;
  const yR = yE + D * 1.15;
  const COLS = 7;
  const ROWS = 4;
  const roofBase = rng.pick(SHINGLE);
  for (const s of [-1, 1]) {
    const out = V(0, 1, s * 0.9);
    for (let r = 0; r < ROWS; r++) {
      const t0 = r / ROWS;
      const t1 = (r + 1) / ROWS;
      for (let c = 0; c < COLS; c++) {
        const x0 = -L + (2 * L * c) / COLS;
        const x1 = -L + (2 * L * (c + 1)) / COLS;
        const zy = (t: number) => V(0, yE + (yR - yE) * t, s * D * (1 - t));
        const a = zy(t0);
        const b = zy(t1);
        const q = quad(V(x0, a.y, a.z), V(x1, a.y, a.z), V(x1, b.y, b.z), V(x0, b.y, b.z), out);
        // Stagger rows by a small colour step so the shingle courses read.
        parts.push(paint(q, roofBase, 0.2 + (r % 2) * 0.1, rng));
      }
    }
    // Thin dark underside edge (fascia) along the eave.
    box(2 * L, 0.14, 0.12, 0, yE - 0.1, s * D, TIMBER);
  }
  box(2 * L + 0.1, 0.18, 0.3, 0, yR - 0.05, 0, TIMBER); // ridge beam
  // Gable triangles (plaster with a timber bargeboard cap).
  for (const sx of [-1, 1]) {
    parts.push(paint(tri(V(sx * (w / 2), wallH - 0.2, -d / 2), V(sx * (w / 2), wallH - 0.2, d / 2), V(sx * (w / 2), yR - 0.1, 0), V(sx, 0, 0)), rng.pick(PLASTER), 0.04, rng));
    box(0.16, 0.16, 0.16, sx * (L - 0.05), yR - 0.12, 0, TIMBER);
  }

  // Chimney: stone stack up through the roof slope behind the ridge.
  const cx = w * 0.26;
  const cz = -d * 0.16;
  const roofYAtCz = yE + (yR - yE) * (1 - Math.abs(cz) / D);
  const top = yR + 0.85;
  box(0.78, top - roofYAtCz + 0.3, 0.78, cx, roofYAtCz - 0.3, cz, rng.pick(STONE), 0.12);
  box(0.98, 0.18, 0.98, cx, top - 0.05, cz, 0x6e695f);
  const chimney = V(cx, top + 0.2, cz);

  // Door: planks, lintel, step; a lantern bracket is added by the props.
  box(0.95, 1.75, 0.16, 0, baseH - 0.1, d / 2 + 0.06, 0x4a2f1c);
  box(1.3, 0.2, 0.26, 0, baseH + 1.7, d / 2 + 0.08, TIMBER);
  box(1.4, 0.18, 0.55, 0, 0, d / 2 + 0.4, rng.pick(STONE), 0.1);

  // Windows: frames and shutters in the body, glowing panes in `windows`.
  const panes: THREE.BufferGeometry[] = [];
  const addWindow = (x: number, y: number, z: number, side: 'f' | 'b' | 'l' | 'r') => {
    const alongZ = side === 'l' || side === 'r';
    const sgn = side === 'f' || side === 'r' ? 1 : -1;
    const off = alongZ ? w / 2 : d / 2;
    const fw = 0.95;
    const fh = 0.85;
    const geo = (bw: number, bh: number, bd: number) => (alongZ ? new THREE.BoxGeometry(bd, bh, bw) : new THREE.BoxGeometry(bw, bh, bd));
    const at = (u: number, v: number, n: number) => (alongZ ? V(sgn * (off + n), v, z + u) : V(x + u, v, sgn * (off + n)));
    const place = (g: THREE.BufferGeometry, p: THREE.Vector3) => g.translate(p.x, p.y, p.z);
    parts.push(paint(place(geo(fw + 0.2, fh + 0.2, 0.1), at(0, y, 0.03)), TIMBER));
    panes.push(paint(place(geo(fw - 0.1, fh - 0.1, 0.1), at(0, y, 0.09)), 0xffffff));
    parts.push(paint(place(geo(0.07, fh, 0.12), at(0, y, 0.11)), TIMBER)); // mullion
    parts.push(paint(place(geo(0.4, fh + 0.1, 0.07), at(-fw / 2 - 0.22, y, 0.07)), 0x3f6a7a)); // shutters, a muted blue
    parts.push(paint(place(geo(0.4, fh + 0.1, 0.07), at(fw / 2 + 0.22, y, 0.07)), 0x3f6a7a));
    void x;
  };
  addWindow(-w * 0.3, 1.9, 0, 'f');
  addWindow(w * 0.3, 1.9, 0, 'f');
  addWindow(0, 1.9, -d * 0.0, 'r');
  addWindow(0, 1.9, 0, 'l');
  addWindow(0, 1.9, 0, 'b');
  // Attic round-ish window in the +x gable.
  panes.push(paint(new THREE.BoxGeometry(0.1, 0.5, 0.5).translate(w / 2 + 0.06, wallH + 0.55, 0), 0xffffff));

  return { body: merge(parts), windows: merge(panes), chimney, w, d };
}
