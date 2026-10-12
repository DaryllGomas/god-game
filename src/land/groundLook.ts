import * as THREE from 'three';
import { WORLD_SIZE } from '../config';

/** Resolution of the land mask (0.78 m per texel over the 800 m world). */
export const LAND_RES = 1024;

/**
 * The land mask: one RGBA texture painted on the CPU (see LandMask.ts) and read by the terrain and the grass.
 *   R = worn dirt path (roads, village footpaths)     G = forest floor (shade and needles under trees)
 *   B = trampled ground (around houses, fields, the totem)     A = unused
 * Shared by reference: the terrain material and the grass tufts pick up the texture the land plugin fills in.
 */
const maskData = new Uint8Array(LAND_RES * LAND_RES * 4);
export const landMaskTexture = new THREE.DataTexture(maskData, LAND_RES, LAND_RES, THREE.RGBAFormat);
landMaskTexture.magFilter = THREE.LinearFilter;
landMaskTexture.minFilter = THREE.LinearFilter;
landMaskTexture.wrapS = landMaskTexture.wrapT = THREE.ClampToEdgeWrapping;
landMaskTexture.generateMipmaps = false;
landMaskTexture.colorSpace = THREE.NoColorSpace;
landMaskTexture.needsUpdate = true;

export const LAND_UNIFORMS = {
  uLandMask: { value: landMaskTexture },
  uLandWorld: { value: WORLD_SIZE },
};

/** Overwrite the mask contents (length LAND_RES^2 * 4) and upload. */
export function setLandMask(data: Uint8Array) {
  maskData.set(data);
  landMaskTexture.needsUpdate = true;
}

/** Shared GLSL: sample the mask at a world xz (clamped, NaN-safe). */
export const LAND_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uLandMask;
uniform float uLandWorld;
vec4 landMask(vec2 xz) {
  vec2 uv = clamp(xz / max(uLandWorld, 1.0) + 0.5, 0.0, 1.0);
  return texture2D(uLandMask, uv);
}
`;

/**
 * Ground colour work on top of the baked vertex colour and the painterly blotches (Terrain.ts GROUND_DETAIL):
 * big warm/deep/mossy patches, meadow yellows, dry olive on slopes, mud and stones near the water, darker ground
 * under trees, worn dirt around buildings and soft-edged dirt paths. Colours are sRGB, converted once.
 */
export const LAND_LOOK_GLSL = /* glsl */ `
{
  vec2 lp = vWorldPos.xz;
  vec4 lm = landMask(lp);
  float gy = vWorldPos.y;
  vec4 bwl = vBiome / max(vBiome.x + vBiome.y + vBiome.z + vBiome.w, 1e-3);
  float flatN = clamp(vWNormal.y / max(length(vWNormal), 1e-4), 0.0, 1.0);
  float slopeL = 1.0 - flatN;

  float big = gnoise(lp * 0.012 + 3.7);
  float mid = gnoise(lp * 0.035 + 11.0);
  float mid2 = gnoise(lp * 0.075 + 29.0);
  float fine = gnoise(lp * 0.9 + 5.0);

  vec3 cDeep = pow(vec3(0.20, 0.38, 0.16), vec3(2.2));
  vec3 cMoss = pow(vec3(0.27, 0.43, 0.25), vec3(2.2));
  vec3 cWarm = pow(vec3(0.52, 0.56, 0.20), vec3(2.2));
  vec3 cMeadow = pow(vec3(0.66, 0.62, 0.27), vec3(2.2));
  vec3 cDirt = pow(vec3(0.58, 0.43, 0.26), vec3(2.2));
  vec3 cDirtLight = pow(vec3(0.72, 0.58, 0.37), vec3(2.2));
  vec3 cDirtDark = pow(vec3(0.38, 0.28, 0.17), vec3(2.2));
  vec3 cNeedle = pow(vec3(0.17, 0.27, 0.13), vec3(2.2));
  vec3 cStone = pow(vec3(0.46, 0.43, 0.38), vec3(2.2));

  vec3 col = diffuseColor.rgb;
  float gw = bwl.x;
  col *= mix(1.0, 0.7, gw); col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * vec3(0.92, 1.0, 0.62), gw * 0.3); // deeper, warmer greens overall: the storyboard's meadows are mid-dark, not lime

  // Large-scale meadow patches: deep green hollows, mossy lows, warm olive and yellow dry rises.
  col = mix(col, cDeep, gw * (1.0 - smoothstep(0.30, 0.55, big)) * 0.7);
  col = mix(col, cMoss, gw * smoothstep(0.42, 0.66, mid2) * (1.0 - smoothstep(0.35, 0.55, big)) * 0.45);
  col = mix(col, cWarm, gw * smoothstep(0.52, 0.72, big) * 0.5);
  col = mix(col, cMeadow, gw * smoothstep(0.60, 0.80, mid) * smoothstep(0.5, 0.7, big) * 0.55);
  // Mid-scale mottling so no patch of lawn reads flat.
  col *= 1.0 + 0.16 * (mid - 0.5) + 0.07 * (fine - 0.5);

  // Dry, dusty olive and bare earth on the steeper green.
  float dry = smoothstep(0.07, 0.2, slopeL) * (0.5 + 0.5 * mid2);
  col = mix(col, cWarm, gw * dry * 0.5);
  col = mix(col, cDirt, gw * smoothstep(0.17, 0.32, slopeL) * smoothstep(0.35, 0.65, mid2 + 0.15) * 0.55);

  // The coast: sand creeps into the grass in patches, mud and pebbles right at the waterline.
  float coastBand = 1.0 - smoothstep(2.4, 6.5, gy);
  col = mix(col, mix(cWarm, cDirtLight, 0.6), gw * coastBand * smoothstep(0.35, 0.65, mid) * 0.65);
  col = mix(col, cStone, bwl.y * smoothstep(0.55, 0.8, fine) * smoothstep(0.1, 0.4, gnoise(lp * 0.3 + 2.0)) * 0.5);

  // Under the trees: darker, bluer, needle-brown ground.
  float floorK = clamp(lm.g, 0.0, 1.0) * (0.75 + 0.25 * gnoise(lp * 0.4 + 9.0));
  col = mix(col, cNeedle * (0.9 + 0.25 * fine), floorK * (gw + 0.5 * bwl.z) * 0.8);

  // Worn ground around buildings, fields and the totem: dry, trampled, with the odd tuft still holding on.
  float worn = clamp(lm.b, 0.0, 1.0) * smoothstep(0.1, 0.55, lm.b + 0.35 * (gnoise(lp * 0.6 + 21.0) - 0.5));
  col = mix(col, mix(cWarm, cDirt, 0.65), worn * 0.7 * (gw + bwl.y));

  // Dirt paths, soft-edged: a worn centre, darker rim, grass breaking through at the edge.
  float pm = clamp(lm.r, 0.0, 1.0);
  float pedge = pm + 0.28 * (gnoise(lp * 0.7 + 13.0) - 0.5) + 0.12 * (fine - 0.5);
  float path = smoothstep(0.28, 0.62, pedge);
  float core = smoothstep(0.55, 0.9, pedge);
  vec3 pc = mix(cDirt, cDirtLight, core * (0.6 + 0.4 * fine));
  pc = mix(pc, cDirtDark, (1.0 - core) * 0.35);
  col = mix(col, pc, path * (1.0 - 0.8 * bwl.w));

  // Sea cliffs: where the ground is steep and near the water the grass gives way to layered strata, a dark wet base
  // and a grass lip above (v0.6 coast; colour only, the height field is untouched).
  {
    float cliffK = smoothstep(0.2, 0.42, slopeL) * (1.0 - smoothstep(9.0, 20.0, gy));
    if (cliffK > 0.001) {
      float yy = gy * 1.15 + gnoise(lp * 0.35) * 0.9;
      float layer = floor(yy);
      float lf = fract(yy);
      float rnd = fract(sin(layer * 12.9898) * 43758.5453);
      vec3 sA = pow(vec3(0.60, 0.54, 0.46), vec3(2.2));
      vec3 sB = pow(vec3(0.42, 0.40, 0.41), vec3(2.2));
      vec3 sC = pow(vec3(0.70, 0.60, 0.46), vec3(2.2));
      vec3 rk = mix(mix(sA, sB, step(0.4, rnd)), sC, step(0.78, rnd));
      rk *= 0.82 + 0.18 * smoothstep(0.0, 0.14, lf) * (1.0 - smoothstep(0.86, 1.0, lf));
      rk = mix(rk, rk * vec3(0.45, 0.52, 0.6), 1.0 - smoothstep(0.2, 2.2, gy));
      col = mix(col, rk, clamp(cliffK, 0.0, 1.0) * 0.92);
    }
  }

  diffuseColor.rgb = col;
}
`;
