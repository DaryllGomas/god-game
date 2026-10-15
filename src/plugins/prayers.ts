import type { Game, GamePlugin } from '../Game';
import { Prayers } from '../prayers/Prayers';
import { PrayerBubbles } from '../prayers/PrayerBubbles';
import { Advisors } from '../prayers/Advisors';
import type { Prayer, PrayerKind } from '../prayers/Prayers';

/**
 * Story mode only: the first time each kind of prayer appears on an island, Ora says plainly how to answer it
 * (Daryll, 2026-10-14: "how the hell do I make them learn to believe?", and the lost child: "okay, now what?").
 * One line per kind, then the player knows; free play stays quiet.
 */
const HOW: Record<Exclude<PrayerKind, 'project'>, (p: Prayer) => string> = {
  timber: (p) => `${p.village.name} is asking for timber. Lift a tree and set it down on their storehouse.`,
  food: (p) => `${p.village.name} is hungry. Let Food fall on their storehouse, or carry fruit and fish to it.`,
  rain: (p) => `${p.village.name}'s fields are thirsty. Let Water fall over them.`,
  fire: (p) => `Fire in ${p.village.name}. Water, over the flames, quickly.`,
  sign: (p) => `${p.village.name} asks for a sign. Let Water or Food fall where they can see it. Every answer, they believe a little more.`,
  lost: (p) => `${p.villager?.name ?? 'A child'} wandered away from ${p.village.name}. Lift them gently, and set them down at home.`,
};

/**
 * Prayers & advisors: the purpose layer. Villages ask for things (wood, food, rain, a lost
 * child, help with a fire, a sign) and you answer with your hands. Two advisors, a kind
 * spirit and a cheeky imp, react to what you do (they never explain the controls).
 */
export function install(game: Game): GamePlugin {
  const prayers = new Prayers(game);
  const bubbles = new PrayerBubbles(game);
  const advisors = new Advisors(game);

  const story = () => (game as unknown as { story?: { active: boolean } }).story;
  const ora = () => (game as unknown as { ora?: { guide(t: string): void } }).ora;
  const told = new Set<PrayerKind>();
  let lostHeld: Prayer | null = null;
  const explain = (p: Prayer) => {
    if (p.kind === 'project' || told.has(p.kind) || !story()?.active) return;
    // Before the first answer, home's prayers are the story's own first goal: Ora's lead names one (howFor), so
    // it isn't said twice.
    if (prayers.answered === 0 && p.village.isHome) return;
    told.add(p.kind);
    ora()?.guide(HOW[p.kind](p));
  };
  /** How to answer `p`, in Ora's words (story mode's first goal); `mark`: that kind counts as explained from now on. */
  const howFor = (p: Prayer, mark = true): string => {
    if (p.kind === 'project') return '';
    if (mark) told.add(p.kind);
    return HOW[p.kind](p);
  };

  prayers.setListener({
    added: (p) => {
      bubbles.added(p);
      explain(p);
    },
    fulfilled: (p) => {
      bubbles.fulfilled(p);
      advisors.prayerAnswered(p, prayers.answered);
    },
    gone: (p) => bubbles.gone(p),
  });

  // Debug/test handle, like game.advance().
  (game as unknown as { prayerSystem: unknown }).prayerSystem = Object.assign(prayers, { bubbles, advisors, howFor });

  return {
    name: 'prayers',
    update: (dt) => prayers.update(dt),
    save: () => prayers.save(),
    load: (d) => prayers.load(d),
    frame: (dt) => {
      bubbles.frame(dt);
      advisors.frame(dt);
      // The first time you pick up a lost child, Ora points them home.
      const lost = prayers.active.find((p) => p.kind === 'lost' && p.villager?.held);
      if (lost && lost !== lostHeld && story()?.active) {
        lostHeld = lost;
        if (!told.has('lost-home' as PrayerKind)) {
          told.add('lost-home' as PrayerKind);
          ora()?.guide(`Home is ${lost.village.name}. Set them down among their people.`);
        }
      }
    },
  };
}
