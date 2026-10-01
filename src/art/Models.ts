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

const LEAF_COLORS = [0x4f8a2f, 0x5c9a34, 0x3f7a2a, 0x6aa33c, 0x76a83a];
const PINE_COLORS = [0x2f5f3a, 0x2a5534, 0x356b3f];

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

export function storeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.CylinderGeometry(3.4, 3.7, 3.6, 10).translate(0, 1.8, 0), 0xd8c49a, 0.06));
  parts.push(paint(new THREE.CylinderGeometry(3.8, 3.8, 0.35, 10).translate(0, 3.6, 0), 0x6a4a2a));
  parts.push(paint(new THREE.ConeGeometry(4.4, 3.4, 10).translate(0, 5.4, 0), 0xb0452f, 0.1));
  parts.push(paint(new THREE.BoxGeometry(1.4, 2.2, 0.3).translate(0, 1.1, 3.55), 0x4a3020));
  // A flag on top
  parts.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 2.4).translate(0, 8.2, 0), 0x5a3d22));
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
}

const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68a5e, 0x9a6440, 0x7a4a2e];
const HAIR = [0x2a1a10, 0x5a3a1a, 0xa0702a, 0xd9b870, 0x1a1a1a, 0x8a3a1a];

export function villagerParts(seed: number, tunic: number): VillagerParts {
  const rng = new Rng(seed);
  const skin = rng.pick(SKIN);
  const hair = rng.pick(HAIR);
  const tunicCol = new THREE.Color(tunic).multiplyScalar(rng.range(0.85, 1.15));
  const body = merge([
    paint(new THREE.CylinderGeometry(0.28, 0.42, 0.95, 7).translate(0, 1.05, 0), tunicCol),
    paint(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 7).translate(0, 0.82, 0), 0x5a3d22),
    paint(new THREE.IcosahedronGeometry(0.27, 1).translate(0, 1.75, 0), skin),
    paint(new THREE.SphereGeometry(0.29, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.78, -0.02), hair),
  ]);
  const arm = merge([paint(new THREE.CapsuleGeometry(0.09, 0.55, 2, 6).translate(0, -0.33, 0), tunicCol)]);
  const leg = merge([
    paint(new THREE.CapsuleGeometry(0.11, 0.5, 2, 6).translate(0, -0.3, 0), 0x4a3a2a),
    paint(new THREE.BoxGeometry(0.2, 0.12, 0.3).translate(0, -0.66, 0.05), 0x2a1a10),
  ]);
  return { body, arm, leg };
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
