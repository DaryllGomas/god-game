import type { Game, GamePlugin } from '../Game';
import { Shrines } from '../shrines/Shrines';

/**
 * The shrine track (see src/shrines): each village's prayer place grows from a totem to a stone circle,
 * a pyramid and a temple, raised by its projects (Well, then the pyramid and the temple, built at the
 * prayer place). At the stone circle and after, answered prayers now and then send a soft streak of
 * light across the village's sky: the visitor their murals remember.
 *
 * On `game.shrines` (debug and the endings):
 *   setStage(village | index | name, 'pyramid', animate?)   put a prayer place at an age now
 *   streak(village | index | name)                          send the visitor across its sky
 *   allTemplesStand()                                       the island's end goal (also game.allTemplesStand())
 *   state()                                                 every village's stage and the stages it reached
 * Event: `shrineRaised` { village, stage }.
 */
export function install(game: Game): GamePlugin {
  const shrines = new Shrines(game);
  (game as unknown as { shrines: Shrines }).shrines = shrines;
  return {
    name: 'shrines',
    update: (dt) => shrines.update(dt),
    frame: (dt) => shrines.frame(dt),
    save: () => shrines.save(),
    load: (d) => shrines.load(d),
  };
}
