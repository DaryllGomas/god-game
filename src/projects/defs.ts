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

/** The chain every village works through, one project at a time. */
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
/** Neutral villages quarry a trickle of stone themselves (per second) so they never stall for good. */
export const NEUTRAL_QUARRY = 0.12;

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
export const NEUTRAL_FINISH_BELIEF = 40;
/** Belief a neutral village gains per unit of material you give its project. */
export const NEUTRAL_GIFT_BELIEF = 0.25;

/** The Wonder's footprint and appetite. All three villages must worship you before it unlocks. */
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
  temple: {
    id: 'temple',
    name: 'Temple',
    icon: '🏛️',
    prayer: ['We dream of a temple to honour you! Stone and timber, great one?', 'A temple, if you will. We would build it with our own hands.'],
    thanks: 'A home for our prayers!',
    effect: 'More prayer power from every worshipper, and faith holds steadier.',
    needs: { wood: 80, stone: 56, food: 0 },
    radius: 7,
    height: 9,
  },
  festival: {
    id: 'festival',
    name: 'Harvest Festival',
    icon: '🏮',
    prayer: ['We dream of a harvest festival! Timber for the lanterns and food for the feast.', 'Let us hold a feast! Lanterns, ribbons and a full table.'],
    thanks: 'Let the dancing begin!',
    effect: 'A night of dancing under lanterns: a big boost to faith and prayer power.',
    needs: { wood: 40, stone: 0, food: 70 },
    radius: 9,
    height: 8.5,
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
