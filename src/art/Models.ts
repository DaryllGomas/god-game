import { STORE_SKIRT } from '../world/groundRules';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../util/rng';

/** Shared materials. Most props are vertex-coloured low-poly meshes on one material. */
export const MAT = {
  base: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
  charred: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, color: 0x2b2522 }),
  window: new THREE.MeshStandardMaterial({ color: 0x3a2c18, emissive: 0xffa640, emissiveIntensity: 0, roughness: 0.6 }),
  cloud: new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    transparent: true,
    opacity: 0.88,
    emissive: 0x8a96a8,
    emissiveIntensity: 0.35,
  }),
};

const tmpColor = new THREE.Color();

/** Bake a flat vertex colour into a geometry (converted to non-indexed so merges always line up). */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, rng?: Rng): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  tmpColor.set(color);
  for (let i = 0; i < n; i += 3) {
    const j = jitter ? 1 + ((rng ? rng.next() : Math.random()) - 0.5) * jitter : 1;
    for (let k = 0; k < 3 && i + k < n; k++) {
      c[(i + k) * 3] = tmpColor.r * j;
      c[(i + k) * 3 + 1] = tmpColor.g * j;
      c[(i + k) * 3 + 2] = tmpColor.b * j;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function jitterVerts(geo: THREE.BufferGeometry, amount: number, rng: Rng): THREE.BufferGeometry {
  // Displace shared positions consistently so polyhedra stay closed.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = cache.get(key);
    if (!d) {
      d = [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
      cache.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  return geo;
}

// ------------------------------------------------------------------- nature

const LEAF_COLORS = [0x3f7a2c, 0x4a8a30, 0x2f6a2a, 0x4f8f36, 0x5a9638];
const PINE_COLORS = [0x24503a, 0x1f4a38, 0x2b5e44];

export function treeGeometry(seed: number): { geo: THREE.BufferGeometry; height: number } {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  if (rng.chance(0.4)) {
    // Pine
    const h = rng.range(7, 10);
    parts.push(paint(new THREE.CylinderGeometry(0.22, 0.38, h * 0.4, 6).translate(0, h * 0.2, 0), 0x6b4a2e));
    const col = rng.pick(PINE_COLORS);
    for (let i = 0; i < 3; i++) {
      const r = 2.4 - i * 0.6;
      const ch = h * 0.38;
      parts.push(paint(new THREE.ConeGeometry(r, ch, 7).translate(0, h * 0.3 + i * h * 0.2 + ch / 2, 0), col, 0.15, rng));
    }
    return { geo: merge(parts), height: h };
  }
  // Broadleaf
  const h = rng.range(5.5, 8);
  parts.push(paint(new THREE.CylinderGeometry(0.25, 0.42, h * 0.55, 6).translate(0, h * 0.275, 0), 0x74502f));
  const col = rng.pick(LEAF_COLORS);
  const blobs = rng.int(2, 4);
  for (let i = 0; i < blobs; i++) {
    const r = rng.range(1.5, 2.3);
    const blob = jitterVerts(new THREE.IcosahedronGeometry(r, 0), r * 0.18, rng);
    blob.translate(rng.range(-0.9, 0.9), h * 0.62 + rng.range(-0.3, 0.9), rng.range(-0.9, 0.9));
    parts.push(paint(blob, col, 0.2, rng));
  }
  return { geo: merge(parts), height: h };
}

export function rockGeometry(seed: number, radius: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const g = jitterVerts(new THREE.IcosahedronGeometry(radius, 1), radius * 0.22, rng);
  g.scale(1, rng.range(0.65, 0.9), 1);
  const grey = rng.pick([0x8d8983, 0x7b776f, 0x9a948a]);
  return merge([paint(g, grey, 0.18, rng)]);
}

// ---------------------------------------------------------------- buildings

export function houseGeometry(seed: number): { body: THREE.BufferGeometry; windows: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const w = rng.range(4.2, 5.2);
  const d = rng.range(3.6, 4.4);
  const wallH = 2.8;
  const parts: THREE.BufferGeometry[] = [];
  const wallCol = rng.pick([0xe8dcc0, 0xdcc8a0, 0xefe4cf]);
  parts.push(paint(new THREE.BoxGeometry(w, wallH, d).translate(0, wallH / 2, 0), wallCol));
  // Timber frame corners
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(paint(new THREE.BoxGeometry(0.3, wallH, 0.3).translate((sx * w) / 2, wallH / 2, (sz * d) / 2), 0x5a3d22));
  parts.push(paint(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2).translate(0, wallH, 0), 0x5a3d22));
  // Thatched roof: a 4-sided cone stretched to the footprint.
  const roof = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4);
  roof.scale((w + 1.2) * 0.72, rng.range(2.4, 3.2), (d + 1.2) * 0.72);
  roof.translate(0, wallH + 0.5 + 1.3, 0);
  parts.push(paint(roof, rng.pick([0xc9a24a, 0xb8903c, 0xa87f3a]), 0.12, rng));
  // Door
  parts.push(paint(new THREE.BoxGeometry(0.9, 1.7, 0.15).translate(0, 0.85, d / 2 + 0.05), 0x4a3020));
  // Chimney
  parts.push(paint(new THREE.BoxGeometry(0.6, 1.6, 0.6).translate(w * 0.28, wallH + 2.1, -d * 0.15), 0x8a7f74));

  const windows = merge([
    paint(new THREE.BoxGeometry(0.8, 0.7, 0.12).translate(-w * 0.28, 1.7, d / 2 + 0.03), 0xffffff),
    paint(new THREE.BoxGeometry(0.8, 0.7, 0.12).translate(w * 0.28, 1.7, d / 2 + 0.03), 0xffffff),
    paint(new THREE.BoxGeometry(0.12, 0.7, 0.8).translate(w / 2 + 0.03, 1.7, 0), 0xffffff),
    paint(new THREE.BoxGeometry(0.12, 0.7, 0.8).translate(-w / 2 - 0.03, 1.7, 0), 0xffffff),
  ]);
  return { body: merge(parts), windows };
}

export function scaffoldGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 4.6;
  const d = 4;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(paint(new THREE.BoxGeometry(0.25, 3.2, 0.25).translate((sx * w) / 2, 1.6, (sz * d) / 2), 0x8a6a42));
  parts.push(paint(new THREE.BoxGeometry(w, 0.2, 0.2).translate(0, 3, d / 2), 0x8a6a42));
  parts.push(paint(new THREE.BoxGeometry(w, 0.2, 0.2).translate(0, 3, -d / 2), 0x8a6a42));
  parts.push(paint(new THREE.BoxGeometry(0.2, 0.2, d).translate(w / 2, 3, 0), 0x8a6a42));
  parts.push(paint(new THREE.BoxGeometry(0.2, 0.2, d).translate(-w / 2, 3, 0), 0x8a6a42));
  parts.push(paint(new THREE.BoxGeometry(w + 0.6, 0.15, d + 0.6).translate(0, 0.08, 0), 0x9a8a6a));
  return merge(parts);
}

export function ruinsGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const b = new THREE.BoxGeometry(rng.range(0.5, 1.6), rng.range(0.2, 1.2), rng.range(0.4, 1.4));
    b.rotateY(rng.range(0, Math.PI)).translate(rng.range(-2.4, 2.4), 0.3, rng.range(-2, 2));
    parts.push(paint(b, rng.pick([0x3a3430, 0x2a2420, 0x4a3a2a]), 0.2, rng));
  }
  return merge(parts);
}

/**
 * The storehouse (village art pass 2026-10-16): a round granary of fieldstone with a timber band, a deep conical roof of
 * warm shingle courses, a little lantern cupola on top carrying the flag pole, and a big plank door. Same footprint (r 3.7)
 * and door (+z) as before.
 */
export function storeGeometry(): THREE.BufferGeometry {
  const rng = new Rng(77);
  const parts: THREE.BufferGeometry[] = [];
  const SEG = 14;
  // A hidden foot under the wall so the store never shows daylight on a slope.
  parts.push(paint(new THREE.CylinderGeometry(3.75, 3.75, STORE_SKIRT, SEG).translate(0, -STORE_SKIRT / 2, 0), 0x9a917f, 0.06));
  // Fieldstone drum with stone courses proud of it.
  parts.push(paint(new THREE.CylinderGeometry(3.45, 3.7, 2.6, SEG).translate(0, 1.3, 0), 0xa39a88, 0.1, rng));
  for (let r = 0; r < 5; r++) {
    const y = 0.15 + r * 0.5;
    for (let i = 0; i < SEG; i++) {
      if (rng.next() < 0.45) continue;
      const a = ((i + (r % 2) * 0.5) / SEG) * Math.PI * 2;
      const rad = 3.68 - r * 0.05;
      const b = new THREE.BoxGeometry(1.3, 0.42, 0.14).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * rad, y + 0.2, Math.sin(a) * rad);
      parts.push(paint(b, rng.pick([0xa39a88, 0x9a917f, 0xb0a691, 0x8f877a]), 0.12, rng));
    }
  }
  // Timber upper band and plaster.
  parts.push(paint(new THREE.CylinderGeometry(3.4, 3.45, 1.3, SEG).translate(0, 3.25, 0), 0xeadfc6, 0.04, rng));
  parts.push(paint(new THREE.CylinderGeometry(3.52, 3.52, 0.22, SEG).translate(0, 2.65, 0), 0x5a3b22));
  parts.push(paint(new THREE.CylinderGeometry(3.6, 3.6, 0.3, SEG).translate(0, 3.9, 0), 0x5a3b22));
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    parts.push(paint(new THREE.BoxGeometry(0.16, 1.3, 0.16).translate(Math.cos(a) * 3.45, 3.25, Math.sin(a) * 3.45), 0x5a3b22));
  }
  // Conical roof in courses (each a touch proud of the one above), with a thick lip.
  const ROWS = 5;
  const R0 = 4.6;
  const y0 = 3.95;
  const H = 4.1;
  for (let r = 0; r < ROWS; r++) {
    const t0 = r / ROWS;
    const t1 = (r + 1) / ROWS;
    const rb = R0 * (1 - t0) + 0.12;
    const rt = R0 * (1 - t1);
    const g = new THREE.CylinderGeometry(Math.max(0.05, rt), rb, (t1 - t0) * H + 0.12, SEG).translate(0, y0 + ((t0 + t1) / 2) * H, 0);
    parts.push(paint(g, new THREE.Color(0x8a4a2e).multiplyScalar(1 - (r % 2) * 0.1), 0.16, rng));
  }
  parts.push(paint(new THREE.CylinderGeometry(R0 + 0.1, R0 + 0.15, 0.22, SEG).translate(0, y0 - 0.05, 0), 0x5a3b22));
  // Lantern cupola at the top.
  parts.push(paint(new THREE.CylinderGeometry(0.7, 0.75, 0.9, 8).translate(0, y0 + H - 0.35, 0), 0xeadfc6));
  parts.push(paint(new THREE.ConeGeometry(0.95, 1.0, 8).translate(0, y0 + H + 0.55, 0), 0x6f3a24, 0.1, rng));
  // Big plank door with a lintel, and a step.
  parts.push(paint(new THREE.BoxGeometry(1.7, 2.3, 0.3).translate(0, 1.15, 3.55), 0x4a3020));
  for (const x of [-0.42, 0, 0.42]) parts.push(paint(new THREE.BoxGeometry(0.05, 2.2, 0.06).translate(x, 1.15, 3.72), 0x3a2414));
  parts.push(paint(new THREE.BoxGeometry(2.2, 0.3, 0.5).translate(0, 2.45, 3.6), 0x5a3b22));
  parts.push(paint(new THREE.BoxGeometry(2.2, 0.2, 0.8).translate(0, 0.05, 3.95), 0x8d877c));
  // The flag pole out of the cupola.
  parts.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 2.4).translate(0, 8.9, 0), 0x5a3d22));
  return merge(parts);
}

export function flagGeometry(): THREE.BufferGeometry {
  return merge([paint(new THREE.BoxGeometry(1.6, 0.9, 0.05).translate(0.8, 0, 0), 0xffffff)]);
}

export function foodHeapGeometry(): THREE.BufferGeometry {
  const rng = new Rng(5);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xe0b64a, 0.15, rng));
  for (let i = 0; i < 5; i++) {
    const s = new THREE.SphereGeometry(0.35, 6, 4).scale(1, 0.8, 1.3);
    s.translate(rng.range(-0.7, 0.7), rng.range(0.3, 0.7), rng.range(-0.7, 0.7));
    parts.push(paint(s, rng.pick([0xc98a3a, 0xd9a24a, 0xb0602a]), 0.1, rng));
  }
  return merge(parts);
}

export function logStackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rows = [3, 2, 1];
  let y = 0.25;
  for (const n of rows) {
    for (let i = 0; i < n; i++) {
      const log = new THREE.CylinderGeometry(0.25, 0.25, 2.2, 6).rotateZ(Math.PI / 2);
      log.translate(0, y, (i - (n - 1) / 2) * 0.52);
      parts.push(paint(log, 0x8a5a32, 0.12));
    }
    y += 0.44;
  }
  return merge(parts);
}

export function worshipGeometry(): { site: THREE.BufferGeometry; fire: THREE.BufferGeometry } {
  const rng = new Rng(11);
  const parts: THREE.BufferGeometry[] = [];
  // Packed-earth dance circle
  parts.push(paint(new THREE.CylinderGeometry(8, 8.4, 0.2, 20).translate(0, 0.1, 0), 0xa08660, 0.05, rng));
  // Totem pole segments
  const cols = [0x8a4a2a, 0x3a6a8a, 0xc9a24a, 0x8a2a2a, 0x2a6a4a];
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const h = rng.range(1.2, 1.7);
    const seg = i % 2 === 0 ? new THREE.CylinderGeometry(0.7, 0.8, h, 8) : new THREE.BoxGeometry(1.4, h, 1.4);
    parts.push(paint(seg.translate(0, y + h / 2, 0), cols[i], 0.1, rng));
    y += h;
  }
  // Wings on top
  parts.push(paint(new THREE.BoxGeometry(4, 0.4, 0.5).translate(0, y - 0.6, 0), 0xc9a24a));
  // Standing stones
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const h = rng.range(1.4, 2.4);
    const st = new THREE.BoxGeometry(0.8, h, 0.6).rotateY(a).translate(Math.cos(a) * 9.5, h / 2, Math.sin(a) * 9.5);
    parts.push(paint(st, 0x8d8983, 0.15, rng));
  }
  const fire = merge([
    paint(new THREE.CylinderGeometry(1.1, 0.8, 0.7, 8).translate(0, 0.35, 0), 0x55504a),
  ]);
  return { site: merge(parts), fire };
}

export function fieldGeometry(w: number, d: number): { soil: THREE.BufferGeometry; crops: THREE.BufferGeometry } {
  const soil = merge([paint(new THREE.BoxGeometry(w, 0.3, d).translate(0, 0.1, 0), 0x6e4e30, 0.08)]);
  const parts: THREE.BufferGeometry[] = [];
  const rows = Math.floor(d / 1.2);
  for (let r = 0; r < rows; r++) {
    const z = -d / 2 + 0.6 + r * 1.2;
    parts.push(paint(new THREE.BoxGeometry(w - 0.8, 1, 0.55).translate(0, 0.5, z), 0xffffff, 0.12));
  }
  return { soil, crops: merge(parts) };
}

export function cloudGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  // Many overlapping, squashed puffs with a flat, darker underside read as a raincloud.
  for (let i = 0; i < 16; i++) {
    const r = rng.range(2.2, 4.2);
    const b = jitterVerts(new THREE.IcosahedronGeometry(r, 1), r * 0.08, rng);
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * 8;
    b.scale(1.25, 0.62, 1.25).translate(Math.cos(a) * d, rng.range(0, 1.8) + (8 - d) * 0.15, Math.sin(a) * d);
    parts.push(paint(b, i < 6 ? 0xc9d0da : 0xf2f5f9, 0.04, rng));
  }
  return merge(parts);
}

// ----------------------------------------------------------------- villager

export interface VillagerParts {
  body: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  /** Gold accents a believer wears (a sash and a little sun pendant): drawn with VILLAGER_GOLD, shown by the villager. */
  faith: THREE.BufferGeometry;
}

/** Where the limbs hang from (local, before the villager's own scale): arms at the shoulders, legs at the hips. */
export const VILLAGER_PIVOT = { armX: 0.41, armY: 1.45, legX: 0.15, legY: 0.8 };

/** A believer's gold (village art pass, 2026-10-16): warm by day, a soft glow at dusk. */
export const VILLAGER_GOLD = new THREE.MeshStandardMaterial({ color: 0xe8b84a, emissive: 0xffc860, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.4, flatShading: true });

const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68a5e, 0x9a6440, 0x7a4a2e];
const HAIR = [0x2a1a10, 0x5a3a1a, 0xa0702a, 0xd9b870, 0x1a1a1a, 0x8a3a1a, 0x6e4a2a, 0xc8c2b8];
/** Undyed cloth: linen, wool and leather, for shirts, aprons, trousers and the odd neutral smock. */
const LINEN = [0xefe4cc, 0xe6d6b4, 0xd9c8a6];
const WOOL = [0x6b4e34, 0x5a4636, 0x7a6248, 0x4e5a48];
const TROUSER = [0x4a3a2a, 0x3e3428, 0x5a4632, 0x34302c];

/**
 * A villager as a little person (village art pass 2026-10-16, after storyboard panel 2): a belted tunic or a long dress
 * in the village's colour with a linen collar, shoulders, a round head with eyes, a nose and one of several hair styles
 * (or a hood or a straw hat), hands on the arms, trousers and boots. Front is +z. All vertex-coloured (MAT.base) except
 * `faith`, the gold accents. Same pivots as before, so every pose, tool and carried load still lines up.
 */
export function villagerParts(seed: number, tunic: number): VillagerParts {
  const rng = new Rng(seed);
  const skin = rng.pick(SKIN);
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(tunic).getHSL(hsl);
  // The village's hue stays the read from afar: deep and saturated, a little shade variation per person.
  const shade = rng.range(0.86, 1.12);
  const main = new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.68), Math.min(0.42, Math.max(0.3, hsl.l)) * shade);
  const dark = new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.6), 0.2);
  const linen = rng.pick(LINEN);
  const trouser = rng.pick(TROUSER);
  const boot = 0x2a1c12;
  const belt = 0x4a3020;
  // Outfits: 0 tunic, 1 long dress with an apron, 2 hooded cloak over a tunic, 3 a neutral smock with a village-colour scarf.
  const outfit = rng.pick([0, 0, 0, 1, 1, 2, 3]);
  const robe = outfit === 3 ? new THREE.Color(rng.pick(WOOL)) : main;
  const hem = outfit === 1 ? 0.3 : 0.56;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: THREE.ColorRepresentation, j = 0) => parts.push(paint(g, c, j, rng));

  // Torso: a slightly flattened, tapering tunic from the hem to the shoulders, a flare at the hem, a belt.
  const torso = new THREE.CylinderGeometry(0.31, 0.4, 1.52 - hem, 8).scale(1, 1, 0.82).translate(0, (1.52 + hem) / 2, 0);
  add(torso, robe);
  add(new THREE.CylinderGeometry(0.43, 0.47, 0.1, 8).scale(1, 1, 0.84).translate(0, hem + 0.05, 0), outfit === 1 ? robe.clone().multiplyScalar(0.8) : dark);
  add(new THREE.CylinderGeometry(0.38, 0.38, 0.11, 8).scale(1, 1, 0.84).translate(0, 0.98, 0), belt);
  add(new THREE.BoxGeometry(0.13, 0.12, 0.05).translate(0, 0.98, 0.33), 0xb89a5a); // buckle
  // Shoulders, so the arms join a body rather than a cone.
  for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.17, 7, 5).scale(1, 0.85, 1).translate(sx * 0.33, 1.43, 0), robe);
  // Collar: linen at the neck, a little V in front.
  add(new THREE.CylinderGeometry(0.22, 0.3, 0.1, 8).scale(1, 1, 0.84).translate(0, 1.55, 0), linen);
  add(new THREE.BoxGeometry(0.16, 0.2, 0.04).translate(0, 1.42, 0.27), linen);
  if (outfit === 1) {
    // Apron over the dress.
    add(new THREE.BoxGeometry(0.46, 0.62, 0.05).translate(0, 0.64, 0.36).rotateX(-0.06), linen);
  }
  if (outfit === 3) {
    // The village's colour as a scarf, so a neutral smock still says whose village this is.
    add(new THREE.CylinderGeometry(0.27, 0.33, 0.14, 8).scale(1, 1, 0.9).translate(0, 1.56, 0), main);
    add(new THREE.BoxGeometry(0.12, 0.38, 0.05).translate(0.12, 1.32, 0.3), main);
  }
  // Neck and head: bigger than before so a face reads, with eyes, a nose and cheeks.
  add(new THREE.CylinderGeometry(0.11, 0.12, 0.14, 6).translate(0, 1.64, 0), skin);
  const headY = 1.88;
  add(new THREE.IcosahedronGeometry(0.31, 1).scale(1, 1.04, 0.96).translate(0, headY, 0), skin);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.08, 0.04).translate(sx * 0.11, headY + 0.02, 0.285), 0x1e140e);
  add(new THREE.BoxGeometry(0.07, 0.08, 0.08).translate(0, headY - 0.06, 0.3), new THREE.Color(skin).multiplyScalar(0.9));
  // Hair: a cap of hair, longer hair down the back, a bun, cropped, or a hood or straw hat instead.
  const hair = rng.pick(HAIR);
  const style = outfit === 2 ? 'hood' : rng.pick(['cap', 'cap', 'long', 'bun', 'crop', 'hat']);
  const capHair = () => add(new THREE.SphereGeometry(0.335, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.95, 1).translate(0, headY + 0.03, -0.035), hair);
  if (style === 'hood') {
    add(new THREE.SphereGeometry(0.38, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, headY + 0.02, -0.06), dark);
    add(new THREE.CylinderGeometry(0.3, 0.46, 0.9, 8).scale(1, 1, 0.8).translate(0, 1.18, -0.1), dark); // cloak down the back
  } else if (style === 'hat') {
    capHair();
    add(new THREE.CylinderGeometry(0.52, 0.55, 0.05, 10).translate(0, headY + 0.2, 0), 0xd8b45e);
    add(new THREE.CylinderGeometry(0.22, 0.3, 0.2, 10).translate(0, headY + 0.32, 0), 0xceaa52);
  } else {
    capHair();
    if (style === 'long') add(new THREE.BoxGeometry(0.5, 0.5, 0.14).translate(0, headY - 0.22, -0.24), hair);
    if (style === 'bun') add(new THREE.IcosahedronGeometry(0.13, 0).translate(0, headY + 0.2, -0.27), hair);
    if (style === 'crop') add(new THREE.BoxGeometry(0.5, 0.08, 0.4).translate(0, headY + 0.27, -0.02), hair);
  }
  const body = merge(parts);

  // Arm: a sleeve in the robe's colour and a hand, hanging from the shoulder pivot.
  const arm = merge([
    paint(new THREE.CapsuleGeometry(0.1, 0.42, 2, 6).translate(0, -0.27, 0), robe),
    paint(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 6).translate(0, -0.5, 0), outfit === 3 ? linen : dark),
    paint(new THREE.IcosahedronGeometry(0.1, 0).translate(0, -0.62, 0.01), skin),
  ]);
  // Leg: trousers and a boot (mostly hidden under a long dress).
  const leg = merge([
    paint(new THREE.CapsuleGeometry(0.12, 0.46, 2, 6).translate(0, -0.3, 0), trouser),
    paint(new THREE.BoxGeometry(0.22, 0.14, 0.34).translate(0, -0.66, 0.05), boot),
  ]);
  // A believer's gold: a sash over the shoulder and a little sun on the chest.
  const sash = new THREE.BoxGeometry(0.13, 1.0, 0.05).translate(0, 0, 0).rotateZ(0.62).translate(0.02, 1.2, 0.335);
  const sashBack = new THREE.BoxGeometry(0.13, 1.0, 0.05).rotateZ(-0.62).translate(0.02, 1.2, -0.335);
  const faith = merge([
    paint(sash, 0xffffff),
    paint(sashBack, 0xffffff),
    paint(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8).rotateX(Math.PI / 2).translate(-0.02, 1.32, 0.35), 0xffffff),
  ]);
  return { body, arm, leg, faith };
}

export function carriedGeometry(kind: 'food' | 'wood'): THREE.BufferGeometry {
  if (kind === 'wood') {
    return merge([
      paint(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 6).rotateZ(Math.PI / 2).translate(0, 0, 0.12), 0x8a5a32),
      paint(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 6).rotateZ(Math.PI / 2).translate(0, 0, -0.12), 0x7a4a2a),
    ]);
  }
  return merge([paint(new THREE.SphereGeometry(0.35, 7, 5).scale(1, 0.9, 0.8), 0xd9b25a, 0.1)]);
}
