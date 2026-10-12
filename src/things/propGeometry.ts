import * as THREE from 'three';
import { merge, paint } from '../art/Models';
import { Rng } from '../util/rng';

/** Small village props, each one merged vertex-coloured geometry (drawn instanced, MAT.base). Origin at the ground. */
const R = new Rng(777);

export function barrelGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.42, 0.42, 0.9, 8).translate(0, 0.45, 0);
  const belly = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8).translate(0, 0.45, 0);
  const lid = new THREE.CylinderGeometry(0.4, 0.4, 0.04, 8).translate(0, 0.9, 0);
  return merge([
    paint(body, 0x7a5230, 0.1, R),
    paint(belly, 0x8a6038, 0.1, R),
    paint(new THREE.CylinderGeometry(0.52, 0.52, 0.07, 8).translate(0, 0.22, 0), 0x3a3a3c),
    paint(new THREE.CylinderGeometry(0.52, 0.52, 0.07, 8).translate(0, 0.68, 0), 0x3a3a3c),
    paint(lid, 0x9a7444),
  ]);
}

export function crateGeometry(): THREE.BufferGeometry {
  const parts = [paint(new THREE.BoxGeometry(0.85, 0.7, 0.85).translate(0, 0.35, 0), 0x9a7a4a, 0.1, R)];
  for (const y of [0.08, 0.62]) parts.push(paint(new THREE.BoxGeometry(0.9, 0.1, 0.9).translate(0, y, 0), 0x6a4a28));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(paint(new THREE.BoxGeometry(0.1, 0.74, 0.1).translate(sx * 0.42, 0.37, sz * 0.42), 0x6a4a28));
  return merge(parts);
}

/** A 2 m fence segment along x: two posts, two rails. */
export function fenceGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1, 1]) parts.push(paint(new THREE.BoxGeometry(0.16, 1.05, 0.16).translate(x, 0.52, 0), 0x6a4a2c, 0.12, R));
  for (const y of [0.4, 0.8]) parts.push(paint(new THREE.BoxGeometry(2.1, 0.11, 0.09).translate(0, y, 0), 0x8a6a42, 0.12, R));
  return merge(parts);
}

/** Lantern post: pole with a bracket; the glowing cage is a separate geometry. */
export function lanternPostGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.BoxGeometry(0.12, 1.7, 0.12).translate(0, 0.85, 0), 0x4a3320),
    paint(new THREE.BoxGeometry(0.5, 0.08, 0.08).translate(0.22, 1.66, 0), 0x4a3320),
    paint(new THREE.BoxGeometry(0.3, 0.06, 0.3).translate(0.4, 1.4, 0), 0x2f2a26),
    paint(new THREE.BoxGeometry(0.3, 0.05, 0.3).translate(0.4, 1.1, 0), 0x2f2a26),
  ]);
}
export function lanternGlowGeometry(): THREE.BufferGeometry {
  return merge([paint(new THREE.BoxGeometry(0.22, 0.26, 0.22).translate(0.4, 1.25, 0), 0xffffff)]);
}

/** Tree stump: flared base, cut top with growth rings (paler centre). */
export function stumpGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.55, 0.78, 0.7, 9).translate(0, 0.35, 0);
  const roots: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    roots.push(paint(new THREE.BoxGeometry(0.9, 0.22, 0.2).rotateY(-a).translate(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55), 0x4e3722, 0.1, R));
  }
  return merge([
    paint(body, 0x5e4228, 0.14, R),
    paint(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 9).translate(0, 0.72, 0), 0xcfa66c),
    paint(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 9).translate(0, 0.745, 0), 0xe2c28a),
    paint(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 7).translate(0, 0.765, 0), 0xb98a52),
    ...roots,
  ]);
}
