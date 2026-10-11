import * as THREE from 'three';
import type { Game } from '../Game';
import type { PostFX } from '../world/PostFX';
import type { SkyWeather } from '../world/Sky';
import { BALANCE_TINT } from '../world/balanceTint';
import { damp, smoothstep } from '../util/math';
import type { Balance } from './Balance';
import { SkyRings } from './SkyRings';

// ------------------------------------------------------------------ tuning knobs
// Each is [balance where it starts, balance where it is complete].

/** Colour drains toward grey-olive. */
const DRAIN: [number, number] = [0.68, 0.14];
/** Colour runs a little richer and warmer. */
const RICH: [number, number] = [0.66, 0.92];
/** The sky rings fade out. */
const RINGS: [number, number] = [0.3, 0.85];
/** The sea darkens toward his side. */
const SEA: [number, number] = [0.72, 0.14];
/** The music drifts out of tune. */
const DETUNE: [number, number] = [0.66, 0.18];
/** How grey the sky goes at the bottom (0..1 of a storm's gloom), and the dusky violet-grey it leans toward. */
const GLOOM = 0.48;
const DUSK_HORIZON = new THREE.Color(0x5c5a6e);
const DUSK_ZENITH = new THREE.Color(0x34344f);
/** Real seconds for the look to catch up with the balance (so 4x speed still glides). */
const EASE = 1.2;

const tint = new THREE.Vector3();
const FALLING_SKY: SkyWeather = {
  horizonTint: DUSK_HORIZON,
  horizonAmt: 0,
  zenithTint: DUSK_ZENITH,
  zenithAmt: 0,
  sunTint: new THREE.Color(1, 1, 1),
  sunAmt: 0,
  sunScale: 1,
  hemiScale: 1,
  fogScale: 1,
  nightLift: 0,
  gloom: 0,
  flash: 0,
};

/**
 * The island is the meter: nothing on screen names the balance; the land, the sky, the sea and the
 * music show it. In tune: rich colour, two rings of light in the sky, a chord that comes home. Falling
 * out of tune: the colour drains to grey-olive, the rings fade, the sky greys, the sea darkens toward
 * Vexahl's side and the music sags flat. (His spire drawing nearer is in src/rival.)
 */
export class BalanceLook {
  readonly rings: SkyRings;
  /** The balance as currently shown (eased in real time). */
  shown: number;

  constructor(
    private readonly game: Game,
    private readonly balance: Balance,
  ) {
    this.shown = balance.value;
    this.rings = new SkyRings(game.scene);
    const ao = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
    ao?.push(this.rings.group);
  }

  /** Jump straight to the current balance (after a debug force, or a load). */
  snap() {
    this.shown = this.balance.value;
  }

  /** Per rendered frame, after the seasons plugin (this plugin's file sorts after it). */
  frame(dt: number) {
    const g = this.game;
    this.shown += (this.balance.value - this.shown) * (this.balance.pinned ? 1 : damp(1 / EASE, dt));
    const b = this.shown;
    const drain = smoothstep(DRAIN[0], DRAIN[1], b);
    const rich = smoothstep(RICH[0], RICH[1], b);

    // Land: terrain, grass and trees share one pair of uniforms.
    BALANCE_TINT.uDrain.value = drain;
    BALANCE_TINT.uRich.value = rich;

    // The whole picture: a gentle grade on top of the season's (houses, people, sea), when post-processing is on.
    const fx = (g as unknown as { postfx?: PostFX }).postfx;
    fx?.setBalanceGrade(1 + 0.03 * rich - 0.28 * drain, tint.set(1 + 0.02 * rich - 0.01 * drain, 1 - 0.01 * drain, 1 - 0.03 * rich - 0.06 * drain));

    // Sky: greyer and dimmer as it falls (on top of the season's weather, which ran first this frame).
    if (drain > 0.002) {
      FALLING_SKY.gloom = GLOOM * drain;
      FALLING_SKY.horizonAmt = 0.4 * drain;
      FALLING_SKY.zenithAmt = 0.45 * drain;
      g.sky.applyWeather(FALLING_SKY);
    }
    this.rings.setStrength(smoothstep(RINGS[0], RINGS[1], b));
    this.rings.frame(dt, g.godCam.camera);

    // Sea: dark water on his side.
    const isle = (g as unknown as { rival?: { isle?: { group: THREE.Object3D } } }).rival?.isle?.group.position;
    const dx = isle ? isle.x : -0.85;
    const dz = isle ? isle.z : -0.53;
    const len = Math.hypot(dx, dz) || 1;
    g.water.setShade(dx / len, dz / len, smoothstep(SEA[0], SEA[1], b));

    // Sound.
    g.audio.setBalance(smoothstep(DETUNE[0], DETUNE[1], b), rich);
  }
}
