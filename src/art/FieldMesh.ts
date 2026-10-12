import * as THREE from 'three';
import { paint, merge } from './Models';
import { SOIL_LIFT, SOIL_STEP } from '../world/groundRules';

/**
 * A crop field that follows the ground. `sample(lx, lz)` gives the terrain height at a point in the
 * field's local frame (relative to the field's origin), so the soil is draped over the slope with a
 * buried skirt, and every crop row grows up from the ground under it instead of sinking or floating.
 */
export interface FieldMesh {
  soil: THREE.BufferGeometry;
  crops: THREE.BufferGeometry;
  /** Ground height per crop vertex, and whether the vertex is on the top of its box. */
  ground: Float32Array;
  top: Uint8Array;
}

const CROP_BURY = 0.35;

/** Soil grid cells along a side of length `len`. */
export const soilCells = (len: number) => Math.max(2, Math.ceil(len / SOIL_STEP));

export function buildFieldMesh(w: number, d: number, sample: (lx: number, lz: number) => number): FieldMesh {
  // --- soil: a grid draped on the terrain, plus a skirt so no gap shows on slopes.
  const nx = soilCells(w);
  const nz = soilCells(d);
  const pos: number[] = [];
  const idx: number[] = [];
  const vi = (i: number, j: number) => j * (nx + 1) + i;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = -w / 2 + (w * i) / nx;
      const z = -d / 2 + (d * j) / nz;
      pos.push(x, sample(x, z) + SOIL_LIFT, z);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = vi(i, j);
      const b = vi(i + 1, j);
      const c = vi(i + 1, j + 1);
      const e = vi(i, j + 1);
      idx.push(a, e, c, a, c, b);
    }
  const skirt = (ids: number[]) => {
    const base = pos.length / 3;
    for (const v of ids) pos.push(pos[v * 3], pos[v * 3 + 1] - 0.7, pos[v * 3 + 2]);
    for (let k = 0; k < ids.length - 1; k++) {
      const a = ids[k];
      const b = ids[k + 1];
      const c = base + k + 1;
      const e = base + k;
      idx.push(a, b, c, a, c, e, a, c, b, a, e, c); // two-sided: winding differs per edge
    }
  };
  const north: number[] = [], south: number[] = [], west: number[] = [], east: number[] = [];
  for (let i = 0; i <= nx; i++) {
    north.push(vi(i, 0));
    south.push(vi(i, nz));
  }
  for (let j = 0; j <= nz; j++) {
    west.push(vi(0, j));
    east.push(vi(nx, j));
  }
  skirt(north);
  skirt(south);
  skirt(west);
  skirt(east);
  let soilGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
  soilGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  soilGeo.setIndex(idx);
  soilGeo = paint(soilGeo, 0x6e4e30, 0.1);
  soilGeo.computeVertexNormals();
  soilGeo.computeBoundingSphere();

  // --- crops: rows of short segments; each vertex remembers its ground height.
  const parts: THREE.BufferGeometry[] = [];
  const rows = Math.floor(d / 1.2);
  const segs = Math.max(4, Math.round((w - 0.8) / 1.1));
  const segW = (w - 0.8) / segs;
  for (let r = 0; r < rows; r++) {
    const z = -d / 2 + 0.6 + r * 1.2;
    for (let s = 0; s < segs; s++) {
      const x = -(w - 0.8) / 2 + segW * (s + 0.5);
      parts.push(paint(new THREE.BoxGeometry(segW + 0.02, 1, 0.55).translate(x, 0.5, z), 0xffffff, 0.12));
    }
  }
  const crops = merge(parts);
  const p = crops.attributes.position as THREE.BufferAttribute;
  const ground = new Float32Array(p.count);
  const top = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    ground[i] = sample(p.getX(i), p.getZ(i));
    top[i] = p.getY(i) > 0.5 ? 1 : 0;
  }
  const out: FieldMesh = { soil: soilGeo, crops, ground, top };
  setCropHeight(out, 0.2);
  return out;
}

/** Set every crop's height (`scale` 0.15..1.1) by moving the box tops up from the ground under them. */
export function setCropHeight(f: FieldMesh, scale: number) {
  const p = f.crops.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const g = f.ground[i];
    p.setY(i, f.top[i] ? g + SOIL_LIFT + scale : g - CROP_BURY);
  }
  p.needsUpdate = true;
  f.crops.computeBoundingSphere();
}
