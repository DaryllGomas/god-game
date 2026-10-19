import * as THREE from 'three';
import type { Game } from '../Game';
import type { Entity } from '../entities/Entity';
import type { Advisors, Line } from '../prayers/Advisors';
import type { NexusAge } from '../nexus/NexusAge';
import type { Seasons } from '../seasons/Seasons';
import { SEASON_IDS, type SeasonId } from '../seasons/data';
import { clamp } from '../util/math';
import { Boat, type BoatPhase } from './Boat';
import { CELEBRATE, FestivalKit, type FestPhase } from './Festival';
import { Growth, type GrowItem } from './Growth';
import { Newcomers, type FamilySave } from './Newcomers';
import { People, TUNICS } from './People';
import { ASK_LINES, FESTIVALS, FIRST_BOAT, FIRST_GARDEN, FIRST_HOME, LATER_BOAT, ORA_ASK, PARTY_LINES, PAST_WALLS } from './lines';
import './after.css';

// ------------------------------------------------------------------ tuning knobs

/** Game seconds after you stay on the island before Telor asks for its first festival. */
const FIRST_ASK = 75;
/** Each season Telor asks on this day of the season, at this hour (0.25 sunrise, 0.5 noon, 0.75 sunset). */
const ASK_DAY = 2;
const ASK_HOUR: Record<SeasonId, number> = { spring: 0.3, summer: 0.3, autumn: 0.6, winter: 0.6 };
/** Lantern Night and Midwinter Fire wait for dark once granted; the day festivals begin after a breath. */
const NIGHT_FESTIVALS = new Set<SeasonId>(['autumn', 'winter']);
/** Dark enough for the night festivals: from a little before sunset (0.75) to a little after sunrise (0.25). */
const DUSK = 0.735;
const DAWN = 0.24;
const READY_BEAT = 4;
/** Real seconds after a festival is asked before Ora says so (the moment lands first). */
const SPEAK_AFTER = 3;
/** Within this far of the Nexus is "in Telor" (m); the city's own growth pushes it out. */
const CITY_R = 106;
/** Tending (answered prayers, gifts, rain, festivals) banks care; each step of growth spends one. At most this much. */
const CARE_MAX = 3;
const CARE = { prayer: 1, gift: 0.5, rain: 0.3, telor: 1, festival: 2 };
/** Game seconds between steps of growth at the most (sooner while a family waits for a house). */
const GROW_GAP = 75;
const GROW_GAP_FAMILY = 35;
/** Boats: the first a while after you stay, then now and then, never while two families are still waiting. */
const FIRST_BOAT_AT = 200;
const BOAT_EVERY = 420;
const BOAT_JITTER = 160;
const MAX_WAITING = 2;
/** A celebration lifts every village of yours a little. */
const PARTY_BELIEF = 6;
/** Chance a later boat brings a word from Fizz. */
const BOAT_CHAT = 0.35;

interface Fest {
  kind: SeasonId;
  key: number;
  phase: FestPhase;
  /** Game seconds into the phase. */
  t: number;
}

interface AfterSave {
  v: 1;
  doneKey: number;
  firstAsk: boolean;
  firstAskAt: number;
  fest: Fest | null;
  care: number;
  lastGrow: number;
  grown: number;
  boat: { phase: BoatPhase; t: number; stripe: number } | null;
  nextBoatAt: number;
  boats: number;
  families: FamilySave[];
  said: string[];
  /** Feast food still to be cleared (a save in the half second after it was given; Codex review 2026-10-18). */
  piles?: { x: number; z: number; at: number }[];
}

/**
 * AFTER THE TRUE END (Daryll, 2026-10-18): "a couple of interesting things to do if you just want to keep playing,
 * without getting too crazy about it ... just to close it out. Some sort of loop." Earlier: "if you continue playing,
 * then the game will just be to maintain them ... it'll be more of like an ambient experience from there. No real end."
 *
 * Story mode only, once the true end is done and you stay on the island (src/nexus, phase 'done'):
 *   Seasons in Telor   Each season the city holds a celebration and asks you for one thing: Blossom Day (rain), the
 *                      Harvest Feast (food), Lantern Night (timber), Midwinter Fire (a spark of fire). Ora names it,
 *                      once. Give it in Telor and the celebration plays round the Nexus (src/after/Festival.ts). If it
 *                      is never given, it simply passes when the next season's comes.
 *   The city grows     While you tend the island (answer prayers, give gifts, send rain, keep the festivals), Telor adds
 *                      a lane, a house or a garden at its edge now and then (src/after/Growth.ts). Now and then a boat
 *                      of newcomers comes in to the shore and the family walks up to where their house will stand
 *                      (src/after/Boat.ts, Newcomers.ts). Neglect it and it stops growing: nobody leaves, nothing is
 *                      lost. No pressure, no fail state, no ending.
 * Saved on its own (plugin 'after'); an island saved mid-season or mid-growth reloads where it was. Old saves load
 * unchanged (an island already past the true end starts the loop from where it stands).
 */
export class AfterLoop {
  private growth: Growth | null = null;
  private boat: Boat | null = null;
  private newcomers: Newcomers | null = null;
  private kit: FestivalKit | null = null;
  private people: People | null = null;
  private readonly group = new THREE.Group();
  private started = false;
  private pending: AfterSave | null = null;
  doneKey = -1;
  private firstAsk = true;
  private firstAskAt = 0;
  fest: Fest | null = null;
  care = 0;
  /** Where the care came from (for tests). */
  private readonly careFrom = { prayer: 0, gift: 0, rain: 0, telor: 0, festival: 0 };
  private lastGrow = -1e9;
  private nextBoatAt = 0;
  private boats = 0;
  private readonly said = new Set<string>();
  private readonly lineQueue: { lines: Line[]; topic: string; chat: boolean; until: number }[] = [];
  /** Seconds of play (not paused) that queued lines have waited by. */
  private lineClock = 0;
  /** What has been said (topics), for tests. */
  private readonly voiced: string[] = [];
  private spoken = false;
  private speakIn = -1;
  private reminder = false;
  private partySaid = false;
  private alignFix = 0;
  private readonly piles: { x: number; z: number; at: number }[] = [];
  private readonly chip: HTMLDivElement;
  private readonly proj = new THREE.Vector3();
  private wasActive = false;

  constructor(private readonly game: Game) {
    this.group.name = 'after-loop';
    game.scene.add(this.group);
    this.chip = document.createElement('div');
    this.chip.className = 'pj-chip after-chip';
    this.chip.innerHTML = '<span class="pj-ic"></span><span class="pj-nm"></span><span class="pj-pc"></span>';
    this.chip.style.display = 'none';
    this.chip.onclick = () => {
      const c = this.center;
      if (!c) return;
      game.godCam.flyTo(c.x, c.z);
      game.godCam.setDistance(150);
      game.audio.click();
    };
    (game.hud.root.querySelector('.pj-layer') ?? game.hud.root).appendChild(this.chip);

    // Tending the island banks a little care; the city grows on it.
    game.events.on('prayerAnswered', ({ kind }) => {
      if (this.active && kind !== 'project') this.addCare(CARE.prayer, 'prayer');
    });
    game.events.on('gift', () => {
      if (this.active) this.addCare(CARE.gift, 'gift');
    });
    game.events.on('rainedOn', () => {
      if (this.active) this.addCare(CARE.rain, 'rain');
    });
    // What Telor asked for, given in Telor.
    game.events.on('miracle', ({ id, x, z }) => {
      if (!this.active || !this.inCity(x, z)) return;
      const want = this.fest?.phase === 'asked' ? FESTIVALS[this.fest.kind].ask : null;
      const match = (id === 'water' && want === 'rain') || (id === 'food' && want === 'food') || (id === 'fire' && want === 'fire');
      if (match) {
        // A fireball that lights the midwinter fires is a gift, not a blow.
        if (id === 'fire') this.alignFix += 0.03;
        if (id === 'food') this.piles.push({ x, z, at: game.time + 0.5 });
        this.grant();
      } else if (id !== 'fire') this.addCare(CARE.telor * 0.5, 'telor');
    });
    game.events.on('place', ({ entity, x, z }) => this.delivered(entity, x, z));
    game.events.on('landed', ({ entity }) => this.delivered(entity, entity.pos.x, entity.pos.z));
  }

  // ---------------------------------------------------------------- context

  private get nexus(): NexusAge | null {
    return (this.game as unknown as { nexus?: NexusAge }).nexus ?? null;
  }

  private get advisors(): Advisors | null {
    return (this.game as unknown as { prayerSystem?: { advisors?: Advisors } }).prayerSystem?.advisors ?? null;
  }

  private get ora(): { guide(t: string, o?: { clear?: boolean; goal?: boolean }): void } | null {
    return (this.game as unknown as { ora?: { guide(t: string, o?: { clear?: boolean; goal?: boolean }): void } }).ora ?? null;
  }

  private get seasons(): Seasons {
    return (this.game as unknown as { seasons: Seasons }).seasons;
  }

  /** Story mode, the true end done, staying on the island. */
  get active(): boolean {
    const g = this.game as unknown as { pace?: { story: boolean } };
    const n = this.nexus;
    return !!g.pace?.story && !!n && n.phase === 'done' && !!n.telor && this.game.saves.armed;
  }

  private get center(): THREE.Vector3 | null {
    return this.nexus?.telor?.center ?? null;
  }

  private inCity(x: number, z: number): boolean {
    const c = this.center;
    if (!c) return false;
    return Math.hypot(x - c.x, z - c.z) < Math.max(CITY_R, this.growth?.reach ?? 0);
  }

  private keyNow(): number {
    const s = this.seasons;
    return (s.year - 1) * 4 + SEASON_IDS.indexOf(s.season);
  }

  /** Lumi and Fizz say `lines` as soon as they can (another moment may hold the stage a while; a line waits for it). */
  private say(lines: Line[], topic: string, chat = false) {
    this.lineQueue.push({ lines, topic, chat, until: this.lineClock + (chat ? 25 : 60) });
  }

  private flushLines(dt: number) {
    const a = this.advisors;
    const q = this.lineQueue[0];
    if (!a || !q || a.muted) return;
    this.lineClock += dt;
    if (this.lineClock > q.until) {
      this.lineQueue.shift();
      return;
    }
    if (a.say(q.lines, q.chat ? { pri: 'chat', topic: q.topic, cooldown: 600 } : { pri: 'important', topic: q.topic, cooldown: 0, argument: true })) {
      this.lineQueue.shift();
      this.voiced.push(q.topic);
    }
  }

  private once(id: string): boolean {
    if (this.said.has(id)) return false;
    this.said.add(id);
    return true;
  }

  private addCare(n: number, from: keyof typeof CARE) {
    this.care = Math.min(CARE_MAX, this.care + n);
    this.careFrom[from] += n;
  }

  // ---------------------------------------------------------------- set up

  /** The loop's pieces, made the first time it runs (Telor stands by then). */
  private ensure(): boolean {
    if (this.started) return true;
    const telor = this.nexus?.telor;
    if (!telor) return false;
    const g = this.game;
    this.people = new People(this.group, 30);
    this.boat = new Boat(g, telor.center);
    this.growth = new Growth(g, telor, this.boat.landing?.shore ?? null);
    this.newcomers = new Newcomers(g, this.people, this.growth, this.boat, telor.center);
    this.kit = new FestivalKit(g, telor, this.people);
    this.growth.onBuilt = (it, i) => this.built(it, i);
    this.newcomers.onHome = () => {
      g.events.emit('telorBoat', { phase: 'home' });
      if (this.once('home')) this.say(FIRST_HOME, 'after-home');
    };
    this.started = true;
    const d = this.pending;
    this.pending = null;
    if (d) this.restore(d);
    else this.fresh();
    return true;
  }

  /** The first time: the season's festival a little after you stay, the first boat a while after that. */
  private fresh() {
    const g = this.game;
    this.doneKey = this.keyNow() - 1;
    this.firstAsk = true;
    this.firstAskAt = g.time + FIRST_ASK;
    this.nextBoatAt = g.time + FIRST_BOAT_AT;
  }

  // ---------------------------------------------------------------- the festivals

  private ask(kind: SeasonId, key: number) {
    const g = this.game;
    this.fest = { kind, key, phase: 'asked', t: 0 };
    this.firstAsk = false;
    this.spoken = false;
    this.reminder = false;
    this.partySaid = false;
    this.speakIn = SPEAK_AFTER;
    g.events.emit('telorFestival', { kind, phase: 'asked' });
    g.saves.save('quiet');
  }

  /** What Telor asked for has come. */
  private grant() {
    const f = this.fest;
    if (!f || f.phase !== 'asked') return;
    const g = this.game;
    const c = this.center!;
    f.phase = 'ready';
    f.t = 0;
    this.addCare(CARE.festival, 'festival');
    g.fx.sparkle(c.x, c.y + 4, c.z, 140, 0xfff0b0, 26);
    g.audio.projectDone();
    // The ask is answered: Ora need not say it again.
    this.ora?.guide('', { clear: true });
    g.events.emit('telorFestival', { kind: f.kind, phase: 'granted' });
    g.saves.save('quiet');
  }

  private begin() {
    const f = this.fest!;
    f.phase = 'on';
    f.t = 0;
    this.partySaid = false;
    const c = this.center!;
    this.game.audio.festivalChimes(c);
    this.game.events.emit('telorFestival', { kind: f.kind, phase: 'begun' });
    this.game.saves.save('quiet');
  }

  private over() {
    const g = this.game;
    const f = this.fest!;
    this.doneKey = Math.max(this.doneKey, f.key);
    for (const v of g.villages) if (v.owner === 'player') v.belief = Math.min(100, v.belief + PARTY_BELIEF);
    this.fest = null;
    g.events.emit('telorFestival', { kind: f.kind, phase: 'over' });
    g.saves.save('quiet');
  }

  private get dark(): boolean {
    const h = this.game.dayTime;
    return h >= DUSK || h < DAWN;
  }

  /** Is it Telor's day to ask this season? */
  private askDue(): boolean {
    const s = this.seasons;
    return s.dayOfSeason > ASK_DAY || (s.dayOfSeason === ASK_DAY && this.game.dayTime >= ASK_HOUR[s.season]);
  }

  private updateFestival(dt: number) {
    const g = this.game;
    const key = this.keyNow();
    const f = this.fest;
    if (!f) {
      if (key <= this.doneKey) return;
      if (this.firstAsk ? g.time >= this.firstAskAt : this.askDue()) this.ask(this.seasons.season, key);
      return;
    }
    if (f.phase === 'asked') {
      // Never given: it passes quietly when the next season's festival comes round.
      if (key > f.key && this.askDue()) {
        this.doneKey = f.key;
        this.fest = null;
        g.events.emit('telorFestival', { kind: f.kind, phase: 'lapsed' });
        this.ora?.guide('', { clear: true });
      }
      return;
    }
    f.t += dt;
    if (f.phase === 'ready') {
      if (NIGHT_FESTIVALS.has(f.kind) ? this.dark : f.t >= READY_BEAT) this.begin();
      return;
    }
    // Celebrating.
    if (!this.partySaid) {
      const due = f.kind === 'winter' ? this.kit?.firstBurst : f.t >= 8;
      if (due) {
        this.partySaid = true;
        this.say(PARTY_LINES[f.kind], `after-party-${f.kind}`);
      }
    }
    if (f.t >= CELEBRATE) this.over();
  }

  /** Something carried or thrown into Telor: timber or food for the festival that asked for it. */
  private delivered(e: Entity, x: number, z: number) {
    if (!this.active || !this.fest || this.fest.phase !== 'asked' || !this.inCity(x, z)) return;
    const want = FESTIVALS[this.fest.kind].ask;
    const timber = (e.kind === 'tree' || e.kind === 'wood') && want === 'timber';
    const food = e.kind === 'food' && want === 'food';
    if (!timber && !food) return;
    const g = this.game;
    // The people carry it off to the plaza.
    g.fx.sparkle(e.pos.x, e.pos.y + 2, e.pos.z, 40, timber ? 0xe8b070 : 0xffe28a, 4);
    g.fx.dust(e.pos.x, e.pos.y, e.pos.z, 8, 0.8);
    g.audio.chime(e.pos, 1.3);
    if (!e.held) g.remove(e);
    this.grant();
  }

  // ---------------------------------------------------------------- growth and boats

  private built(it: GrowItem, step: number) {
    const g = this.game;
    g.events.emit('telorGrew', { kind: it.kind, step });
    if (it.kind === 'house' && this.once('walls')) this.say(PAST_WALLS, 'after-walls');
    else if (it.kind === 'garden' && this.once('garden')) this.say(FIRST_GARDEN, 'after-garden', true);
  }

  private updateGrowth(dt: number) {
    const g = this.game;
    const gr = this.growth!;
    gr.update(dt);
    const waiting = this.newcomers!.waiting > 0;
    if (!gr.busy && gr.next && this.care >= 1 && g.time - this.lastGrow >= (waiting ? GROW_GAP_FAMILY : GROW_GAP)) {
      if (gr.start()) {
        this.care -= 1;
        this.lastGrow = g.time;
      }
    }
  }

  private sendBoat(): boolean {
    const b = this.boat!;
    const nc = this.newcomers!;
    if (b.phase !== 'off' || !b.landing || nc.waiting >= MAX_WAITING) return false;
    const f = nc.embark(Math.random() < 0.5 ? 3 : 4);
    b.sail(TUNICS[f.looks[0]]);
    this.boats++;
    this.game.events.emit('telorBoat', { phase: 'sailing' });
    if (this.once('boat')) this.say(FIRST_BOAT, 'after-boat');
    else if (Math.random() < BOAT_CHAT) this.say(LATER_BOAT, 'after-boat-later', true);
    return true;
  }

  private updateBoats(dt: number) {
    const g = this.game;
    const b = this.boat!;
    if (b.phase === 'off' && g.time >= this.nextBoatAt) {
      this.sendBoat();
      this.nextBoatAt = g.time + BOAT_EVERY + Math.random() * BOAT_JITTER;
    }
    if (b.update(dt) === 'moored') {
      for (const f of this.newcomers!.families) if (f.phase === 'boat') this.newcomers!.land(f);
      g.events.emit('telorBoat', { phase: 'landed' });
    }
    this.newcomers!.update(dt);
  }

  // ---------------------------------------------------------------- per step

  /** Simulation step (game seconds). */
  update(dt: number) {
    if (!this.active || !this.ensure()) return;
    const g = this.game;
    if (this.alignFix) {
      g.player.shiftAlignment(this.alignFix);
      this.alignFix = 0;
    }
    // Food the feast asked for, lying where it fell: carried off to the tables.
    for (let i = this.piles.length - 1; i >= 0; i--) {
      const p = this.piles[i];
      if (g.time < p.at) continue;
      this.piles.splice(i, 1);
      g.forEachNear(p.x, p.z, 8, (e) => {
        if (e.kind === 'food' && !e.held) {
          g.fx.sparkle(e.pos.x, e.pos.y + 1, e.pos.z, 8, 0xffe28a, 2);
          g.remove(e);
        }
      });
    }
    this.updateFestival(dt);
    this.updateGrowth(dt);
    this.updateBoats(dt);
  }

  /** Per frame (real seconds). */
  frame(dt: number) {
    const g = this.game;
    const on = this.active && this.started;
    if (!on) {
      if (this.wasActive) {
        // The true end played again, say: the loop's people and boat step out of the picture until it is over.
        this.kit?.hide();
        this.chip.style.display = 'none';
        this.group.visible = false;
        if (this.boat) this.boat.group.visible = false;
      }
      this.wasActive = false;
      return;
    }
    this.wasActive = true;
    this.group.visible = true;
    const night = 1 - clamp(g.sky.daylight * 1.4, 0, 1);
    const running = !g.paused && !g.hud.helpOpen;
    const f = this.fest;
    // Ora names what the festival is short of, once the moment has landed.
    if (f && f.phase === 'asked' && !this.spoken && this.speakIn >= 0) {
      if (running) this.speakIn -= dt;
      if (this.speakIn < 0) {
        this.spoken = true;
        this.ora?.guide(ORA_ASK[f.kind], { goal: true });
        if (!this.reminder) this.say(ASK_LINES[f.kind], `after-ask-${f.kind}`);
      }
    }
    if (f) this.kit!.frame(f.kind, f.phase, f.t, night, running ? dt * g.speed : 0);
    else this.kit!.hide();
    this.boat!.frame(running ? dt * g.speed : 0, night);
    this.newcomers!.frame();
    this.growth!.frame(night);
    this.people!.flush();
    if (running) this.flushLines(dt);
    this.frameChip();
  }

  /** Ora's reminder: what this festival is short of (the reminder orb says it again), or null. */
  goalLine(): string | null {
    return this.active && this.fest?.phase === 'asked' && this.spoken ? ORA_ASK[this.fest.kind] : null;
  }

  /** A small chip over the Nexus while a festival is asked or under way: its sign, its name, what it wants. */
  private frameChip() {
    const g = this.game;
    const f = this.fest;
    const c = this.center;
    if (!f || !c || g.hud.helpOpen || (f.phase === 'asked' && !this.spoken)) {
      this.chip.style.display = 'none';
      return;
    }
    const cam = g.godCam.camera;
    const world = this.proj.set(c.x, c.y + 24, c.z);
    const dist = cam.position.distanceTo(world);
    world.project(cam);
    if (world.z > 1 || Math.abs(world.x) > 1.05 || Math.abs(world.y) > 1.05 || dist > 1500) {
      this.chip.style.display = 'none';
      return;
    }
    const info = FESTIVALS[f.kind];
    const x = (world.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-world.y * 0.5 + 0.5) * window.innerHeight;
    const scale = Math.max(0.7, Math.min(1.1, 260 / dist));
    this.chip.style.display = '';
    this.chip.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0) scale(${scale})`;
    const state = f.phase === 'asked' ? info.askIcon : f.phase === 'ready' ? (NIGHT_FESTIVALS.has(f.kind) ? '☾' : '♪') : '♪';
    if (this.chip.dataset.k !== `${f.kind}:${f.phase}`) {
      this.chip.dataset.k = `${f.kind}:${f.phase}`;
      this.chip.children[0].textContent = info.icon;
      this.chip.children[1].textContent = info.name;
      this.chip.children[2].textContent = state;
      this.chip.classList.toggle('on', f.phase !== 'asked');
      this.chip.title = f.phase === 'asked' ? ORA_ASK[f.kind] : info.name;
    }
  }

  // ---------------------------------------------------------------- save / load

  save(): AfterSave | null {
    if (!this.started) return this.pending;
    const r = (n: number) => Math.round(n * 100) / 100;
    const b = this.boat!;
    return {
      v: 1,
      doneKey: this.doneKey,
      firstAsk: this.firstAsk,
      firstAskAt: r(this.firstAskAt),
      fest: this.fest ? { ...this.fest, t: r(this.fest.t) } : null,
      care: r(this.care),
      lastGrow: r(Math.max(this.lastGrow, -1e6)),
      // A step that was rising stands on a reload.
      grown: this.growth!.done + (this.growth!.busy ? 1 : 0),
      boat: b.phase === 'off' ? null : { phase: b.phase, t: r(b.t), stripe: b.stripe },
      nextBoatAt: r(this.nextBoatAt),
      boats: this.boats,
      families: this.newcomers!.save(),
      said: [...this.said],
      piles: this.piles.map((p) => ({ x: r(p.x), z: r(p.z), at: r(p.at) })),
    };
  }

  load(data: unknown) {
    const d = data as Partial<AfterSave> | null;
    if (!d || typeof d !== 'object' || d.v !== 1) return;
    this.pending = d as AfterSave;
    // Telor stands already (the last age loaded first): pick up where it was now.
    if (this.active) this.ensure();
  }

  private restore(d: AfterSave) {
    const g = this.game;
    this.doneKey = typeof d.doneKey === 'number' ? d.doneKey : this.keyNow() - 1;
    this.firstAsk = !!d.firstAsk;
    this.firstAskAt = d.firstAskAt ?? g.time;
    this.care = clamp(d.care ?? 0, 0, CARE_MAX);
    this.lastGrow = d.lastGrow ?? -1e9;
    this.nextBoatAt = d.nextBoatAt ?? g.time + FIRST_BOAT_AT;
    this.boats = d.boats ?? 0;
    for (const s of d.said ?? []) this.said.add(s);
    for (const p of d.piles ?? []) this.piles.push({ x: p.x, z: p.z, at: p.at });
    this.growth!.buildTo(d.grown ?? 0);
    const f = d.fest;
    if (f && SEASON_IDS.includes(f.kind) && (f.phase === 'asked' || f.phase === 'ready' || f.phase === 'on')) {
      this.fest = { kind: f.kind, key: f.key, phase: f.phase, t: f.t ?? 0 };
      // An open ask: Ora says it again in a moment (no second word from Lumi or Fizz).
      this.spoken = false;
      this.reminder = true;
      this.speakIn = SPEAK_AFTER;
      this.partySaid = f.phase === 'on' && (f.t ?? 0) > 12;
    }
    this.newcomers!.load(d.families ?? []);
    const boating = this.newcomers!.families.filter((x) => x.phase === 'boat');
    if (d.boat && d.boat.phase !== 'off' && this.boat!.landing) {
      this.boat!.sail(d.boat.stripe, d.boat.t);
      this.boat!.phase = d.boat.phase;
      if (d.boat.phase !== 'in') for (const x of boating) this.newcomers!.land(x);
    } else for (const x of boating) this.newcomers!.land(x);
  }

  // ---------------------------------------------------------------- debug

  /**
   * Debug/test: 'festival' asks this season's festival now (or `arg`'s: 'spring' ... 'winter'); 'grant' gives what it
   * asked for; 'celebrate' starts it now (a night one without waiting for dark), or moves it to `arg` seconds in;
   * 'boat' sends a boat now; 'land' brings it straight in; 'grow' starts the next step of growth (no care needed);
   * 'care' sets the care banked to `arg`.
   */
  debug(kind: 'festival' | 'grant' | 'celebrate' | 'boat' | 'land' | 'grow' | 'care', arg?: string | number): string {
    if (!this.active) return 'not after the true end';
    this.ensure();
    const g = this.game;
    if (kind === 'festival') {
      if (this.fest) return `already: ${this.fest.kind} ${this.fest.phase}`;
      const k = (typeof arg === 'string' && (SEASON_IDS as string[]).includes(arg) ? arg : this.seasons.season) as SeasonId;
      this.ask(k, Math.max(this.keyNow(), this.doneKey + 1));
      this.speakIn = 0.2;
      return k;
    }
    if (kind === 'grant') {
      if (this.fest?.phase !== 'asked') return `nothing asked (${this.fest?.phase ?? 'none'})`;
      this.grant();
      return 'ready';
    }
    if (kind === 'celebrate') {
      const f = this.fest;
      if (!f) return 'no festival';
      if (f.phase === 'asked') this.grant();
      if (f.phase === 'ready') this.begin();
      if (typeof arg === 'number') f.t = arg;
      return `on ${f.t.toFixed(1)}`;
    }
    if (kind === 'boat') {
      if (this.boat!.phase !== 'off') return `boat already ${this.boat!.phase}`;
      return this.sendBoat() ? 'sailing' : this.boat!.landing ? 'two families already waiting' : 'no landing';
    }
    if (kind === 'land') {
      if (this.boat!.phase !== 'in') return `boat ${this.boat!.phase}`;
      this.boat!.t = Math.max(this.boat!.t, 45.9);
      return 'landing';
    }
    if (kind === 'grow') {
      const gr = this.growth!;
      if (gr.busy) return 'already growing';
      const next = gr.next?.kind ?? null;
      if (!next || !gr.start()) return 'nothing left to grow';
      this.lastGrow = g.time;
      return next;
    }
    if (kind === 'care') {
      this.care = clamp(Number(arg ?? 0), 0, CARE_MAX);
      return `care ${this.care}`;
    }
    return '?';
  }

  /** Debug/test: where the loop stands. */
  state() {
    const g = this.game;
    const s = this.seasons;
    const b = this.boat;
    return {
      active: this.active,
      started: this.started,
      season: { season: s.season, year: s.year, day: s.dayOfSeason },
      key: this.keyNow(),
      doneKey: this.doneKey,
      festival: this.fest ? { kind: this.fest.kind, name: FESTIVALS[this.fest.kind].name, phase: this.fest.phase, t: Math.round(this.fest.t * 10) / 10, ask: FESTIVALS[this.fest.kind].ask, spoken: this.spoken } : null,
      care: Math.round(this.care * 100) / 100,
      careFrom: { ...this.careFrom },
      growth: this.growth?.counts() ?? null,
      families: this.newcomers?.families.map((f) => ({ n: f.looks.length, lot: f.lot, phase: f.phase, t: Math.round(f.t) })) ?? [],
      boat: b ? { phase: b.phase, t: Math.round(b.t * 10) / 10, progress: Math.round(b.progress * 100) / 100, landing: b.landing ? { shore: [Math.round(b.landing.shore.x), Math.round(b.landing.shore.z)], water: [Math.round(b.landing.water.x), Math.round(b.landing.water.z)] } : null } : null,
      boats: this.boats,
      nextBoatIn: Math.round(this.nextBoatAt - g.time),
      nextAskIn: this.firstAsk ? Math.round(this.firstAskAt - g.time) : null,
      people: this.people?.out ?? 0,
      crowd: this.kit?.crowdOut ?? 0,
      chip: this.chip.style.display !== 'none' ? this.chip.textContent : null,
      lines: { waiting: this.lineQueue.map((q) => q.topic), said: [...this.voiced] },
    };
  }
}
