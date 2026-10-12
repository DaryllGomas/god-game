import * as THREE from 'three';
import type { Job } from './Jobs';

/** Solid, deliberately oversized silhouettes, readable without labels. */
export function equipment(): Record<Exclude<Job, 'worshipper'>, THREE.Group> {
  const wood = new THREE.MeshStandardMaterial({ color: 0x946039, roughness: 1 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xbac5c9, roughness: 1 });
  const straw = new THREE.MeshStandardMaterial({ color: 0xd6b267, roughness: 1 });
  const part = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };
  const forester = new THREE.Group();
  part(forester, new THREE.BoxGeometry(0.12, 2, 0.12), wood, 0.55, 1.85, -0.12).rotation.z = -0.35;
  part(forester, new THREE.BoxGeometry(0.65, 0.45, 0.18), stone, 0.85, 2.65, -0.12);
  const farmer = new THREE.Group();
  part(farmer, new THREE.BoxGeometry(0.1, 2, 0.1), wood, -0.65, 1.4, 0);
  part(farmer, new THREE.BoxGeometry(0.6, 0.12, 0.3), stone, -0.65, 0.4, 0.12);
  part(farmer, new THREE.CylinderGeometry(0.4, 0.32, 0.5, 6), straw, 0.55, 1.1, -0.3);
  const builder = new THREE.Group();
  part(builder, new THREE.BoxGeometry(1.1, 0.6, 0.65), stone, 0, 1.45, 0.55);
  const fisher = new THREE.Group();
  part(fisher, new THREE.CylinderGeometry(0.04, 0.06, 3.1, 5), wood, 0.65, 2, 0.45).rotation.x = 0.35;
  part(fisher, new THREE.CylinderGeometry(0.015, 0.015, 1.6, 4), straw, 0.65, 2.3, 0.98);
  part(fisher, new THREE.ConeGeometry(0.55, 0.25, 8), straw, 0, 2.2, 0);
  return { forester, farmer, builder, fisher };
}
