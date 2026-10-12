import * as THREE from 'three';
import { Rng } from '../util/rng';

/**
 * v0.6 coast: layered sea-cliff rock. One lowpoly slab (unit footprint, y 0..1, +z is the sea face, tapered and
 * jittered, flat shaded) and one material that paints strata by world height: pale and dark rock layers, a darker
 * wet base, a drifting foam wash at the waterline, and a grass lip on the top and just below it. Instanced by
 * ScatterSet (src/land/Scatter.ts), so cliffs, rock stacks and islets all share one draw call.
 */
/** A tall rock stack: a faceted, strongly tapered column (unit radius 0.5, y 0..1) with a ragged outline. */
export function cliffStackGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const g = new THREE.CylinderGeometry(0.34, 0.5, 1, 7, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + (rng.next() - 0.5) * 0.42 + 0.12 * Math.sin(y * 9 + seed);
    if (y > 0.001 && y < 0.999) p.setXYZ(i, p.getX(i) * k, y + (rng.next() - 0.5) * 0.04, p.getZ(i) * k);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

export function cliffSlabGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 5, 3);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    let x = p.getX(i);
    let z = p.getZ(i);
    const taper = 1 - 0.22 * y;
    x *= taper;
    z *= taper;
    // Jitter the outline (not the very top rim, so the grass cap stays level), more on the sides than the corners.
    const j = 0.16 * (0.4 + y);
    x += (rng.next() - 0.5) * j;
    z += (rng.next() - 0.5) * j;
    p.setXYZ(i, x, y, z);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

export const cliffUniforms = { uCliffTime: { value: 0 }, uCliffSea: { value: 0 } };

export function cliffMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCliffTime = cliffUniforms.uCliffTime;
    shader.uniforms.uCliffSea = cliffUniforms.uCliffSea;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWP;\nvarying float vCTop;\nvarying float vCDrop;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          mat4 im = mat4(1.0);
          #ifdef USE_INSTANCING
            im = instanceMatrix;
          #endif
          vCWP = (modelMatrix * im * vec4(transformed, 1.0)).xyz;
          vCTop = clamp(normal.y, 0.0, 1.0);
          float sy = max(length(im[1].xyz), 1e-3);
          vCDrop = (1.0 - clamp(position.y, 0.0, 1.0)) * sy;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCWP;
        varying float vCTop;
        varying float vCDrop;
        uniform float uCliffTime;
        uniform float uCliffSea;
        float ch(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float cn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 wp = vCWP;
          float wob = cn(wp.xz * 0.35) * 0.9 + cn(wp.xz * 1.7) * 0.25;
          float yy = wp.y * 1.15 + wob;
          float layer = floor(yy);
          float lf = fract(yy);
          float rnd = ch(vec2(layer, 3.0));
          vec3 cA = pow(vec3(0.5, 0.48, 0.47), vec3(2.2));
          vec3 cB = pow(vec3(0.34, 0.33, 0.37), vec3(2.2));
          vec3 cC = pow(vec3(0.62, 0.52, 0.42), vec3(2.2));
          vec3 rock = mix(mix(cA, cB, step(0.45, rnd)), cC, step(0.86, rnd));
          rock *= 0.9 + 0.2 * cn(wp.xz * 3.1 + layer);
          rock *= 0.82 + 0.18 * smoothstep(0.0, 0.14, lf) * (1.0 - smoothstep(0.86, 1.0, lf)); // dark seams between layers
          // Wet, dark, bluish base.
          float wet = 1.0 - smoothstep(uCliffSea + 0.2, uCliffSea + 1.9, wp.y);
          rock = mix(rock, rock * vec3(0.42, 0.5, 0.58), wet);
          // Foam wash that breathes up and down at the waterline.
          float swell = 0.28 + 0.16 * sin(uCliffTime * 0.9 + wp.x * 0.35 + wp.z * 0.3);
          float foam = (1.0 - smoothstep(0.0, 0.7, abs(wp.y - uCliffSea - swell * 0.5))) * smoothstep(0.3, 0.55, cn(wp.xz * 1.3 + uCliffTime * 0.2));
          rock = mix(rock, vec3(0.9, 0.93, 0.95), foam * 0.95);
          // Grass on top, with a ragged lip that hangs over the face.
          vec3 grassC = pow(vec3(0.34, 0.52, 0.2), vec3(2.2)) * (0.85 + 0.3 * cn(wp.xz * 0.5));
          float lip = 0.12 + 0.5 * cn(wp.xz * 1.9 + 4.0);
          float g = max(smoothstep(0.55, 0.85, vCTop), 1.0 - smoothstep(lip * 0.6, lip, vCDrop));
          rock = mix(rock, grassC, clamp(g, 0.0, 1.0));
          diffuseColor.rgb *= rock;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'cliff-v1';
  return mat;
}
