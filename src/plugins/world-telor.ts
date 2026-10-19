import type { Game, GamePlugin } from '../Game';
import { AfterLoop } from '../after/AfterLoop';

/**
 * After the true end (src/after): if you stay on the island in story mode, Telor keeps its seasons (a festival each,
 * asking you for one thing) and keeps growing at its edge while you tend the island, with newcomers by boat. Named to
 * load after world-nexus (it reads the last age's phase and Telor on load). Free play and everything before the true
 * end are untouched.
 *
 * On `game.after`:
 *   debug('festival', season?)   ask this season's festival now (or that season's)
 *   debug('grant')               give what it asked for
 *   debug('celebrate', t?)       start it now (no waiting for dark), or move it to t game seconds in
 *   debug('boat' | 'land')       send a boat of newcomers now / bring it straight in
 *   debug('grow')                start the next step of growth (a lane, a house or a garden)
 *   debug('care', n)             set the care banked (each step of growth spends one)
 *   state()                      the festival, the growth, the families and the boat
 */
export function install(game: Game): GamePlugin {
  const after = new AfterLoop(game);
  (game as unknown as { after: AfterLoop }).after = after;
  return {
    name: 'after',
    update: (dt) => after.update(dt),
    frame: (dt) => after.frame(dt),
    save: () => after.save(),
    load: (d) => after.load(d),
  };
}
