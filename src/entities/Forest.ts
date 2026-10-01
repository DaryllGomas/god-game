import * as THREE from 'three';
import { MAT } from '../art/Models';
import { assets } from '../assets';
import { TREE_VARIANTS, initTrees, treeVariant, type Tree } from './Nature';

const CAPACITY = 512;
const WHITE = new THREE.Color(1, 1, 1);
const CHARRED = new THREE.Color(0x2b2522);

/**
 * Seasonal controls shared by every tree material (the seasons plugin writes these each frame):
 * leaf tint, autumn colour (0..1), bare/dried winter leaves, blossom bloom and canopy snow.
 */
export const FOREST_SEASON = {
  uLeafTint: { value: new THREE.Color(1, 1, 1) },
  uAutumn: { value: 0 },
  uBare: { value: 0 },
  uBlossom: { value: 1 },
  uSnowT: { value: 0 },
};

/** Species codes understood by the tree shader. */
const SPECIES_CODE: Record<string, number> = { oak: 0, pine: 1, birch: 2, blossom: 3 };

/** Per-vertex leaf recolouring and an up-facing snow dusting, on a copy of the shared base material. */
function seasonalMaterial(species: number): THREE.MeshStandardMaterial {
  const mat = MAT.base.clone();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOREST_SEASON, { uSpecies: { value: species } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uLeafTint;
        uniform float uAutumn;
        uniform float uBare;
        uniform float uBlossom;
        uniform float uSpecies;
        varying float vSnowK;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        {
          vec3 base = color.rgb;
          vec3 ip = instanceMatrix[3].xyz;
          float h = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
          float h2 = fract(h * 7.13 + 0.31);
          vSnowK = 0.7 + 0.3 * h2;
          float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
          float lf = clamp(luma / 0.32, 0.55, 1.35);
          float green = step(base.r + 0.04, base.g) * step(base.b, base.g);
          float petal = step(base.g + 0.15, base.r) * step(base.g, base.b) * step(2.5, uSpecies);
          float isLeaf = max(green, petal);
          float pine = step(0.5, uSpecies) * step(uSpecies, 1.5);
          float dec = 1.0 - pine;
          // Spring/summer greens (blossom trees wear their petals while uBlossom is up).
          vec3 leaf = base * uLeafTint;
          vec3 petalLeaf = mix(vec3(0.17, 0.36, 0.05) * lf * uLeafTint, base, uBlossom);
          leaf = mix(leaf, petalLeaf, petal);
          // Autumn: gold, orange and red, trees turning a little at a time.
          float turn = clamp(uAutumn * 1.5 - h * 0.5, 0.0, 1.0) * dec;
          vec3 pal = h2 < 0.34 ? vec3(0.78, 0.44, 0.04) : (h2 < 0.7 ? vec3(0.66, 0.20, 0.03) : vec3(0.42, 0.06, 0.03));
          if (uSpecies > 1.5 && uSpecies < 2.5) pal = mix(pal, vec3(0.85, 0.62, 0.06), 0.7);
          leaf = mix(leaf, pal * lf, turn);
          // Winter: dried russet leaves still clinging; pines go a cold, deep green.
          leaf = mix(leaf, vec3(0.30, 0.20, 0.12) * lf, uBare * dec);
          leaf = mix(leaf, base * vec3(0.8, 0.95, 1.12), uBare * pine);
          vColor.rgb = mix(vColor.rgb, leaf * instanceColor.rgb, isLeaf);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnowT;
varying float vSnowK;`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float cover = smoothstep(0.2, 0.6, dot(normal, upV)) * uSnowT * vSnowK;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), cover * 0.85);
        }`,
      );
  };
  return mat;
}

/**
 * Draws every tree with one InstancedMesh per geometry variant: one draw call per variant
 * for the whole island instead of one (plus a shadow pass) per tree.
 * Trees keep their transform on their entity Group; this just mirrors it.
 */
export class Forest {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly slots: Tree[][] = [];
  private readonly local = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    initTrees(); // TREE_VARIANTS depends on whether the Blender set loaded
    for (let i = 0; i < TREE_VARIANTS; i++) {
      const species = SPECIES_CODE[assets.trees?.[i]?.species ?? 'oak'] ?? 0;
      const mesh = new THREE.InstancedMesh(treeVariant(i).geo, seasonalMaterial(species), CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Instances move (thrown, felled), so skip the stale whole-mesh bounds test.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, WHITE); // allocate instanceColor before the first compile
      scene.add(mesh);
      this.meshes.push(mesh);
      this.slots.push([]);
    }
  }

  add(t: Tree) {
    const list = this.slots[t.variant];
    if (list.length >= CAPACITY) return;
    list.push(t);
  }

  remove(t: Tree) {
    const list = this.slots[t.variant];
    const i = list.indexOf(t);
    if (i < 0) return;
    list[i] = list[list.length - 1];
    list.pop();
  }

  sync() {
    for (let v = 0; v < this.meshes.length; v++) {
      const mesh = this.meshes[v];
      const list = this.slots[v];
      mesh.count = list.length;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        t.object.updateMatrix();
        this.local.makeRotationY(t.yaw).scale(this.s.setScalar(t.scale));
        this.world.multiplyMatrices(t.object.matrix, this.local);
        mesh.setMatrixAt(i, this.world);
        mesh.setColorAt(i, t.charred ? CHARRED : WHITE);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
