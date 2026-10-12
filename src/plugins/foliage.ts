import type { Game, GamePlugin } from '../Game';
import { FOLIAGE_WIND } from '../art/softCanopy';

/** OPUS pass: advances the wind clock the foliage shader sways the tree crowns with (see entities/Forest.ts). */
export function install(game: Game): GamePlugin {
  return {
    name: 'foliage',
    frame(realDt) {
      // Wind keeps blowing while paused (it's the world breathing, not the simulation);.
      const t = FOLIAGE_WIND.uWindT.value + Math.min(realDt, 0.1) * (game.paused ? 0.6 : 1);
      FOLIAGE_WIND.uWindT.value = t > 1e5 ? 0 : t;
    },
  };
}
