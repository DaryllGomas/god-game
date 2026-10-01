import * as THREE from 'three';
import { Terrain } from './world/Terrain';
import { Water } from './world/Water';
import { Sky } from './world/Sky';
import { Effects } from './fx/Particles';
import { GodCamera } from './camera/GodCamera';
import { Hand } from './hand/Hand';
import { Input } from './input/Input';
import { Controls } from './input/Controls';
import { HUD } from './ui/HUD';
import { Player } from './systems/Player';
import { updatePhysics } from './systems/Physics';
import { updateFire } from './systems/Fire';
import { Village } from './village/Village';
import type { Entity, Kind } from './entities/Entity';
import { Rock, Tree } from './entities/Nature';
import { Forest } from './entities/Forest';
import { Golem } from './creature/Golem';
import { CreaturePanel } from './ui/CreaturePanel';
import { House, Store } from './entities/Buildings';
import { Villager, type DeathCause } from './entities/Villager';
import { MIRACLE_INFO, Orb, type MiracleId } from './miracles/Miracles';
import { MAT } from './art/Models';
import { Audio, type SoundscapeInput } from './audio/Audio';
import { EventBus } from './systems/Events';
import { DAY_LENGTH, PLAYER, SEA_LEVEL, START_TIME_OF_DAY, VILLAGE, VILLAGE_SITES, WORLD_SEED, WORLD_SIZE } from './config';
import { Rng } from './util/rng';
import { Noise2D } from './util/noise';
import { SaveSystem, loadPlugins, quarantine, readSave, restoreWorld } from './systems/Save';

const MAX_TREES = 520;

/**
 * A plugin is a self-contained feature (prayers, seasons, rival...). Drop a file in
 * src/plugins/ that exports `install(game)` and it is loaded automatically.
 */
export interface GamePlugin {
  name: string;
  /** Simulation step (scaled by game speed, not called while paused). */
  update?(dt: number): void;
  /** Every rendered frame, in real seconds (camera, UI, visuals). */
  frame?(realDt: number): void;
  resize?(width: number, height: number): void;
  /** Save/load: this plugin's state as plain JSON-able data (see systems/Save.ts). */
  save?(): unknown;
  /** Restore what `save` returned; called once, after every plugin is installed. */
  load?(data: unknown): void;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly terrain: Terrain;
  readonly water: Water;
  readonly sky: Sky;
  readonly fx: Effects;
  readonly forest: Forest;
  readonly godCam: GodCamera;
  readonly hand: Hand;
  readonly input: Input;
  readonly controls: Controls;
  readonly player = new Player();
  readonly audio = new Audio();
  /** World events (gifts, miracles, births, deaths...). Subscribe with events.on(). */
  readonly events = new EventBus();
  readonly plugins: GamePlugin[] = [];
  /** Multipliers that systems like seasons and weather adjust; 1 = normal. */
  readonly modifiers = { cropGrowth: 1, treeGrowth: 1, villagerHunger: 1, fireSpread: 1 };
  /** A plugin may take over the final render (e.g. post-processing). */
  renderOverride: ((scene: THREE.Scene, camera: THREE.Camera) => void) | null = null;
  readonly hud: HUD;
  /** Autosave and the title screen's Continue / New island (see systems/Save.ts). */
  readonly saves: SaveSystem;
  readonly villages: Village[] = [];
  readonly entities: Entity[] = [];
  creature!: Golem;
  private creaturePanel!: CreaturePanel;

  /** Simulation seconds (scaled by game speed, frozen when paused). */
  time = 0;
  realTime = 0;
  dayTime = START_TIME_OF_DAY;
  day = 1;
  speed = 1;
  paused = false;
  selectedVillage: Village | null = null;
  hoverBuilding: Entity | null = null;
  private won = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly projV = new THREE.Vector3();
  private lastFrame = performance.now();
  private influenceTimer = 0;
  private regrowTimer = 0;
  private removals = false;
  private soundscapeTimer = 0;
  private soundscape: Omit<SoundscapeInput, 'daylight' | 'dayTime'> = { water: 0, land: 1, fire: 0, rain: 0, village: 0, worship: null };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.terrain = new Terrain(WORLD_SEED, VILLAGE_SITES);
    this.scene.add(this.terrain.mesh);
    this.water = new Water(this.terrain.heightTexture);
    this.scene.add(this.water.mesh);
    this.sky = new Sky(this.scene);
    this.fx = new Effects(this.scene);
    this.forest = new Forest(this.scene);
    this.godCam = new GodCamera(window.innerWidth / window.innerHeight);
    this.hand = new Hand(this.scene);
    this.input = new Input(this.renderer.domElement);
    this.controls = new Controls(this, this.input);

    // Continue a saved island if there is one (terrain is regenerated from the seed, everything on it from the save).
    let saved = readSave();
    if (saved) {
      try {
        restoreWorld(this, saved);
      } catch (err) {
        console.warn('The saved island could not be rebuilt; starting a new one. The save is kept under a backup key.', err);
        quarantine();
        this.clearWorld();
        saved = null;
      }
    }
    if (!saved) this.buildWorld();
    this.saves = new SaveSystem(this, saved);
    this.hud = new HUD(this, document.body);
    this.creaturePanel = new CreaturePanel(this, this.creature, this.hud.root);
    this.installPlugins();
    if (saved) loadPlugins(this, saved);

    const home = this.villages.find((v) => v.isHome)!;
    this.godCam.jumpTo(home.center.x, home.center.z + 20, this.terrain);
    const cam = saved?.world.cam;
    if (cam) {
      this.godCam.jumpTo(cam[0], cam[1], this.terrain);
      this.godCam.rotate(cam[2] - this.godCam.yaw, cam[3] - this.godCam.pitch);
      this.godCam.setDistance(cam[4]);
    }
    this.updateInfluence();

    // Browsers only start audio after a gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private installPlugins() {
    const modules = import.meta.glob<{ install?: (game: Game) => GamePlugin | void }>('./plugins/*.ts', { eager: true });
    for (const path of Object.keys(modules).sort()) {
      try {
        const plugin = modules[path].install?.(this);
        if (plugin) this.plugins.push(plugin);
      } catch (err) {
        console.error(`Plugin ${path} failed to install`, err);
      }
    }
  }

  /** Draw the scene (through a plugin's post-processing, if one is installed). */
  private render() {
    const cam = this.godCam.camera;
    if (this.renderOverride) this.renderOverride(this.scene, cam);
    else this.renderer.render(this.scene, cam);
  }

  // ---------------------------------------------------------------- world

  /** Throw away a half-restored world (a save that failed to load) before building a fresh one. */
  private clearWorld() {
    for (const e of this.entities) {
      this.scene.remove(e.object);
      if (e instanceof Tree) this.forest.remove(e);
    }
    this.entities.length = 0;
    this.villages.length = 0;
    this.time = 0;
    this.day = 1;
    this.dayTime = START_TIME_OF_DAY;
    this.speed = 1;
    this.player.power = PLAYER.startPower;
    this.player.alignment = 0;
  }

  private buildWorld() {
    VILLAGE_SITES.forEach((site, i) => this.villages.push(new Village(this, site, WORLD_SEED + 100 + i)));

    const rng = new Rng(WORLD_SEED + 5);
    const forest = new Noise2D(WORLD_SEED + 6);
    const half = WORLD_SIZE / 2;

    // Groves near each village so there's always timber in reach.
    for (const v of this.villages) {
      let placed = 0;
      for (let i = 0; i < 200 && placed < 22; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(v.radius * 1.25, v.radius * 2.1);
        const x = v.center.x + Math.cos(a) * d;
        const z = v.center.z + Math.sin(a) * d;
        if (this.canPlantTree(x, z)) {
          this.plantTree(rng, x, z, rng.range(0.7, 1));
          placed++;
        }
      }
    }
    // Forests elsewhere, clustered by noise.
    let trees = 0;
    for (let i = 0; i < 9000 && trees < 380; i++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const density = forest.fbm(x * 0.008, z * 0.008, 3);
      if (density < 0.05 || rng.next() > density * 1.6) continue;
      if (!this.canPlantTree(x, z)) continue;
      this.plantTree(rng, x, z, rng.range(0.45, 1));
      trees++;
    }

    this.spawnCreature(rng);

    // Boulders
    let rocks = 0;
    for (let i = 0; i < 3000 && rocks < 55; i++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      if (!this.terrain.isLand(x, z, 1.5) || this.terrain.heightAt(x, z) > 60) continue;
      if (this.villages.some((v) => v.contains(x, z, 1.1))) continue;
      const r = rng.range(1.1, 2.6);
      const rock = new Rock(rng.int(0, 1e6), x, z, r);
      rock.pos.y = this.terrain.heightAt(x, z) + rock.groundOffset;
      this.add(rock);
      rocks++;
    }
    // A couple of handy boulders just outside each village for throwing practice.
    for (const v of this.villages) {
      for (let i = 0; i < 3; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = v.radius * rng.range(1.05, 1.3);
        const x = v.center.x + Math.cos(a) * d;
        const z = v.center.z + Math.sin(a) * d;
        if (!this.terrain.isLand(x, z, 1.5)) continue;
        const rock = new Rock(rng.int(0, 1e6), x, z, rng.range(1.2, 2));
        rock.pos.y = this.terrain.heightAt(x, z) + rock.groundOffset;
        this.add(rock);
      }
    }
  }

  /** The prototype golem lives just outside the home village. */
  private spawnCreature(rng: Rng) {
    const home = this.villages.find((v) => v.isHome)!;
    let x = home.center.x + home.radius * 1.2;
    let z = home.center.z;
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const cx = home.center.x + Math.cos(a) * home.radius * 1.15;
      const cz = home.center.z + Math.sin(a) * home.radius * 1.15;
      const crowded = home.fields.some((f) => Math.hypot(f.pos.x - cx, f.pos.z - cz) < 11) || home.houses.some((h) => Math.hypot(h.pos.x - cx, h.pos.z - cz) < 8);
      if (!crowded && this.terrain.isLand(cx, cz, 2) && this.terrain.normalAt(cx, cz, this.projV).y > 0.9) {
        x = cx;
        z = cz;
        break;
      }
    }
    this.creature = new Golem(home, x, z);
    this.creature.pos.y = this.terrain.heightAt(x, z);
    this.add(this.creature);
  }

  /** Keeps the island stocked with boulders (the golem eats and throws them). */
  private spawnBoulder() {
    let rocks = 0;
    for (const e of this.entities) if (e.kind === 'rock' && e.alive) rocks++;
    if (rocks >= 60) return;
    const half = WORLD_SIZE / 2;
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() * 2 - 1) * half;
      const z = (Math.random() * 2 - 1) * half;
      if (!this.terrain.isLand(x, z, 1.5) || this.terrain.heightAt(x, z) > 60) continue;
      if (this.villages.some((v) => v.contains(x, z, 1.1))) continue;
      const rock = new Rock(Math.floor(Math.random() * 1e6), x, z, 1.1 + Math.random() * 1.4);
      rock.pos.y = this.terrain.heightAt(x, z) + rock.groundOffset;
      this.add(rock);
      return;
    }
  }

  private plantTree(rng: Rng, x: number, z: number, growth: number) {
    const t = new Tree(rng.int(0, 1e6), x, z, growth);
    t.pos.y = this.terrain.heightAt(x, z);
    this.add(t);
  }

  canPlantTree(x: number, z: number): boolean {
    const h = this.terrain.heightAt(x, z);
    if (h < SEA_LEVEL + 2.2 || h > 58) return false;
    if (this.terrain.normalAt(x, z, this.projV).y < 0.82) return false;
    for (const v of this.villages) if (v.contains(x, z, 1.1)) return false;
    for (const e of this.entities) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (e.kind === 'tree' && d < 3.2) return false;
      if ((e.kind === 'field' || e.kind === 'house') && d < 8) return false;
      if (e.kind === 'site' && d < e.radius + 3) return false;
    }
    return true;
  }

  // ----------------------------------------------------- entity registry

  add(e: Entity) {
    this.entities.push(e);
    this.scene.add(e.object);
    e.syncObject();
    if (e instanceof Tree) this.forest.add(e);
  }

  remove(e: Entity) {
    if (!e.alive) return;
    e.alive = false;
    this.removals = true;
    if (this.hand.held === e) this.hand.held = null;
    if (this.hand.hover === e) this.hand.hover = null;
  }

  private flushRemovals() {
    if (!this.removals) return;
    this.removals = false;
    let w = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.alive) this.entities[w++] = e;
      else {
        this.scene.remove(e.object);
        if (e instanceof Tree) this.forest.remove(e);
        e.dispose();
      }
    }
    this.entities.length = w;
  }

  forEachNear(x: number, z: number, r: number, cb: (e: Entity) => void) {
    for (const e of this.entities) {
      if (!e.alive) continue;
      const dx = e.pos.x - x;
      const dz = e.pos.z - z;
      if (dx * dx + dz * dz <= r * r) cb(e);
    }
  }

  nearest<T extends Entity>(kind: Kind, x: number, z: number, maxDist: number, filter?: (e: Entity) => boolean): T | null {
    let best: Entity | null = null;
    let bd = maxDist * maxDist;
    for (const e of this.entities) {
      if (!e.alive || e.kind !== kind) continue;
      const dx = e.pos.x - x;
      const dz = e.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd && (!filter || filter(e))) {
        bd = d;
        best = e;
      }
    }
    return best as T | null;
  }

  storeNear(x: number, z: number, r: number): Store | null {
    for (const v of this.villages) {
      if (Math.hypot(v.store.pos.x - x, v.store.pos.z - z) < r) return v.store;
    }
    return null;
  }

  villageAt(x: number, z: number): Village | null {
    for (const v of this.villages) if (v.contains(x, z, 1.25)) return v;
    return null;
  }

  villageOf(e: Entity): Village | null {
    return (e as unknown as { village?: Village }).village ?? null;
  }

  inInfluence(x: number, z: number): boolean {
    for (const v of this.villages) {
      if (v.owner === 'player' && Math.hypot(v.center.x - x, v.center.z - z) < v.influenceRadius) return true;
    }
    return false;
  }

  findWaterNear(x: number, z: number, r: number): THREE.Vector3 | null {
    for (let d = 5; d <= r; d += 5) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (this.terrain.heightAt(px, pz) < SEA_LEVEL - 0.8) return new THREE.Vector3(px, SEA_LEVEL, pz);
      }
    }
    return null;
  }

  private updateInfluence() {
    this.terrain.setInfluence(
      this.villages.filter((v) => v.owner === 'player').map((v) => ({ x: v.center.x, z: v.center.z, r: v.influenceRadius })),
    );
    // The rival god's villages get a violet ring of their own.
    this.terrain.setRivalInfluence(
      this.villages.filter((v) => v.owner === 'rival').map((v) => ({ x: v.center.x, z: v.center.z, r: v.influenceRadius })),
    );
  }

  // ------------------------------------------------------ world events

  /** Something heavy landed or rolled: squash villagers, batter houses. */
  crush(source: Entity, pos: THREE.Vector3, radius: number, damage: number) {
    const blame = source.thrownByPlayer;
    const byCreature = source.thrownByCreature;
    this.forEachNear(pos.x, pos.z, radius + 3, (e) => {
      if (e === source || e.held || e.airborne) return;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (e instanceof Villager && !e.dead && d < radius && damage > 0.15) {
        e.die(this, 'crushed', blame);
        if (byCreature) this.creature.onThrowKilled();
      }
      else if (e instanceof House && d < radius + 3) e.damage(this, damage * 0.5, blame);
    });
  }

  shake(amount: number) {
    this.godCam.shake(amount);
  }

  /**
   * An impressive deed at (x, z). Neutral villages in range grow in belief;
   * your own villages gain a little faith.
   */
  impress(x: number, z: number, amount: number, alignmentDelta: number, reason: string) {
    if (alignmentDelta) this.player.shiftAlignment(alignmentDelta);
    for (const v of this.villages) {
      const d = Math.hypot(v.center.x - x, v.center.z - z);
      if (d > VILLAGE.impressRange) continue;
      const fall = 1 - d / VILLAGE.impressRange;
      const gain = amount * fall * fall;
      if (gain < 0.5) continue;
      if (v.owner === 'player') {
        v.belief = Math.min(100, v.belief + gain * 0.3);
        continue;
      }
      v.belief += gain;
      if (gain >= 3) this.audio.chime(v.center, 1.25);
      this.hud.floatText(v.center.x, v.center.y + 14, v.center.z, `+${Math.round(gain)} belief`, '#f4cf73');
      if (v.belief >= VILLAGE.convertAt) v.convert(this);
      else if (gain >= 3) this.message(`${v.name}: “${reason}!” (belief ${Math.floor(v.belief)}%)`, 'divine', `imp-${v.name}`);
    }
  }

  giftToVillage(v: Village, amount: number, kind: 'food' | 'wood') {
    this.audio.chime(v.store.pos);
    this.events.emit('gift', { village: v, kind, amount });
    const worth = kind === 'food' ? amount * 0.28 : amount * 0.15;
    if (v.owner === 'player') {
      v.belief = Math.min(100, v.belief + worth * 0.2);
      this.player.shiftAlignment(0.004);
      return;
    }
    this.player.shiftAlignment(0.012);
    this.impress(v.center.x, v.center.z, worth, 0, `A gift of ${kind}`);
  }

  /** First landing after a throw: onlookers are impressed by distance and heft. */
  onThrownLanding(e: Entity) {
    const flight = Math.hypot(e.pos.x - e.launchPoint.x, e.pos.z - e.launchPoint.z);
    this.events.emit('landed', { entity: e, flight });
    if (e.kind === 'orb' || e.kind === 'food' || e.kind === 'wood') return;
    if (flight < 12) return;
    const base = e.kind === 'rock' ? 2 + e.radius * 1.5 : e.kind === 'villager' ? 3 : 2;
    this.impress(e.pos.x, e.pos.z, base + flight * 0.05, 0, flight > 120 ? 'An astonishing throw' : 'A mighty throw');
  }

  onThrow(e: Entity, speed: number) {
    if (e instanceof Villager && speed > 25) this.player.shiftAlignment(-0.006);
  }

  onVillagerDeath(v: Villager, cause: DeathCause, byPlayer: boolean) {
    this.events.emit('villagerDied', { villager: v, cause, byPlayer });
    const village = v.village;
    const mine = village.owner === 'player';
    if (cause === 'eaten') {
      // Your creature is your responsibility, but less so than your own hand.
      this.player.shiftAlignment(-0.015);
      if (mine) village.belief = Math.max(0, village.belief - 6);
      else this.impress(v.pos.x, v.pos.z, 5, 0, 'The golem devours one of them');
    }
    if (byPlayer) {
      this.player.shiftAlignment(-0.045);
      if (mine) village.belief = Math.max(0, village.belief - 8);
      else this.impress(v.pos.x, v.pos.z, 6, 0, 'Fear of an angry god');
    }
    if (mine) {
      const why = {
        starved: 'starved to death',
        thrown: 'fell to their death',
        crushed: 'was crushed',
        burned: 'burned to death',
        eaten: 'was eaten by your golem',
      }[cause];
      this.message(`A villager of ${village.name} ${why}.`, 'bad', `death-${cause}`);
    }
    if (mine && village.population === 0) this.checkDefeat();
  }

  onHouseDestroyed(h: House, byPlayer: boolean) {
    this.audio.crumble(h.pos);
    this.events.emit('houseDestroyed', { house: h, byPlayer });
    const v = h.village;
    if (byPlayer) {
      this.player.shiftAlignment(-0.035);
      if (v.owner === 'player') v.belief = Math.max(0, v.belief - 10);
      else this.impress(h.pos.x, h.pos.z, 8, 0, 'Their homes crumble before you');
    }
    if (v.owner === 'player') this.message(`A house in ${v.name} was destroyed.`, 'bad');
  }

  onBuildingHit(_h: House, _dmg: number, _byPlayer: boolean) {
    this.shake(0.3);
  }

  onVillageConverted(v: Village) {
    this.audio.fanfare();
    this.events.emit('villageConverted', { village: v });
    this.hud.showBanner(`${v.name} worships you!`, 'Their people will dance for you now, and your influence grows.');
    this.message(`${v.name} now believes in you!`, 'good');
    this.fx.sparkle(v.center.x, v.center.y + 6, v.center.z, 200, 0xfff0b0, 30);
    this.updateInfluence();
    // Winning every heart now unlocks the Wonder (see plugins/projects.ts); finishing it wins the island.
  }

  /** The Wonder is complete: the island is yours. */
  onWonderCompleted() {
    if (this.won) return;
    this.won = true;
    this.events.emit('wonderCompleted', {});
    setTimeout(() => {
      const followers = this.villages.reduce((s, x) => s + x.population, 0);
      const mins = Math.floor(this.time / 60);
      this.hud.showWin({ time: `${mins} min`, alignment: this.player.alignmentLabel, followers });
    }, 6000);
  }

  onVillageLost(v: Village) {
    this.events.emit('villageLost', { village: v });
    this.hud.showBanner(`${v.name} has lost faith`, 'Starved and neglected, they turn away from you.');
    this.message(`${v.name} no longer believes in you.`, 'bad');
    this.updateInfluence();
  }

  /** A village's faith hit 0 while the rival pressed on it: it now worships him (see src/rival). */
  onVillageTurned(v: Village) {
    this.events.emit('villageTurned', { village: v });
    this.updateInfluence();
  }

  private checkDefeat() {
    const followers = this.villages.filter((v) => v.owner === 'player').reduce((s, v) => s + v.population, 0);
    if (followers === 0) this.hud.showBanner('Your people are gone', 'A god without worshippers is no god at all.');
  }

  // --------------------------------------------------------- miracles

  selectMiracle(id: MiracleId) {
    const info = MIRACLE_INFO[id];
    const held = this.hand.held;
    if (held?.kind === 'orb') {
      if ((held as Orb).miracle === id) return this.cancelMiracle();
      this.cancelMiracle();
    } else if (held) {
      this.message('Your hand is full. Put that down first.', 'warn', 'hand-full');
      return;
    }
    if (!this.player.spend(info.cost)) {
      this.message(`Not enough prayer power for ${info.name} (${info.cost}). More worshippers will help.`, 'warn', 'no-power');
      return;
    }
    const orb = new Orb(id);
    orb.pos.copy(this.hand.pos);
    this.add(orb);
    this.hand.grab(this, orb);
    this.audio.miracleSelect(id);
  }

  cancelMiracle() {
    const orb = this.hand.held;
    if (!(orb instanceof Orb)) return;
    this.player.addPower(MIRACLE_INFO[orb.miracle].cost);
    this.audio.click();
    this.hand.held = null;
    orb.held = false;
    this.remove(orb);
  }

  // ------------------------------------------------------------ misc

  message(text: string, tone: 'good' | 'bad' | 'info' | 'warn' | 'divine' = 'info', key?: string) {
    this.hud?.message(text, tone, key);
  }

  floatText(x: number, y: number, z: number, text: string, color?: string) {
    this.hud.floatText(x, y, z, text, color);
  }

  selectVillage(v: Village | null) {
    this.selectedVillage = v;
  }

  /** A plain click (no drag) on a non-grabbable thing. */
  clickEntity(e: Entity | null) {
    if (e instanceof Golem) e.pat(this);
    else this.selectVillage(e ? this.villageOf(e) : null);
  }

  /** "Come here": the creature walks to the Hand, or to the middle of the view. */
  callCreature() {
    this.creature.callTo(this, this.hand.valid ? this.hand.ground : this.godCam.target);
  }

  focusCreature() {
    const c = this.creature;
    this.godCam.flyTo(c.pos.x, c.pos.z);
    this.godCam.setDistance(70);
  }

  togglePause() {
    this.paused = !this.paused;
  }

  setSpeed(s: number) {
    this.speed = s;
    this.paused = false;
  }

  goHome() {
    const home = this.villages.find((v) => v.isHome);
    if (home) this.godCam.flyTo(home.center.x, home.center.z);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.godCam.camera.aspect = w / h;
    this.godCam.camera.updateProjectionMatrix();
    this.fx.resize(h * this.renderer.getPixelRatio(), this.godCam.camera.fov);
    for (const p of this.plugins) p.resize?.(w, h);
  }

  // ----------------------------------------------------------- picking

  private updateCursor() {
    const cam = this.godCam.camera;
    this.ndc.set(this.input.nx, this.input.ny);
    this.raycaster.setFromCamera(this.ndc, cam);
    const hand = this.hand;
    hand.valid = this.input.inside && this.terrain.raycast(this.raycaster.ray, hand.ground);
    hand.blocked = hand.valid && !this.inInfluence(hand.ground.x, hand.ground.z);

    hand.hover = null;
    this.hoverBuilding = null;
    if (!hand.valid || this.controls.mode !== 'none' || this.hud.helpOpen) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const sx = this.input.x;
    const sy = this.input.y;
    const focal = h / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let bestGrab: Entity | null = null;
    let bestGrabScore = 1;
    let bestBuild: Entity | null = null;
    let bestBuildScore = 1;
    for (const e of this.entities) {
      if (!e.alive || e.held) continue;
      const isBuilding = e.kind === 'house' || e.kind === 'store' || e.kind === 'worship' || e.kind === 'field' || e.kind === 'creature' || e.kind === 'site';
      if (!e.grabbable && !isBuilding) continue;
      if (e instanceof Villager && !e.object.visible) continue;
      this.projV.set(e.pos.x, e.pos.y + Math.min(e.topHeight * 0.5, 3), e.pos.z);
      const dist = cam.position.distanceTo(this.projV);
      this.projV.project(cam);
      if (this.projV.z > 1) continue;
      const px = (this.projV.x * 0.5 + 0.5) * w;
      const py = (-this.projV.y * 0.5 + 0.5) * h;
      const rPx = (e.radius / dist) * focal;
      const d = Math.hypot(px - sx, py - sy);
      if (isBuilding) {
        const score = d / Math.max(rPx * 1.1, 18);
        if (score < bestBuildScore) {
          bestBuildScore = score;
          bestBuild = e;
        }
      } else {
        // Small things get a generous minimum target; nearer the camera wins ties.
        const score = d / Math.max(rPx * 1.2, 16) + dist * 0.0005;
        if (score < bestGrabScore) {
          bestGrabScore = score;
          bestGrab = e;
        }
      }
    }
    hand.hover = hand.held ? null : bestGrab;
    this.hoverBuilding = bestGrab ? null : bestBuild;
  }

  // ------------------------------------------------------------- loop

  private frame() {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.realTime += realDt;

    this.controls.update(realDt, this.realTime);
    this.godCam.update(realDt, this.terrain);
    this.updateCursor();
    this.hand.update(this, realDt, this.realTime);

    if (!this.paused && !this.hud.helpOpen) {
      const steps = this.speed;
      for (let i = 0; i < steps; i++) this.simulate(realDt);
      this.fx.update(realDt * this.speed);
    }

    const cam = this.godCam.camera;
    this.sky.update(this.dayTime, cam, this.godCam.target, this.godCam.distance);
    this.water.update(this.realTime, this.sky.sunDir, this.sky.sunColor, this.sky.daylight);
    this.fx.light = 0.18 + 0.82 * this.sky.daylight;
    this.terrain.setFrame(this.realTime, this.godCam.distance);
    MAT.window.emissiveIntensity = Math.max(0, 1 - this.sky.daylight * 1.8) * 1.6;
    this.forest.sync();
    this.updateSoundscape(realDt);
    this.hud.update(realDt);
    this.creaturePanel.update(realDt);
    for (const p of this.plugins) p.frame?.(realDt);
    this.render();
  }

  /** Feed the audio engine the camera and what's around the view (sea, fires, rain). */
  private updateSoundscape(dt: number) {
    const cam = this.godCam;
    this.audio.setListener(cam.target, cam.yaw, cam.distance);
    this.soundscapeTimer -= dt;
    if (this.soundscapeTimer <= 0) {
      this.soundscapeTimer = 0.25;
      const t = cam.target;
      const ring = Math.max(25, cam.distance * 0.5);
      let wet = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (this.terrain.heightAt(t.x + Math.cos(a) * ring, t.z + Math.sin(a) * ring) < SEA_LEVEL) wet++;
      }
      const range = cam.distance * 1.2 + 40;
      let fire = 0;
      let rain = 0;
      for (const e of this.entities) {
        if (!e.alive || (!e.burning && e.kind !== 'cloud')) continue;
        const d = Math.hypot(e.pos.x - t.x, e.pos.z - t.z);
        if (d > range) continue;
        const near = 1 - d / range;
        if (e.burning) fire += near * (e.kind === 'house' ? 1.5 : 0.6);
        else rain = Math.max(rain, near);
      }
      this.soundscape.water = wet / 12;
      this.soundscape.land = 1 - wet / 12;
      this.soundscape.fire = Math.min(1, fire / 5);
      this.soundscape.rain = rain;

      // Nearest lively village (murmur) and nearest worship circle with dancers (drums).
      let village = 0;
      let worship: SoundscapeInput['worship'] = null;
      let bestDrum = Infinity;
      for (const v of this.villages) {
        const d = Math.hypot(v.center.x - t.x, v.center.z - t.z);
        village = Math.max(village, Math.max(0, 1 - d / (v.radius * 2.5 + cam.distance * 0.3)) * Math.min(1, v.population / 8));
        if (v.dancers > 0 && d < bestDrum) {
          bestDrum = d;
          worship = { pos: v.worship.pos, level: Math.min(1, v.dancers / 4) };
        }
      }
      this.soundscape.village = village;
      this.soundscape.worship = worship;
    }
    this.audio.update(dt, { daylight: this.sky.daylight, dayTime: this.dayTime, ...this.soundscape });
  }

  /** Something thrown or dropped hits the ground. */
  onLanding(e: Entity, speed: number) {
    if (speed < 5 || e.kind === 'orb') return;
    const weight = e.kind === 'rock' ? 0.6 + e.radius * 0.5 : e.kind === 'tree' ? 1 : e.kind === 'villager' ? 0.45 : 0.35;
    this.audio.thud(e.pos, (speed / 25) * weight);
  }

  onSplash(e: Entity) {
    this.audio.splash(e.pos, Math.max(0.4, e.radius * 0.6));
  }

  /** Debug/test hook: run the simulation forward without waiting for frames. */
  advance(seconds: number) {
    const dt = 0.05;
    for (let t = 0; t < seconds; t += dt) {
      this.simulate(dt);
      this.fx.update(dt);
      this.sky.update(this.dayTime, this.godCam.camera, this.godCam.target, this.godCam.distance);
    }
    this.hud.update(Math.min(seconds, 0.3));
    this.forest.sync();
    for (const p of this.plugins) p.frame?.(Math.min(seconds, 0.3));
    this.render();
  }

  private simulate(dt: number) {
    this.time += dt;
    this.dayTime += dt / DAY_LENGTH;
    if (this.dayTime >= 1) {
      this.dayTime -= 1;
      this.day++;
      this.events.emit('newDay', { day: this.day });
    }

    for (const v of this.villages) v.update(this, dt);
    const n = this.entities.length;
    for (let i = 0; i < n; i++) {
      const e = this.entities[i];
      if (e.alive) e.update(this, dt);
    }
    updatePhysics(this, dt);
    updateFire(this, dt);
    for (const p of this.plugins) p.update?.(dt);

    this.influenceTimer -= dt;
    if (this.influenceTimer <= 0) {
      this.influenceTimer = 0.5;
      this.updateInfluence();
    }

    // Forests slowly spread on their own, and boulders tumble down from the hills.
    this.regrowTimer -= dt;
    if (this.regrowTimer <= 0) {
      this.regrowTimer = 4;
      if (Math.random() < 0.25) this.spawnBoulder();
      const trees = this.entities.filter((e) => e.kind === 'tree' && e.alive) as Tree[];
      if (trees.length < MAX_TREES && trees.length > 0) {
        const parent = trees[Math.floor(Math.random() * trees.length)];
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * 8;
        const x = parent.pos.x + Math.cos(a) * d;
        const z = parent.pos.z + Math.sin(a) * d;
        if (this.canPlantTree(x, z)) {
          const t = new Tree(Math.floor(Math.random() * 1e6), x, z, 0.05);
          t.pos.y = this.terrain.heightAt(x, z);
          this.add(t);
        }
      }
    }

    this.flushRemovals();
  }
}
