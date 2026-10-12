import * as THREE from 'three';

/**
 * Leaf tints multiplied into every tree and shrub (instance colour): deeper, bluer and warmer greens than the raw
 * model so a wood has depth, the way the storyboard's forests do. Real trees (Forest.ts) and decorative ones share it.
 */
export const TREE_TINTS = [
  new THREE.Color(0.56, 0.72, 0.58),
  new THREE.Color(0.46, 0.64, 0.54),
  new THREE.Color(0.66, 0.74, 0.5),
  new THREE.Color(0.42, 0.6, 0.56),
  new THREE.Color(0.58, 0.7, 0.46),
  new THREE.Color(0.4, 0.56, 0.48),
  new THREE.Color(0.72, 0.7, 0.48),
];
