import type { Game, GamePlugin } from '../Game';
import { Prayers } from '../prayers/Prayers';
import { PrayerBubbles } from '../prayers/PrayerBubbles';
import { Advisors } from '../prayers/Advisors';

/**
 * Prayers & advisors: the purpose layer. Villages ask for things (wood, food, rain, a lost
 * child, help with a fire, a sign) and you answer with your hands. Two advisors, a kind
 * spirit and a cheeky imp, teach the basics and comment on what you do.
 */
export function install(game: Game): GamePlugin {
  const prayers = new Prayers(game);
  const bubbles = new PrayerBubbles(game);
  const advisors = new Advisors(game, () => prayers.active.length > 0);

  prayers.setListener({
    added: (p) => bubbles.added(p),
    fulfilled: (p) => {
      bubbles.fulfilled(p);
      advisors.prayerAnswered(p, prayers.answered);
    },
    gone: (p) => bubbles.gone(p),
  });

  // Debug/test handle, like game.advance().
  (game as unknown as { prayerSystem: unknown }).prayerSystem = Object.assign(prayers, { bubbles, advisors });

  return {
    name: 'prayers',
    update: (dt) => prayers.update(dt),
    save: () => prayers.save(),
    load: (d) => prayers.load(d),
    frame: (dt) => {
      bubbles.frame(dt);
      advisors.frame(dt);
    },
  };
}
