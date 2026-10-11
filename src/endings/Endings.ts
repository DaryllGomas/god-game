import type { Game } from '../Game';
import type { Rival } from '../rival/Rival';
import type { Balance } from '../balance/Balance';
import type { Prayers } from '../prayers/Prayers';
import type { Advisors } from '../prayers/Advisors';
import { DAY_LENGTH } from '../config';
import { SAVE_KEY } from '../systems/Save';
import { INTRO_SEEN_KEY } from '../intro/Intro';
import { ISLE_POS } from '../rival/RivalVisuals';
import { Cine } from './Cine';
import { Collapse, Arrival, arrivalLine, type Stage } from './Collapse';
import { Ascension, READY } from './Ascension';
import { CityLights } from './CityLights';
import { EndCard } from './EndCard';
import { RuinModel, ruinSite } from './Ruin';
import { buildLegacy, downloadLegacy, nearestVillage, type Legacy } from './Legacy';
import { clearRebirth, readRebirth, writeRebirth, type Ruin } from './memory';
import './endings.css';

// ------------------------------------------------------------------ tuning knobs

/** Collapse: the balance held below COLLAPSE_BELOW for this many game seconds (1.5 days)... */
export const COLLAPSE_BELOW = 0.2;
export const COLLAPSE_AFTER = 1.5 * DAY_LENGTH;
/** ...or none of your people left alive for this long (game seconds). */
export const PEOPLE_GONE_AFTER = 20;
/** Whole: every temple stands and the balance has stayed in tune (above Balance's HIGH, 0.75) this long (1 day). */
export const WHOLE_AFTER = 1 * DAY_LENGTH;
/** The end card's one line, handing off to the next chapter (the RPG builds the Nexus). */
export const HANDOFF_LINE = 'The Nexus is forming.';
/** Ruins kept from fallen worlds (the newest stands where it fell; older ones stay too, up to this many). */
const MAX_RUINS = 5;

export type Phase = 'play' | 'collapse' | 'arrival' | 'whole' | 'ready' | 'card' | 'after';

interface EndingsSave {
  v: 1;
  /** Worlds that fell before this one. */
  worlds: number;
  ruins: Ruin[];
  lowest: number;
  lowFor: number;
  goneFor: number;
  best: { text: string; score: number } | null;
  /** Where it got to: a sequence in progress restarts from its start on load; 'after' = the good ending is done. */
  phase: Phase;
}

type Seq = { frame(dt: number): boolean };

/**
 * The two endings of THE FIRST WORLD (v0.5, "The Split"):
 * - **Collapse** (the self-destructive loop): balance held very low, or every one of your people gone.
 *   Grey, quiet, his spire over the island, the reveal (your hand turns violet), one line from Ora, black.
 *   The world begins again, remembering: a new island with a ruin where the worst act was. No legacy.
 * - **Whole → Ready to See** (the tending loop): every temple stands and the world is in tune. Your hand
 *   and his meet and become one light; the villages become a city of light; the end card. The Legacy
 *   record for the RPG is written as Ready to See begins.
 */
export class Endings {
  phase: Phase = 'play';
  worlds = 0;
  ruins: Ruin[] = [];
  /** The lowest the balance has been on this island (for the legacy). */
  lowest = 1;
  /** Game seconds the balance has been below COLLAPSE_BELOW / no people left. */
  lowFor = 0;
  goneFor = 0;
  /** The kindest single thing you did (for the legacy's marks.bestAct). */
  best: { text: string; score: number } | null = null;
  /** The Legacy record (written at Ready to See; carried in the save as `save.legacy`). */
  legacy: Legacy | null;
  readonly cine: Cine;
  private readonly card: EndCard;
  private seq: Seq | null = null;
  private ascension: Ascension | null = null;
  private city: CityLights | null = null;
  private readonly ruinModels: RuinModel[] = [];
  private advisorsWere = false;
  private resume: Phase | null = null;

  constructor(private readonly game: Game) {
    this.cine = new Cine(game);
    this.card = new EndCard(game.hud.root, HANDOFF_LINE, () => this.legacy && downloadLegacy(this.legacy));
    this.card.onClosed = () => this.toAfter();
    this.cine.onKey = () => this.card.close();
    this.legacy = (game.saves.loaded?.legacy as Legacy | undefined) ?? null;
    this.watchKindness();

    // A world that just fell: this new island remembers it.
    const rebirth = readRebirth();
    if (rebirth && !game.saves.loaded) this.arrive(rebirth.worlds, rebirth.ruins);
    else if (rebirth) clearRebirth();
  }

  private get stage(): Stage {
    const g = this.game as unknown as { rival?: Rival; balance?: Balance };
    return { game: this.game, cine: this.cine, rival: g.rival ?? null, balance: g.balance ?? null };
  }

  private get advisors(): Advisors | null {
    return (this.game as unknown as { prayerSystem?: Prayers & { advisors?: Advisors } }).prayerSystem?.advisors ?? null;
  }

  private cityLights(): CityLights {
    if (!this.city) this.city = new CityLights(this.game);
    return this.city;
  }

  // -------------------------------------------------------------- triggers

  /** Simulation step (game seconds): watch for either ending. */
  update(dt: number) {
    const g = this.game;
    const b = this.stage.balance;
    if (this.phase !== 'play' || !g.saves.armed || !b) return;
    if (!b.pinned) this.lowest = Math.min(this.lowest, b.value);
    this.lowFor = b.value < COLLAPSE_BELOW && !b.pinned ? this.lowFor + dt : 0;
    const followers = g.villages.reduce((n, v) => n + (v.owner === 'player' ? v.population : 0), 0);
    this.goneFor = followers === 0 ? this.goneFor + dt : 0;
    if (this.lowFor >= COLLAPSE_AFTER || this.goneFor >= PEOPLE_GONE_AFTER) this.startCollapse();
    else if (b.highFor >= WHOLE_AFTER && g.allTemplesStand()) this.startAscension(false);
  }

  // ------------------------------------------------------------- sequences

  private take() {
    const a = this.advisors;
    if (a) {
      this.advisorsWere = a.muted;
      a.muted = true; // Lumi and Fizz stay quiet through an ending (not saved as the player's choice)
    }
  }

  private giveBack() {
    const a = this.advisors;
    if (a) a.muted = this.advisorsWere;
  }

  startCollapse() {
    if (this.phase !== 'play' && this.phase !== 'arrival') return;
    this.phase = 'collapse';
    this.take();
    const c = new Collapse(this.stage, () => this.fall());
    c.begin();
    this.seq = c;
  }

  /** The old world is let go: remember it, and begin again (a new island, by reloading the page). */
  private fall() {
    const g = this.game;
    const b = this.stage.balance;
    const home = g.villages.find((v) => v.isHome) ?? g.villages[0];
    const w = b?.worst ?? null;
    // No recorded deed (the people simply faded): the ruin stands by home, on his side.
    const dir = Math.hypot(ISLE_POS.x, ISLE_POS.z);
    const x = w?.x ?? home.center.x + (ISLE_POS.x / dir) * home.radius * 1.8;
    const z = w?.z ?? home.center.z + (ISLE_POS.z / dir) * home.radius * 1.8;
    const world = this.worlds + 1;
    const ruins = [...this.ruins, { x, z, what: w?.what ?? 'faded', world }].slice(-MAX_RUINS);
    writeRebirth({ worlds: world, ruins, at: Date.now() });
    g.saves.freeze(); // the page unload must not write the fallen world back
    try {
      localStorage.setItem(INTRO_SEEN_KEY, '1');
      localStorage.removeItem(SAVE_KEY);
      sessionStorage.setItem('godgame.autostart', '1'); // the new island skips the title screen (see systems/Save.ts)
    } catch {
      /* storage unavailable: the reload still starts a new island */
    }
    location.reload();
  }

  /** A new island after a fall: place the ruins, then play the arrival. */
  private arrive(worlds: number, ruins: Ruin[]) {
    this.worlds = worlds;
    this.ruins = [];
    const newest = ruins[ruins.length - 1];
    for (const r of ruins) {
      // The newest is placed now (searching outward from the deed for dry, open land); older ones already were.
      const site = r === newest ? ruinSite(this.game, r.x, r.z) : { x: r.x, z: r.z };
      if (site && !this.ruins.some((o) => Math.hypot(o.x - site.x, o.z - site.z) < 24)) this.ruins.push({ ...r, x: Math.round(site.x), z: Math.round(site.z) });
    }
    this.placeRuins();
    const focus = this.ruins[this.ruins.length - 1] ?? { x: this.game.villages[0].center.x, z: this.game.villages[0].center.z };
    this.phase = 'arrival';
    this.take();
    const a = new Arrival(this.stage, focus, arrivalLine(worlds));
    a.begin();
    this.seq = a;
    // Keep what this world remembers right away (in its own save), then forget the hand-over note.
    window.setTimeout(() => {
      this.game.saves.arm();
      this.game.saves.save('quiet');
      clearRebirth();
    }, 0);
  }

  private placeRuins() {
    for (const m of this.ruinModels) m.dispose();
    this.ruinModels.length = 0;
    for (const r of this.ruins) {
      const m = new RuinModel(this.game, r);
      m.place();
      this.ruinModels.push(m);
    }
  }

  startAscension(fromReady: boolean) {
    if (this.phase !== 'play' && this.phase !== 'after') return;
    this.phase = fromReady ? 'ready' : 'whole';
    this.take();
    const a = new Ascension(
      this.stage,
      () => this.cityLights(),
      () => this.writeLegacy(),
      () => this.showCard(),
      fromReady,
    );
    a.begin();
    this.ascension = a;
    this.seq = a;
  }

  /** Ready to See: write the Legacy record and save at once (it goes up to Pulse with the cloud save). */
  private writeLegacy() {
    this.phase = 'ready';
    this.legacy = buildLegacy(this.game, this.lowest, this.best?.text ?? null);
    this.game.saves.save('quiet');
  }

  private showCard() {
    this.phase = 'card';
    this.card.show();
  }

  /** The card has gone: back on the island, at night, the city lit. The game goes on. */
  private toAfter() {
    const g = this.game;
    this.phase = 'after';
    this.seq = null;
    this.ascension?.release();
    this.ascension?.dispose();
    this.ascension = null;
    this.cine.setVeil(0);
    this.cine.end();
    this.giveBack();
    g.audio.endingBreathe();
    g.saves.save('quiet');
  }

  // -------------------------------------------------------------- per frame

  frame(dt: number) {
    if (this.seq && this.seq.frame(dt)) {
      if (this.phase === 'arrival') {
        this.phase = 'play';
        this.giveBack();
      }
      if (this.phase !== 'card') this.seq = null;
    }
    if (this.ascension && this.phase === 'whole' && this.ascension.phase === 'ready') this.phase = 'ready';
    // Leaving the card: the night island comes up from black as the card fades.
    if (this.phase === 'card' && this.card.closing) this.cine.setVeil(this.card.level);
    if (this.resume) {
      const r = this.resume;
      this.resume = null;
      if (r === 'collapse') this.startCollapse();
      else if (r === 'whole' || r === 'ready' || r === 'card') this.startAscension(r !== 'whole');
    }
    // The city keeps its lights after the ending: lit through the night, resting by day.
    if (this.city) {
      if (this.phase === 'after') {
        const night = 1 - this.game.sky.daylight;
        this.city.level = Math.min(1, Math.max(0.12, night * 1.25));
        this.city.t = Math.max(this.city.t, 30);
      }
      this.city.frame(dt, this.phase === 'after' ? 0.22 : 1);
    }
    this.card.frame(dt);
    this.cine.frame(dt);
  }

  // ------------------------------------------------------------- kindness

  /** The kindest single thing you did, as a fallback for the legacy when the chronicle remembers nothing kinder (see Legacy.bestAct). */
  private watchKindness() {
    const ev = this.game.events;
    const note = (score: number, text: string) => {
      if (!this.best || score >= this.best.score) this.best = { text, score };
    };
    const names: Record<string, string> = { whispers: 'whispers', blight: 'blight', hand: 'grasping hand', storm: 'violet storm' };
    ev.on('schemeFoiled', ({ kind, village }) => note(3, `You turned Vexahl's ${names[kind] ?? kind} away from ${village.name}.`));
    ev.on('fireOut', ({ entity }) => {
      const v = nearestVillage(this.game, entity.pos.x, entity.pos.z);
      if (entity.kind === 'house') note(2.6, `You put out a burning home in ${v?.name ?? 'a village'}.`);
      else note(1, `You put out a fire near ${v?.name ?? 'a village'}.`);
    });
    ev.on('gift', ({ village, kind, amount }) => {
      if (kind === 'food' && amount >= 20 && village.starving > 0) note(3.2, `You fed ${village.name} in a hungry time.`);
      else if (amount >= 60) note(1.2, `You filled ${village.name}'s stores.`);
    });
    ev.on('villageConverted', ({ village }) => note(2, `${village.name} came to believe in you.`));
  }

  // -------------------------------------------------------------- save/load

  save(): EndingsSave {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      v: 1,
      worlds: this.worlds,
      ruins: this.ruins,
      lowest: r(this.lowest),
      lowFor: Math.round(this.lowFor),
      goneFor: Math.round(this.goneFor),
      best: this.best,
      phase: this.phase === 'arrival' ? 'play' : this.phase,
    };
  }

  load(data: unknown) {
    const d = data as Partial<EndingsSave> | null;
    if (!d || typeof d !== 'object') return;
    this.worlds = typeof d.worlds === 'number' ? d.worlds : 0;
    this.ruins = Array.isArray(d.ruins) ? d.ruins.filter((r) => r && typeof r.x === 'number' && typeof r.z === 'number') : [];
    this.lowest = typeof d.lowest === 'number' ? d.lowest : 1;
    this.lowFor = d.lowFor ?? 0;
    this.goneFor = d.goneFor ?? 0;
    this.best = d.best ?? null;
    this.placeRuins();
    const phase = d.phase ?? 'play';
    if (phase === 'after') {
      // The good ending is done: Vexahl is whole, the city keeps its lights.
      this.phase = 'after';
      const r = this.stage.rival;
      if (r) {
        r.reintegrate();
        r.isle.setPresent(false, true);
      }
      this.cityLights().t = 30;
    } else if (phase !== 'play') this.resume = phase; // a sequence was cut off (tab closed): play it again from its start
  }

  // ---------------------------------------------------------------- debug

  /**
   * Debug: play an ending now. 'collapse' runs the whole fall and reloads into the new island;
   * 'whole' plays Whole into Ready to See and the end card; 'ready' starts at Ready to See.
   */
  debug(kind: 'collapse' | 'whole' | 'ready') {
    if (this.seq) return `busy: ${this.phase}`;
    if (kind === 'collapse') {
      const b = this.stage.balance;
      // A worst act to remember, if the world never recorded one.
      if (b && !b.worst) {
        const home = this.game.villages.find((v) => v.isHome) ?? this.game.villages[0];
        const h = home.houses.find((x) => !x.destroyed) ?? home.store;
        b.worst = { x: Math.round(h.pos.x), z: Math.round(h.pos.z), what: 'home destroyed', points: -4, day: this.game.day };
      }
      // After the good ending he is gone; a debug fall needs his spire back on the sea.
      const r = this.stage.rival;
      if (r && !r.isle.present) r.isle.setPresent(true, true);
      this.phase = 'play';
      this.startCollapse();
    } else {
      if (this.phase !== 'after') this.phase = 'play';
      this.startAscension(kind === 'ready');
    }
    return this.phase;
  }

  /** Debug/test: where things stand. */
  state() {
    const b = this.stage.balance;
    return {
      phase: this.phase,
      worlds: this.worlds,
      ruins: this.ruins,
      lowest: Math.round(this.lowest * 1000) / 1000,
      collapse: { below: COLLAPSE_BELOW, lowFor: Math.round(this.lowFor), after: COLLAPSE_AFTER, goneFor: Math.round(this.goneFor), goneAfter: PEOPLE_GONE_AFTER },
      whole: { templesStand: this.game.allTemplesStand(), highFor: Math.round(b?.highFor ?? 0), after: WHOLE_AFTER },
      best: this.best?.text ?? null,
      legacy: !!this.legacy,
      sequenceTime: this.seq ? Math.round(((this.seq as unknown as { t?: number }).t ?? 0) * 10) / 10 : null,
      readyAt: READY,
    };
  }
}
