import type { ChronicleEntry } from './Chronicle';
import type { ShrineStage } from '../shrines/stages';

/**
 * One-line stories from a villager's chronicle entries, for the legacy record (the RPG shows the
 * people you saved as elders in the City) and anything else that wants to remember them:
 * "Pip, who wandered into the woods as a child and was carried home by the hand".
 * Plain, warm words; no pronouns that assume who they were.
 */

const AGE_WORDS: Record<ShrineStage, string> = {
  totem: 'the totem',
  stone_circle: 'the standing stones',
  pyramid: 'the pyramid',
  temple: 'the temple',
};

const DEATHS = new Set(['killed', 'eaten_by_golem', 'died_old', 'died']);

/** How much each kind of moment is worth remembering (also what the chronicle keeps when it is full). */
export const KIND_WEIGHT: Record<string, number> = {
  shrine_raised: 10,
  worst_act: 10,
  village_joined: 8,
  village_turned: 7,
  lost_child_home: 7,
  saved_from_fire: 6,
  killed: 6,
  eaten_by_golem: 6,
  fed_in_famine: 4.5,
  scheme_foiled: 4,
  died_old: 4,
  thrown: 3,
  carried_by_hand: 2.5,
  died: 2,
  born: 1,
};

export const weightOf = (kind: string) => KIND_WEIGHT[kind] ?? 2;

/** The age a village was in at time t, from its shrine_raised entries. */
export type EraLookup = (village: string | undefined, t: number) => ShrineStage;

function clause(e: ChronicleEntry, era: EraLookup): string {
  const where = e.village ?? 'the village';
  switch (e.kind) {
    case 'born':
      return `was born in ${where} in the age of ${AGE_WORDS[era(e.village, e.t)]}`;
    case 'lost_child_home':
      return 'wandered into the woods as a child and was carried home by the hand';
    case 'saved_from_fire':
      return e.note === 'home'
        ? 'saw the hand save their home from the flames'
        : e.note === 'water'
          ? 'was carried, burning, to the water by the hand'
          : 'was saved from the flames by rain from a clear sky';
    case 'fed_in_famine':
      return 'was fed by the hand when the stores ran empty';
    case 'carried_by_hand':
      return e.note ? `was carried by the hand to a new home in ${e.note}` : 'was lifted up and carried across the island by the hand';
    case 'thrown':
      return 'was hurled through the sky by the hand, and lived';
    case 'killed':
      return e.note === 'thrown'
        ? 'was thrown by the hand and never rose again'
        : e.note === 'crushed'
          ? 'was crushed by a stone the hand let fall'
          : e.note === 'burned'
            ? "burned in the hand's fire"
            : 'was struck down by the hand';
    case 'eaten_by_golem':
      return 'was eaten by the golem';
    case 'died_old':
      return 'passed away, old and well loved';
    case 'died':
      return e.note === 'starved'
        ? 'starved in a lean season'
        : e.note === 'burned'
          ? 'was lost to a fire'
          : e.note === 'crushed'
            ? 'was lost under falling stone'
            : e.note === 'thrown'
              ? 'fell, and did not get up'
              : 'was lost';
    default:
      return e.note ? `was there when ${e.note}` : 'was there';
  }
}

/**
 * A villager's story: their two most memorable moments in the order they happened, and how they died
 * if they did. Thrown-then-killed reads as one moment.
 */
export function storyOf(name: string, entries: readonly ChronicleEntry[], era: EraLookup): string {
  const killedByThrow = entries.some((e) => e.kind === 'killed' && e.note === 'thrown');
  const life = entries.filter((e) => !DEATHS.has(e.kind) && !(killedByThrow && e.kind === 'thrown'));
  const death = entries.find((e) => DEATHS.has(e.kind)) ?? null;
  // The richest moments first (a birth only when there is nothing else), then back into time order.
  const moments = life.filter((e) => e.kind !== 'born');
  const picks = (moments.length ? moments : life)
    .slice()
    .sort((a, b) => weightOf(b.kind) - weightOf(a.kind) || a.t - b.t)
    .slice(0, death ? 1 + (moments.length > 1 && weightOf(death.kind) < 5 ? 1 : 0) : 2)
    .sort((a, b) => a.t - b.t);
  if (death) picks.push(death);
  if (!picks.length) return `${name}, who lived on the island`;
  const parts = picks.map((e) => clause(e, era));
  const n = parts.length;
  let s = parts[0];
  if (n > 1) {
    const later = picks[n - 1].t - picks[n - 2].t > 300;
    const comma = n > 2 || later || parts.some((p) => p.includes(' and '));
    s = `${parts.slice(0, -1).join(', ')}${comma ? ',' : ''} and ${later ? 'later ' : ''}${parts[n - 1]}`;
  }
  return `${name}, who ${s}`;
}
