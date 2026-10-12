import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';

/**
 * v0.6 (Fable pass): cloud shadows drifting over the island.
 *
 * The god camera looks down, so the sky dome's clouds are never in frame and the island reads as one still, evenly
 * lit lawn. A diorama feels alive when big soft shadows slide over it (Tiny Glade, Black & White). One invisible
 * plane high over the world carries a tiling cloud mask and casts shadows into the existing sun shadow map; nothing
 * is drawn to the colour buffer (`colorWrite = false`), so trees, houses, villagers and the ground all darken
 * together, consistently, for one draw call. The mask drifts slowly with the wind.
 */
const HEIGHT = 110; // m above sea level; low enough that the shadow stays within the sun's frustum
const SIZE = 3000; // m; wide enough that the flat golden-hour sun still finds cloud over the whole island
const TEX = 256; // mask texels per tile
const TILE_M = 520; // m per tile of the mask (so a cloud is 60 to 200 m across)
const COVERAGE = 0.46; // mask threshold: higher = fewer, smaller clouds
const SPEED = 2.2; // m/s drift (real seconds, not game speed: weather keeps moving while paused)
const DRIFT_DIR = new THREE.Vector2(0.86, 0.5).normalize();

/** Tiling value noise (2D), 0..1. */
function makeMask(seed: number): THREE.DataTexture {
  const lattice = (n: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = (s & 0xffff) / 0xffff;
    }
    return g;
  };
  const sample = (g: Float32Array, n: number, u: number, v: number) => {
    const x = u * n, y = v * n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const octaves = [4, 8, 16, 32].map((n) => ({ n, g: lattice(n) }));
  const data = new Uint8Array(TEX * TEX * 4);
  for (let j = 0; j < TEX; j++) {
    for (let i = 0; i < TEX; i++) {
      const u = i / TEX, v = j / TEX;
      let f = 0, amp = 0.5, tot = 0;
      for (const o of octaves) {
        f += sample(o.g, o.n, u, v) * amp;
        tot += amp;
        amp *= 0.5;
      }
      f /= tot;
      // Soft-edged puffs: everything under the coverage line is clear sky, the rest ramps to solid cloud.
      const k = Math.min(1, Math.max(0, (f - COVERAGE) / 0.1));
      const val = Math.round(k * 255);
      const p = (j * TEX + i) * 4;
      data[p] = data[p + 1] = data[p + 2] = val;
      data[p + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function install(game: Game): GamePlugin {
  const mask = makeMask(1709);
  mask.repeat.set(SIZE / TILE_M, SIZE / TILE_M);
  const mat = new THREE.MeshBasicMaterial({ alphaMap: mask, alphaTest: 0.5, colorWrite: false, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = HEIGHT;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'cloud-shadows';
  game.scene.add(mesh);

  let registered = false;
  const offset = new THREE.Vector2();
  return {
    name: 'cloud-shadows',
    update() {},
    frame(realDt) {
      // The AO pre-pass renders with an override material that ignores alphaTest; this plane would read as a solid
      // ceiling and darken the whole world. Register it with the post-processing plugin's ignore list (merged each
      // frame, so load order doesn't matter). Copy, don't push: another plugin owns that array.
      if (!registered) {
        const g = game as unknown as { aoIgnore?: THREE.Object3D[] };
        g.aoIgnore = [...(g.aoIgnore ?? []), mesh];
        registered = true;
      }
      const dt = Math.min(Math.max(realDt, 0), 0.1);
      offset.addScaledVector(DRIFT_DIR, (dt * SPEED) / TILE_M);
      mask.offset.set(offset.x % 1, offset.y % 1);
    },
  };
}
