import * as THREE from 'three';

/**
 * Soft canopies (OPUS pass): the "volumetric tree" normal trick used by Ghibli-style and Tiny Glade-style foliage.
 *
 * The tree models are faceted low-poly crowns. Lit with their own (face) normals, every facet is a separate flat tone
 * and the crown reads as a pile of shards. Here every leaf vertex gets a normal pointing out from the crown's centre
 * (an ellipsoid fitted to the leaf vertices), blended with a little of the original normal so the clumps keep some
 * form. The whole crown then catches the light as one soft volume: warm lit top, cool belly, a soft terminator.
 * The baked AO in the vertex colours still marks the clumps.
 *
 * Leaf vertices are found the same way the tree shader finds them (Forest.ts): green-dominant, or a blossom pink.
 * Trunks keep their normals. Runs once per tree geometry at load; idempotent (marks the geometry).
 */
export function softenCanopy(geo: THREE.BufferGeometry, species: string): void {
  if (geo.userData.softCanopy) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  let nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !col) return;
  if (!nor) {
    geo.computeVertexNormals();
    nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  }
  const n = pos.count;
  const leaf = new Uint8Array(n);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const blossom = species === 'blossom';
  const p = new THREE.Vector3();
  let leaves = 0;
  for (let i = 0; i < n; i++) {
    const r = col.getX(i);
    const g = col.getY(i);
    const b = col.getZ(i);
    const green = g >= r + 0.04 && g >= b; // same test as the tree shader (Forest.ts)
    const petal = blossom && r > g + 0.15 && b >= g;
    if (!green && !petal) continue;
    // Thin trunks are brown (r > g), so they never land here; skip anything near the ground just in case.
    if (pos.getY(i) < 0.8) continue;
    leaf[i] = 1;
    leaves++;
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    min.min(p);
    max.max(p);
  }
  if (leaves < 8) return;
  const c = min.clone().add(max).multiplyScalar(0.5);
  const e = max.clone().sub(min).multiplyScalar(0.5).max(new THREE.Vector3(0.5, 0.5, 0.5));
  const pine = species === 'pine';
  // Pines are tiered cones: keep more of the facet normal so each tier still reads, and lift the normals so the
  // sides catch the sky. Broadleaf crowns go almost fully round.
  const keep = pine ? 0.4 : 0.22;
  const lift = pine ? 0.35 : 0.12;
  const s = new THREE.Vector3();
  const o = new THREE.Vector3();
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    o.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    if (leaf[i]) {
      s.set((pos.getX(i) - c.x) / e.x, (pos.getY(i) - c.y) / e.y + lift, (pos.getZ(i) - c.z) / e.z);
      if (s.lengthSq() < 1e-6) s.set(0, 1, 0);
      s.normalize().multiplyScalar(1 - keep).addScaledVector(o.normalize(), keep);
      if (s.lengthSq() < 1e-6) s.set(0, 1, 0);
      o.copy(s.normalize());
    }
    out[i * 3] = Number.isFinite(o.x) ? o.x : 0;
    out[i * 3 + 1] = Number.isFinite(o.y) ? o.y : 1;
    out[i * 3 + 2] = Number.isFinite(o.z) ? o.z : 0;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  geo.userData.softCanopy = true;
}

/** Wind clock for every foliage material (advanced by plugins/foliage.ts). */
export const FOLIAGE_WIND = { uWindT: { value: 0 } };
