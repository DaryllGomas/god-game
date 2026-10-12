import type { Game, GamePlugin } from '../Game';
import { Pace } from '../pace/Pace';

/**
 * Your pace (src/pace): Ora asks once "Walk on, or stay a while?" and two marks (a road, a hearth) wait
 * for the hand. Walk on: faster time, fewer materials, the ending when earned. Stay: full depth, and you
 * choose when to ascend by touching the light that rises at the temple. Saved with the island.
 * Debug: `game.pace.choose('walk' | 'stay')`, `game.pace.choice`.
 */
export function install(game: Game): GamePlugin {
  const pace = new Pace(game);
  (game as unknown as { pace: Pace }).pace = pace;
  return {
    name: 'pace',
    update: (dt) => pace.update(dt),
    frame: (dt) => pace.frame(dt),
    save: () => pace.save(),
    load: (d) => pace.load(d),
  };
}
