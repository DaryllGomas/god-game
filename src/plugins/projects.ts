import type { Game, GamePlugin } from '../Game';
import type { Prayers } from '../prayers/Prayers';
import type { Advisors } from '../prayers/Advisors';
import { Projects } from '../projects/Projects';
import { ProjectUI } from '../projects/ProjectUI';

/**
 * Village projects and the Wonder: the session-length goal. Each village dreams of a well, a
 * temple and a harvest festival (announced as prayers); builders carry timber and food, and
 * you supply stone by dropping boulders on the site. Win all three villages and the whole
 * island raises the Wonder, which ends the game. Needs the prayers plugin (loads before this one).
 */
export function install(game: Game): GamePlugin | void {
  const ps = (game as unknown as { prayerSystem?: Prayers & { advisors: Advisors } }).prayerSystem;
  if (!ps) {
    console.warn('projects: the prayers plugin is not installed; projects are disabled');
    return;
  }
  const sys = new Projects(game, ps, ps.advisors);
  const ui = new ProjectUI(game, sys);

  // Debug/test handle, like game.advance().
  (game as unknown as { projectSystem: unknown }).projectSystem = Object.assign(sys, { ui });

  let t = 0;
  return {
    name: 'projects',
    update: (dt) => sys.update(dt),
    save: () => sys.save(),
    load: (d) => sys.load(d),
    frame: (dt) => {
      t += dt;
      sys.frame(t);
      ui.frame(dt);
    },
  };
}
