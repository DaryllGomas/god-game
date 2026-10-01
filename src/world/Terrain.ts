import * as THREE from 'three';
import { Noise2D } from '../util/noise';
import { clamp, lerp, smoothstep } from '../util/math';
import { SEA_LEVEL, TERRAIN_RES, WORLD_SIZE, type VillageSite } from '../config';
import { GROUND_NOISE_GLSL } from './groundNoise';

const MAX_INFLUENCE = 8;
const MAX_RIVAL = 4;
const OCEAN_FLOOR = -30;

/**
 * Procedural island heightfield. Owns the mesh plus fast CPU-side queries
 * (height, normal, ray intersection) used by every other system.
 */
export class Terrain {
  readonly size = WORLD_SIZE;
  readonly res = TERRAIN_RES;
  readonly cell = WORLD_SIZE / (TERRAIN_RES - 1);
  readonly heights: Float32Array;
  readonly mesh: THREE.Mesh;
  /** Height encoded into a texture so the water shader can find shorelines. */
  readonly heightTexture: THREE.DataTexture;
  /** Heights in metres as half floats (used by the grass to sit blades on the ground). */
  readonly heightHalfTexture: THREE.DataTexture;

  private readonly uniforms = {
    uInfluence: { value: Array.from({ length: MAX_INFLUENCE }, () => new THREE.Vector3()) },
    uInfluenceCount: { value: 0 },
    // The rival god's villages (see src/rival): a violet ring with an ember edge.
    uRival: { value: Array.from({ length: MAX_RIVAL }, () => new THREE.Vector3()) },
    uRivalCount: { value: 0 },
    uRingWidth: { value: 1 },
    uHand: { value: new THREE.Vector4(0, 0, 0, 0) }, // x, z, radius, blocked(0/1)
    uTime: { value: 0 },
    // Seasons (see src/seasons): grass hue shift, snow cover and rain wetness.
    uGrassTarget: { value: new THREE.Color(0x7fc74a) },
    uGrassAmt: { value: 0 },
    uSnow: { value: 0 },
    uWet: { value: 0 },
  };

  constructor(seed: number, sites: VillageSite[]) {
    this.heights = this.generate(seed, sites);
    this.mesh = this.buildMesh(seed);
    this.heightTexture = this.buildHeightTexture();
    this.heightHalfTexture = this.buildHeightHalfTexture();
  }

  // ---------------------------------------------------------------- generation

  private generate(seed: number, sites: VillageSite[]): Float32Array {
    const n = new Noise2D(seed);
    const warp = new Noise2D(seed + 1);
    const mountains = new Noise2D(seed + 2);
    const { res, size } = this;
    const h = new Float32Array(res * res);
    const half = size / 2;

    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = (ix / (res - 1)) * size - half;
        const z = (iz / (res - 1)) * size - half;

        // Warped radial island mask.
        const d = Math.hypot(x * 1.05, z) / half;
        const w = warp.fbm(x * 0.0045, z * 0.0045, 4) * 0.28;
        let mask = 1 - smoothstep(0.52, 0.9, d + w);
        for (const s of sites) {
          const sd = Math.hypot(x - s.x, z - s.z);
          mask = Math.max(mask, 1 - smoothstep(s.radius * 1.4, s.radius * 2.6, sd));
        }

        // Rolling hills + a ridged mountain range through the middle.
        const hills = n.fbm(x * 0.006, z * 0.006, 5) * 0.5 + 0.5;
        const rangeCenter = Math.hypot(x + 10, z - 20) / 170;
        const rangeMask = 1 - smoothstep(0.35, 1.0, rangeCenter + warp.noise(x * 0.01, z * 0.01) * 0.15);
        const ridge = mountains.ridged(x * 0.0065, z * 0.0065, 5);
        let height = 4 + hills * 16 + Math.pow(ridge, 2.4) * 95 * rangeMask;

        height = lerp(OCEAN_FLOOR, height, mask);

        // Flatten village plateaus.
        for (const s of sites) {
          const sd = Math.hypot(x - s.x, z - s.z);
          const t = 1 - smoothstep(s.radius * 0.9, s.radius * 1.7, sd);
          if (t > 0) height = lerp(height, 7 + hills * 3, t);
        }

        h[iz * res + ix] = height;
      }
    }

    // A couple of smoothing passes so slopes are walkable.
    const tmp = new Float32Array(h.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let iz = 0; iz < res; iz++) {
        for (let ix = 0; ix < res; ix++) {
          let sum = 0;
          let cnt = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const jx = clamp(ix + dx, 0, res - 1);
              const jz = clamp(iz + dz, 0, res - 1);
              sum += h[jz * res + jx];
              cnt++;
            }
          }
          tmp[iz * res + ix] = sum / cnt;
        }
      }
      h.set(tmp);
    }
    return h;
  }

  private buildMesh(seed: number): THREE.Mesh {
    const { res, size } = this;
    const geo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const biome = new Float32Array(pos.count * 4); // grass, sand, rock, snow weights for the shader
    const tint = new Noise2D(seed + 7);

    const sand = new THREE.Color(0xd9c38a);
    const wetSand = new THREE.Color(0xa89468);
    const grass = new THREE.Color(0x6aa33f);
    const lush = new THREE.Color(0x3f7f2c);
    const dry = new THREE.Color(0x9aa84a);
    const rock = new THREE.Color(0x857c70);
    const darkRock = new THREE.Color(0x5e5750);
    const snow = new THREE.Color(0xf2f4f7);
    const c = new THREE.Color();
    const n = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // PlaneGeometry after rotateX(-PI/2) lays rows along -z..+z matching our index order.
      const ix = i % res;
      const iz = Math.floor(i / res);
      const y = this.heights[iz * res + ix];
      pos.setY(i, y);

      this.normalAt(x, z, n);
      const slope = 1 - n.y;
      const v = tint.fbm(x * 0.02, z * 0.02, 3);

      if (y < SEA_LEVEL - 0.5) c.copy(wetSand).lerp(darkRock, clamp(-y / 25, 0, 0.7));
      else if (y < SEA_LEVEL + 2.2) c.copy(sand);
      else {
        c.copy(grass).lerp(lush, clamp(v * 0.8 + 0.4, 0, 1));
        c.lerp(dry, clamp(-v * 1.2, 0, 0.6));
        c.lerp(sand, smoothstep(3.5, 2.2, y));
        const rockiness = smoothstep(0.18, 0.34, slope) + smoothstep(45, 62, y);
        c.lerp(rock, clamp(rockiness, 0, 1));
        c.lerp(darkRock, clamp(smoothstep(0.35, 0.55, slope) * 0.6, 0, 1));
        c.lerp(snow, smoothstep(56, 70, y + v * 6) * (1 - smoothstep(0.45, 0.7, slope)));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      const sandW = y < SEA_LEVEL + 2.2 ? 1 : smoothstep(3.5, 2.2, y);
      const rockW = y < SEA_LEVEL + 2.2 ? 0 : clamp(smoothstep(0.18, 0.34, slope) + smoothstep(45, 62, y), 0, 1);
      const snowW = y < SEA_LEVEL + 2.2 ? 0 : smoothstep(56, 70, y + v * 6) * (1 - smoothstep(0.45, 0.7, slope));
      biome[i * 4] = Math.max(0, 1 - sandW - rockW - snowW);
      biome[i * 4 + 1] = sandW;
      biome[i * 4 + 2] = rockW;
      biome[i * 4 + 3] = snowW;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('biome', new THREE.BufferAttribute(biome, 4));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    this.injectInfluenceShader(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  private injectInfluenceShader(mat: THREE.MeshStandardMaterial) {
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nattribute vec4 biome;\nvarying vec4 vBiome;\nvarying vec3 vWNormal;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWNormal = objectNormal;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBiome = biome;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPos;
          varying vec4 vBiome;
          varying vec3 vWNormal;
          uniform vec3 uGrassTarget;
          uniform float uGrassAmt;
          uniform float uSnow;
          uniform float uWet;
          float gWet = 0.0;
          float gSnow = 0.0;
          ${GROUND_NOISE_GLSL}
          uniform vec3 uInfluence[${MAX_INFLUENCE}];
          uniform int uInfluenceCount;
          uniform vec3 uRival[${MAX_RIVAL}];
          uniform int uRivalCount;
          uniform float uRingWidth;
          uniform vec4 uHand;
          uniform float uTime;`,
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_DETAIL_GLSL}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, max(gWet, uWet * 0.6)); roughnessFactor = mix(roughnessFactor, 0.55, gSnow);')
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          {
            float sd = 1e5;
            for (int i = 0; i < ${MAX_INFLUENCE}; i++) {
              if (i >= uInfluenceCount) break;
              sd = min(sd, length(vWorldPos.xz - uInfluence[i].xy) - uInfluence[i].z);
            }
            if (uInfluenceCount > 0) {
              float ring = 1.0 - smoothstep(0.0, uRingWidth, abs(sd));
              float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + vWorldPos.x * 0.05 + vWorldPos.z * 0.05);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.72, 0.22), ring * 0.75 * pulse);
              if (sd > 0.0) gl_FragColor.rgb *= 0.86;
            }
            // The rival god's villages: a violet ring with an ember edge, and a faint violet wash inside.
            if (uRivalCount > 0) {
              float rd = 1e5;
              for (int i = 0; i < ${MAX_RIVAL}; i++) {
                if (i >= uRivalCount) break;
                rd = min(rd, length(vWorldPos.xz - uRival[i].xy) - uRival[i].z);
              }
              float rw = uRingWidth * 1.7;
              float rring = 1.0 - smoothstep(0.0, rw, abs(rd));
              float rpulse = 0.75 + 0.25 * sin(uTime * 1.6 - vWorldPos.x * 0.04 + vWorldPos.z * 0.05);
              float rim = smoothstep(0.1 * rw, 0.7 * rw, abs(rd));
              vec3 rcol = mix(vec3(0.5, 0.16, 1.0), vec3(1.0, 0.42, 0.08), rim);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.3, 0.1, 0.55), (1.0 - smoothstep(-22.0, 0.0, rd)) * step(rd, 0.0) * 0.22);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, rcol, rring * 0.92 * rpulse);
            }
            // Soft hand shadow / cursor spot.
            float hd = length(vWorldPos.xz - uHand.xy);
            float spot = (1.0 - smoothstep(uHand.z * 0.35, uHand.z, hd)) * step(0.001, uHand.z);
            vec3 spotCol = mix(vec3(0.0), vec3(0.55, 0.0, 0.0), uHand.w);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, spotCol, spot * 0.35);
          }`,
        );
    };
  }

  private buildHeightTexture(): THREE.DataTexture {
    const { res } = this;
    const data = new Uint8Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      // Encode [-32, 32] around sea level; only the shallows matter to the water shader.
      const v = clamp((this.heights[i] + 32) / 64, 0, 1) * 255;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private buildHeightHalfTexture(): THREE.DataTexture {
    const { res } = this;
    const data = new Uint16Array(res * res);
    for (let i = 0; i < res * res; i++) data[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
    const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------ queries

  heightAt(x: number, z: number): number {
    const { res, size, cell } = this;
    const fx = (x + size / 2) / cell;
    const fz = (z + size / 2) / cell;
    if (fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1) return OCEAN_FLOOR;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const i = iz * res + ix;
    const a = h[i];
    const b = h[i + 1];
    const c = h[i + res];
    const d = h[i + res + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** Height of whatever you'd stand on: terrain or the water surface. */
  surfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), SEA_LEVEL);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  isLand(x: number, z: number, margin = 0.8): boolean {
    return this.heightAt(x, z) > SEA_LEVEL + margin;
  }

  /** March a ray against the heightfield (and sea surface). */
  raycast(ray: THREE.Ray, out: THREE.Vector3, maxDist = 5000): boolean {
    const o = ray.origin;
    const d = ray.direction;
    let t = 0;
    let prevT = 0;
    const p = new THREE.Vector3();
    while (t < maxDist) {
      p.copy(o).addScaledVector(d, t);
      const ground = this.surfaceAt(p.x, p.z);
      if (p.y <= ground) {
        // Refine between prevT and t.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          p.copy(o).addScaledVector(d, mid);
          if (p.y <= this.surfaceAt(p.x, p.z)) hi = mid;
          else lo = mid;
        }
        out.copy(o).addScaledVector(d, hi);
        out.y = this.surfaceAt(out.x, out.z);
        return true;
      }
      prevT = t;
      const clearance = p.y - ground;
      t += Math.max(0.5, Math.min(clearance * 0.5, 20));
      if (p.y < OCEAN_FLOOR && d.y < 0) break;
    }
    // Fallback: sea plane.
    if (d.y < -1e-4) {
      const s = (SEA_LEVEL - o.y) / d.y;
      out.copy(o).addScaledVector(d, s);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ shader state

  setInfluence(circles: { x: number; z: number; r: number }[]) {
    const n = Math.min(circles.length, MAX_INFLUENCE);
    for (let i = 0; i < n; i++) this.uniforms.uInfluence.value[i].set(circles[i].x, circles[i].z, circles[i].r);
    this.uniforms.uInfluenceCount.value = n;
  }

  setRivalInfluence(circles: { x: number; z: number; r: number }[]) {
    const n = Math.min(circles.length, MAX_RIVAL);
    for (let i = 0; i < n; i++) this.uniforms.uRival.value[i].set(circles[i].x, circles[i].z, circles[i].r);
    this.uniforms.uRivalCount.value = n;
  }

  setHandSpot(x: number, z: number, radius: number, blocked: boolean) {
    this.uniforms.uHand.value.set(x, z, radius, blocked ? 1 : 0);
  }

  /** Seasonal look: grass hue shift (`grassAmt` 0..1 toward `grass`), snow cover 0..1 and rain wetness 0..1. */
  setSeason(grass: THREE.Color, grassAmt: number, snow: number, wet: number) {
    const u = this.uniforms;
    u.uGrassTarget.value.copy(grass);
    u.uGrassAmt.value = grassAmt;
    u.uSnow.value = snow;
    u.uWet.value = wet;
  }

  setFrame(time: number, cameraDistance: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uRingWidth.value = Math.max(0.8, cameraDistance * 0.006);
  }
}

/**
 * Per-biome ground detail, multiplied into the baked vertex colour (see Terrain.buildMesh):
 * painterly two-tone blotches and sun flecks on grass, grain and ripples on sand, strata on rock,
 * soft shading on snow, and a wet darkened strip along the waterline that breathes with the tide.
 */
const GROUND_DETAIL_GLSL = /* glsl */ `
{
  vec2 gp = vWorldPos.xz;
  float tone = grassTone(gp);
  float n2 = gnoise(gp * 0.21 + 17.0);
  float n3 = gnoise(gp * 1.15 + 4.0);
  float n4 = gnoise(gp * 4.7 + 11.0);
  float blot = smoothstep(0.40, 0.60, gnoise(gp * 0.11 + 31.0));
  vec3 gm = mix(vec3(0.88, 1.0, 1.05), vec3(1.10, 1.05, 0.86), smoothstep(0.30, 0.70, tone));
  gm *= 0.90 + 0.22 * blot + 0.12 * (n3 - 0.5);
  gm += vec3(0.035, 0.05, 0.0) * smoothstep(0.72, 0.95, n4);
  vec3 sm = vec3(0.93 + 0.14 * gnoise(gp * 3.1) + 0.08 * (n4 - 0.5)) * (0.97 + 0.06 * sin(gp.x * 0.9 + n2 * 6.0));
  float strata = gnoise(vec2(gp.x * 0.05 + gp.y * 0.03, vWorldPos.y * 0.55));
  vec3 rm = vec3(0.86 + 0.28 * strata + 0.14 * (n3 - 0.5));
  vec3 snm = mix(vec3(0.90, 0.95, 1.04), vec3(1.03, 1.02, 1.0), n2);
  vec4 bw = vBiome / max(vBiome.x + vBiome.y + vBiome.z + vBiome.w, 1e-3);
  vec3 grassPart = diffuseColor.rgb * gm;
  // Season: pull the grass toward the season's colour, keeping its light/dark blotches.
  float gl = dot(grassPart, vec3(0.2126, 0.7152, 0.0722));
  vec3 seasonal = uGrassTarget * (gl / 0.28);
  grassPart = mix(grassPart, seasonal, uGrassAmt);
  diffuseColor.rgb = grassPart * bw.x + diffuseColor.rgb * (sm * bw.y + rm * bw.z + snm * bw.w);

  float tide = 0.55 + 0.25 * sin(uTime * 0.35 + gp.x * 0.02);
  gWet = (1.0 - smoothstep(0.0, tide + n3 * 0.25, vWorldPos.y)) * step(-0.8, vWorldPos.y);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.66, 0.72), gWet);

  // Rain-soaked ground is darker; snow settles on high ground and north-facing slopes.
  diffuseColor.rgb *= 1.0 - 0.22 * uWet * (1.0 - bw.w);
  if (uSnow > 0.001) {
    vec3 wn = normalize(vWNormal);
    float north = clamp(-wn.z, 0.0, 1.0);
    float hi = smoothstep(4.0, 55.0, vWorldPos.y);
    float flatness = smoothstep(0.55, 0.9, wn.y);
    float score = uSnow * (0.6 + 0.32 * hi + 0.14 * north) + (n2 - 0.5) * 0.34 + (n3 - 0.5) * 0.12 - 0.04;
    float cover = smoothstep(0.34, 0.62, score) * flatness;
    cover *= smoothstep(0.9, 2.6, vWorldPos.y); // not on the water line
    cover *= 1.0 - 0.45 * bw.y;                  // beaches keep a little sand showing through
    vec3 snowCol = mix(vec3(0.80, 0.86, 0.96), vec3(0.97, 0.97, 0.98), n3);
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, cover);
    gSnow = cover;
  }
}
`;
