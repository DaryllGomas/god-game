import * as THREE from 'three';

/**
 * Leaf tints multiplied into every tree and shrub (instance colour): deeper, bluer and warmer greens than the raw
 * model so a wood has depth, the way the storyboard's forests do. Real trees (Forest.ts) and decorative ones share it.
 */
export const TREE_TINTS = [
  // World look pass 6 (storyboard panel 3): deeper overall, more spread between dark teal pines, mid greens and olive,
  // and one warm gold-orange so the odd tree turns, as in the storyboard's woods.
  new THREE.Color(0.5, 0.66, 0.52),
  new THREE.Color(0.38, 0.56, 0.5),
  new THREE.Color(0.6, 0.66, 0.42),
  new THREE.Color(0.32, 0.5, 0.5),
  new THREE.Color(0.52, 0.62, 0.4),
  new THREE.Color(0.3, 0.45, 0.4),
  new THREE.Color(0.68, 0.64, 0.4),
  new THREE.Color(0.44, 0.6, 0.44),
  new THREE.Color(0.26, 0.42, 0.38),
  new THREE.Color(0.86, 0.6, 0.32),
];
