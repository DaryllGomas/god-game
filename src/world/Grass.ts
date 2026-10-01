import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { GROUND_NOISE_GLSL } from './groundNoise';
import { WORLD_SIZE } from '../config';

// Tuning knobs.
const CELL = 2.4; // metres per placement cell
const HALF_CELLS = 30; // ring half-width in cells (radius ~ 72 m)
const TUFTS_PER_CELL = 6;
const FLOWERS_PER_CELL = 3;
const MASK_RES = 512;
const MAX_HEIGHT = 46; // no grass above this (rock and snow take over)
const MAX_SLOPE = 0.34; // rise per metre; steeper ground stays bare
const BEACH_HEIGHT = 1.9; // no grass on the sand
const FAR_VIEW = 240; // hide it all when the camera is this far out (it would be sub-pixel)

/**
 * Seasonal controls, shared by every Grass instance (the seasons plugin writes these each frame):
 * hue shift toward `uGrassTarget`, tuft and flower abundance (0 = none), and wind strength.
 */
export const GRASS_SEASON = {
  uGrassTarget: { value: new THREE.Color(0x7fc74a) },
  uGrassAmt: { value: 0 },
  uGrassScale: { value: 1 },
  uFlower: { value: 1 },
  uWind: { value: 1 },
};

export interface MaskStamp {
  x: number;
  z: number;
  /** Circle radius, or the rectangle's half extents (with `rot`) when `w`/`d` are set. */
  r: number;
  w?: number;
  d?: number;
  rot?: number;
  /** Fully blocked inside `r * core`, fading to open at `r`. */
  core?: number;
}

/**
 * Instanced grass tufts and wildflowers in a ring around the camera target. Everything (placement,
 * wind, fade) happens in the vertex shader from gl_InstanceID: placement is hashed per world cell,
 * so tufts never swim as the camera moves. A mask texture keeps them off villages and fields.
 */
export class Grass {
  readonly meshes: THREE.Mesh[] = [];
  private readonly mask: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly cellCount = (HALF_CELLS * 2) ** 2;

  constructor(terrain: Terrain, scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = MASK_RES;
    this.mask = new THREE.CanvasTexture(this.canvas);
    this.mask.flipY = false;
    this.mask.generateMipmaps = false;
    this.mask.minFilter = this.mask.magFilter = THREE.LinearFilter;
    this.mask.colorSpace = THREE.NoColorSpace;
    this.setMask([]);

    this.uniforms = {
      uTime: { value: 0 },
      uCell: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uHeight: { value: terrain.heightHalfTexture },
      uMask: { value: this.mask },
      uWorld: { value: WORLD_SIZE },
      uRes: { value: terrain.res },
      uBoost: { value: 1 },
      uRadius: { value: HALF_CELLS * CELL },
      ...GRASS_SEASON,
    };

    this.meshes.push(this.makeMesh(tuftGeometry(), TUFTS_PER_CELL, false), this.makeMesh(flowerGeometry(), FLOWERS_PER_CELL, true));
    for (const m of this.meshes) scene.add(m);
  }

  private makeMesh(geo: THREE.BufferGeometry, perCell: number, flowers: boolean): THREE.Mesh {
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    ig.attributes = geo.attributes;
    ig.instanceCount = this.cellCount * perCell;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.defines = { PER_CELL: perCell, HALF_CELLS, CELL: CELL.toFixed(3), FLOWERS: flowers ? 1 : 0 };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec2 uCell;
          uniform vec2 uCenter;
          uniform sampler2D uHeight;
          uniform sampler2D uMask;
          uniform float uWorld;
          uniform float uRes;
          uniform float uBoost;
          uniform float uRadius;
          uniform vec3 uGrassTarget;
          uniform float uGrassAmt;
          uniform float uGrassScale;
          uniform float uFlower;
          uniform float uWind;
          ${GROUND_NOISE_GLSL}
          vec2 hash22(vec2 p) {
            vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
            q += dot(q, q.yzx + 33.33);
            return fract((q.xx + q.yz) * q.zy);
          }
          float groundY(vec2 xz) {
            vec2 t = (xz / uWorld + 0.5) * (uRes - 1.0) / uRes + 0.5 / uRes;
            return texture2D(uHeight, t).r;
          }`,
        )
        // Surface normal straight up: tufts shade like the soil under them, so they blend in.
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          int id = gl_InstanceID;
          int cellI = id / PER_CELL;
          int k = id - cellI * PER_CELL;
          int cx = cellI % (HALF_CELLS * 2);
          int cz = cellI / (HALF_CELLS * 2);
          vec2 wc = vec2(float(cx - HALF_CELLS), float(cz - HALF_CELLS)) + uCell;
          vec2 r1 = hash22(wc * 1.37 + float(k) * 17.0 + (FLOWERS == 1 ? 311.0 : 0.0));
          vec2 r2 = hash22(wc * 2.11 + float(k) * 5.0 + 91.0);
          vec2 xz = (wc + r1) * float(CELL);
          float gy = groundY(xz);
          float gyx = groundY(xz + vec2(1.5, 0.0));
          float gyz = groundY(xz + vec2(0.0, 1.5));
          float slope = length(vec2(gyx - gy, gyz - gy)) / 1.5;
          float open = texture2D(uMask, xz / uWorld + 0.5).r;
          float d = length(xz - uCenter);
          float tone = grassTone(xz);
          // Keep/discard per tuft: ground type, mask, ring falloff (thinning outward, then gone).
          float keep = step(${BEACH_HEIGHT.toFixed(2)}, gy) * step(gy, ${MAX_HEIGHT.toFixed(1)}) * step(slope, ${MAX_SLOPE.toFixed(2)});
          keep *= step(r2.x, open * open);
          keep *= step(r2.y * 0.85, 1.0 - smoothstep(uRadius * 0.3, uRadius, d));
          #if FLOWERS == 1
            // Meadows: flowers only where a slow noise says so, in drifts.
            float msh = (uFlower - 1.0) * 0.08;
            float meadow = smoothstep(0.5 - msh, 0.64 - msh, gnoise(xz * 0.035 + 5.0));
            keep *= step(r1.x, meadow * 0.9);
          #endif
          float sc = keep * (0.8 + 0.5 * r2.x) * uBoost;
          #if FLOWERS == 1
            sc *= clamp(uFlower * 2.0, 0.0, 1.0) * (0.9 + 0.1 * min(uFlower, 2.0));
          #else
            sc *= uGrassScale;
          #endif
          sc *= 1.0 - smoothstep(uRadius * 0.82, uRadius, d);
          // Tint by the meadow tone so tufts match the ground beneath them.
          vec3 warm = vec3(1.08, 1.05, 0.72);
          vec3 cool = vec3(0.78, 1.0, 0.95);
          vec3 tint = mix(cool, warm, smoothstep(0.3, 0.7, tone));
          #if FLOWERS == 0
            vColor.rgb *= tint * (0.85 + 0.3 * r2.x);
            // Season: shift the blade colour toward the season's, keeping root-to-tip shading.
            float bl = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            vColor.rgb = mix(vColor.rgb, uGrassTarget * (bl / 0.26), uGrassAmt);
          #else
            float pick = r2.x * 4.0;
            vec3 petal = pick < 1.0 ? vec3(1.0, 0.95, 0.92) : pick < 2.0 ? vec3(1.0, 0.72, 0.8) : pick < 3.0 ? vec3(1.0, 0.85, 0.3) : vec3(0.72, 0.62, 1.0);
            // Geometry colours: green stem, white petals, gold centre.
            float isPetal = step(0.95, vColor.r) * step(0.95, vColor.b);
            float isCenter = step(vColor.g + 0.1, vColor.r) * (1.0 - isPetal);
            vec3 c = vColor.rgb * tint;
            c = mix(c, petal, isPetal);
            vColor.rgb = mix(c, vec3(0.95, 0.7, 0.15), isCenter);
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `
          float ang = r2.y * 6.2831853;
          float ca = cos(ang);
          float sa = sin(ang);
          vec3 local = position;
          #if FLOWERS == 1
            local *= 1.7;
          #endif
          vec3 rotated = vec3(local.x * ca - local.z * sa, local.y, local.x * sa + local.z * ca);
          // Wind: slow travelling sway plus a smaller flutter; blade tips move most.
          float sway = sin(uTime * 1.5 + xz.x * 0.21 + xz.y * 0.17) * 0.5 + sin(uTime * 2.7 + xz.x * 0.9 + xz.y * 0.6) * 0.18;
          float bend = clamp(position.y, 0.0, 1.0);
          bend *= bend;
          #if FLOWERS == 1
            bend *= 0.5;
          #endif
          rotated.x += sway * 0.22 * bend * uWind;
          rotated.z += sway * 0.12 * bend * uWind;
          vec3 transformed = vec3(xz.x, gy - 0.05, xz.y) + rotated * sc;
          `,
        );
      // Normals are fixed up-vectors, so don't flip them for back faces.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`,
      );
    };
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = flowers ? 'flowers' : 'grass';
    mesh.renderOrder = 0;
    return mesh;
  }

  /** Paint the "no grass here" mask: white = open ground, black = village, field, building. */
  setMask(stamps: MaskStamp[]) {
    const ctx = this.canvas.getContext('2d')!;
    const k = MASK_RES / WORLD_SIZE;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, MASK_RES, MASK_RES);
    for (const s of stamps) {
      const cx = (s.x + WORLD_SIZE / 2) * k;
      const cy = (s.z + WORLD_SIZE / 2) * k;
      ctx.save();
      ctx.translate(cx, cy);
      if (s.w !== undefined && s.d !== undefined) {
        // Rotated rectangle with a soft edge (a field).
        ctx.rotate(s.rot ?? 0);
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#000';
        ctx.fillRect(-s.w * k, -s.d * k, s.w * 2 * k, s.d * 2 * k);
      } else {
        const r = s.r * k;
        const g = ctx.createRadialGradient(0, 0, r * (s.core ?? 0.55), 0, 0, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    this.mask.needsUpdate = true;
  }

  /** Per-frame: follow the camera target, drive the wind, and fade out when zoomed far away. */
  update(time: number, centerX: number, centerZ: number, cameraDistance: number) {
    const u = this.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector2).set(centerX, centerZ);
    (u.uCell.value as THREE.Vector2).set(Math.floor(centerX / CELL), Math.floor(centerZ / CELL));
    u.uBoost.value = THREE.MathUtils.clamp(cameraDistance / 75, 1, 2.0);
    const show = cameraDistance < FAR_VIEW;
    for (const m of this.meshes) m.visible = show;
  }
}

// ------------------------------------------------------------------ geometry

/** Linear-RGB blade colour from root (br 0.5) to tip (br 1): deep green to sunlit yellow-green. */
const bladeColour = (br: number): [number, number, number] => {
  const t = (br - 0.5) * 2;
  return [0.07 + 0.2 * t, 0.2 + 0.32 * t, 0.04 + 0.07 * t];
};

/** A tuft: a fan of tapered blades, y in [0,1] along each blade. Vertex colour darkens toward the root. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.18 + (b % 3) * 0.08;
    const h = 0.8 + (b % 2) * 0.35 - (b === 4 ? 0.25 : 0);
    const w = 0.1;
    const ox = Math.cos(a) * 0.1;
    const oz = Math.sin(a) * 0.1;
    // Blade direction (tangent across the width) and lean direction (outward).
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const rows: [number, number, number][] = [
      [0, w, 0.5], // y fraction, half width, brightness
      [0.55, w * 0.7, 0.8],
      [1, 0.0, 1.0],
    ];
    const base = pos.length / 3;
    for (const [f, hw, br] of rows) {
      const bend = f * f; // curve outward toward the tip
      const cx = ox + lx * bend;
      const cz = oz + lz * bend;
      const y = f * h;
      if (hw > 0) {
        pos.push(cx - tx * hw, y, cz - tz * hw, cx + tx * hw, y, cz + tz * hw);
        col.push(...bladeColour(br), ...bladeColour(br));
      } else {
        pos.push(cx, y, cz);
        col.push(...bladeColour(br));
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  return buildGeo(pos, col, idx);
}

/** A little six-petal flower on a short stem: green stem, white petals (tinted per flower), gold centre. */
function flowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const stemH = 0.4;
  // Stem: a thin two-triangle blade.
  pos.push(-0.015, 0, 0, 0.015, 0, 0, -0.012, stemH, 0, 0.012, stemH, 0);
  for (let i = 0; i < 4; i++) col.push(0.3, 0.6, 0.25);
  idx.push(0, 1, 2, 1, 3, 2);
  // Petals: a tilted fan of triangles around the top.
  const petals = 6;
  const centre = pos.length / 3;
  pos.push(0, stemH + 0.03, 0);
  col.push(0.9, 0.7, 0.1);
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2;
    const a1 = ((i + 0.5) / petals) * Math.PI * 2;
    const a2 = ((i + 1) / petals) * Math.PI * 2;
    const r = 0.17;
    const base = pos.length / 3;
    pos.push(Math.cos(a0) * r * 0.5, stemH + 0.02, Math.sin(a0) * r * 0.5);
    pos.push(Math.cos(a1) * r, stemH + 0.07, Math.sin(a1) * r);
    pos.push(Math.cos(a2) * r * 0.5, stemH + 0.02, Math.sin(a2) * r * 0.5);
    for (let j = 0; j < 3; j++) col.push(1, 1, 1);
    idx.push(base, base + 1, base + 2);
  }
  idx.push(centre, centre, centre); // degenerate: keeps the centre vertex valid but unused
  // A small gold centre cap.
  const cb = pos.length / 3;
  const cr = 0.05;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pos.push(Math.cos(a) * cr, stemH + 0.07, Math.sin(a) * cr);
    col.push(0.95, 0.7, 0.15);
  }
  pos.push(0, stemH + 0.1, 0);
  col.push(0.95, 0.7, 0.15);
  for (let i = 0; i < 4; i++) idx.push(cb + i, cb + ((i + 1) % 4), cb + 4);
  return buildGeo(pos, col, idx);
}

function buildGeo(pos: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
