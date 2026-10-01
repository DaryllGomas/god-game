import type { Game, GamePlugin } from '../Game';
import { Grass, type MaskStamp } from '../world/Grass';

const MASK_CHECK = 1.0; // seconds between "did the buildings change?" checks

/**
 * Grass tufts and wildflowers around the camera, swaying in the wind (see world/Grass.ts).
 * The mask that keeps them off villages, houses and fields is repainted whenever buildings change.
 */
export function install(game: Game): GamePlugin {
  const grass = new Grass(game.terrain, game.scene);
  // Tell the post-processing plugin to leave these out of the AO depth/normal pre-pass.
  (game as unknown as { aoIgnore: unknown[] }).aoIgnore = grass.meshes;

  let lastSig = -1;
  let timer = 0;

  const refreshMask = () => {
    const stamps: MaskStamp[] = [];
    let sig = 0;
    for (const v of game.villages) stamps.push({ x: v.center.x, z: v.center.z, r: v.radius * 1.0, core: 0.65 });
    for (const e of game.entities) {
      switch (e.kind) {
        case 'house':
          stamps.push({ x: e.pos.x, z: e.pos.z, r: 6.5, core: 0.6 });
          break;
        case 'store':
          stamps.push({ x: e.pos.x, z: e.pos.z, r: 6.5, core: 0.6 });
          break;
        case 'worship':
          stamps.push({ x: e.pos.x, z: e.pos.z, r: 11, core: 0.65 });
          break;
        case 'field':
          stamps.push({ x: e.pos.x, z: e.pos.z, r: 0, w: 7.5, d: 5.8, rot: -e.object.rotation.y });
          break;
        default:
          continue;
      }
      sig += e.pos.x * 3.1 + e.pos.z * 5.7 + stamps.length;
    }
    if (Math.abs(sig - lastSig) < 1e-6) return;
    lastSig = sig;
    grass.setMask(stamps);
  };
  refreshMask();

  return {
    name: 'grass',
    frame(realDt) {
      timer -= realDt;
      if (timer <= 0) {
        timer = MASK_CHECK;
        refreshMask();
      }
      const cam = game.godCam;
      grass.update(game.realTime, cam.target.x, cam.target.z, cam.distance);
    },
  };
}
