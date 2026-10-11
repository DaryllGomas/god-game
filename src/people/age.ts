import { DAY_LENGTH } from '../config';

/**
 * Villager ages. Nobody stores an age for the people who were there on the island's first day: it is
 * made from their seed, like their name. Children born later get their birth time from the people
 * plugin (src/plugins/chronicle.ts), which saves it. Lifespans are long next to a play session, so
 * only the island's eldest pass away (peacefully, in the morning) during a long game.
 */

// ------------------------------------------------------------------ tuning knobs

/** How old the first islanders are on day one (game days). */
export const FIRST_AGES = [0, 24] as const;
/** How long a villager lives (game days; a year is 10). */
export const LIFESPAN = [34, 50] as const;
/** Younger than this, they count as a child (for roles in the legacy record). */
export const CHILD_DAYS = 3;
/** From this share of their lifespan on, they count as an elder. */
export const ELDER_AT = 0.72;

/** A stable number in 0..1 from a seed and a salt (so age and lifespan don't move together). */
function unit(seed: number, salt: number): number {
  let h = Math.imul(seed ^ salt, 0x2c1b3c6d) ^ 0x297a2d39;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Game time a first-day villager was born (before the island's first day, so negative). */
export function firstBornAt(seed: number): number {
  return -(FIRST_AGES[0] + (FIRST_AGES[1] - FIRST_AGES[0]) * unit(seed, 0x51ed)) * DAY_LENGTH;
}

export function lifespanDays(seed: number): number {
  return LIFESPAN[0] + (LIFESPAN[1] - LIFESPAN[0]) * unit(seed, 0x7a11);
}

/** Age in game days at game time `now`. */
export function ageDays(bornAt: number, now: number): number {
  return (now - bornAt) / DAY_LENGTH;
}
