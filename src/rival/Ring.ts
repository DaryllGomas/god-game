import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Balance } from '../balance/Balance';
import { TUNE } from '../balance/Balance';
import { clamp } from '../util/math';
import { LUMI_REFUSED, LUMI_TAKEN, ORA_RING, RING, RING_OFFERS, RING_REFUSED, RING_TAKEN, RIVAL_NAME, type Line, type RingMoment } from './data';
import type { Rival } from './Rival';

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

/** One offer on the table: the moment that drew him, and the village it is about (if any). */
interface Offer {
  moment: RingMoment;
  village: Village | null;
  line: Line;
}

/** A village ruled by fear: game seconds the balance has stayed low (it may slip away) or in tune (the fear lifts). */
interface Fear {
  low: number;
  tune: number;
}

/**
 * The ring (Daryll, 2026-10-15: "if you ruled with an iron fist and with power ... he could be holding up the ring. And
 * so it's your job to turn it down."). Two or three times a story game (fewer in free play), at a moment of
 * impatience, Vexahl appears on a larger, darker card with the E portrait and offers his ring:
 * - a village you are winning has stalled (its belief has not risen for a while): take it, and it kneels;
 * - one of his schemes is draining a village: take it, and he lifts it (a village not yet yours kneels too);
 * - you have been cruel lately: take it, and the village in your light kneels (or, if none, power floods in).
 * Taking it gives you what you wanted now, and costs: alignment toward cruel, the world's balance, and his citadel grows
 * a step (the first step toward becoming him, CANON ruling 8). The village that knelt is ruled by fear: its homes glow
 * cold violet and ember, it dances and prays less, it can slip away to him while the world stays low, and the fear lifts
 * after a long stretch in tune (no hell; anyone can come back). Turning it down: he turns away and dissolves (F), Lumi
 * is warm, and the world steadies a little. Ora names the stakes once, on the first offer.
 */
export class Ring {
  offered = 0;
  taken = 0;
  refused = 0;
  /** Steps his citadel has grown from the ring (on top of the ages you raise; see Rival.tierNow). */
  steps = 0;
  /** Game time of the last offer, and of his rising (the first offer waits a while after it). */
  private lastAt = -1e9;
  private risenAt: number | null = null;
  private offer: Offer | null = null;
  /**
   * Villages you are trying to win (in your light, or the one the story is carrying your light toward): their belief
   * when the clock last started, game seconds since it rose by RING.stallRise, and whether your light reaches them.
   */
  private readonly stall = new Map<Village, { mark: number; t: number; reach: boolean }>();
  /** Game seconds the current scheme has run (and which scheme). */
  private schemeT = 0;
  private schemeOf: unknown = null;
  readonly fear = new Map<Village, Fear>();

  constructor(private readonly rival: Rival) {}

  private get game(): Game {
    return this.rival.game;
  }

  private get balance(): Balance | null {
    return (this.game as unknown as { balance?: Balance }).balance ?? null;
  }

  /** Most offers in this game: a story game has two or three, free play fewer. */
  get limit(): number {
    return this.rival.story ? RING.story : RING.free;
  }

  get open(): boolean {
    return this.offer !== null;
  }

  /** Simulation step (game seconds). */
  update(dt: number) {
    const g = this.game;
    const r = this.rival;
    this.watchFear(dt);
    if (!r.risen || r.stage === 'retreated') return;
    this.risenAt ??= g.time;
    this.watchStalls(dt);
    const s = r.scheme;
    if (s !== this.schemeOf) {
      this.schemeOf = s;
      this.schemeT = 0;
    } else if (s && s.phase === 'active') this.schemeT += dt;

    if (this.offer || this.offered >= this.limit || r.farewell) return;
    if (g.time - this.lastAt < RING.gap || g.time - (this.risenAt ?? g.time) < RING.firstAfter) return;
    if (!this.calm()) return;
    const m = this.moment();
    if (m) this.make(m.moment, m.village);
  }

  /** Nothing else on: no glance out to sea, no line of his or theirs, no ending, no help screen. */
  private calm(): boolean {
    const g = this.game;
    const endings = (g as unknown as { endings?: { phase: string } }).endings;
    if (endings && endings.phase !== 'play') return false;
    if (g.hud.helpOpen || this.rival.glancing || this.rival.ui.talking) return false;
    return !g.hud.root.querySelector('.talk-card.show');
  }

  /**
   * A village you are winning whose belief climbs keeps its clock at 0; one that has stalled (less than RING.stallRise
   * gained since the clock started) counts up. The village the story is carrying your light toward counts too, before
   * your light reaches it (a long wait is impatience as well).
   */
  private watchStalls(dt: number) {
    const g = this.game;
    const goal = (g as unknown as { story?: { active: boolean; goal: { id: string; village: Village } | null } }).story;
    const target = goal?.active && goal.goal && (goal.goal.id === 'carry' || goal.goal.id === 'win') ? goal.goal.village : null;
    for (const v of g.villages) {
      const reach = g.withinReach(v);
      const inPlay = v.owner === null && v.population > 0 && (reach || v === target);
      if (!inPlay) {
        this.stall.delete(v);
        continue;
      }
      const st = this.stall.get(v) ?? { mark: v.belief, t: 0, reach };
      if (st.reach !== reach) {
        // Your light just reached it: a fresh start.
        st.reach = reach;
        st.mark = v.belief;
        st.t = 0;
      } else if (v.belief >= st.mark + RING.stallRise) {
        st.mark = v.belief;
        st.t = 0;
      } else {
        st.mark = Math.min(st.mark, v.belief);
        st.t += dt;
      }
      this.stall.set(v, st);
    }
  }

  /** The moment of impatience that draws him now, if there is one. */
  private moment(): { moment: RingMoment; village: Village | null } | null {
    const r = this.rival;
    // A scheme of his draining a village for a while.
    const s = r.scheme;
    if (s && s.phase === 'active' && this.schemeT >= RING.drain && (s.village.owner !== 'player' || s.village.belief <= RING.drainFaith)) return { moment: 'drain', village: s.village };
    // A village you are winning that has stalled.
    for (const [v, st] of this.stall) {
      if (st.reach ? st.t >= RING.stall && v.belief >= RING.stallBelief : st.t >= RING.stallFar) return { moment: 'stall', village: v };
    }
    // You have been cruel lately (and the world feels it).
    const echo = this.balance?.echo;
    if (echo && echo.burn + echo.throw + echo.neglect >= RING.cruel) return { moment: 'cruel', village: this.kneeler() };
    return null;
  }

  /** The village in your light nearest to joining you (it would kneel), or null. */
  private kneeler(): Village | null {
    const g = this.game;
    const near = g.villages.filter((v) => v.owner === null && v.population > 0 && g.withinReach(v));
    near.sort((a, b) => b.belief - a.belief);
    return near[0] ?? null;
  }

  /** He offers the ring now. */
  private make(moment: RingMoment, village: Village | null) {
    const g = this.game;
    const line = pick(RING_OFFERS[moment]);
    this.offer = { moment, village, line };
    this.offered++;
    this.lastAt = g.time;
    this.rival.isle.pulse(0.8);
    g.message(`${RIVAL_NAME} offers you a ring.`, 'warn', 'rival-ring');
    g.events.emit('ringOffered', { moment, village });
    // Ora names the stakes once (text only), the first time.
    if (this.offered === 1) this.rival.oraSay(ORA_RING);
    void this.rival.ui.offer(line, (took, timedOut) => this.answered(took, timedOut));
  }

  /** Debug/test hook: he offers the ring now, for this moment (and village). Returns whether he did. */
  offerNow(moment: RingMoment = 'stall', villageName?: string): boolean {
    if (this.offer) return false;
    const v = villageName ? this.game.villages.find((x) => x.name === villageName) ?? null : moment === 'drain' ? this.rival.scheme?.village ?? null : this.kneeler();
    this.make(moment, v);
    return true;
  }

  private answered(took: boolean, timedOut: boolean) {
    const o = this.offer;
    this.offer = null;
    if (!o) return;
    this.lastAt = this.game.time;
    if (took) this.take(o);
    else this.refuse(o, timedOut);
  }

  // ------------------------------------------------------------- taken

  private take(o: Offer) {
    const g = this.game;
    const r = this.rival;
    this.taken++;
    const v = o.village;
    const where = v ?? g.villages.find((x) => x.isHome) ?? g.villages[0];
    // What you wanted, now.
    let knelt: Village | null = null;
    if (o.moment === 'drain' && r.scheme) r.endScheme('faded');
    if (v && v.owner === null && v.population > 0) knelt = this.kneel(v);
    else if (o.moment === 'drain' && v && v.owner === 'player') this.markFear(v, true);
    else if (!knelt) {
      g.player.addPower(RING.take.power);
      const mine = g.villages.filter((x) => x.owner === 'player' && x.population > 0);
      const mark = mine.find((x) => !x.isHome) ?? mine[0];
      if (mark) this.markFear(mark, true);
      g.floatText(where.center.x, where.center.y + 30, where.center.z, `+${RING.take.power} power`, '#ffb08a');
    }
    // What it costs.
    g.player.shiftAlignment(RING.take.alignment);
    this.balance?.deed(RING.take.deed, 'took the ring', where.center.x, where.center.z);
    this.balance?.jolt(RING.take.jolt);
    // His citadel grows a step: the first step toward becoming him.
    this.steps++;
    r.isle.pulse(1.4);
    r.isle.ring([10, 220], 3.2, 0.4);
    g.audio.thunder(0.85);
    g.chronicle?.add({ kind: 'ring_taken', village: (knelt ?? v)?.name, x: where.center.x, z: where.center.z, note: o.moment });
    g.events.emit('ringTaken', { moment: o.moment, village: knelt ?? v });
    g.message(`You took ${RIVAL_NAME}'s ring. Out at sea, his citadel grows.`, 'bad', 'ring-taken');
    r.ui.say(pick(RING_TAKEN), { delay: 1.2 });
    r.ui.say(LUMI_TAKEN);
  }

  /** The village kneels: yours at once, out of fear. */
  private kneel(v: Village): Village {
    const g = this.game;
    // Ruled by fear before it converts, so the usual joy at a village joining you stays quiet.
    v.fear = true;
    v.convert(g);
    v.belief = RING.fear.faith;
    this.markFear(v, true);
    g.fx.sparkle(v.center.x, v.center.y + 8, v.center.z, 120, 0xff5a2a, 24);
    g.fx.sparkle(v.center.x, v.center.y + 6, v.center.z, 70, 0x8a50e0, 18);
    // His banner tint over the game's own "worships you": they kneel, they don't dance for joy.
    this.rival.ui.banner(`${v.name} kneels`, 'Out of fear, not love. Fewer will dance for you, and if the world stays dark they may slip away to him.');
    return v;
  }

  /** Mark a village of yours as ruled by fear (its homes' glow turns cold violet and ember). */
  private markFear(v: Village, flare: boolean) {
    v.fear = true;
    this.fear.set(v, { low: 0, tune: 0 });
    if (flare) for (const h of v.houses) h.setFear(true, true);
  }

  /** Ruled by fear: it slips away to him if the world stays low, and the fear lifts after a long while in tune. */
  private watchFear(dt: number) {
    const g = this.game;
    const b = this.balance?.value ?? 0.75;
    for (const [v, f] of this.fear) {
      if (!v.fear || v.owner !== 'player') {
        v.fear = false;
        this.fear.delete(v);
        continue;
      }
      f.low = b < RING.fear.slipBelow ? f.low + dt : 0;
      f.tune = b >= TUNE ? f.tune + dt : Math.max(0, f.tune - dt * 0.5);
      if (f.low >= RING.fear.slipAfter && !v.isHome && this.rival.stage !== 'retreated') {
        v.fear = false;
        this.fear.delete(v);
        g.message(`${v.name} only ever knelt out of fear. Now it slips away to ${RIVAL_NAME}.`, 'bad', 'ring-slip');
        this.rival.turn(v);
      } else if (f.tune >= RING.fear.liftAfter) {
        v.fear = false;
        this.fear.delete(v);
        for (const h of v.houses) h.setFear(false);
        for (const h of v.houses) h.setBelieving(false, true);
        g.fx.sparkle(v.center.x, v.center.y + 6, v.center.z, 140, 0xfff0b0, 26);
        g.message(`${v.name} no longer fears you. Their hearts are truly yours now.`, 'good', 'ring-lift');
      }
    }
  }

  // ------------------------------------------------------------ refused

  private refuse(o: Offer, timedOut: boolean) {
    const g = this.game;
    const r = this.rival;
    this.refused++;
    const where = o.village ?? g.villages.find((x) => x.isHome) ?? g.villages[0];
    g.player.shiftAlignment(RING.refuse.alignment);
    this.balance?.deed(RING.refuse.deed, 'refused the ring', where.center.x, where.center.z);
    g.chronicle?.add({ kind: 'ring_refused', village: o.village?.name, x: where.center.x, z: where.center.z, note: timedOut ? 'silence' : o.moment });
    g.events.emit('ringRefused', { moment: o.moment, village: o.village, timedOut });
    g.message(timedOut ? `You let ${RIVAL_NAME}'s ring go by.` : `You turned down ${RIVAL_NAME}'s ring.`, 'good', 'ring-refused');
    r.setMood('sulking', 60);
    r.ui.say(pick(RING_REFUSED), { delay: 0.4 });
    r.ui.say(LUMI_REFUSED[this.refused === 1 ? 0 : 1]);
  }

  // ------------------------------------------------------- save / load

  save() {
    const g = this.game;
    return {
      offered: this.offered,
      taken: this.taken,
      refused: this.refused,
      steps: this.steps,
      ago: Math.round(clamp(g.time - this.lastAt, 0, 1e6)),
      fear: [...this.fear.entries()].map(([v, f]) => ({ v: g.villages.indexOf(v), low: Math.round(f.low), tune: Math.round(f.tune) })),
    };
  }

  load(d: Partial<ReturnType<Ring['save']>> | undefined) {
    if (!d) return;
    const g = this.game;
    this.offered = d.offered ?? 0;
    this.taken = d.taken ?? 0;
    this.refused = d.refused ?? 0;
    this.steps = d.steps ?? 0;
    this.lastAt = g.time - (d.ago ?? 1e6);
    this.risenAt = null;
    this.fear.clear();
    for (const f of d.fear ?? []) {
      const v = g.villages[f.v];
      if (!v || v.owner !== 'player') continue;
      v.fear = true;
      this.fear.set(v, { low: f.low ?? 0, tune: f.tune ?? 0 });
    }
  }

  state() {
    return {
      offered: this.offered,
      taken: this.taken,
      refused: this.refused,
      steps: this.steps,
      limit: this.limit,
      open: this.offer ? { moment: this.offer.moment, village: this.offer.village?.name ?? null, text: this.offer.line.text } : null,
      fear: [...this.fear.keys()].map((v) => v.name),
      stalls: [...this.stall.entries()].map(([v, s]) => ({ village: v.name, t: Math.round(s.t), mark: Math.round(s.mark), reach: s.reach })),
    };
  }
}
