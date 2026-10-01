import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** One Blender-built tree variant: geometry with its origin at the trunk base. */
export interface TreeAsset {
  name: string;
  /** 'oak' | 'pine' | 'birch' | 'blossom' (from the mesh name, e.g. "oak_3"). */
  species: string;
  geo: THREE.BufferGeometry;
  /** Height at full growth, in metres. */
  height: number;
}

/** Models loaded before the game starts. Anything missing falls back to code-built art. */
export const assets: { golem: THREE.Object3D | null; trees: TreeAsset[] | null; hand: THREE.Object3D | null } = { golem: null, trees: null, hand: null };

export async function loadAssets(): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  const [golem, trees, hand] = await Promise.allSettled([
    loader.loadAsync(`${base}models/golem.glb`),
    loader.loadAsync(`${base}models/trees.glb`),
    loader.loadAsync(`${base}models/hand.glb`),
  ]);
  if (hand.status === 'fulfilled') assets.hand = hand.value.scene;
  else console.warn('Hand model failed to load; using the primitive hand instead.', hand.reason);

  if (golem.status === 'fulfilled') assets.golem = golem.value.scene;
  else console.warn('Golem model failed to load; using the code-built prototype instead.', golem.reason);

  if (trees.status === 'fulfilled') {
    const scene = trees.value.scene;
    scene.updateMatrixWorld(true);
    const list: TreeAsset[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      list.push({ name: m.name, species: m.name.replace(/_\d+$/, ''), geo, height: geo.boundingBox!.max.y });
    });
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (list.length) assets.trees = list;
  } else {
    console.warn('Tree models failed to load; using the code-built trees instead.', trees.reason);
  }
}
