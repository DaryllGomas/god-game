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
    // Ratio test, not the shader's absolute one: the baked AO leaves much of a crown very dark in linear (0.02/0.05/0.01),
    // and near-black canopy-interior vertices count too. Brown trunks (r > g) and pale birch bark (grey) stay out.
    const mx = Math.max(r, g, b);
    const green = (g >= r * 1.08 && g >= b * 0.95) || mx < 0.012;
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

  // The Blender set bakes a random tone per facet (and a hard black AO) into the vertex colours; with soft normals that
  // jitter is what still reads as shards. Rebuild the crown's colour: its mean leaf colour (petals keep their own),
  // shaded by a smooth volumetric AO (dark belly and core, bright crown) and 25% of the welded original for life.
  let mr = 0, mg = 0, mb = 0, mc = 0;
  for (let i = 0; i < n; i++) {
    if (!leaf[i]) continue;
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    if (Math.max(r, g, b) < 0.03 || !(g >= r * 1.08)) continue; // only clearly green, lit samples set the mean
    mr += r; mg += g; mb += b; mc++;
  }
  if (mc < 4) { mr = 0.06; mg = 0.16; mb = 0.03; mc = 1; }
  mr /= mc; mg /= mc; mb /= mc;
  const sum = new Map<string, [number, number, number, number]>();
  const key = (i: number) => `${Math.round(pos.getX(i) * 200)},${Math.round(pos.getY(i) * 200)},${Math.round(pos.getZ(i) * 200)}`;
  for (let i = 0; i < n; i++) {
    if (!leaf[i]) continue;
    const k = key(i);
    const a = sum.get(k) ?? [0, 0, 0, 0];
    a[0] += col.getX(i); a[1] += col.getY(i); a[2] += col.getZ(i); a[3]++;
    sum.set(k, a);
  }
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    if (leaf[i]) {
      const a = sum.get(key(i))!;
      const wr = a[0] / a[3], wg = a[1] / a[3], wb = a[2] / a[3];
      const isPetal = species === 'blossom' && wr > wg + 0.1;
      // Volumetric AO from where the vertex sits in the crown: radial depth and how much it faces down.
      const dx = (pos.getX(i) - c.x) / e.x, dy = (pos.getY(i) - c.y) / e.y, dz = (pos.getZ(i) - c.z) / e.z;
      const rad = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const ny = out[i * 3 + 1];
      const up = Math.min(1, Math.max(0, (ny + 0.9) / 1.6));
      const ao = (0.42 + 0.58 * up * up * (3 - 2 * up)) * (0.6 + 0.4 * Math.min(1, Math.max(0, (rad - 0.3) / 0.6)));
      const br = isPetal ? wr : mr, bg = isPetal ? wg : mg, bb = isPetal ? wb : mb;
      r = br * ao * 0.75 + wr * 0.25;
      g = bg * ao * 0.75 + wg * 0.25;
      b = bb * ao * 0.75 + wb * 0.25;
    }
    cols[i * 3] = Number.isFinite(r) ? r : 0;
    cols[i * 3 + 1] = Number.isFinite(g) ? g : 0;
    cols[i * 3 + 2] = Number.isFinite(b) ? b : 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.userData.softCanopy = true;
}

/** Wind clock for every foliage material (advanced by plugins/foliage.ts). */
export const FOLIAGE_WIND = { uWindT: { value: 0 } };
