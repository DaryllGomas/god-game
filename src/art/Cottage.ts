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
  /** Height of the roof ridge (local), for labels and the believer's light. */
  top: number;
}

const THATCH = [0xc9a24a, 0xb8903c, 0xbf9a48];
const SLATE = [0x5e6672, 0x56606c, 0x66707a];
const FIELDSTONE = [0xa39a88, 0x9a917f, 0xb0a691, 0x8f877a];
const BLOOM = [0xe85a6a, 0xf2c84a, 0xf4f0e6, 0xb070d8, 0xf08a3a];

type Style = 'timber' | 'stone' | 'tall';

/**
 * A cottage (village art pass 2026-10-16, after storyboard panel 2: big, chunky and warm). Three kinds, picked by the seed:
 *  - timber: a stone footing, plaster in a dark timber frame, a steep shingled roof (the v0.6 cottage, a size up);
 *  - stone: thick fieldstone walls with quoins, a deep thatched roof;
 *  - tall: a stone ground floor with a jettied timber-and-plaster upper floor and a slate or shingle roof with a dormer.
 * All get a big stone chimney, lit windows in timber frames with flower boxes, a plank door under a lintel, and some a porch.
 * Door faces +z; the roof ridge runs along x. Vertex-coloured (MAT.base); the window panes are a separate geometry so they glow.
 */
export function cottageGeometry(seed: number): Cottage {
  const rng = new Rng(seed);
  const style: Style = rng.pick(['timber', 'timber', 'stone', 'tall'] as Style[]);
  const w = rng.range(5.5, 6.6);
  const d = rng.range(4.6, 5.3);
  const baseH = style === 'stone' ? 0.5 : 0.95;
  const floor1 = style === 'tall' ? 3.0 : 3.45; // top of the ground-floor walls
  const jetty = style === 'tall' ? 0.3 : 0;
  const wallH = style === 'tall' ? floor1 + 2.5 : floor1; // eave line
  const parts: THREE.BufferGeometry[] = [];
  const panes: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, col: THREE.ColorRepresentation, jit = 0) =>
    parts.push(paint(new THREE.BoxGeometry(bw, bh, bd).translate(x, y + bh / 2, z), col, jit, rng));
  const plaster = rng.pick(PLASTER);
  const stone = rng.pick(style === 'timber' ? STONE : FIELDSTONE);

  // ---- walls
  // The footing runs down below the floor line (HOUSE_SKIRT) so a house on a slope never shows daylight under it.
  box(w + 0.36, baseH + HOUSE_SKIRT, d + 0.36, 0, -HOUSE_SKIRT, 0, stone, 0.1);
  if (style === 'timber') {
    box(w, floor1 - baseH, d, 0, baseH, 0, plaster, 0.04);
  } else {
    // Fieldstone: courses of blocks proud of the wall, quoins at the corners.
    box(w, floor1 - baseH, d, 0, baseH, 0, stone, 0.08);
    const courses = Math.round((floor1 - baseH) / 0.42);
    for (let r = 0; r < courses; r++) {
      const y = baseH + r * 0.42 + 0.04;
      for (const sz of [-1, 1]) {
        let x = -w / 2 + rng.range(0, 0.4);
        while (x < w / 2 - 0.3) {
          const bw = Math.min(rng.range(0.5, 1.0), w / 2 - x);
          if (rng.next() < 0.45) box(bw - 0.06, 0.36, 0.08, x + bw / 2, y, sz * (d / 2 + 0.02), rng.pick(FIELDSTONE), 0.14);
          x += bw;
        }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(r % 2 ? 0.5 : 0.32, 0.38, r % 2 ? 0.32 : 0.5, sx * (w / 2 - 0.08), y, sz * (d / 2 - 0.08), rng.pick(FIELDSTONE), 0.1);
    }
  }
  if (style === 'tall') {
    // The upper floor juts out over the stone one: plaster in a timber frame with braces.
    const uw = w + jetty * 2;
    const ud = d + jetty * 2;
    box(uw + 0.12, 0.24, ud + 0.12, 0, floor1 - 0.02, 0, TIMBER);
    box(uw, wallH - floor1, ud, 0, floor1, 0, plaster, 0.04);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.26, wallH - floor1, 0.26, (sx * uw) / 2, floor1, (sz * ud) / 2, TIMBER);
    for (const sz of [-1, 1]) {
      for (const x of [-uw / 2 + 1.0, -0.55, 0.55, uw / 2 - 1.0]) box(0.15, wallH - floor1 - 0.2, 0.1, x, floor1 + 0.1, sz * (ud / 2 + 0.04), TIMBER);
      for (const sx of [-1, 1]) {
        const brace = new THREE.BoxGeometry(0.14, 1.6, 0.1).rotateZ(sx * 0.62).translate(sx * (uw / 2 - 0.6), floor1 + 1.1, sz * (ud / 2 + 0.05));
        parts.push(paint(brace, TIMBER));
      }
    }
    box(uw + 0.12, 0.2, ud + 0.12, 0, wallH - 0.2, 0, TIMBER);
  }
  if (style === 'timber') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.3, floor1 - baseH + 0.1, 0.3, (sx * w) / 2, baseH, (sz * d) / 2, TIMBER);
    box(w + 0.12, 0.22, d + 0.12, 0, floor1 - 0.22, 0, TIMBER);
    box(w + 0.12, 0.16, d + 0.12, 0, baseH + 0.9, 0, TIMBER);
    for (const sz of [-1, 1]) {
      for (const x of [-w * 0.5 + 1.15, w * 0.5 - 1.15]) box(0.16, floor1 - baseH - 0.4, 0.1, x, baseH + 0.1, sz * (d / 2 + 0.04), TIMBER);
      for (const sx of [-1, 1]) {
        const brace = new THREE.BoxGeometry(0.14, 1.5, 0.1).rotateZ(sx * 0.7).translate(sx * (w / 2 - 0.55), baseH + 1.75, sz * (d / 2 + 0.05));
        parts.push(paint(brace, TIMBER));
      }
    }
  }

  // ---- roof: steep, a deep overhang, courses of shingle, slate or thatch
  const roofKind = style === 'stone' ? 'thatch' : style === 'tall' && rng.next() < 0.5 ? 'slate' : 'shingle';
  const roofBase = roofKind === 'thatch' ? rng.pick(THATCH) : roofKind === 'slate' ? rng.pick(SLATE) : rng.pick(SHINGLE);
  const ov = roofKind === 'thatch' ? 0.85 : 0.65;
  const L = (style === 'tall' ? w / 2 + jetty : w / 2) + ov;
  const D = (style === 'tall' ? d / 2 + jetty : d / 2) + ov;
  const yE = wallH - (roofKind === 'thatch' ? 0.35 : 0.1);
  const yR = yE + D * (style === 'tall' ? 1.05 : 1.2);
  const COLS = roofKind === 'thatch' ? 1 : 8;
  const ROWS = roofKind === 'thatch' ? 5 : 5;
  const thick = roofKind === 'thatch' ? 0.45 : 0.16;
  for (const s of [-1, 1]) {
    const out = V(0, 1, s * 0.9);
    const zy = (t: number) => V(0, yE + (yR - yE) * t, s * D * (1 - t));
    for (let r = 0; r < ROWS; r++) {
      const a = zy(r / ROWS);
      const b = zy((r + 1) / ROWS);
      for (let c = 0; c < COLS; c++) {
        const x0 = -L + (2 * L * c) / COLS;
        const x1 = -L + (2 * L * (c + 1)) / COLS;
        // Each course sits a touch proud of the one above, so the courses read as layers.
        const lift = (ROWS - r) * 0.03;
        const q = quad(V(x0, a.y + lift, a.z), V(x1, a.y + lift, a.z), V(x1, b.y + lift, b.z), V(x0, b.y + lift, b.z), out);
        const shade = roofKind === 'thatch' ? 0.82 + (r % 2) * 0.12 + r * 0.03 : 1 - (r % 2) * 0.07;
        parts.push(paint(q, new THREE.Color(roofBase).multiplyScalar(shade), roofKind === 'thatch' ? 0.1 : 0.22, rng));
      }
    }
    // The roof's thickness along the eave (a thick thatch lip, or a fascia board).
    box(2 * L, thick, 0.2, 0, yE - thick + 0.04, s * D, roofKind === 'thatch' ? new THREE.Color(roofBase).multiplyScalar(0.7) : TIMBER);
    // Bargeboards up the gable edges.
    for (const sx of [-1, 1]) {
      const len = Math.hypot(D, yR - yE);
      const g = new THREE.BoxGeometry(0.2, thick + 0.08, len).rotateX(s * Math.atan2(yR - yE, D)).translate(sx * L, (yE + yR) / 2 + 0.02, (s * D) / 2);
      parts.push(paint(g, roofKind === 'thatch' ? new THREE.Color(roofBase).multiplyScalar(0.75) : TIMBER));
    }
  }
  if (roofKind === 'thatch') {
    const ridge = new THREE.CylinderGeometry(0.42, 0.42, 2 * L + 0.1, 8).rotateZ(Math.PI / 2).scale(1, 0.75, 1).translate(0, yR + 0.02, 0);
    parts.push(paint(ridge, new THREE.Color(roofBase).multiplyScalar(0.78), 0.06, rng));
  } else box(2 * L + 0.14, 0.24, 0.42, 0, yR - 0.06, 0, roofKind === 'slate' ? 0x4a525c : TIMBER); // ridge
  // Gable triangles.
  const gw = style === 'tall' ? w / 2 + jetty : w / 2;
  const gd = style === 'tall' ? d / 2 + jetty : d / 2;
  for (const sx of [-1, 1]) {
    const col = style === 'stone' ? stone : plaster;
    parts.push(paint(tri(V(sx * gw, wallH - 0.2, -gd), V(sx * gw, wallH - 0.2, gd), V(sx * gw, yR - 0.1, 0), V(sx, 0, 0)), col, 0.04, rng));
    if (style !== 'stone') {
      // A king post and collar in the gable.
      box(0.14, yR - wallH - 0.2, 0.14, sx * (gw + 0.03), wallH - 0.1, 0, TIMBER);
      box(0.12, 0.14, gd * 1.1, sx * (gw + 0.03), wallH + (yR - wallH) * 0.42, 0, TIMBER);
    }
  }
  // A dormer on the front slope of the tall house.
  if (style === 'tall') {
    const dz = D * 0.45;
    const dy = yE + (yR - yE) * 0.55 - 0.1;
    box(1.5, 1.3, 1.4, 0, dy - 0.4, dz - 0.2, plaster, 0.04);
    // A little gable roof on the dormer, ridge running out toward the front.
    for (const sx of [-1, 1]) {
      const slab = new THREE.BoxGeometry(1.05, 0.14, 1.9).rotateZ(-sx * 0.62).translate(sx * 0.42, dy + 1.18, dz - 0.15);
      parts.push(paint(slab, roofBase, 0.12, rng));
    }
    parts.push(paint(tri(V(-0.75, dy + 0.9, dz + 0.5), V(0.75, dy + 0.9, dz + 0.5), V(0, dy + 1.48, dz + 0.5), V(0, 0, 1)), plaster));
    box(0.9, 0.7, 0.08, 0, dy + 0.0, dz + 0.5, TIMBER);
    panes.push(paint(new THREE.BoxGeometry(0.7, 0.55, 0.1).translate(0, dy + 0.35, dz + 0.52), 0xffffff));
  }

  // ---- chimney: a big stone stack at one gable end, up through the roof
  const cSide = rng.next() < 0.5 ? 1 : -1;
  const cx = cSide * (L - ov - 0.55);
  const cz = -d * 0.12;
  const roofYAtCz = yE + (yR - yE) * (1 - Math.abs(cz) / D);
  const top = yR + 1.2;
  box(1.05, top - roofYAtCz + 0.4, 1.05, cx, roofYAtCz - 0.4, cz, rng.pick(FIELDSTONE), 0.12);
  box(1.25, 0.2, 1.25, cx, top - 0.05, cz, 0x6e695f);
  box(0.35, 0.3, 0.35, cx - 0.2, top + 0.15, cz, 0x8a5a3a); // chimney pot
  const chimney = V(cx - 0.2, top + 0.5, cz);

  // ---- door: planks under a lintel, a stone step; sometimes a porch on two posts
  const fz = d / 2;
  box(1.15, 2.0, 0.16, 0, baseH - 0.1, fz + 0.06, 0x4a2f1c, 0.06);
  for (const x of [-0.3, 0, 0.3]) box(0.04, 1.9, 0.04, x, baseH - 0.05, fz + 0.15, 0x3a2414);
  box(1.6, 0.26, 0.3, 0, baseH + 1.95, fz + 0.1, style === 'stone' ? stone : TIMBER);
  box(1.7, 0.22, 0.7, 0, 0, fz + 0.45, rng.pick(STONE), 0.1);
  if (rng.next() < 0.45) {
    const py = baseH + 2.55;
    for (const x of [-1.0, 1.0]) box(0.18, py, 0.18, x, 0, fz + 1.3, TIMBER);
    const pr = quad(V(-1.35, py + 0.1, fz + 1.55), V(1.35, py + 0.1, fz + 1.55), V(1.35, py + 0.7, fz), V(-1.35, py + 0.7, fz), V(0, 1, 1));
    parts.push(paint(pr, roofBase, 0.15, rng));
    box(2.8, 0.14, 0.14, 0, py, fz + 1.3, TIMBER);
  }

  // ---- windows: timber frames, mullions, shutters and flower boxes in the body; glowing panes in `windows`
  const shutter = rng.pick([0x3f6a7a, 0x6a7a3f, 0x7a3f3f, 0x3f4f7a]);
  const addWindow = (face: 'f' | 'b' | 'l' | 'r', u: number, y: number, hw: number, hd: number, big = 1) => {
    const alongZ = face === 'l' || face === 'r';
    const sgn = face === 'f' || face === 'r' ? 1 : -1;
    const off = alongZ ? hw : hd;
    const fw = 1.05 * big;
    const fh = 1.0 * big;
    const geo = (bw: number, bh: number, bd: number) => (alongZ ? new THREE.BoxGeometry(bd, bh, bw) : new THREE.BoxGeometry(bw, bh, bd));
    const at = (du: number, v: number, n: number) => (alongZ ? V(sgn * (off + n), v, u + du) : V(u + du, v, sgn * (off + n)));
    const put = (g: THREE.BufferGeometry, p: THREE.Vector3, col: THREE.ColorRepresentation, list = parts) => list.push(paint(g.translate(p.x, p.y, p.z), col));
    put(geo(fw + 0.24, fh + 0.24, 0.1), at(0, y, 0.03), TIMBER);
    put(geo(fw - 0.08, fh - 0.08, 0.1), at(0, y, 0.09), 0xffffff, panes);
    put(geo(0.07, fh, 0.12), at(0, y, 0.12), TIMBER); // mullion
    put(geo(fw, 0.07, 0.12), at(0, y + 0.05, 0.12), TIMBER); // transom
    put(geo(0.42, fh + 0.1, 0.07), at(-fw / 2 - 0.24, y, 0.07), shutter);
    put(geo(0.42, fh + 0.1, 0.07), at(fw / 2 + 0.24, y, 0.07), shutter);
    put(geo(fw + 0.3, 0.12, 0.32), at(0, y - fh / 2 - 0.1, 0.12), stone); // sill
    if (face === 'f' && rng.next() < 0.75) {
      // A flower box under the window.
      put(geo(fw + 0.1, 0.24, 0.3), at(0, y - fh / 2 - 0.3, 0.22), 0x6a4426);
      for (let i = 0; i < 4; i++) {
        const b = new THREE.IcosahedronGeometry(0.17, 0);
        put(b, at(-fw / 2 + 0.18 + i * ((fw - 0.36) / 3), y - fh / 2 - 0.08, 0.26), rng.pick(BLOOM));
      }
    }
  };
  const y1 = baseH + 1.3;
  addWindow('f', -w * 0.3, y1, w / 2, d / 2);
  addWindow('f', w * 0.3, y1, w / 2, d / 2);
  addWindow('b', 0, y1, w / 2, d / 2);
  addWindow('l', 0, y1, w / 2, d / 2);
  addWindow('r', 0, y1, w / 2, d / 2);
  if (style === 'tall') {
    const y2 = floor1 + 1.25;
    for (const u of [-w * 0.3, w * 0.3]) addWindow('f', u, y2, w / 2 + jetty, d / 2 + jetty, 0.9);
    addWindow('b', 0, y2, w / 2 + jetty, d / 2 + jetty, 0.9);
  } else {
    // A small window up in the gable at the far end from the chimney.
    panes.push(paint(new THREE.BoxGeometry(0.1, 0.6, 0.6).translate(-cSide * (gw + 0.07), wallH + 0.75, 0), 0xffffff));
    box(0.08, 0.8, 0.8, -cSide * (gw + 0.03), wallH + 0.35, 0, TIMBER);
  }

  return { body: merge(parts), windows: merge(panes), chimney, w: style === 'tall' ? w + jetty * 2 : w, d: style === 'tall' ? d + jetty * 2 : d, top: yR };
}
