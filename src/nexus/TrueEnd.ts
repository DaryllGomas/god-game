import * as THREE from 'three';
import type { Game } from '../Game';
import type { Cine } from '../endings/Cine';
import { along, ease, span, type Shot } from '../endings/Cine';
import { EndCard } from '../endings/EndCard';
import { clamp, lerp } from '../util/math';
import type { NexusVisual } from './NexusModel';
import type { Telor } from './Telor';
import { ORA } from './lines';
import { MARK_COUNT } from './glyphs';

// ------------------------------------------------------------------ tuning knobs

/** The beats, in real seconds from the start (the sequence runs at normal speed, like the endings). */
const T = {
  toBlack: [0, 1.1] as const,
  fromBlack: [1.4, 3.6] as const,
  column: [5.5, 9] as const,
  gather: [8, 14] as const,
  understand: 14.5,
  black: [24, 27] as const,
  card: 27,
};
/** Dusk deepening to a starry night over the city (time of day, 0.75 = sunset). */
const DAY = [0.762, 0.79] as const;
/**
 * The end card cuts to the RPG (Daryll, 2026-10-17: "we'll cut to the beginning of the RPG where Atlas comes in to the
 * Nexus because it'll be a little bit in the future because the city has been built up around it").
 */
export const CUT_LINE = 'Some years later, the Nexus opens.';
export const CITY_NAME = 'TELOR';
/** The card asks plainly (Daryll: "would you like to go on to the next game?"); the next game is the RPG. */
export const ASK = 'Would you like to go on to the next game?';
export const NEXT_GAME = 'Beyond the Nexus';
export const STAY_LABEL = 'Stay on this island';
/** The RPG's page on the studio site (the game is served at /the-first-world/play/; the RPG is not playable online yet). */
export const RPG_URL = '../../rpg/';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * The true end of THE FIRST WORLD (Daryll, 2026-10-17: "end it when the nexus is built, and they understand you now
 * ... that's the first world, right there, and then we cut into the RPG"). Telor and the Nexus stand. The camera rises
 * over the city at dusk; a column of light opens at the Nexus and three rings of light turn above it; the people of
 * Telor stop, gather round it and look up. No kneeling, no worship: they understand you now (Ora's last line). The
 * moment holds; then the end card cuts to the RPG, a little in the future: "Some years later, the Nexus opens.", and
 * asks plainly: "Would you like to go on to the next game?" Beyond the Nexus (the RPG's page, for now), or stay on this
 * island (free play). A / Enter goes on, B / Escape stays.
 */
export class TrueEnd {
  t = 0;
  private readonly keys: Shot[];
  private readonly card: EndCard;
  private carded = false;
  private said = false;
  private sounded = false;
  private readonly startDay: number;
  /** The card has closed: the island goes on. */
  onDone: (() => void) | null = null;
  get cardUp(): boolean {
    return this.carded;
  }

  constructor(
    private readonly game: Game,
    private readonly cine: Cine,
    private readonly ring: NexusVisual,
    private readonly telor: Telor,
    private readonly c: THREE.Vector3,
    onDownload: () => void,
    onGo: () => void,
  ) {
    const g = game;
    this.startDay = g.dayTime;
    const gy = (x: number, z: number) => Math.max(g.terrain.heightAt(x, z), 0);
    // The side the camera comes in from: away from the high ground, so the hills never block the ring.
    let best = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let score = 0;
      for (const r of [40, 70, 100, 140]) score -= Math.max(0, gy(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r) - c.y) * (160 - r) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    const dir = (a: number, r: number, y: number) => v3(c.x + Math.cos(best + a) * r, c.y + y, c.z + Math.sin(best + a) * r);
    // Low on the plaza among the people, looking up at the light: a spot clear of the plaza's fountains, benches, lamps
    // and planters, between two stones (so the ring frames the light).
    let gap = 0;
    let gapScore = -Infinity;
    for (let i = 0; i < MARK_COUNT; i++) {
      const a0 = (i / MARK_COUNT) * Math.PI * 2 + 0.22;
      const a = Math.atan2(-Math.cos(a0), Math.sin(a0)) + Math.PI / MARK_COUNT;
      if (Math.cos(a - best - 0.9) > gapScore) {
        gapScore = Math.cos(a - best - 0.9);
        gap = a;
      }
    }
    const low = (r: number, lift: number) => {
      for (let k = 0; k < 24; k++) {
        const a = gap + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.045;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (telor.isClear(x, z, 2.4)) return v3(x, gy(x, z) + lift, z);
      }
      return v3(c.x + Math.cos(gap) * r, gy(c.x, c.z) + lift, c.z + Math.sin(gap) * r);
    };
    this.keys = [
      cine.current(0),
      { t: T.toBlack[1], pos: cine.current().pos, look: cine.current().look },
      { t: T.toBlack[1] + 0.01, pos: dir(0, 210, 150), look: v3(c.x, c.y + 8, c.z) },
      { t: 8, pos: dir(0.35, 150, 95), look: v3(c.x, c.y + 22, c.z) },
      { t: 11.5, pos: dir(0.7, 80, 40), look: v3(c.x, c.y + 18, c.z) },
      // Down into the plaza from above the roofs (never through the first ring of houses).
      { t: 14.2, pos: low(33, 20), look: v3(c.x, c.y + 6, c.z) },
      { t: 16.5, pos: low(33, 7), look: v3(c.x, c.y + 5, c.z) },
      { t: 21, pos: low(28.5, 3.6), look: v3(c.x, c.y + 12, c.z) },
      { t: 25.5, pos: low(29, 24), look: v3(c.x, c.y + 8, c.z) },
      { t: 30, pos: dir(1.2, 150, 100), look: v3(c.x, c.y + 6, c.z) },
    ];
    this.card = new EndCard(g.hud.root, CUT_LINE, onDownload, { kicker: CITY_NAME, choice: { ask: ASK, go: { label: NEXT_GAME, note: 'the next game', onGo }, stay: { label: STAY_LABEL } } });
    this.card.onClosed = () => this.onDone?.();
  }

  begin() {
    const g = this.game;
    this.cine.begin();
    this.cine.takeCamera();
    this.keyWas = this.cine.onKey;
    // Enter or the controller's A goes on to the next game; Escape or B stays on the island.
    this.cine.onKey = (e) => this.card.key(e);
    g.audio.endingReady();
    this.telor.gatherAt.copy(this.c);
  }

  /** Per rendered frame (real seconds). */
  frame(dt: number) {
    const g = this.game;
    this.t += dt;
    const t = this.t;
    this.card.frame(dt);
    if (this.carded) {
      // Leaving the card: the night city comes up from black as it fades.
      if (this.card.closing) this.cine.setVeil(this.card.level);
      return;
    }
    along(this.keys, t, this.cine.pos, this.cine.look);
    this.cine.setVeil(t < T.toBlack[1] ? ease(t / T.toBlack[1]) : Math.max(1 - span(t, T.fromBlack[0], T.fromBlack[1]), span(t, T.black[0], T.black[1])));
    if (t >= T.toBlack[1]) g.dayTime = lerp(DAY[0], DAY[1], clamp((t - T.toBlack[1]) / 26, 0, 1));
    else g.dayTime = this.startDay;
    this.ring.lit = 1;
    // The Nexus lights: the column opens and the rings turn above it.
    this.ring.column = span(t, T.column[0], T.column[1]);
    if (!this.sounded && t >= T.column[0]) {
      this.sounded = true;
      g.audio.wonderAwakens();
    }
    // The people stop, gather round it and look up (no kneeling: they understand).
    this.telor.gatherAt.copy(this.c);
    this.telor.gather = span(t, T.gather[0], T.gather[1]);
    if (!this.said && t >= T.understand) {
      this.said = true;
      this.cine.say(ORA.understand, 5);
    }
    if (t >= T.card) {
      this.carded = true;
      this.card.show();
    }
  }

  /** Give the endings back their own key handling. */
  dispose() {
    this.cine.onKey = this.keyWas;
    this.card.el.remove();
  }
  private keyWas: ((e: KeyboardEvent) => void) | null = null;
}
