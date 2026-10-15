/** Project definitions and tuning knobs for village projects and the Wonder. */

export type ProjectId = 'well' | 'temple' | 'festival' | 'wonder';
export type Res = 'wood' | 'stone' | 'food';
export type Needs = Record<Res, number>;

export interface ProjectDef {
  id: ProjectId;
  name: string;
  icon: string;
  /** Prayer bubble texts (one is picked). */
  prayer: string[];
  thanks: string;
  /** What finishing it does, in plain words (shown in the panel and tooltip). */
  effect: string;
  needs: Needs;
  /** Footprint radius in metres: boulders dropped inside it count, and it is the picking radius. */
  radius: number;
  /** Rough height of the finished building (for labels and sparkles). */
  height: number;
}

// ------------------------------------------------------------- tuning knobs

/**
 * The chain every village works through, one project at a time. The ids are kept from v0.4 (saves use
 * them), but each now raises an age of the prayer place (see src/shrines/stages.ts): the Well also
 * raises the stone circle, 'temple' is the pyramid and 'festival' is the temple.
 */
export const CHAIN: ProjectId[] = ['well', 'temple', 'festival'];

/** Game seconds before the first project is announced: home village / the other villages. */
export const FIRST_PROJECT_HOME = [100, 140] as const;
export const FIRST_PROJECT_OTHER = [170, 250] as const;
/** Quiet gap after one project is finished before the next dream is announced. */
export const NEXT_PROJECT_GAP = [60, 100] as const;

/** Wood and food a builder carries per trip. */
export const CARRY = 10;
/** Stock a store keeps back so builders never starve the village or stop house-building. */
export const RESERVE: Record<Res, number> = { wood: 8, food: 30, stone: 0 };
/** Builders per village on a village project, and on the Wonder. */
export const BUILDERS = 2;
export const WONDER_BUILDERS = 3;

/** Stone from one boulder: radius squared times this (min 4). A typical boulder is ~15. */
export const STONE_PER_ROCK_AREA = 5;
/** Wood in a thrown tree is its own wood; food/wood piles count in full. */
/**
 * A village of yours quarries a trickle of stone itself (per second) so it never stalls for good, but only once a
 * dream has waited QUARRY_PATIENCE game seconds for your stone: the stones are something you raise with them
 * (2026-10-14; before, Ashford raised its own at about 3 minutes whatever you did). A village that isn't yours
 * never quarries: it rises past the totem only with your hand. (The name is kept from v0.4.)
 */
export const NEUTRAL_QUARRY = 0.12;
export const QUARRY_PATIENCE = 150;
/** A neighbour your light has just reached waits at least this long before it announces a dream (game seconds). */
export const FIRST_DREAM_AFTER_REACH = [60, 90] as const;

/** Well: field growth multiplier, and extra fuel burned per second by fires inside the village (1 = twice as fast). */
export const WELL_CROP_BOOST = 1.6;
export const WELL_FIRE_EXTRA = 1.2;
/** Temple: prayer power multiplier, and how much of the faith loss from hunger it absorbs / extra faith recovery per second. */
export const TEMPLE_POWER = 1.5;
export const TEMPLE_FAITH_SHIELD = 0.6;
export const TEMPLE_FAITH_REGEN = 0.2;
/** Harvest festival: how long the dance lasts (game seconds), and the boosts when it starts. */
export const FESTIVAL_TIME = 80;
export const FESTIVAL_FAITH = 30;
export const FESTIVAL_POWER = 200;
/** Extra belief a neutral village gets for finishing a project (on top of the prayer reward). */
export const NEUTRAL_FINISH_BELIEF = 15;
/** Belief a neutral village gains per unit of material you give its project (a boulder is ~15 stone). */
export const NEUTRAL_GIFT_BELIEF = 0.12;

/**
 * The Wonder (v0.4's end goal). Retired in v0.5: every village's temple standing is the goal now. It is
 * no longer unlocked in play; a finished one in an old save still stands.
 */
export const WONDER_UNLOCK_DELAY = 6;

export const DEFS: Record<ProjectId, ProjectDef> = {
  well: {
    id: 'well',
    name: 'Well',
    icon: '💧',
    prayer: ['We dream of a well! Timber and a few good stones, please.', 'A well would change everything. Stones and timber?'],
    thanks: 'Fresh water at last!',
    effect: 'Fields grow faster and fires burn out sooner.',
    needs: { wood: 40, stone: 24, food: 0 },
    radius: 3.4,
    height: 5,
  },
  // The pyramid: the old Temple project, now built at the prayer place (it keeps the temple's effect).
  temple: {
    id: 'temple',
    name: 'Pyramid',
    icon: '🔺',
    prayer: ['We dream of a pyramid at our prayer place, pointing at the stars! Stone and timber, great one?', 'A pyramid, if you will. We would raise it with our own hands.'],
    thanks: 'It points at the stars!',
    effect: 'More prayer power from every worshipper, and faith holds steadier.',
    needs: { wood: 70, stone: 64, food: 0 },
    radius: 8,
    height: 9,
  },
  // The temple: the old Harvest Festival, now a temple of white stone round the pyramid, opened with the festival's night of dancing.
  festival: {
    id: 'festival',
    name: 'Temple',
    icon: '🏛️',
    prayer: ['We dream of a temple of white stone round our pyramid, and a feast to open it!', 'A temple! Columns, a crown of light, and a feast for everyone.'],
    thanks: 'Let the dancing begin!',
    effect: 'A temple of white stone, opened with a night of dancing: a big boost to faith and prayer power.',
    needs: { wood: 50, stone: 32, food: 60 },
    radius: 11.5,
    height: 14,
  },
  wonder: {
    id: 'wonder',
    name: 'The Wonder',
    icon: '🌟',
    prayer: ['The Wonder awaits! Every village must bring timber, stone and food.'],
    thanks: 'The island is yours!',
    effect: 'A monument of light, raised by every village you have won.',
    needs: { wood: 450, stone: 280, food: 260 },
    radius: 23,
    height: 40,
  },
};
