import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Prayers, Prayer } from '../prayers/Prayers';
import type { Advisors, Line } from '../prayers/Advisors';
import { SEA_LEVEL, VILLAGE } from '../config';
import { rng } from '../util/rng';
import { smoothstep } from '../util/math';
import {
  CHAIN,
  DEFS,
  FESTIVAL_FAITH,
  FESTIVAL_POWER,
  FESTIVAL_TIME,
  FIRST_PROJECT_HOME,
  FIRST_PROJECT_OTHER,
  NEUTRAL_FINISH_BELIEF,
  NEUTRAL_QUARRY,
  NEXT_PROJECT_GAP,
  TEMPLE_FAITH_REGEN,
  TEMPLE_FAITH_SHIELD,
  TEMPLE_POWER,
  WELL_CROP_BOOST,
  WELL_FIRE_EXTRA,
  WONDER_UNLOCK_DELAY,
  type ProjectDef,
  type ProjectId,
  type Res,
} from './defs';
import { Site } from './Site';
import { CRYSTAL, GLOW, RUNE_ON } from './ProjectModels';

/** One village's journey through the project chain. */
export interface VillageProjects {
  readonly village: Village;
  /** Index into CHAIN of the next project to start. */
  index: number;
  site: Site | null;
  prayer: Prayer | null;
  nextAt: number;
  readonly done: Set<ProjectId>;
  /** Game time at which a running festival ends (0 when none). */
  festivalUntil: number;
  festivalSite: Site | null;
  quarry: number;
}

interface Mote {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  res: Res;
  amount: number;
  site: Site;
  arc: number;
}

const MOTE_COLOR: Record<Res, number> = { wood: 0xe8b070, stone: 0xe6e0d0, food: 0xffe28a };

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const START_LINES: Record<ProjectId, Line[][]> = {
  well: [
    [
      { who: 'spirit', text: 'They dream of a well! Drop a boulder on the marked ground for stone, and carry trees to their store for timber.' },
      { who: 'imp', text: 'Rocks. You throw rocks at things. Finally, a use for your hobby.' },
    ],
  ],
  temple: [[{ who: 'spirit', text: 'A temple! The builders do the timber, but they cannot lift stone. That part is yours.' }]],
  festival: [[{ who: 'imp', text: 'A festival? Count me in. Bring bread, and perhaps a boulder or two for the fireworks. (There are no fireworks.)' }]],
  wonder: [],
};

const DONE_LINES: Record<ProjectId, Line[][]> = {
  well: [[{ who: 'spirit', text: 'Hear that trickle? Cooler air, greener fields, and fires will think twice.' }]],
  temple: [[{ who: 'spirit', text: 'Every prayer rings a little louder now.' }, { who: 'imp', text: 'Echo! Echo! ...Sorry.' }]],
  festival: [[{ who: 'spirit', text: 'Lanterns and ribbons and dancing. I could watch this all night.' }, { who: 'imp', text: 'I am not crying. The ribbons are in my eye.' }]],
  wonder: [],
};

/**
 * Village projects and the Wonder. Each village works through a chain (well, temple, harvest
 * festival), one dream at a time, announced as a prayer. Builders carry timber and food from the
 * store; you provide stone by dropping or throwing boulders onto the site. Finishing one gives a
 * lasting effect; once all three villages worship you the whole island raises the Wonder.
 */
export class Projects {
  readonly states = new Map<Village, VillageProjects>();
  wonder: Site | null = null;
  wonderPrayer: Prayer | null = null;
  wonderUnlocked = false;
  wonderDone = false;
  private unlockAt = -1;
  private readonly motes: Mote[] = [];
  private tick = 0;
  private celebrate = 0;
  private shimmer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly game: Game,
    private readonly prayers: Prayers,
    private readonly advisors: Advisors,
  ) {
    for (const v of game.villages) {
      const first = v.isHome ? FIRST_PROJECT_HOME : FIRST_PROJECT_OTHER;
      this.states.set(v, {
        village: v,
        index: 0,
        site: null,
        prayer: null,
        nextAt: rng.range(first[0], first[1]),
        done: new Set(),
        festivalUntil: 0,
        festivalSite: null,
        quarry: 0,
      });
    }
  }

  has(v: Village, id: ProjectId): boolean {
    return this.states.get(v)?.done.has(id) ?? false;
  }

  // ----------------------------------------------------------- simulation

  update(dt: number) {
    const g = this.game;
    this.applyEffects(dt);
    this.updateMotes(dt);
    this.updateFestivals(dt);

    if (this.wonder && !this.wonder.complete && this.wonder.shown < 0.05) {
      this.shimmer -= dt;
      if (this.shimmer <= 0) {
        this.shimmer = 0.25;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 14;
        g.fx.prayer(this.wonder.pos.x + Math.cos(a) * r, this.wonder.pos.y + 2, this.wonder.pos.z + Math.sin(a) * r, 0xbff0ff);
      }
    }
    if (this.celebrate > 0) this.celebration(dt);

    this.tick += dt;
    if (this.tick < 0.5) return;
    const step = this.tick;
    this.tick = 0;

    for (const vs of this.states.values()) this.updateVillage(vs, step);
    this.updateWonder(step);
  }

  private updateVillage(vs: VillageProjects, step: number) {
    const g = this.game;
    const v = vs.village;
    if (!vs.site) {
      if (vs.index < CHAIN.length && g.time >= vs.nextAt && v.population >= 3) this.start(vs, CHAIN[vs.index]);
      return;
    }
    const site = vs.site;
    if (vs.prayer) vs.prayer.progress = site.fraction * 100;
    // Neutral villagers quarry a little stone themselves so they are never stuck for good.
    if (v.owner !== 'player' && site.open('stone') > 0 && v.population >= 4) {
      vs.quarry += NEUTRAL_QUARRY * step;
      if (vs.quarry >= 2) {
        vs.quarry = 0;
        site.add(g, 'stone', 2, 'quarry');
        g.fx.dust(site.pos.x, site.pos.y + 1, site.pos.z, 6, 0.7, 0xb8b1a4);
      }
    }
    if (site.full && !site.complete) this.finish(vs);
  }

  // ------------------------------------------------------- starting a project

  /** A flat-enough plot inside the village for a project's footprint. */
  private findPlot(v: Village, def: ProjectDef): { x: number; z: number; y: number } | null {
    const g = this.game;
    const maxRange = def.id === 'temple' ? 3.4 : 2.6;
    let best: { x: number; z: number; y: number; range: number } | null = null;
    const attempts: [number, number, number][] = [
      [0.2, 0.75, def.radius * 0.9],
      [0.2, 0.95, def.radius * 0.75],
      [0.15, 1.1, def.radius * 0.6],
    ];
    for (const [lo, hi, clear] of attempts) {
      for (let k = 0; k < 6; k++) {
        const spot = v.findSpot(g, lo, hi, clear);
        if (!spot) continue;
        let top = -Infinity;
        let bot = Infinity;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const h = g.terrain.heightAt(spot.x + Math.cos(a) * def.radius * 0.85, spot.z + Math.sin(a) * def.radius * 0.85);
          top = Math.max(top, h);
          bot = Math.min(bot, h);
        }
        top = Math.max(top, spot.y);
        const range = top - Math.min(bot, spot.y);
        if (bot < SEA_LEVEL + 0.6) continue;
        if (range <= maxRange) return { x: spot.x, z: spot.z, y: top - 0.15 };
        if (!best || range < best.range) best = { x: spot.x, z: spot.z, y: top - 0.15, range };
      }
    }
    return best && best.range < maxRange * 2 ? best : null;
  }

  /** Announce the village's next dream and mark out its site. */
  start(vs: VillageProjects, id: ProjectId): Site | null {
    const g = this.game;
    const v = vs.village;
    const def = DEFS[id];
    const plot = this.findPlot(v, def);
    if (!plot) {
      vs.nextAt = g.time + 15;
      return null;
    }
    const rot = Math.atan2(v.center.x - plot.x, v.center.z - plot.z);
    const site = new Site(v, def, plot.x, plot.y, plot.z, rot);
    g.add(site);
    v.obstacles.push({ pos: site.pos, radius: def.radius + 3 });
    v.projectSite = site;
    vs.site = site;
    vs.prayer = this.prayers.spawnProject(v, def.icon, pick(def.prayer), def.thanks);
    g.events.emit('projectStarted', { village: v, project: id });
    const hint = def.needs.stone > 0 ? ' Drop boulders on the marked ground for stone.' : '';
    g.message(
      v.owner === 'player'
        ? `${v.name} dreams of a ${def.name.toLowerCase()}.${hint}`
        : `${v.name} dreams of a ${def.name.toLowerCase()}. Help them build it to win their hearts.${hint}`,
      'info',
      `proj-${v.name}`,
    );
    g.fx.sparkle(site.pos.x, site.pos.y + 3, site.pos.z, 30, 0xfff0b0, def.radius);
    const lines = START_LINES[id];
    if (lines.length && v.isHome) this.advisors.say(pick(lines), { pri: 'important', topic: `proj-${id}`, cooldown: 0 });
    return site;
  }

  // ------------------------------------------------------------ finishing

  private finish(vs: VillageProjects) {
    const g = this.game;
    const v = vs.village;
    const site = vs.site!;
    const def = site.def;
    site.complete = true;
    vs.site = null;
    v.projectSite = null;
    vs.done.add(def.id);
    vs.index++;
    vs.nextAt = g.time + rng.range(NEXT_PROJECT_GAP[0], NEXT_PROJECT_GAP[1]);

    g.audio.projectDone();
    g.fx.sparkle(site.pos.x, site.pos.y + def.height * 0.6, site.pos.z, 120, 0xfff0b0, def.radius * 1.4);
    g.fx.sparkle(site.pos.x, site.pos.y + def.height + 2, site.pos.z, 40, 0xbfe6ff, 4);
    g.floatText(site.pos.x, site.pos.y + def.height + 6, site.pos.z, `${def.name} complete!`, '#ffe9a8');
    g.hud.showBanner(`${v.name}: ${def.name} complete!`, def.effect);
    g.message(`${v.name} finished their ${def.name.toLowerCase()}. ${def.effect}`, 'good', `done-${v.name}-${def.id}`);
    g.events.emit('projectCompleted', { village: v, project: def.id });
    const lines = DONE_LINES[def.id];
    if (lines.length && v.owner === 'player') this.advisors.say(pick(lines), { pri: 'important', topic: `done-${def.id}`, cooldown: 0 });

    // A neutral village is moved by what you helped them build. (The prayer's own reward comes on top.)
    // If they built it all themselves, there's nothing to thank you for: the prayer just fades.
    const helped = site.given > 0;
    if (helped && v.owner !== 'player') v.belief += NEUTRAL_FINISH_BELIEF;
    const prayer = vs.prayer;
    vs.prayer = null;
    if (prayer) {
      if (helped) this.prayers.fulfil(prayer);
      else this.prayers.drop(prayer);
    } else if (v.owner !== 'player' && v.belief >= VILLAGE.convertAt) v.convert(g);

    if (def.id === 'festival') this.startFestival(vs, site);
  }

  // ------------------------------------------------------------- effects

  private applyEffects(dt: number) {
    const g = this.game;
    let burning = false;
    for (const e of g.entities) {
      if (e.burning) {
        burning = true;
        break;
      }
    }
    for (const vs of this.states.values()) {
      const v = vs.village;
      if (vs.done.has('well')) {
        const extra = (dt / VILLAGE.fieldGrowTime) * (WELL_CROP_BOOST - 1) * g.modifiers.cropGrowth;
        for (const f of v.fields) if (f.alive && !f.burning && f.growth < 1) f.water(extra);
        if (burning) {
          for (const e of g.entities) {
            if (e.burning && e.alive && !e.held && v.contains(e.pos.x, e.pos.z, 1.15)) e.fuel -= dt * WELL_FIRE_EXTRA;
          }
        }
      }
      if (vs.done.has('temple') && v.owner === 'player') {
        const bonus = v.prayerRate * (TEMPLE_POWER - 1);
        g.player.addPower(bonus * dt);
        v.prayerRate += bonus;
        if (v.starving > 0) v.belief += dt * 0.35 * v.starving * TEMPLE_FAITH_SHIELD;
        else v.belief = Math.min(100, v.belief + dt * TEMPLE_FAITH_REGEN);
      }
    }
  }

  // ------------------------------------------------------------- festival

  private startFestival(vs: VillageProjects, site: Site) {
    const g = this.game;
    const v = vs.village;
    vs.festivalSite = site;
    vs.festivalUntil = g.time + FESTIVAL_TIME;
    v.festival = site;
    for (const vl of v.villagers) {
      vl.wake();
      vl.hunger = Math.min(vl.hunger, 0.3);
    }
    if (v.owner === 'player') {
      v.belief = Math.min(100, v.belief + FESTIVAL_FAITH);
      g.player.addPower(FESTIVAL_POWER);
      g.floatText(site.pos.x, site.pos.y + 14, site.pos.z, `+${FESTIVAL_FAITH} faith · +${FESTIVAL_POWER} power`, '#bff0c0');
    }
    g.message(`${v.name} celebrates! Everyone gathers to dance.`, 'divine', `fest-${v.name}`);
  }

  private updateFestivals(dt: number) {
    const g = this.game;
    for (const vs of this.states.values()) {
      const site = vs.festivalSite;
      if (!site || !vs.festivalUntil) continue;
      const v = vs.village;
      if (g.time >= vs.festivalUntil) {
        vs.festivalUntil = 0;
        vs.festivalSite = null;
        v.festival = null;
        g.message(`The festival in ${v.name} winds down. What a night.`, 'info', `festend-${v.name}`);
        continue;
      }
      // Everyone feasts (nobody gets too hungry to dance), and the green sparkles.
      if (Math.random() < dt * 4) {
        for (const vl of v.villagers) if (vl.hunger > 0.3) vl.hunger = 0.3;
      }
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * 8;
        g.fx.sparkle(site.pos.x + Math.cos(a) * r, site.pos.y + 1.5 + Math.random() * 4, site.pos.z + Math.sin(a) * r, 1, [0xffd27a, 0xf08aa8, 0x9fe8ff][Math.floor(Math.random() * 3)], 0.5);
      }
      if (Math.random() < dt * 1.2) {
        // A floating lantern drifts up into the sky.
        g.fx.prayer(site.pos.x + (Math.random() - 0.5) * 12, site.pos.y + 3, site.pos.z + (Math.random() - 0.5) * 12, 0xffc060);
      }
      g.audio.festivalChimes(site.pos);
      if (v.owner === 'player') g.player.addPower(v.prayerRate * dt);
    }
  }

  // ------------------------------------------------------------- the Wonder

  private updateWonder(step: number) {
    const g = this.game;
    void step;
    if (!this.wonderUnlocked) {
      const all = g.villages.every((v) => v.owner === 'player');
      if (!all) this.unlockAt = -1;
      else if (this.unlockAt < 0) this.unlockAt = g.time + WONDER_UNLOCK_DELAY;
      else if (g.time >= this.unlockAt) this.unlock();
      return;
    }
    const w = this.wonder;
    if (!w) return;
    for (const v of g.villages) v.wonderSite = !w.complete && v.owner === 'player' ? w : null;
    if (this.wonderPrayer) this.wonderPrayer.progress = w.fraction * 100;
    if (w.full && !w.complete) this.completeWonder(w);
  }

  /** Find a broad, flat, dry place near the home village for the Wonder's dais. */
  private findWonderSpot(): { x: number; z: number; y: number } | null {
    const g = this.game;
    const home = g.villages.find((v) => v.isHome)!;
    const R = DEFS.wonder.radius;
    let best: { x: number; z: number; y: number; score: number } | null = null;
    for (let pass = 0; pass < 3; pass++) {
      const clearance = 6 - pass * 3;
      for (let ring = 0; ring < 8; ring++) {
        const d = home.radius * (0.9 + ring * 0.3);
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2 + ring * 0.37;
          const x = home.center.x + Math.cos(a) * d;
          const z = home.center.z + Math.sin(a) * d;
          if (!g.terrain.isLand(x, z, 2)) continue;
          if (g.villages.some((o) => o !== home && Math.hypot(o.center.x - x, o.center.z - z) < o.radius * 1.3 + R)) continue;
          // Clear of the home village's own buildings.
          let ok = true;
          const keep = (px: number, pz: number, r: number) => {
            if (Math.hypot(px - x, pz - z) < R + r + clearance) ok = false;
          };
          keep(home.store.pos.x, home.store.pos.z, 4);
          keep(home.worship.pos.x, home.worship.pos.z, 8);
          for (const h of home.houses) keep(h.pos.x, h.pos.z, 3);
          for (const f of home.fields) keep(f.pos.x, f.pos.z, 7);
          for (const o of home.obstacles) keep(o.pos.x, o.pos.z, o.radius);
          if (!ok) continue;
          // Flatness over the dais.
          let top = g.terrain.heightAt(x, z);
          let bot = top;
          let wet = false;
          for (let k = 0; k < 16; k++) {
            const aa = (k / 16) * Math.PI * 2;
            for (const f of [0.5, 1]) {
              const h = g.terrain.heightAt(x + Math.cos(aa) * R * f, z + Math.sin(aa) * R * f);
              top = Math.max(top, h);
              bot = Math.min(bot, h);
              if (h < SEA_LEVEL + 0.8) wet = true;
            }
          }
          if (wet) continue;
          const range = top - bot;
          if (range > 7) continue;
          const score = range * 2 + d * 0.05 - top * 0.05;
          if (!best || score < best.score) best = { x, z, y: top - 0.3, score };
        }
      }
      if (best) break;
    }
    return best;
  }

  /** Every village worships you: raise the Wonder. */
  unlock(): Site | null {
    const g = this.game;
    if (this.wonderUnlocked) return this.wonder;
    const spot = this.findWonderSpot();
    if (!spot) {
      this.unlockAt = g.time + 20;
      return null;
    }
    const home = g.villages.find((v) => v.isHome)!;
    this.wonderUnlocked = true;
    // Clear the footprint of trees and boulders.
    const R = DEFS.wonder.radius + 1;
    g.forEachNear(spot.x, spot.z, R, (e) => {
      if (e.kind === 'tree' || e.kind === 'rock') {
        g.fx.dust(e.pos.x, e.pos.y, e.pos.z, 6, 0.6);
        g.remove(e);
      }
    });
    const site = new Site(home, DEFS.wonder, spot.x, spot.y, spot.z, 0);
    site.onRemote = (from, res, amount) => this.launchMote(from, site, res, amount);
    g.add(site);
    home.obstacles.push({ pos: site.pos, radius: DEFS.wonder.radius + 4 });
    this.wonder = site;
    this.wonderPrayer = this.prayers.spawnProject(home, DEFS.wonder.icon, DEFS.wonder.prayer[0], DEFS.wonder.thanks);
    g.audio.wonderCalls();
    g.hud.showBanner('The Wonder awaits', 'Every village worships you. Gather timber, stone and food, and raise something unforgettable.');
    g.message('The Wonder can be raised! Drop boulders on its dais; all your villages will bring timber and food.', 'divine', 'wonder-unlock');
    g.fx.sparkle(site.pos.x, site.pos.y + 4, site.pos.z, 120, 0xbff0ff, 24);
    g.events.emit('wonderUnlocked', {});
    this.advisors.say(
      [
        { who: 'spirit', text: 'Every heart on the island is yours. Now they want to build you something. A Wonder!' },
        { who: 'imp', text: 'Big. Shiny. Mostly rocks, naturally. Start throwing.' },
      ],
      { pri: 'important', topic: 'wonder-unlock', cooldown: 0 },
    );
    return site;
  }

  private completeWonder(w: Site) {
    const g = this.game;
    w.complete = true;
    this.wonderDone = true;
    for (const v of g.villages) v.wonderSite = null;
    g.audio.wonderAwakens();
    g.hud.showBanner('The Wonder is complete', 'Light spills across the island. And far over the sea, something stirs...');
    g.message('The Wonder shines! The island is yours.', 'divine', 'wonder-done');
    this.celebrate = 14;
    const prayer = this.wonderPrayer;
    this.wonderPrayer = null;
    if (prayer) this.prayers.fulfil(prayer);
    this.advisors.say(
      [
        { who: 'spirit', text: 'It is the most beautiful thing I have ever seen. Look at the light on the water.' },
        { who: 'imp', text: '...Hold on. Is anyone else feeling a draught from the east? Across the sea?' },
        { who: 'spirit', text: 'Something stirs out there. But that is a story for another day.' },
      ],
      { pri: 'important', topic: 'wonder-done', cooldown: 0 },
    );
    g.onWonderCompleted();
  }

  /** Light showers over the finished Wonder for a few seconds. */
  private celebration(dt: number) {
    const g = this.game;
    const w = this.wonder;
    if (!w) return;
    this.celebrate -= dt;
    const topY = w.wonderVisual?.topY ?? 40;
    if (Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2;
      g.fx.sparkle(w.pos.x + Math.cos(a) * 13, w.pos.y + 4 + Math.random() * 8, w.pos.z + Math.sin(a) * 13, 3, 0xbff0ff, 2);
    }
    if (Math.random() < dt * 20) g.fx.sparkle(w.pos.x, w.pos.y + topY + Math.random() * 4, w.pos.z, 4, 0xfff0b0, 6);
  }

  // ----------------------------------------------------------------- motes

  /** Another village's offering flies across the island as a trail of light. */
  private launchMote(from: Village, site: Site, res: Res, amount: number) {
    const a = from.worship.pos;
    const f = new THREE.Vector3(a.x, a.y + 3, a.z);
    const t = new THREE.Vector3(site.pos.x, site.pos.y + 8, site.pos.z);
    const dist = f.distanceTo(t);
    this.motes.push({ from: f, to: t, t: 0, dur: 2.5 + dist / 55, res, amount, site, arc: 14 + dist * 0.14 });
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
        g.audio.chime(m.site.pos);
        m.site.land(g, m.res, m.amount);
      }
    }
  }

  // ------------------------------------------------------------ save / load

  /** Every project site on the island (finished ones stay as buildings), plus each village's place in the chain. */
  save() {
    const g = this.game;
    const r = (n: number) => Math.round(n * 100) / 100;
    const sites = g.entities
      .filter((e): e is Site => e instanceof Site && e.alive)
      .map((s) => ({
        v: g.villages.indexOf(s.village),
        id: s.def.id,
        x: r(s.pos.x),
        y: r(s.pos.y),
        z: r(s.pos.z),
        rot: r(s.object.rotation.y),
        complete: s.complete,
        // Materials still flying in from other villages count as delivered (the motes are dropped).
        have: (['wood', 'stone', 'food'] as Res[]).map((k) => r(Math.min(s.def.needs[k], s.have[k] + s.pending[k]))),
        given: r(s.given),
      }));
    const villages = g.villages.map((v) => {
      const vs = this.states.get(v)!;
      return {
        index: vs.index,
        nextAt: r(vs.nextAt),
        done: [...vs.done],
        quarry: r(vs.quarry),
        festival: vs.festivalSite && vs.festivalUntil ? r(Math.max(0, vs.festivalUntil - g.time)) : 0,
      };
    });
    return { sites, villages, wonderUnlocked: this.wonderUnlocked, wonderDone: this.wonderDone };
  }

  load(data: unknown) {
    const g = this.game;
    const d = data as ReturnType<Projects['save']>;
    d.villages.forEach((s, i) => {
      const vs = this.states.get(g.villages[i]);
      if (!vs) return;
      vs.index = s.index;
      vs.nextAt = s.nextAt;
      vs.quarry = s.quarry;
      vs.done.clear();
      for (const id of s.done) vs.done.add(id);
    });
    this.wonderUnlocked = d.wonderUnlocked;
    this.wonderDone = d.wonderDone;

    for (const s of d.sites) {
      const v = g.villages[s.v];
      const def = DEFS[s.id];
      if (!v || !def) continue;
      const site = new Site(v, def, s.x, s.y, s.z, s.rot);
      (['wood', 'stone', 'food'] as Res[]).forEach((k, i) => (site.have[k] = s.have[i] ?? 0));
      site.given = s.given ?? 0;
      site.complete = s.complete;
      site.shown = s.complete ? 1 : site.fraction;
      g.add(site);
      const isWonder = def.id === 'wonder';
      v.obstacles.push({ pos: site.pos, radius: def.radius + (isWonder ? 4 : 3) });
      const vs = this.states.get(v)!;
      if (isWonder) {
        site.onRemote = (from, res, amount) => this.launchMote(from, site, res, amount);
        this.wonder = site;
        if (!s.complete) this.wonderPrayer = this.prayers.spawnProject(v, def.icon, def.prayer[0], def.thanks);
      } else if (!s.complete) {
        v.projectSite = site;
        vs.site = site;
        vs.prayer = this.prayers.spawnProject(v, def.icon, pick(def.prayer), def.thanks);
      }
    }

    // A festival still in full swing carries on for the time it had left.
    d.villages.forEach((s, i) => {
      const v = g.villages[i];
      const vs = this.states.get(v);
      const site = g.entities.find((e): e is Site => e instanceof Site && e.alive && e.village === v && e.def.id === 'festival' && e.complete);
      if (!vs || !site || s.festival <= 0) return;
      vs.festivalSite = site;
      vs.festivalUntil = g.time + s.festival;
      v.festival = site;
    });
  }

  // -------------------------------------------------------------- test hooks

  /** Debug: fill a site's materials completely (the system finishes it on the next tick). */
  cheatFill(site: Site) {
    for (const r of ['wood', 'stone', 'food'] as Res[]) site.have[r] = site.def.needs[r];
  }

  /** Debug: start a village's next project right now. */
  startNow(v: Village): Site | null {
    const vs = this.states.get(v)!;
    if (vs.site || vs.index >= CHAIN.length) return vs.site;
    return this.start(vs, CHAIN[vs.index]);
  }

  /** Per-frame look: lanterns brighten at dusk (and during a festival); Wonder runes pulse. */
  frame(t: number) {
    const g = this.game;
    const night = 1 - Math.min(1, Math.max(0, g.sky.daylight * 1.5));
    let fest = 0;
    for (const vs of this.states.values()) if (vs.festivalSite) fest = 1;
    GLOW.emissiveIntensity = Math.max(0.35 + night * 1.9, fest * 1.8) * (0.92 + Math.sin(t * 3.1) * 0.08);
    RUNE_ON.emissiveIntensity = 1.2 + night * 1.2 + Math.sin(t * 1.7) * 0.25;
    CRYSTAL.emissiveIntensity = 1.4 + night * 1.0 + Math.sin(t * 2.3) * 0.3;
  }
}
