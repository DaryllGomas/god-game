import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { WORLD_SEED } from '../config';
import { getLink } from '../cloud/Cloud';
import { chroniclePeople, stagesReached } from './lane3a';

/**
 * The Legacy record, AGREED v1 (`THE FIRST WORLD/HANDOFF TO THE RPG.md`): written once, at Ready to See,
 * into the save as `save.legacy` (so it syncs to Pulse with the cloud save). The RPG reads it to add
 * personal touches to the one City. Collapse never writes one.
 */
export interface Legacy {
  kind: 'atlas.first-world.legacy';
  v: 1;
  completedAt: string;
  world: { godName: string | null; islandName: string | null; peopleName: string | null; seed: number };
  villages: { name: string; joined: boolean; stagesReached: string[] }[];
  balance: { final: number; lowest: number };
  alignment: number;
  golem: {
    name: string | null;
    alignment: number;
    size: number;
    look: 'good' | 'neutral' | 'evil';
    habits: { eatsFoodPiles: number; eatsCrops: number; eatsVillagers: number; eatsRocks: number; throwsRocks: number };
  };
  people: { name: string; village: string | null; role: string; story: string }[];
  marks: { worstAct: string | null; bestAct: string | null };
  vexahl: { outcome: 'reintegrated' };
}

/** How many remembered people the record carries. */
const PEOPLE = 6;
/** The golem's look: past this much of its own alignment it reads as good (or, negated, evil). */
const LOOK_AT = 0.3;
/** A deed this bad (Balance's deed points) or worse is worth a memorial; milder ones leave none. */
const WORST_AT = -2.5;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The worst deed as one plain line, the way a memorial would put it (Balance's `worst`). */
export function describeWorst(game: Game, worst: { x: number; z: number; what: string; points: number } | null): string | null {
  if (!worst || worst.points > WORST_AT) return null;
  const near = nearestVillage(game, worst.x, worst.z)?.name ?? 'the island';
  const w = worst.what;
  if (w.startsWith('killed')) return `A villager of ${near} died by your hand.`;
  if (w === 'eaten') return `Your golem ate a villager of ${near}.`;
  if (w === 'starved') return `A villager of ${near} starved.`;
  if (w === 'home destroyed') return `You destroyed a home in ${near}.`;
  if (w === 'home lost') return `A home in ${near} was lost.`;
  if (w === 'fire') return `You set fire to the land near ${near}.`;
  if (w === 'thrown') return `You hurled a villager of ${near}.`;
  if (w === 'lost') return `${near} lost its faith in you.`;
  if (w === 'turned') return `${near} turned to Vexahl.`;
  const unanswered = /^unanswered (\w+)/.exec(w);
  if (unanswered) {
    const ask = { food: 'food', rain: 'rain', fire: 'help with a fire', lost: 'a lost child' }[unanswered[1]] ?? unanswered[1];
    return `${near} prayed for ${ask}, and no one answered.`;
  }
  return `${w} (near ${near}).`;
}

export function nearestVillage(game: Game, x: number, z: number): Village | null {
  let best: Village | null = null;
  let bd = Infinity;
  for (const v of game.villages) {
    const d = Math.hypot(v.center.x - x, v.center.z - z);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Build the record from the world as it stands. `lowest` is the lowest balance this island ever reached. */
export function buildLegacy(game: Game, lowest: number, bestAct: string | null): Legacy {
  const bal = (game as unknown as { balance?: { value: number; worst: { x: number; z: number; what: string; points: number } | null } }).balance;
  const golem = game.creature;
  const o = golem.opinions;
  const a = golem.alignment;
  const final = bal?.value ?? 0.75;
  return {
    kind: 'atlas.first-world.legacy',
    v: 1,
    completedAt: new Date().toISOString(),
    world: { godName: getLink()?.name ?? null, islandName: null, peopleName: null, seed: WORLD_SEED },
    villages: game.villages.map((v) => ({ name: v.name, joined: v.owner === 'player', stagesReached: stagesReached(game, v) })),
    balance: { final: r3(final), lowest: r3(Math.min(lowest, final)) },
    alignment: r3(game.player.alignment),
    golem: {
      name: null,
      alignment: r3(a),
      size: Math.round(golem.size * 100) / 100,
      look: a >= LOOK_AT ? 'good' : a <= -LOOK_AT ? 'evil' : 'neutral',
      habits: {
        eatsFoodPiles: r3(o['eat:food']),
        eatsCrops: r3(o['eat:crops']),
        eatsVillagers: r3(o['eat:villager']),
        eatsRocks: r3(o['eat:rock']),
        throwsRocks: r3(o['throw:rock']),
      },
    },
    people: chroniclePeople(game, PEOPLE).map((p) => ({
      name: String(p.name),
      village: typeof p.village === 'string' ? p.village : (p.village?.name ?? null),
      role: String(p.role ?? ''),
      story: String(p.story ?? ''),
    })),
    marks: { worstAct: describeWorst(game, bal?.worst ?? null), bestAct },
    vexahl: { outcome: 'reintegrated' },
  };
}

/** The fallback hand-off: the record as a .json file the RPG can import. */
export function downloadLegacy(legacy: Legacy) {
  const blob = new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `the-first-world-legacy-${legacy.completedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
