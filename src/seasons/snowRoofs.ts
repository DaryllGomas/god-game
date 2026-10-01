import { MAT } from '../art/Models';
import { FOREST_SEASON } from '../entities/Forest';

/**
 * Winter dusting for everything built from the shared base material (roofs, boulders, villagers'
 * shoulders...): upward-facing surfaces whiten with the same `uSnowT` the tree canopies use.
 * Patches the material once at install time, before anything has been drawn.
 */
export function patchSnowOnBase() {
  const mat = MAT.base;
  if (mat.userData.snowPatched) return;
  mat.userData.snowPatched = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowT = FOREST_SEASON.uSnowT;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowT;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float cover = smoothstep(0.35, 0.7, dot(normal, upV)) * uSnowT;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.98), cover * 0.9);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'base-snow';
  mat.needsUpdate = true;
}
