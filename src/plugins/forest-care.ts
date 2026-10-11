import type { Game, GamePlugin } from '../Game';
import { ForestCare } from '../forest/ForestCare';

/**
 * Forests that can be kept (v0.5 tuning, see src/forest/ForestCare.ts): clearings heal from the trees
 * around them, villagers replant while the world is in tune, and rain on open land grows a grove.
 * `game.forestCare.stats` counts saplings by cause, for tests.
 */
export function install(game: Game): GamePlugin {
  const care = new ForestCare(game);
  (game as unknown as { forestCare: ForestCare }).forestCare = care;
  return {
    name: 'forest-care',
    update: (dt) => care.update(dt),
  };
}
