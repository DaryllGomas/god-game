import type { Game, GamePlugin } from '../Game';
import { Seasons } from '../seasons/Seasons';

/**
 * Seasons and nature events (see src/seasons): a year of four seasons that blend smoothly, each with
 * one gentle, telegraphed event (spring bloom, summer dry spell, autumn storm, winter cold snap).
 *
 * Debug hooks on `game.seasons`:
 *   jumpTo('spring' | 'summer' | 'autumn' | 'winter')
 *   trigger('storm' | 'dry' | 'coldsnap' | 'bloom', { warn?: seconds })
 *   stop(), state()
 */
export function install(game: Game): GamePlugin {
  const seasons = new Seasons(game);
  (game as unknown as { seasons: Seasons }).seasons = seasons;
  return {
    name: 'seasons',
    update: (dt) => seasons.update(dt),
    save: () => seasons.save(),
    load: (d) => seasons.load(d),
    frame: (dt) => seasons.frame(dt),
  };
}
