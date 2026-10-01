import * as THREE from 'three';
import { smoothstep } from '../util/math';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_IDS: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

// ------------------------------------------------------------------ tuning knobs

/** Length of each season in game days (a day is DAY_LENGTH seconds, 5 real minutes by default). */
export const SEASON_DAYS = 2.5;
/** Each season melts into the next over this many game days at its end, so nothing ever pops. */
export const BLEND_DAYS = 1;
/** Chance a season brings its nature event (the first year always does, so you meet them all). */
export const EVENT_CHANCE = 0.75;
/** An event starts at a random point of its season, between these fractions of the season. */
export const EVENT_START: [number, number] = [0.28, 0.5];

export const SEASON_NAME: Record<SeasonId, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
export const SEASON_ICON: Record<SeasonId, string> = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

/** Everything that changes with the season. Blended between neighbours; see `blendLook`. */
export interface Look {
  // Ground and plants
  grassColor: THREE.Color;
  grassAmt: number;
  snow: number;
  leafTint: THREE.Color;
  autumn: number;
  bare: number;
  blossom: number;
  snowCanopy: number;
  grassScale: number;
  flower: number;
  wind: number;
  // Sky and light
  horizonTint: THREE.Color;
  horizonAmt: number;
  zenithTint: THREE.Color;
  zenithAmt: number;
  sunTint: THREE.Color;
  sunAmt: number;
  sunScale: number;
  hemiScale: number;
  fogScale: number;
  /** Extra ambient light at night (snow glows under the moon). */
  nightLift: number;
  // Grade
  warm: THREE.Vector3;
  sat: number;
  vignette: number;
  // Simulation (game.modifiers)
  cropGrowth: number;
  treeGrowth: number;
  hunger: number;
  fireSpread: number;
  // Ambience and particles
  birds: number;
  hush: number;
  leaves: number;
  petals: number;
  windows: number;
}

const c = (hex: number) => new THREE.Color(hex);
const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const LOOKS: Record<SeasonId, Look> = {
  spring: {
    grassColor: c(0x86d052), grassAmt: 0.38, snow: 0,
    leafTint: lin(1.12, 1.22, 0.9), autumn: 0, bare: 0, blossom: 1, snowCanopy: 0,
    grassScale: 1.1, flower: 1.5, wind: 1,
    horizonTint: c(0xd5efff), horizonAmt: 0.12, zenithTint: c(0x3d94e8), zenithAmt: 0.15,
    sunTint: c(0xfff0d0), sunAmt: 0.15, sunScale: 1.03, hemiScale: 1.05, fogScale: 1, nightLift: 0,
    warm: v3(1.03, 1.02, 0.97), sat: 1.12, vignette: 0.2,
    cropGrowth: 1.35, treeGrowth: 1.3, hunger: 1, fireSpread: 1,
    birds: 1, hush: 0, leaves: 0, petals: 0.35, windows: 1,
  },
  summer: {
    grassColor: c(0xbdb248), grassAmt: 0.5, snow: 0,
    leafTint: lin(0.92, 1.0, 0.82), autumn: 0, bare: 0, blossom: 0, snowCanopy: 0,
    grassScale: 1, flower: 1, wind: 1,
    horizonTint: c(0xffe9c0), horizonAmt: 0.22, zenithTint: c(0x2f7fd0), zenithAmt: 0.2,
    sunTint: c(0xffd488), sunAmt: 0.5, sunScale: 1.12, hemiScale: 1, fogScale: 1, nightLift: 0,
    warm: v3(1.06, 1.0, 0.92), sat: 1.08, vignette: 0.22,
    cropGrowth: 1, treeGrowth: 1, hunger: 1, fireSpread: 1.35,
    birds: 0.5, hush: 0, leaves: 0, petals: 0, windows: 1,
  },
  autumn: {
    grassColor: c(0xb5702a), grassAmt: 0.65, snow: 0,
    leafTint: lin(1, 1, 0.9), autumn: 1, bare: 0, blossom: 0, snowCanopy: 0,
    grassScale: 0.85, flower: 0.35, wind: 1.3,
    horizonTint: c(0xf6c48a), horizonAmt: 0.32, zenithTint: c(0x4a79b8), zenithAmt: 0.25,
    sunTint: c(0xffb066), sunAmt: 0.42, sunScale: 0.95, hemiScale: 0.95, fogScale: 0.95, nightLift: 0.05,
    warm: v3(1.08, 1.0, 0.88), sat: 1.12, vignette: 0.25,
    cropGrowth: 1.1, treeGrowth: 0.8, hunger: 0.95, fireSpread: 0.9,
    birds: 0.15, hush: 0, leaves: 1, petals: 0, windows: 1.2,
  },
  winter: {
    grassColor: c(0xc4c2a8), grassAmt: 0.6, snow: 1,
    leafTint: lin(0.9, 0.95, 1), autumn: 0, bare: 1, blossom: 0, snowCanopy: 1,
    grassScale: 0.15, flower: 0, wind: 1.1,
    horizonTint: c(0xdde8f7), horizonAmt: 0.4, zenithTint: c(0x6b93c6), zenithAmt: 0.3,
    sunTint: c(0xffcf9a), sunAmt: 0.45, sunScale: 0.95, hemiScale: 1.05, fogScale: 0.85, nightLift: 0.4,
    warm: v3(1.06, 1.0, 0.95), sat: 1.08, vignette: 0.26,
    cropGrowth: 0.08, treeGrowth: 0.15, hunger: 1.2, fireSpread: 0.5,
    birds: 0, hush: 1, leaves: 0, petals: 0, windows: 1.9,
  },
};

export function newLook(): Look {
  return blendLook({ ...LOOKS.spring, grassColor: new THREE.Color(), leafTint: new THREE.Color(), horizonTint: new THREE.Color(), zenithTint: new THREE.Color(), sunTint: new THREE.Color(), warm: new THREE.Vector3() }, LOOKS.spring, LOOKS.spring, 0);
}

/** out = a + (b - a) * t for every field (numbers, colours, vectors). Returns out. */
export function blendLook(out: Look, a: Look, b: Look, t: number): Look {
  const o = out as unknown as Record<string, unknown>;
  const A = a as unknown as Record<string, unknown>;
  const B = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(A)) {
    const x = A[k];
    if (typeof x === 'number') o[k] = x + ((B[k] as number) - x) * t;
    else if (x instanceof THREE.Color) (o[k] as THREE.Color).copy(x).lerp(B[k] as THREE.Color, t);
    else if (x instanceof THREE.Vector3) (o[k] as THREE.Vector3).copy(x).lerp(B[k] as THREE.Vector3, t);
  }
  return out;
}

/** Where we are in the year: season index (0..3), fraction through it (0..1) and how far it has melted into the next (0..1). */
export function yearState(pos: number): { index: number; frac: number; blend: number; year: number } {
  const whole = Math.floor(pos);
  const frac = pos - whole;
  const index = ((whole % 4) + 4) % 4;
  const start = 1 - BLEND_DAYS / SEASON_DAYS;
  return { index, frac, blend: smoothstep(start, 1, frac), year: Math.floor(whole / 4) + 1 };
}
