/** Tuning knobs. Units: 1 unit ≈ 1 metre; a villager is ~1.8 tall. */

export const WORLD_SEED = 1337;
export const WORLD_SIZE = 800;
export const TERRAIN_RES = 257; // vertices per side
export const SEA_LEVEL = 0;

export const GRAVITY = 28;
export const DAY_LENGTH = 300; // seconds per full day/night cycle
export const START_TIME_OF_DAY = 0.3; // 0 = midnight, 0.25 = dawn, 0.5 = noon

/** Who a village worships: you, the rival god (see src/rival), or nobody yet. */
export type Owner = 'player' | 'rival' | null;

export interface VillageSite {
  name: string;
  x: number;
  z: number;
  radius: number;
  owner: Owner;
  villagers: number;
  houses: number;
  fields: number;
  tunic: number;
}

export const VILLAGE_SITES: VillageSite[] = [
  { name: 'Ashford', x: -175, z: 125, radius: 42, owner: 'player', villagers: 10, houses: 5, fields: 3, tunic: 0x3f6fc4 },
  { name: 'Brambleholt', x: 40, z: 185, radius: 38, owner: null, villagers: 8, houses: 4, fields: 2, tunic: 0xc4803f },
  { name: 'Stonemere', x: 195, z: -20, radius: 40, owner: null, villagers: 11, houses: 5, fields: 3, tunic: 0x7a4fb0 },
];

export const PLAYER = {
  startPower: 900,
  maxPower: 5000,
  powerPerWorshipper: 3, // per second
};

export const INFLUENCE = {
  base: 70,
  perHouse: 5,
  /** Each shrine stage past the totem pushes the ring out this much (v0.6: reach you can see, src/reach). */
  perStage: 10,
  /**
   * Your light grows as you tend (2026-10-14, progression; Daryll: "we would want to be able to expand as we go into
   * each one"). Each village of yours has a reach that grows a little with every answered prayer, gift and finished
   * dream, up to a cap set by its prayer place: totem, stones, pyramid, temple. Measured distances: Brambleholt is
   * 223 m from Ashford, Stonemere 257 m from Brambleholt and 397 m from Ashford. With these caps Ashford reaches
   * Brambleholt only once its stones stand, Brambleholt (stones) reaches Stonemere, and Ashford's temple could too.
   */
  stageCap: [130, 200, 260, 330] as readonly number[],
  /** Metres of reach for each deed (in that village, or half of it for a deed in a neighbour your light reaches). */
  grow: { prayer: 4, gift: 1.5, stone: 0.15, dream: 8 },
  /** Growth earned beyond the cap is kept (up to this much) and flows out when the prayer place rises. */
  bank: 20,
  /** How fast earned reach flows into the ring (m per game second): the gold visibly creeps. */
  flow: 3,
  /**
   * The ring leans toward the nearest village that isn't yours: an egg whose tip reaches `reach` along the road.
   * The round part grows only this fraction of what the tip grows; the tip's own radius is this fraction of it.
   */
  roundShare: 0.3,
  tipShare: 0.45,
  /** A village is in reach once your light touches its lands: within its radius times this of its centre. */
  touch: 2,
  /** A reached village's own patch of light: its radius times this, growing with belief from `min` to `max`. */
  neighbourScale: 1.35,
  neighbourScaleMax: 3,
};

export const VILLAGER = {
  walkSpeed: 4.2,
  runSpeed: 8,
  hungerRate: 1 / 170, // per second, 0 = full, 1 = starving
  worshipHungerMult: 1.8,
  starveDamage: 0.02,
  mealFood: 2,
  carryAmount: 10,
  lethalImpact: 30, // landing speed that kills
  stunImpact: 8,
};

export const VILLAGE = {
  houseCapacity: 3,
  houseWoodCost: 30,
  maxHouses: 10,
  /** A village that doesn't believe in you stops building at this many houses (progression: neighbours wait). */
  neutralMaxHouses: 5,
  /**
   * Households join one by one (2026-10-14): belief fills house by house, and the village is yours once this share
   * of its homes believes (at belief = convertAt). 4 houses: 3 families; 5 houses: 4; 10 houses: 7.
   */
  joinShare: 0.7,
  maxFields: 6,
  birthInterval: 22,
  fieldYield: 15,
  fieldGrowTime: 60,
  defaultWorship: 0.35,
  neutralWorship: 0.15,
  beliefDecay: 0.03, // per second, neutral villages only (v0.5 tuning: was 0.12, which undid a gift before the next one landed)
  beliefHold: 60, // game seconds belief holds steady after any deed that raised it, before it starts to fade
  convertAt: 100,
  impressRange: 150, // reaches past your own ring: the gap between Ashford's ring and Brambleholt was 128
};

export const MIRACLES = {
  water: { cost: 250, key: '1' },
  food: { cost: 350, key: '2' },
  fire: { cost: 300, key: '3' },
};
