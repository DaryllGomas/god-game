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
  max: 130,
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
  maxFields: 6,
  birthInterval: 22,
  fieldYield: 15,
  fieldGrowTime: 60,
  defaultWorship: 0.35,
  neutralWorship: 0.15,
  beliefDecay: 0.12, // per second, neutral villages only
  convertAt: 100,
  impressRange: 120,
};

export const MIRACLES = {
  water: { cost: 250, key: '1' },
  food: { cost: 350, key: '2' },
  fire: { cost: 300, key: '3' },
};
