import * as THREE from 'three';
import { MAT } from '../art/Models';
import { assets } from '../assets';
import { TREE_VARIANTS, initTrees, treeVariant, type Tree } from './Nature';
import { BALANCE_TINT, BALANCE_TINT_GLSL } from '../world/balanceTint';
import { TREE_TINTS } from '../land/palette';
import { FOLIAGE_WIND } from '../art/softCanopy';

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
export function seasonalMaterial(species: number): THREE.MeshStandardMaterial {
  const mat = MAT.base.clone();
  // OPUS pass: smooth shading with the soft crown normals (art/softCanopy.ts) instead of flat facets. Shrubs and
  // flowers share this material; their geometry is non-indexed with face normals, so they still look faceted.
  mat.flatShading = false;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOREST_SEASON, BALANCE_TINT, FOLIAGE_WIND, { uSpecies: { value: species } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uLeafTint;
        uniform float uAutumn;
        uniform float uBare;
        uniform float uBlossom;
        uniform float uSpecies;
        uniform float uWindT;
        varying float vSnowK;
        varying float vLeaf;
        vec3 gSway = vec3(0.0);
        ${BALANCE_TINT_GLSL}`,
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
          float green = step(base.r * 1.08, base.g) * step(base.b * 0.95, base.g); // OPUS: ratio test, so dark (AO'd) leaves count too
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
          // Value contrast (v0.6 polish 3): dark blue-green undersides, warm sunlit tops; pines run deeper and bluer.
          float topK = smoothstep(0.08, 0.95, position.y / 7.0);
          vec3 grad = mix(vec3(0.58, 0.68, 0.78), vec3(1.04, 0.98, 0.86), topK);
          grad = mix(grad, grad * vec3(0.78, 0.96, 1.04), pine);
          leaf *= grad;
          vColor.rgb = mix(vColor.rgb, leaf * instanceColor.rgb, isLeaf);
          vColor.rgb = balanceTint(vColor.rgb, 0.4 + 0.6 * isLeaf);
          vLeaf = isLeaf;
          // OPUS pass: a slow sway in the crowns (more at the top, each tree on its own phase). Kept small (~0.15 m at
          // the top of a full tree) so the unswayed shadow and AO passes never visibly disagree.
          float hgt = max(position.y - 1.5, 0.0);
          float ph = h * 6.2831 + ip.x * 0.05 + ip.z * 0.05;
          float gust = 0.6 + 0.4 * sin(uWindT * 0.37 + ip.x * 0.013);
          gSway = vec3(sin(uWindT * 1.3 + ph), 0.0, cos(uWindT * 1.05 + ph * 1.3)) * (0.022 * hgt * gust * isLeaf * (1.0 - 0.6 * uBare));
        }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += gSway;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnowT;
varying float vSnowK;
varying float vLeaf;`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float cover = smoothstep(0.2, 0.6, dot(normal, upV)) * uSnowT * vSnowK;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), cover * 0.85);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // OPUS pass, leaves only: light through the crown. A backlit rim when you look toward the sun, and a wrapped
          // terminator so the shadow side of a crown is lit a little past 90 degrees (leaves scatter, stone doesn't).
          vec3 Ls = directionalLights[0].direction;
          float ndl = dot(geometryNormal, Ls);
          float back = pow(saturate(dot(-geometryViewDir, Ls)), 2.0);
          float rim = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
          float wrapK = saturate((ndl + 0.55) / 1.55) - saturate(ndl);
          vec3 trans = diffuseColor.rgb * directionalLights[0].color * RECIPROCAL_PI * (1.4 * back * rim + 0.45 * wrapK);
          trans *= vec3(1.0, 1.05, 0.8); // light through leaves comes out yellow-green
          if (trans.r == trans.r && trans.g == trans.g && trans.b == trans.b) reflectedLight.directDiffuse += vLeaf * max(trans, vec3(0.0));
        }
        #endif`,
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
        mesh.setColorAt(i, t.charred ? CHARRED : TREE_TINTS[Math.abs(t.seed) % TREE_TINTS.length]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
