/** The golem's good side: what it can learn to do, with icons for its panel (no sentences, see CreaturePanel). */

export const BAD_KEYS = ['eat:food', 'eat:crops', 'eat:villager', 'eat:rock', 'throw:rock'] as const;
export const GOOD_KEYS = [
  'deed:haul',
  'deed:plant',
  'deed:fire',
  'deed:rescue',
  'deed:play',
  'deed:guard',
  'eat:fruit',
  'eat:fish',
] as const;

export type BadKey = (typeof BAD_KEYS)[number];
export type GoodKey = (typeof GOOD_KEYS)[number];

/** Panel icon and tooltip name for each good habit. */
export const GOOD_INFO: Record<GoodKey, { icon: string; name: string }> = {
  'deed:haul': { icon: '🪨', name: 'Hauling stone and wood to a build' },
  'deed:plant': { icon: '🌱', name: 'Planting and watering saplings' },
  'deed:fire': { icon: '💧', name: 'Stomping out fires' },
  'deed:rescue': { icon: '🧒', name: 'Carrying lost villagers home' },
  'deed:play': { icon: '🎈', name: 'Playing gently with children' },
  'deed:guard': { icon: '🛡', name: 'Standing guard against the dark hand' },
  'eat:fruit': { icon: '🍎', name: 'Picking fruit' },
  'eat:fish': { icon: '🐟', name: 'Fishing in the shallows' },
};

export function isGoodKey(k: string): k is GoodKey {
  return (GOOD_KEYS as readonly string[]).includes(k);
}

// Tuning
/** Starting opinion of the harmless foods: it likes them from the start. */
export const HARMLESS_START = 0.5;
/** What watching your hand do a deed teaches (before the usual diminishing returns). */
export const WATCH_GAIN = 0.15;
/** Strokes and pats right after a good deed count this much more than after a bad one. */
export const GOOD_REWARD_MULT = 1.8;
/** How far (metres) the golem notices your hand's deeds. */
export const WATCH_RANGE = 120;
/** Alignment gained per finished deed. */
export const DEED_ALIGNMENT: Record<GoodKey, number> = {
  'deed:haul': 0.03,
  'deed:plant': 0.024,
  'deed:fire': 0.03,
  'deed:rescue': 0.048,
  'deed:play': 0.024,
  'deed:guard': 0.036,
  'eat:fruit': 0.006,
  'eat:fish': 0.006,
};
/** One in this many mature trees bears fruit (by seed), and each is picked clean for this long. */
export const FRUIT_EVERY = 4;
export const FRUIT_REGROW = 150;
