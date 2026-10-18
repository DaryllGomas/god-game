import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Advisors } from '../prayers/Advisors';
import type { Endings } from '../endings/Endings';
import type { Res } from '../projects/defs';
import { DEFS } from '../projects/defs';
import { Site } from '../projects/Site';
import { Beacon } from '../story/Beacon';
import { circle } from '../reach/Light';
import { aoSkip } from '../endings/CityLights';
import { downloadLegacy } from '../endings/Legacy';
import { unlockFreePlay } from '../story/unlock';
import { SEA_LEVEL } from '../config';
import { CH_PATH } from '../land/LandMask';
import type { LandApi } from '../plugins/land';
import { clamp, smoothstep } from '../util/math';
import { DAIS_R, NexusVisual } from './NexusModel';
import { MARK_COUNT } from './glyphs';
import { CITY, STEPS, Telor, type TelorStep } from './Telor';
import { RPG_URL, TrueEnd } from './TrueEnd';
import { AFTER_LINES, BEGIN_LINES, CITY_LINES, ORA, RING_CHAT, RING_DONE, STONE_LINES, type NexusCtx } from './lines';
import './nexus.css';

// ------------------------------------------------------------------ tuning knobs

/** Real seconds after Whole's card closes before Ora names the last age's goal (the island comes up from black first). */
const BEGIN_SPEAK = 4;
/** Real seconds on the ring (playing, not paused) before Ora re-nudges, and between nudges after that. */
const NUDGE_AFTER = 150;
/** Game seconds between the ring standing and the first road being paved (the moment lands first). */
const CITY_DELAY = 10;
/** Game seconds after Telor stands before the true end begins (a breath, the city lit). */
const END_DELAY = 9;
/** The Nexus's own light on the ground: the hand works this far round it (m). */
const LIGHT_R = 90;
/** Each prayer answered in a village brings this much to the Nexus (of whatever it lacks most). */
const PRAYER_GIFT = 9;
/** A gift on a village's store sends this share of it on to the Nexus (up to GIFT_CAP). */
const GIFT_SHARE = 0.5;
const GIFT_CAP = 16;
/** Never stuck for good: once no stone has come for STONE_PATIENCE game seconds, the villages quarry a little themselves. */
const STONE_PATIENCE = 150;
const QUARRY_EVERY = 7;
const QUARRY_STONE = 3;
/** Chance a nudge also brings a word from Lumi or Fizz. */
const CHAT_CHANCE = 0.5;

export type NexusPhase = 'off' | 'ring' | 'city' | 'lit' | 'done';

interface NexusSave {
  v: 1;
  phase: NexusPhase;
  x: number;
  y: number;
  z: number;
  have: [number, number, number];
  given: number;
  cityT: number;
  stoneAt: number;
}

interface Mote {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  res: Res;
  amount: number;
  arc: number;
}

const MOTE_COLOR: Record<Res, number> = { wood: 0xe8b070, stone: 0xe6e0d0, food: 0xffe28a };
const RES: Res[] = ['wood', 'stone', 'food'];

/**
 * THE LAST AGE: the Nexus and Telor (Daryll, 2026-10-17): "after you beat Vexahl, you do one last city building where
 * you bring all of the towns together and it creates Telor. So you go through one more progression and ... we build
 * the nexus, right? Which is kind of like a druidic ring. And once it's built, instead of a temple, now the city starts
 * to get built around it."
 *
 * Story mode, after Whole and its card:
 *   ring   Ora names the goal. At the heart of the island, where the villages' roads meet, the three villages raise the
 *          Nexus, seven standing stones, one per mark. Like every dream: stone from your hand (boulders dropped on
 *          it), timber and food carried by all three villages (their builders, flown over as light), and every prayer
 *          you answer and gift you give in any village sends something on to it. The stones rise one by one.
 *   city   The ring stands and wakes (its marks light). No temple: Telor builds itself round it in visible steps
 *          (src/nexus/Telor.ts) over about three game minutes, people walking the new streets and dancing round it.
 *   lit    The true end (src/nexus/TrueEnd.ts): the Nexus lights, the people of Telor gather and look up; they
 *          understand you now. The end card cuts to the RPG ("Some years later, the Nexus opens.") and asks: go on to
 *          the next game (Beyond the Nexus), or stay on this island.
 *   done   Free play goes on, the city lit at night.
 * Saved on its own (plugin 'nexus'); an island saved mid-age loads where it stood. Old saves have none: 'off'.
 */
export class NexusAge {
  phase: NexusPhase = 'off';
  site: Site | null = null;
  telor: Telor | null = null;
  readonly beacon: Beacon;
  /** Game seconds into Telor's build (negative: the pause after the ring stands). */
  cityT = 0;
  private end: TrueEnd | null = null;
  private readonly motes: Mote[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();
  private stoneAt = 0;
  private quarryAcc = 0;
  private speakIn = -1;
  private spoken = false;
  private reminder = false;
  private stuck = 0;
  private nudges = 0;
  private stonesSaid = 0;
  private advisorsWere = false;
  private readonly chip: HTMLDivElement;
  private resumeEnd = false;
  private afterSaid = false;
  private lastGiven = 0;

  constructor(private readonly game: Game) {
    this.beacon = new Beacon(game);
    aoSkip(game, this.beacon.group);
    this.chip = document.createElement('div');
    this.chip.className = 'pj-chip nexus-chip';
    this.chip.innerHTML = '<span class="pj-ic">◯</span><span class="pj-nm">The Nexus</span><span class="pj-pc"></span><span class="pj-mini"><i></i></span>';
    this.chip.style.display = 'none';
    this.chip.onclick = () => {
      if (!this.site) return;
      game.godCam.flyTo(this.site.pos.x, this.site.pos.z);
      game.godCam.setDistance(120);
      game.audio.click();
    };
    (game.hud.root.querySelector('.pj-layer') ?? game.hud.root).appendChild(this.chip);

    // Every prayer answered and every gift given, in any village, carries the Nexus on.
    game.events.on('prayerAnswered', ({ kind, village }) => {
      if (this.phase !== 'ring' || kind === 'project' || !this.site) return;
      const res = this.mostWanted();
      if (res) this.send(village, res, PRAYER_GIFT);
    });
    game.events.on('gift', ({ village, kind, amount }) => {
      if (this.phase !== 'ring' || !this.site) return;
      const a = Math.min(GIFT_CAP, amount * GIFT_SHARE);
      if (a >= 1 && this.site.open(kind) > 0.5) this.send(village, kind, a);
    });
  }

  private get endings(): Endings | null {
    return (this.game as unknown as { endings?: Endings }).endings ?? null;
  }

  private get advisors(): Advisors | null {
    return (this.game as unknown as { prayerSystem?: { advisors?: Advisors } }).prayerSystem?.advisors ?? null;
  }

  private get ora(): { guide(t: string, o?: { clear?: boolean; goal?: boolean; first?: boolean }): void; guideBusy: boolean } | null {
    return (this.game as unknown as { ora?: { guide(t: string, o?: { clear?: boolean; goal?: boolean; first?: boolean }): void; guideBusy: boolean } }).ora ?? null;
  }

  get stones(): number {
    return this.site?.nexusVisual?.raised ?? 0;
  }

  /** Village names for the lines: the one nearest the Nexus first. */
  private names(): string[] {
    const s = this.site?.pos ?? new THREE.Vector3();
    return [...this.game.villages].sort((a, b) => a.center.distanceTo(s) - b.center.distanceTo(s)).map((v) => v.name);
  }

  private ctx(reminder = false): NexusCtx {
    const n = this.names();
    return { stones: this.stones, near: n[0] ?? 'Ashford', others: [n[1] ?? 'Brambleholt', n[2] ?? 'Stonemere'], reminder };
  }

  /** The current goal in Ora's words (the reminder orb says it again), or null. */
  goalLine(): string | null {
    return this.phase === 'ring' && this.spoken ? ORA.lead(this.ctx(true)) : null;
  }

  // ------------------------------------------------------------- the site

  /**
   * The heart of the island: where the three villages' roads would meet. The flat, dry ground that is nearest to all
   * three (least summed distance), clear of their houses and fields, gentle enough for the dais and the plaza.
   */
  findHeart(): { x: number; y: number; z: number } | null {
    const g = this.game;
    const vs = g.villages;
    const cx = vs.reduce((s, v) => s + v.center.x, 0) / vs.length;
    const cz = vs.reduce((s, v) => s + v.center.z, 0) / vs.length;
    let best: { x: number; y: number; z: number; score: number } | null = null;
    for (const relax of [0, 1]) {
      for (let x = cx - 200; x <= cx + 200; x += 7) {
        for (let z = cz - 200; z <= cz + 200; z += 7) {
          if (!g.terrain.isLand(x, z, 2)) continue;
          if (vs.some((v) => Math.hypot(v.center.x - x, v.center.z - z) < v.radius * 1.25 + 36)) continue;
          let dLo = Infinity;
          let dHi = -Infinity;
          let pLo = Infinity;
          let pHi = -Infinity;
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            for (const r of [0, 6, 11, DAIS_R + 1.5, 24, 32]) {
              const h = g.terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
              if (r <= DAIS_R + 1.5) {
                dLo = Math.min(dLo, h);
                dHi = Math.max(dHi, h);
              }
              pLo = Math.min(pLo, h);
              pHi = Math.max(pHi, h);
            }
          }
          if (pLo < SEA_LEVEL + 2 || dHi > 46) continue;
          if (dHi - dLo > (relax ? 6.5 : 5) || pHi - pLo > (relax ? 16 : 12)) continue;
          // Near all three (least summed distance), and not tucked against one of them (the farthest counts too).
          const ds = vs.map((v) => Math.hypot(v.center.x - x, v.center.z - z));
          const sum = ds.reduce((a, b) => a + b, 0);
          const score = sum + Math.max(...ds) * 0.6 + (dHi - dLo) * 12 + (pHi - pLo) * 4;
          if (!best || score < best.score) best = { x, y: dHi - 0.3, z, score };
        }
      }
      if (best) break;
    }
    return best;
  }

  private nearestVillage(x: number, z: number): Village {
    const vs = this.game.villages;
    return [...vs].sort((a, b) => Math.hypot(a.center.x - x, a.center.z - z) - Math.hypot(b.center.x - x, b.center.z - z))[0];
  }

  /** Raise the site at (x, y, z): the ring, its light on the ground, the villages' builders. */
  private placeSite(x: number, y: number, z: number): Site {
    const g = this.game;
    // Rounded as the save rounds it, so a reloaded island plans exactly the same city round exactly the same spot.
    const r = (n: number) => Math.round(n * 100) / 100;
    x = r(x);
    y = r(y);
    z = r(z);
    const v = this.nearestVillage(x, z);
    // Clear the dais of trees and boulders.
    g.forEachNear(x, z, DAIS_R + 4, (e) => {
      if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) {
        g.fx.dust(e.pos.x, e.pos.y, e.pos.z, 6, 0.6);
        g.remove(e);
      }
    });
    // No decorative nature on it, and no grass through the stone.
    const land = (g as unknown as { land?: LandApi }).land;
    land?.clear((px, pz) => Math.hypot(px - x, pz - z) < DAIS_R + 5);
    land?.paint((p) => p.disc(x, z, DAIS_R + 2.4, CH_PATH, 1, 0.92));
    const site = new Site(v, DEFS.nexus, x, y, z, 0);
    site.onRemote = (from, res, amount) => this.launch(from, res, amount);
    g.add(site);
    v.obstacles.push({ pos: site.pos, radius: DAIS_R + 6 });
    g.extraLight.length = 0;
    g.extraLight.push(circle(x, z, LIGHT_R));
    const vis = site.nexusVisual!;
    vis.onStoneRise = (i) => this.stoneRose(i + 1);
    this.site = site;
    return site;
  }

  // ------------------------------------------------------------- the age

  /** Whole's card has closed (story mode): the last age begins. */
  afterWhole() {
    if (this.phase !== 'off') return;
    this.begin();
  }

  /** Begin the last age now: the site at the heart of the island, Ora's goal in a moment. */
  begin(): boolean {
    const g = this.game;
    const heart = this.findHeart();
    if (!heart) {
      console.warn('The Nexus found no ground at the heart of the island.');
      return false;
    }
    // The villages become one: any that had slipped away comes back for the last age (2026-10-18).
    for (const v of g.villages) if (v.owner !== 'player') v.convert(g);
    const site = this.placeSite(heart.x, heart.y, heart.z);
    this.phase = 'ring';
    this.stoneAt = g.time;
    for (const v of g.villages) if (v.owner === 'player') v.wonderSite = site;
    this.speakIn = BEGIN_SPEAK;
    this.spoken = false;
    this.reminder = false;
    g.fx.sparkle(site.pos.x, site.pos.y + 3, site.pos.z, 120, 0xfff0b0, DAIS_R);
    g.events.emit('nexusBegun', { x: site.pos.x, z: site.pos.z });
    g.saves.save('quiet');
    return true;
  }

  /** What the Nexus lacks most (by share), for a prayer's gift. */
  private mostWanted(): Res | null {
    const s = this.site;
    if (!s) return null;
    let best: Res | null = null;
    let bv = 0;
    for (const r of RES) {
      const need = s.def.needs[r];
      const open = s.open(r) / need;
      if (open > bv + 1e-6) {
        bv = open;
        best = r;
      }
    }
    return best;
  }

  /** Something from village `v` flies to the Nexus as a trail of light. */
  private send(v: Village, res: Res, amount: number) {
    const s = this.site;
    if (!s) return;
    const a = Math.min(amount, s.open(res));
    if (a < 0.5) return;
    s.pending[res] += a;
    this.launch(v, res, a);
  }

  private launch(from: Village, res: Res, amount: number) {
    const s = this.site!;
    const a = from.worship.pos;
    const f = new THREE.Vector3(a.x, a.y + 3, a.z);
    const t = new THREE.Vector3(s.pos.x, s.pos.y + 6, s.pos.z);
    const dist = f.distanceTo(t);
    this.motes.push({ from: f, to: t, t: 0, dur: 2.5 + dist / 55, res, amount, arc: 14 + dist * 0.14 });
    this.game.fx.sparkle(f.x, f.y, f.z, 14, MOTE_COLOR[res], 2);
  }

  private updateMotes(dt: number) {
    const g = this.game;
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const e = smoothstep(0, 1, k);
      this.tmp.lerpVectors(m.from, m.to, e);
      this.tmp.y += Math.sin(Math.PI * e) * m.arc;
      g.fx.sparkle(this.tmp.x, this.tmp.y, this.tmp.z, 2, MOTE_COLOR[m.res], 0.8);
      if (k >= 1) {
        this.motes.splice(i, 1);
        g.fx.sparkle(m.to.x, m.to.y, m.to.z, 30, MOTE_COLOR[m.res], 5);
        if (this.site) {
          g.audio.chime(this.site.pos);
          this.site.land(g, m.res, m.amount);
        }
      }
    }
  }

  private stoneRose(n: number) {
    const g = this.game;
    g.events.emit('nexusStone', { stones: n });
    const lines = STONE_LINES[n];
    if (lines && n > this.stonesSaid) this.advisors?.say(lines, { pri: 'important', topic: `nexus-stone-${n}`, cooldown: 0, argument: true });
    this.stonesSaid = Math.max(this.stonesSaid, n);
    this.stuck = 0;
  }

  /** The ring stands: its marks wake one by one round it, and the city is about to begin. */
  private raiseRing() {
    const g = this.game;
    const s = this.site!;
    s.complete = true;
    for (const r of RES) s.have[r] = s.def.needs[r];
    for (const v of g.villages) if (v.wonderSite === s) v.wonderSite = null;
    s.nexusVisual!.lit = 1;
    this.phase = 'city';
    this.cityT = -CITY_DELAY;
    this.telor = new Telor(g, s.pos);
    g.audio.wonderAwakens();
    g.fx.sparkle(s.pos.x, s.pos.y + 6, s.pos.z, 200, 0xfff0b0, DAIS_R);
    this.ora?.guide(ORA.ring, { clear: true });
    this.advisors?.say(RING_DONE, { pri: 'important', topic: 'nexus-ring', cooldown: 0, argument: true });
    g.godCam.flyTo(s.pos.x, s.pos.z);
    g.godCam.setDistance(Math.max(g.godCam.distance, 200));
    g.events.emit('nexusRaised', {});
    g.saves.save('quiet');
  }

  private cityStep(step: TelorStep) {
    const g = this.game;
    g.events.emit('telorStep', { step });
    if (step === 'roads') this.ora?.guide(ORA.roads);
    else if (step === 'built') this.ora?.guide(ORA.built, { clear: true });
    else {
      const lines = CITY_LINES(this.names())[step];
      if (lines) this.advisors?.say(lines, { pri: 'important', topic: `telor-${step}`, cooldown: 0, argument: true });
    }
  }

  // ------------------------------------------------------------- the true end

  private startTrueEnd() {
    const g = this.game;
    const en = this.endings;
    if (!en || !this.site || !this.telor) return;
    this.phase = 'lit';
    const a = this.advisors;
    if (a) {
      this.advisorsWere = a.muted;
      a.muted = true;
    }
    this.end = new TrueEnd(g, en.cine, this.site.nexusVisual!, this.telor, this.site.pos.clone(), () => en.legacy && downloadLegacy(en.legacy), () => this.toRpg());
    this.end.onDone = () => this.finish();
    this.end.begin();
    this.writeLegacy();
    g.events.emit('trueEnd', { phase: 'begin' });
  }

  /** The record for the RPG says Telor stands (optional field, for readers of the AGREED v1 record). */
  private writeLegacy() {
    const en = this.endings;
    if (!en?.legacy) return;
    (en.legacy as unknown as { telor?: unknown }).telor = { built: true, day: this.game.day };
    this.game.saves.save('quiet');
  }

  /** "Beyond the Nexus": the story is beaten and saved, and the next game takes it from here (its page on the studio site). */
  private toRpg() {
    const g = this.game;
    unlockFreePlay();
    this.phase = 'done';
    g.events.emit('trueEnd', { phase: 'done' });
    g.saves.save('quiet');
    window.location.href = RPG_URL;
  }

  /** After the card (staying on the island): it goes on, the city lit at night. Story mode is beaten: free play is open. */
  private finish() {
    const g = this.game;
    const en = this.endings;
    this.phase = 'done';
    unlockFreePlay();
    this.end?.dispose();
    if (en) {
      en.cine.setVeil(0);
      en.cine.end();
    }
    const a = this.advisors;
    if (a) a.muted = this.advisorsWere;
    this.end = null;
    if (this.telor) this.telor.gather = 0;
    g.audio.endingBreathe();
    g.events.emit('trueEnd', { phase: 'done' });
    g.saves.save('quiet');
  }

  // ------------------------------------------------------------- per step

  /** Simulation step (game seconds). */
  update(dt: number) {
    const g = this.game;
    if (!g.saves.armed) return;
    if (this.phase === 'ring') {
      const s = this.site;
      if (!s) return;
      this.updateMotes(dt);
      // Never stuck for good: the villages quarry a little stone themselves once your hand has been away a while.
      if (s.open('stone') > 0.5 && g.time - this.stoneAt > STONE_PATIENCE) {
        this.quarryAcc += dt;
        if (this.quarryAcc >= QUARRY_EVERY) {
          this.quarryAcc = 0;
          const v = g.villages[Math.floor(Math.random() * g.villages.length)];
          this.send(v, 'stone', QUARRY_STONE);
          this.stoneAt = g.time - STONE_PATIENCE; // keep the trickle going
        }
      }
      // Your hand gave something: the villages wait for you again before they quarry.
      if (s.given > this.lastGiven + 0.01) {
        this.lastGiven = s.given;
        this.stoneAt = g.time;
      }
      if (s.full && !s.complete) this.raiseRing();
    } else if (this.phase === 'city' && this.telor) {
      this.updateMotes(dt);
      const before = this.cityT;
      this.cityT += dt;
      if (this.cityT >= 0) this.telor.build(Math.min(this.cityT, CITY.built + 1));
      for (const st of STEPS) if (before < st.at && this.cityT >= st.at) this.cityStep(st.id);
      if (this.cityT >= CITY.built + END_DELAY) this.startTrueEnd();
    }
  }

  // ------------------------------------------------------------- per frame

  frame(dt: number) {
    const g = this.game;
    const s = this.site;
    const night = 1 - clamp(g.sky.daylight * 1.4, 0, 1);
    // Ora's goal, once the island has come up from black.
    if (this.phase === 'ring' && !this.spoken && this.speakIn >= 0) {
      if (!g.paused && !g.hud.helpOpen) this.speakIn -= dt;
      if (this.speakIn < 0) {
        this.spoken = true;
        this.ora?.guide(ORA.lead(this.ctx(this.reminder)), { goal: true, clear: true });
        if (!this.reminder) this.advisors?.say(BEGIN_LINES(this.ctx()), { pri: 'important', topic: 'nexus-begin', cooldown: 0, argument: true });
      }
    }
    // Stuck on the ring: a gentle re-nudge now and then.
    if (this.phase === 'ring' && this.spoken && !g.paused && !g.hud.helpOpen && !this.ora?.guideBusy) {
      this.stuck += dt;
      if (this.stuck >= (this.nudges >= 3 ? NUDGE_AFTER * 2 : NUDGE_AFTER)) this.nudge();
    }
    this.beacon.target(this.phase === 'ring' && s ? s.pos : null);
    this.beacon.frame(dt, this.phase === 'ring' && this.spoken && !g.hud.helpOpen);
    if (this.telor) this.telor.frame(dt, night);
    if (s && this.phase === 'done') {
      // The ring stays awake; the column comes back softly at night.
      const v = s.nexusVisual!;
      v.lit = 1;
      v.column = 0.3 * night;
    }
    if (this.end) this.end.frame(dt);
    if (this.resumeEnd) {
      this.resumeEnd = false;
      this.startTrueEnd();
    }
    // Back on the island after the true end: Lumi and Fizz have a word.
    if (this.phase === 'done' && !this.afterSaid && !this.end) {
      this.afterSaid = true;
      this.advisors?.say(AFTER_LINES, { pri: 'important', topic: 'nexus-after', cooldown: 0, argument: true });
    }
    this.frameChip();
  }

  /** Ora re-nudges the ring (also the debug handle). */
  nudge() {
    this.stuck = 0;
    this.ora?.guide(ORA.nudge(this.ctx(), this.nudges));
    this.nudges++;
    this.beacon.pulse();
    if (Math.random() < CHAT_CHANCE) this.advisors?.say(RING_CHAT[Math.floor(Math.random() * RING_CHAT.length)], { pri: 'chat', topic: 'nexus-chat', cooldown: 300 });
  }

  /** The chip over the Nexus while it rises: how many stones stand. */
  private frameChip() {
    const g = this.game;
    const s = this.site;
    const on = this.phase === 'ring' && !!s && !g.hud.helpOpen && this.spoken;
    if (!on) {
      this.chip.style.display = 'none';
      return;
    }
    const cam = g.godCam.camera;
    const world = this.proj.set(s.pos.x, s.pos.y + 20, s.pos.z);
    const dist = cam.position.distanceTo(world);
    world.project(cam);
    if (world.z > 1 || Math.abs(world.x) > 1.05 || Math.abs(world.y) > 1.05 || dist > 1500) {
      this.chip.style.display = 'none';
      return;
    }
    const x = (world.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-world.y * 0.5 + 0.5) * window.innerHeight;
    const scale = Math.max(0.7, Math.min(1.1, 260 / dist));
    this.chip.style.display = '';
    this.chip.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0) scale(${scale})`;
    this.chip.children[2].textContent = `${this.stones} of ${MARK_COUNT}`;
    (this.chip.children[3].firstElementChild as HTMLElement).style.width = `${Math.round(s.fraction * 100)}%`;
    this.chip.title = `The Nexus: ${s.progressText()}`;
  }

  // ------------------------------------------------------------- save / load

  save(): NexusSave | null {
    if (this.phase === 'off' || !this.site) return null;
    const s = this.site;
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      v: 1,
      phase: this.phase,
      x: r(s.pos.x),
      y: r(s.pos.y),
      z: r(s.pos.z),
      // What has arrived (light still flying in is let go: a reload stands exactly where it stood, the same stones up).
      have: RES.map((k) => r(Math.min(s.def.needs[k], s.have[k]))) as [number, number, number],
      given: r(s.given),
      cityT: r(this.cityT),
      stoneAt: r(this.stoneAt),
    };
  }

  load(data: unknown) {
    const d = data as Partial<NexusSave> | null;
    if (!d || typeof d !== 'object' || d.v !== 1 || !d.phase || d.phase === 'off') return;
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
    const g = this.game;
    const site = this.placeSite(d.x, d.y, d.z);
    const vis = site.nexusVisual!;
    RES.forEach((k, i) => (site.have[k] = Math.min(site.def.needs[k], d.have?.[i] ?? 0)));
    site.given = d.given ?? 0;
    site.shown = site.fraction;
    this.stoneAt = typeof d.stoneAt === 'number' ? d.stoneAt : g.time;
    this.lastGiven = site.given;
    this.phase = d.phase;
    if (d.phase === 'ring') {
      // The stones that stood, stand (no rising again, no lines again).
      vis.stones.forEach((st, i) => {
        if (site.fraction >= NexusVisual.threshold(i)) {
          st.want = 1;
          st.up = 1;
          st.dusted = true;
        }
      });
      this.stonesSaid = vis.raised;
      for (const v of g.villages) if (v.owner === 'player') v.wonderSite = site;
      this.speakIn = BEGIN_SPEAK;
      this.reminder = true;
      return;
    }
    // The ring stands.
    site.complete = true;
    for (const r of RES) site.have[r] = site.def.needs[r];
    vis.standAll();
    vis.lit = 1;
    this.stonesSaid = MARK_COUNT;
    this.telor = new Telor(g, site.pos);
    this.cityT = d.phase === 'city' ? (d.cityT ?? 0) : CITY.built + END_DELAY;
    this.telor.build(Math.max(0, Math.min(this.cityT, CITY.built + 1)), true);
    if (d.phase === 'lit') this.resumeEnd = true; // the true end was cut off: play it again from its start
    else if (d.phase === 'done') this.afterSaid = true;
  }

  // ------------------------------------------------------------- debug

  /**
   * Debug/test: 'nexus' starts the last age on this island now (every village yours, every temple standing, Vexahl
   * whole); 'stone' brings in enough for the next stone; 'ring' finishes the ring; 'city' jumps Telor's build to `t`
   * game seconds (default: the next step); 'built' finishes Telor (the true end follows); 'end' plays the true end now.
   */
  debug(kind: 'nexus' | 'stone' | 'ring' | 'city' | 'built' | 'end', t?: number): string {
    const g = this.game;
    if (kind === 'nexus') {
      if (this.phase !== 'off') return `already: ${this.phase}`;
      const sh = (g as unknown as { shrines?: { setStage(v: Village, s: string, quiet?: boolean): void } }).shrines;
      for (const v of g.villages) if (v.owner !== 'player') v.convert(g);
      for (const v of g.villages) sh?.setStage(v, 'temple', true);
      const r = (g as unknown as { rival?: { reintegrate(): void; isle: { setPresent(p: boolean, now: boolean): void } } }).rival;
      r?.reintegrate();
      r?.isle.setPresent(false, true);
      const en = this.endings;
      if (en && en.phase === 'play') en.phase = 'after';
      return this.begin() ? 'ring' : 'no site';
    }
    const s = this.site;
    if (!s) return 'off';
    if (kind === 'stone' && this.phase === 'ring') {
      const next = Math.min(MARK_COUNT - 1, this.stones);
      const f = NexusVisual.threshold(next) + 0.005;
      for (const r of RES) s.have[r] = Math.max(s.have[r], Math.min(s.def.needs[r], s.def.needs[r] * f));
      return `${next + 1} of ${MARK_COUNT}`;
    }
    if (kind === 'ring' && this.phase === 'ring') {
      for (const r of RES) s.have[r] = s.def.needs[r];
      return 'ring';
    }
    if (kind === 'city' && this.phase === 'city' && this.telor) {
      const next = STEPS.find((st) => st.at > this.cityT + 0.01);
      const to = t ?? next?.at ?? CITY.built;
      this.cityT = Math.max(this.cityT, to - 0.05);
      return `city ${this.cityT.toFixed(1)}`;
    }
    if (kind === 'built' && this.phase === 'city') {
      this.cityT = Math.max(this.cityT, CITY.built - 0.05);
      return 'built';
    }
    if (kind === 'end' && (this.phase === 'city' || this.phase === 'done') && this.telor) {
      this.telor.build(CITY.built + 1, true);
      this.cityT = CITY.built + END_DELAY;
      this.startTrueEnd();
      return 'lit';
    }
    return `nothing to do in ${this.phase}`;
  }

  /** Debug/test: where the age stands. */
  state() {
    const s = this.site;
    return {
      phase: this.phase,
      site: s ? { x: Math.round(s.pos.x), y: Math.round(s.pos.y * 10) / 10, z: Math.round(s.pos.z), fraction: Math.round(s.fraction * 1000) / 1000, have: { ...s.have }, needs: { ...s.def.needs }, given: Math.round(s.given) } : null,
      stones: this.stones,
      spoken: this.spoken,
      cityT: Math.round(this.cityT * 10) / 10,
      step: this.telor ? this.telor.stepAt(this.cityT) : null,
      city: this.telor ? this.telor.counts() : null,
      end: this.end ? { t: Math.round(this.end.t * 10) / 10, card: this.end.cardUp } : null,
      column: s?.nexusVisual ? Math.round(s.nexusVisual.column * 100) / 100 : 0,
      gather: this.telor ? Math.round(this.telor.gather * 100) / 100 : 0,
      motes: this.motes.length,
      beacon: this.beacon.at,
    };
  }
}
