import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { RainCloud } from '../miracles/Miracles';
import { MAT } from '../art/Models';
import { GRASS_SEASON } from '../world/Grass';
import { FOREST_SEASON } from '../entities/Forest';
import type { PostFX } from '../world/PostFX';
import { VILLAGE } from '../config';
import { clamp, damp, smoothstep } from '../util/math';
import {
  BLEND_DAYS, EVENT_CHANCE, EVENT_START, LOOKS, SEASON_DAYS, SEASON_IDS, SEASON_NAME, blendLook, newLook, yearState,
  type Look, type SeasonId,
} from './data';
import { Falling, PETAL_COLORS } from './Falling';
import { Storm } from './Storm';
import { SeasonChip } from './ui';
import { patchSnowOnBase } from './snowRoofs';

// ------------------------------------------------------------------ tuning knobs

/** Per event kind: seconds of warning before it bites, and how long it lasts once under way. */
const EVENT_TIMING = {
  dry: { warn: 40, length: 260 },
  coldsnap: { warn: 45, length: 200 },
  bloom: { warn: 15, length: 100 },
} as const;
/** Storm warning range (game seconds): dark clouds are visible this long before the rain reaches land. */
const STORM_WARNING: [number, number] = [60, 90];
/** How much a full dry spell slows crops, and how much a full cold snap adds to hunger. */
const DRY_CROP_PENALTY = 0.55;
const COLD_HUNGER_EXTRA = 0.3;
/** Seconds after a dry spell / cold snap starts when villages are asked to pray (rain / food). */
const PRAYER_AT: Record<'dry' | 'coldsnap', number[]> = { dry: [20, 120], coldsnap: [25, 110] };
/** A water miracle keeps its surroundings out of a dry spell for this long (seconds) and this far (metres). */
const RAIN_ZONE = { seconds: 170, radius: 48 };
/** Extra food (as a fraction) villagers bring home from each autumn harvest. */
const AUTUMN_BOUNTY = 0.3;
/** Winter snowfall comes and goes: seconds on and off, and how heavy a gentle fall is (0..1). */
const SNOWFALL_ON: [number, number] = [70, 150];
const SNOWFALL_OFF: [number, number] = [50, 140];
const SNOWFALL_GENTLE = 0.42;

export type EventKind = 'dry' | 'storm' | 'coldsnap' | 'bloom';
const SEASON_EVENT: Record<SeasonId, EventKind> = { spring: 'bloom', summer: 'dry', autumn: 'storm', winter: 'coldsnap' };
const EVENT_LABEL: Record<EventKind, { text: string; icon: string }> = {
  dry: { text: 'Dry spell', icon: '🏜️' },
  storm: { text: 'Storm', icon: '⛈️' },
  coldsnap: { text: 'Cold snap', icon: '🥶' },
  bloom: { text: 'Spring bloom', icon: '🌷' },
};

interface ActiveEvent {
  kind: Exclude<EventKind, 'storm'>;
  phase: 'warning' | 'active' | 'ending';
  t: number;
  warn: number;
  length: number;
  asked: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const STRAW = new THREE.Color(0xcdb85c);
const FRESH = new THREE.Color(0x6fd24a);
const HAZE = new THREE.Color(0xffdfa0);
const COLD_SKY = new THREE.Color(0xcddbec);
const tmpColor = new THREE.Color();
const tmpTint = new THREE.Color();
const tmpVec = new THREE.Vector3();

/**
 * The year and its weather. Tracks which season it is (blending smoothly between them), runs one
 * telegraphed nature event per season, and each frame pushes the result into the world's shaders,
 * sky, post-processing, particles and audio.
 */
export class Seasons {
  /** The current blended look (read-only for others). */
  readonly look: Look = newLook();
  season: SeasonId = 'spring';
  year = 1;
  /** 1-based day within the season. */
  dayOfSeason = 1;
  /** 0..1 through the season. */
  frac = 0;
  /** 0..1 how far the season has melted into the next. */
  blend = 0;
  storm: Storm | null = null;
  /** Smoothed 0..1 strengths of the event effects. */
  readonly level = { dry: 0, cold: 0, bloom: 0, snowfall: 0 };
  /** What the camera is under right now. */
  readonly weather = { rain: 0, gloom: 0, wet: 0, flash: 0 };

  private offset = 0;
  private event: ActiveEvent | null = null;
  private plan: { kind: EventKind; frac: number } | null = null;
  private seasonIndex = -1;
  private readonly zones: { x: number; z: number; until: number }[] = [];
  private snowOn = false;
  private snowTimer = 0;
  private readonly rain = new Falling('rain');
  private readonly snow = new Falling('snow');
  private readonly leaves = new Falling('leaf');
  private readonly petals = new Falling('leaf', PETAL_COLORS);
  private readonly chip: SeasonChip;
  private readonly wind = new THREE.Vector2();
  private birdTimer = 0;

  constructor(private readonly game: Game) {
    patchSnowOnBase();
    this.chip = new SeasonChip(game.hud.root);
    for (const f of [this.rain, this.snow, this.leaves, this.petals]) game.scene.add(f.object);

    // A water miracle fixes a dry spell around where it fell.
    game.events.on('miracle', ({ id, x, z }) => {
      if (id === 'water') this.zones.push({ x, z, until: game.time + RAIN_ZONE.seconds });
    });
    // Generous autumn harvests.
    game.events.on('fieldHarvested', ({ field, food }) => {
      const bonus = Math.round(food * AUTUMN_BOUNTY * this.look.autumn);
      if (bonus < 1) return;
      field.village.store.deposit('food', bonus);
      game.floatText(field.pos.x, field.pos.y + 5, field.pos.z, `+${bonus} autumn bounty`, '#ffd98a');
    });
    this.refreshTime();
    this.seasonIndex = yearState(this.pos()).index;
    this.season = SEASON_IDS[this.seasonIndex];
    this.planEvent();
  }

  // ------------------------------------------------------------------ time

  /** Position in the year, in whole seasons (0 = spring's start, 1 = summer's start, ...). */
  private pos(): number {
    const g = this.game;
    return (g.day - 1 + g.dayTime) / SEASON_DAYS + this.offset;
  }

  private refreshTime() {
    const st = yearState(this.pos());
    this.frac = st.frac;
    this.blend = st.blend;
    this.year = st.year;
    this.dayOfSeason = Math.floor(st.frac * SEASON_DAYS) + 1;
    blendLook(this.look, LOOKS[SEASON_IDS[st.index]], LOOKS[SEASON_IDS[(st.index + 1) % 4]], st.blend);
    return st;
  }

  // ------------------------------------------------------------ debug hooks

  /** Jump the calendar to the start of a season (a little way in), for testing. Cancels any running event. */
  jumpTo(id: SeasonId, frac = 0.3) {
    const g = this.game;
    const base = (g.day - 1 + g.dayTime) / SEASON_DAYS;
    const idx = SEASON_IDS.indexOf(id);
    const target = Math.floor(this.pos() / 4) * 4 + idx + frac;
    this.offset = target - base;
    this.stop();
    this.zones.length = 0;
    this.snowOn = id === 'winter';
    this.snowTimer = rand(...SNOWFALL_ON);
    Object.assign(this.level, { dry: 0, cold: 0, bloom: 0, snowfall: this.snowOn ? SNOWFALL_GENTLE : 0 });
    this.seasonIndex = idx;
    this.season = id;
    this.refreshTime();
    this.planEvent();
    g.events.emit('seasonChanged', { season: id, year: this.year });
  }

  /** Start a nature event right now. `warn` overrides the warning time in seconds (storm: 60-90 normally). */
  trigger(kind: EventKind, opts: { warn?: number; length?: number; angle?: number } = {}) {
    this.stop();
    this.plan = null;
    const g = this.game;
    if (kind === 'storm') {
      const warn = opts.warn ?? rand(...STORM_WARNING);
      const storm = new Storm(g, { warning: warn, angle: opts.angle });
      this.storm = storm;
      storm.onPhase = (p) => this.stormPhase(p);
      storm.onStrike = (s) => this.lightning(s);
      this.announce('storm');
      g.events.emit('weather', { kind: 'storm', phase: 'warning' });
      g.audio.stormWarning();
      return;
    }
    const t = EVENT_TIMING[kind];
    this.event = { kind, phase: 'warning', t: 0, warn: opts.warn ?? t.warn, length: opts.length ?? t.length, asked: 0 };
    this.announce(kind);
    g.events.emit('weather', { kind, phase: 'warning' });
  }

  /** End any running event immediately (no fanfare). */
  stop() {
    if (this.storm) {
      this.storm.dispose();
      this.storm = null;
    }
    this.event = null;
  }

  /** Save/load: the calendar position and the weather state. A storm in flight restarts with a fresh warning. */
  save() {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      offset: r(this.offset),
      event: this.event && this.event.phase !== 'ending' ? { ...this.event } : null,
      stormWarning: this.storm && this.storm.phase !== 'passing' && this.storm.phase !== 'done',
      plan: this.plan ? { ...this.plan } : null,
      snowOn: this.snowOn,
      snowTimer: r(this.snowTimer),
      level: { ...this.level },
      zones: this.zones.map((z) => ({ ...z })),
    };
  }

  load(data: unknown) {
    const d = data as ReturnType<Seasons['save']>;
    this.stop();
    this.offset = d.offset;
    const st = this.refreshTime();
    this.seasonIndex = st.index;
    this.season = SEASON_IDS[st.index];
    this.snowOn = d.snowOn;
    this.snowTimer = d.snowTimer;
    Object.assign(this.level, d.level);
    this.zones.length = 0;
    for (const z of d.zones ?? []) this.zones.push(z);
    this.plan = d.plan ?? null;
    if (d.event) this.event = d.event;
    else if (d.stormWarning) this.trigger('storm', { warn: 45 });
  }

  /** What is going on, for tests and tooling. */
  state() {
    return {
      season: this.season, year: this.year, day: this.dayOfSeason, frac: +this.frac.toFixed(3), blend: +this.blend.toFixed(3),
      event: this.storm ? `storm:${this.storm.phase}` : this.event ? `${this.event.kind}:${this.event.phase}` : null,
      planned: this.plan ? `${this.plan.kind}@${this.plan.frac.toFixed(2)}` : null,
      level: { ...this.level }, weather: { ...this.weather }, modifiers: { ...this.game.modifiers },
    };
  }

  // -------------------------------------------------------------- planning

  private planEvent() {
    this.plan = null;
    if (this.storm || this.event) return;
    const kind = SEASON_EVENT[this.season];
    if (this.year > 1 && Math.random() > EVENT_CHANCE) return;
    this.plan = { kind, frac: rand(Math.max(EVENT_START[0], this.frac + 0.06), Math.max(EVENT_START[1], this.frac + 0.1)) };
  }

  // ------------------------------------------------------------ simulation

  update(dt: number) {
    const g = this.game;
    const st = this.refreshTime();
    if (st.index !== this.seasonIndex) {
      this.seasonIndex = st.index;
      this.season = SEASON_IDS[st.index];
      this.seasonTurned();
    }
    this.season = SEASON_IDS[st.index];

    // Planned event.
    if (this.plan && !this.event && !this.storm && this.frac >= this.plan.frac) {
      const kind = this.plan.kind;
      this.plan = null;
      this.trigger(kind);
    }

    this.updateEvent(dt);
    if (this.storm) {
      this.storm.update(dt);
      if (this.storm.finished) this.storm = null;
    }

    // Winter snowfall comes and goes by itself.
    this.snowTimer -= dt;
    if (this.look.snow > 0.5 || this.snowOn) {
      if (this.snowTimer <= 0) {
        this.snowOn = !this.snowOn;
        this.snowTimer = this.snowOn ? rand(...SNOWFALL_ON) : rand(...SNOWFALL_OFF);
      }
    } else this.snowOn = false;
    const ev = this.event;
    const coldTarget = ev?.kind === 'coldsnap' ? (ev.phase === 'warning' ? 0.4 : ev.phase === 'active' ? 1 : 0) : 0;
    const dryTarget = ev?.kind === 'dry' ? (ev.phase === 'warning' ? 0.35 : ev.phase === 'active' ? 1 : 0) : 0;
    const bloomTarget = ev?.kind === 'bloom' ? (ev.phase === 'warning' ? 0.2 : ev.phase === 'active' ? 1 : 0) : 0;
    const snowTarget = Math.max(coldTarget, this.snowOn && this.look.snow > 0.3 ? SNOWFALL_GENTLE : 0);
    const k = damp(0.06, dt);
    this.level.dry += (dryTarget - this.level.dry) * k;
    this.level.cold += (coldTarget - this.level.cold) * k;
    this.level.bloom += (bloomTarget - this.level.bloom) * damp(0.1, dt);
    this.level.snowfall += (snowTarget - this.level.snowfall) * damp(0.08, dt);

    // The simulation hooks: crops, trees, hunger and fire respond to the season and its events.
    const m = g.modifiers;
    const stormWet = this.storm ? this.weather.rain : 0;
    m.cropGrowth = this.look.cropGrowth * (1 - DRY_CROP_PENALTY * this.level.dry);
    m.treeGrowth = this.look.treeGrowth * (1 - 0.3 * this.level.dry);
    m.villagerHunger = this.look.hunger * (1 + COLD_HUNGER_EXTRA * this.level.cold);
    m.fireSpread = this.look.fireSpread * (1 + 0.3 * this.level.dry) * (1 - 0.6 * Math.max(stormWet, this.weather.wet * 0.5));

    // Rain from the player's miracle gets crops growing at full speed again around where it fell.
    if (this.level.dry > 0.02 && this.zones.length) {
      for (let i = this.zones.length - 1; i >= 0; i--) if (g.time > this.zones[i].until) this.zones.splice(i, 1);
      const extra = (dt / VILLAGE.fieldGrowTime) * this.look.cropGrowth * DRY_CROP_PENALTY * this.level.dry;
      for (const v of g.villages) {
        if (!this.zones.some((z) => Math.hypot(z.x - v.center.x, z.z - v.center.z) < RAIN_ZONE.radius + v.radius * 0.6)) continue;
        for (const f of v.fields) if (f.alive && !f.burning && f.growth < 1) f.growth = Math.min(1, f.growth + extra);
      }
    }

    // Spring and the bloom bring extra birdsong.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1;
      if (Math.random() < 0.1 * this.look.birds + 0.5 * this.level.bloom) g.audio.birdsong(1 + Math.floor(Math.random() * 3));
    }
  }

  private updateEvent(dt: number) {
    const ev = this.event;
    if (!ev) return;
    const g = this.game;
    ev.t += dt;
    if (ev.phase === 'warning' && ev.t >= ev.warn) {
      ev.phase = 'active';
      ev.t = 0;
      this.eventBegins(ev);
      g.events.emit('weather', { kind: ev.kind, phase: 'active' });
    } else if (ev.phase === 'active') {
      if (ev.kind !== 'bloom') {
        const asks = PRAYER_AT[ev.kind];
        if (ev.asked < asks.length && ev.t >= asks[ev.asked]) {
          ev.asked++;
          this.askForHelp(ev.kind === 'dry' ? 'rain' : 'food');
        }
      }
      if (ev.t >= ev.length) {
        ev.phase = 'ending';
        ev.t = 0;
        this.eventEnds(ev);
        g.events.emit('weather', { kind: ev.kind, phase: 'ended' });
      }
    } else if (ev.phase === 'ending' && ev.t > 60) this.event = null;
  }

  /** Ask a couple of villages for `kind` (they pray; you answer in the usual way). */
  private askForHelp(kind: 'rain' | 'food') {
    const ps = (this.game as unknown as { prayerSystem?: { spawnNow(v: Village, k: string): unknown; forVillage(v: Village): { kind: string }[] } }).prayerSystem;
    if (!ps) return;
    const vs = this.game.villages.filter((v) => v.population > 0 && !ps.forVillage(v).some((p) => p.kind === kind));
    vs.sort(() => Math.random() - 0.5);
    for (const v of vs.slice(0, 2)) ps.spawnNow(v, kind);
  }

  private eventBegins(ev: ActiveEvent) {
    const g = this.game;
    if (ev.kind === 'dry') g.message('The spell has settled in. Crops are growing slowly. A little rain would help.', 'warn', 'dry-on');
    else if (ev.kind === 'coldsnap') {
      g.message('The cold snap bites. Villagers are hungrier: keep the stores full.', 'warn', 'cold-on');
    } else {
      g.message('The spring bloom! Flowers and birdsong everywhere.', 'good', 'bloom-on');
      g.audio.bloomChime();
      g.audio.birdsong(5);
    }
  }

  private eventEnds(ev: ActiveEvent) {
    const g = this.game;
    if (ev.kind === 'dry') {
      g.message('The air softens. Clouds drift in with a little rain.', 'good', 'dry-off');
      // A gentle relief shower over each village: nature sets things right by itself.
      for (const v of g.villages) {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          const cloud = new RainCloud(v.center.x + Math.cos(a) * 14, v.center.z + Math.sin(a) * 14, 0.6, 0.2);
          cloud.natural = true;
          g.add(cloud);
        }
      }
    } else if (ev.kind === 'coldsnap') g.message('The bitter cold eases.', 'good', 'cold-off');
    else g.message('The bloom fades into a green, buzzing summer-to-be.', 'info', 'bloom-off');
  }

  private stormPhase(p: 'warning' | 'active' | 'passing' | 'done') {
    const g = this.game;
    if (p === 'active') {
      g.message('The storm reaches the island. Rain sweeps across, and lightning may strike.', 'warn', 'storm-on');
      g.events.emit('weather', { kind: 'storm', phase: 'active' });
    } else if (p === 'passing') g.message('The storm is moving on.', 'info', 'storm-passing');
    else if (p === 'done') {
      g.message('The storm has passed. The air smells of rain.', 'good', 'storm-off');
      g.events.emit('weather', { kind: 'storm', phase: 'ended' });
    }
  }

  private lightning(s: { x: number; z: number; tree: boolean; near: string | null; ignited: boolean }) {
    const g = this.game;
    if (s.near) g.message(`Lightning strikes near ${s.near}!`, 'warn', 'lightning-near');
    else if (s.ignited) g.message('Lightning set a tree alight. A little rain would put it out.', 'warn', 'lightning-fire');
  }

  // ----------------------------------------------------- announcements

  private say(lines: { who: 'spirit' | 'imp'; text: string }[], pri: 'important' | 'chat', topic: string) {
    const adv = (this.game as unknown as { prayerSystem?: { advisors?: { say(l: unknown, o: unknown): boolean } } }).prayerSystem?.advisors;
    adv?.say(lines, { pri, topic, cooldown: 0 });
  }

  private announce(kind: EventKind) {
    const g = this.game;
    switch (kind) {
      case 'dry':
        g.message('The air grows dry... a dry spell is coming. Crops will slow; rain will help.', 'warn', 'dry-warn');
        this.say([
          { who: 'spirit', text: 'The air grows dry. The fields will want rain soon.' },
          { who: 'imp', text: 'Have you tried a cloud? They are very wet.' },
        ], 'important', 'dry-warn');
        break;
      case 'storm':
        g.message('Dark clouds are gathering over the sea. A storm is coming; the wind is rising.', 'warn', 'storm-warn');
        this.say([
          { who: 'spirit', text: 'Dark clouds are gathering over the sea. A storm is on its way.' },
          { who: 'imp', text: 'Ooh, lightning! Keep an eye on the trees.' },
        ], 'important', 'storm-warn');
        break;
      case 'coldsnap':
        g.message('A cold wind from the north... a cold snap is coming. Keep the stores full.', 'warn', 'cold-warn');
        this.say([
          { who: 'spirit', text: 'A bitter wind from the north. Our people will need food.' },
          { who: 'imp', text: 'I volunteer you to deliver bread.' },
        ], 'important', 'cold-warn');
        break;
      case 'bloom':
        g.message('Buds are swelling everywhere... something lovely is about to happen.', 'good', 'bloom-warn');
        break;
    }
  }

  private seasonTurned() {
    const g = this.game;
    this.zones.length = 0;
    this.event = this.event && this.event.phase === 'ending' ? null : this.event;
    this.planEvent();
    g.events.emit('seasonChanged', { season: this.season, year: this.year });
    const text: Record<SeasonId, string> = {
      spring: 'Spring has come. The meadows wake, and the blossom opens.',
      summer: 'Summer arrives, warm and golden.',
      autumn: 'Autumn begins. The leaves turn to gold and the harvest is generous.',
      winter: 'Winter settles in. The fields sleep, and the stores will matter now.',
    };
    g.message(text[this.season], 'info', 'season');
    const line: Record<SeasonId, { who: 'spirit' | 'imp'; text: string }[]> = {
      spring: [{ who: 'spirit', text: 'Spring! Look at all the blossom.' }],
      summer: [{ who: 'imp', text: 'Summer. Prime fire weather. Not that I would suggest anything.' }],
      autumn: [{ who: 'spirit', text: 'The leaves are turning. The harvest will be generous this year.' }],
      winter: [{ who: 'spirit', text: 'Snow! The crops sleep now. Keep the stores full and we will be cosy.' }],
    };
    this.say(line[this.season], 'chat', 'season');
  }

  // ------------------------------------------------------------- visuals

  /** Per rendered frame: push the look and weather into the world. */
  frame(realDt: number) {
    const g = this.game;
    const L = this.look;
    const lv = this.level;
    const cam = g.godCam;
    const tgt = cam.target;
    const storm = this.storm;
    if (storm) storm.frame(realDt);

    // What the camera is under.
    const rainNow = storm ? storm.coverage(tgt.x, tgt.z) : 0;
    const gloomNow = storm ? storm.gloomAt(tgt.x, tgt.z) : 0;
    const w = this.weather;
    const kk = damp(1.4, realDt);
    w.rain += (rainNow - w.rain) * kk;
    w.gloom += (gloomNow - w.gloom) * kk;
    w.wet += (Math.max(w.rain, w.gloom * 0.6) - w.wet) * damp(0.15, realDt);
    w.flash = storm ? storm.flash : 0;
    const stormGloom = w.gloom;
    const gloom = clamp(stormGloom + 0.22 * lv.cold, 0, 1);

    // Ground, grass, trees.
    const dry = lv.dry;
    tmpColor.copy(L.grassColor).lerp(STRAW, dry * 0.65).lerp(FRESH, lv.bloom * 0.3);
    const grassAmt = clamp(L.grassAmt + dry * 0.35 + lv.bloom * 0.1, 0, 1);
    g.terrain.setSeason(tmpColor, grassAmt, L.snow, w.wet);
    const gs = GRASS_SEASON;
    (gs.uGrassTarget.value as THREE.Color).copy(tmpColor);
    gs.uGrassAmt.value = grassAmt;
    gs.uGrassScale.value = L.grassScale * (1 - 0.25 * dry);
    gs.uFlower.value = L.flower * (1 - 0.5 * dry) + lv.bloom * 1.0;
    gs.uWind.value = L.wind * (1 + 1.8 * stormGloom);
    const fs = FOREST_SEASON;
    (fs.uLeafTint.value as THREE.Color).copy(L.leafTint);
    fs.uAutumn.value = L.autumn;
    fs.uBare.value = L.bare;
    fs.uBlossom.value = L.blossom;
    fs.uSnowT.value = Math.max(L.snowCanopy, lv.cold * 0.9);

    // Sky and light.
    tmpTint.copy(L.horizonTint).lerp(HAZE, dry * 0.5).lerp(COLD_SKY, lv.cold * 0.6);
    g.sky.applyWeather({
      horizonTint: tmpTint,
      horizonAmt: clamp(L.horizonAmt + dry * 0.15 + lv.cold * 0.2, 0, 1),
      zenithTint: L.zenithTint,
      zenithAmt: L.zenithAmt,
      sunTint: L.sunTint,
      sunAmt: L.sunAmt,
      sunScale: L.sunScale * (1 + 0.06 * dry),
      hemiScale: L.hemiScale,
      fogScale: L.fogScale * (1 - 0.12 * dry),
      nightLift: L.nightLift,
      gloom,
      flash: w.flash,
    });
    // Cosy evenings: windows glow warmer and earlier, most of all in winter and in storms.
    const dusk = 1 - smoothstep(0.3, 0.85, g.sky.daylight);
    MAT.window.emissiveIntensity = Math.max(MAT.window.emissiveIntensity * L.windows, dusk * (L.windows - 1) * 1.6, gloom * 1.4);

    // Grade.
    const fx = (g as unknown as { postfx?: PostFX }).postfx;
    fx?.setGrade(tmpVec.copy(L.warm), L.sat * (1 - 0.12 * gloom), L.vignette + 0.12 * gloom);

    // Falling things around the view.
    const light = 0.3 + 0.7 * g.sky.daylight;
    const px = g.renderer.domElement.height;
    const fov = cam.camera.fov;
    const center = tmpVec.set(tgt.x, g.terrain.surfaceAt(tgt.x, tgt.z), tgt.z);
    const radius = clamp(cam.distance * 0.9, 70, 300);
    this.snow.setViewportHeight(px, fov);
    this.leaves.setViewportHeight(px, fov);
    this.petals.setViewportHeight(px, fov);
    const wd = storm ? storm.dir : null;
    const windAmt = 2 + 14 * stormGloom;
    this.wind.set((wd ? wd.x : 0.8) * windAmt, (wd ? wd.y : 0.3) * windAmt);
    const t = g.realTime;
    this.rain.update(t, center, radius, Math.pow(w.rain, 0.8), this.wind, light);
    this.snow.update(t, center, radius, lv.snowfall * (1 - 0.0), this.wind.clone().multiplyScalar(0.25), 0.35 + 0.65 * g.sky.daylight);
    this.leaves.update(t, center, radius * 0.7, L.leaves * 0.75, this.wind.clone().multiplyScalar(0.5), light);
    this.petals.update(t, center, radius * 0.7, clamp(L.petals + lv.bloom * 1.0, 0, 1) * 0.8, this.wind.clone().multiplyScalar(0.4), 0.5 + 0.5 * g.sky.daylight);

    // Sound.
    g.audio.weatherAmbience({ storm: stormGloom, rain: w.rain, hush: clamp(L.hush * 0.7 + lv.cold * 0.3, 0, 1) });

    // Season indicator.
    let note: { text: string; icon: string; warning: boolean } | null = null;
    if (this.storm) note = { ...EVENT_LABEL.storm, text: this.storm.phase === 'warning' ? 'Storm approaching' : 'Storm', warning: this.storm.phase === 'warning' };
    else if (this.event && this.event.phase !== 'ending') {
      note = { ...EVENT_LABEL[this.event.kind], warning: this.event.phase === 'warning' };
      if (this.event.phase === 'warning' && this.event.kind !== 'bloom') note.text = `${note.text} coming`;
    }
    this.chip.update(this.season, this.dayOfSeason, this.frac, note);
  }

  /** Season name for messages and UI. */
  get seasonName(): string {
    return SEASON_NAME[this.season];
  }

  /** Days each season lasts (tuning knob, see data.ts). */
  get seasonDays(): number {
    return SEASON_DAYS;
  }

  get blendDays(): number {
    return BLEND_DAYS;
  }
}
