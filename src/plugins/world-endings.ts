import type { Game, GamePlugin } from '../Game';
import { Endings } from '../endings/Endings';

/**
 * The two endings (see src/endings): Collapse, the self-destructive loop (the world begins again,
 * remembering), and Whole into Ready to See, the good ending that writes the Legacy record for the RPG.
 *
 * Named to load last (after world-balance): its frame runs after the hand, the rival's isle and the
 * balance look, so a sequence can pose the hand, hold the spire and light the city on top of them.
 *
 * On `game.endings`:
 *   debug('collapse' | 'whole' | 'ready')   play an ending now
 *   state()                                 phase, timers and thresholds, worlds fallen, ruins
 *   legacy                                  the Legacy record once written (also `save.legacy`)
 */
export function install(game: Game): GamePlugin {
  const endings = new Endings(game);
  (game as unknown as { endings: Endings }).endings = endings;
  return {
    name: 'endings',
    update: (dt) => endings.update(dt),
    frame: (dt) => endings.frame(dt),
    save: () => endings.save(),
    load: (d) => endings.load(d),
  };
}
