import * as THREE from 'three';

/**
 * Leaf tints multiplied into every tree and shrub (instance colour): deeper, bluer and warmer greens than the raw
 * model so a wood has depth, the way the storyboard's forests do. Real trees (Forest.ts) and decorative ones share it.
 */
export const TREE_TINTS = [
  new THREE.Color(0.8, 0.92, 0.78),
  new THREE.Color(0.68, 0.85, 0.7),
  new THREE.Color(0.9, 0.93, 0.7),
  new THREE.Color(0.62, 0.8, 0.74),
  new THREE.Color(0.78, 0.88, 0.62),
  new THREE.Color(0.58, 0.76, 0.62),
  new THREE.Color(0.95, 0.9, 0.66),
];
