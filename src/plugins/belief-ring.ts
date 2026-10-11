import type * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { BeliefRing } from '../village/BeliefRing';

/**
 * A gold ring around each village that doesn't worship you yet, filling with its belief in you
 * (src/village/BeliefRing.ts). No numbers and no words: the ring and the light on the totem are the
 * whole readout, and a deed that lands makes them pulse.
 */
export function install(game: Game): GamePlugin {
  const rings = game.villages.map((v) => new BeliefRing(game, v));
  // Debug/test handle: `game.beliefRings[i].frame(dt, time)` steps a ring's visuals without rendering.
  (game as unknown as { beliefRings: BeliefRing[] }).beliefRings = rings;
  let aoDone = false;
  return {
    name: 'belief-ring',
    frame(realDt) {
      // The post-processing plugin loads after this one; register with its AO skip list once it exists.
      if (!aoDone) {
        const ao = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
        if (ao) {
          for (const r of rings) ao.push(...r.aoIgnore);
          aoDone = true;
        }
      }
      for (const r of rings) r.frame(realDt, game.realTime);
    },
  };
}
