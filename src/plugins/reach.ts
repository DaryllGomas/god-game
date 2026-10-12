import type * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { Reach } from '../reach/Reach';

/**
 * Influence you can see (src/reach): shrine stages and houses send golden waves out to the ring of
 * influence, and a path of light grows toward each neighbour village as its belief fills.
 * Debug: `game.reach.push(village, 'shrine' | 'house')`.
 */
export function install(game: Game): GamePlugin {
  const reach = new Reach(game);
  (game as unknown as { reach: Reach }).reach = reach;
  const seen = new Set<THREE.Object3D>();
  return {
    name: 'reach',
    frame(dt) {
      reach.frame(dt, game.realTime);
      const ao = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
      if (ao) for (const o of reach.aoIgnore) if (!seen.has(o)) (seen.add(o), ao.push(o));
    },
  };
}
