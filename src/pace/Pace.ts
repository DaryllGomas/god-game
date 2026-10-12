import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { DAY_LENGTH, SEA_LEVEL } from '../config';
import { DEFS, type ProjectId } from '../projects/defs';
import { WHOLE_AFTER } from '../endings/Endings';
import { ORA_LINES } from '../ora/Ora';
import { clamp } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** Walk on: days and seasons pass this many times faster, and projects ask for this share of their materials. */
export const WALK_TIME = 1.8;
export const WALK_COST = 0.6;
/** Ora checks in at most this many times in a game, never closer than this (game seconds), and not while balance is below this. */
const MAX_CHECKS = 2;
const FIRST_PRAYER_DELAY = 20; // s after the pace choice: a wood prayer at home, so the first act is see need, carry, thanks
const CHECK_GAP = 2 * DAY_LENGTH;
const CHECK_MIN_BALANCE = 0.45;
/** The marks stay this long (real seconds) at a check-in; at the first question they stay until chosen. */
const CHECK_SHOW = 28;
/** Distance of each mark from the home prayer place, floating height of its emblem, hit radius on the ground (m). */
const MARK_DIST = 34;
const MARK_HEIGHT = 12;
const MARK_HIT = 8.5;
const MARK_SIZE = 25;
/** Ora's orb: small, and hung well above the prayer place (never over it). */
const ORA_SIZE = 7;
const ORA_HEIGHT = 27;
/** Camera heading the game starts on (same as BeliefRing). */
const START_YAW = 0.5;

export type PaceChoice = 'walk' | 'stay';
export interface PaceSave {
  choice?: PaceChoice | null;
  confirmed?: boolean;
  checks?: number;
}

// ------------------------------------------------------------------ the emblems

function emblem(kind: 'road' | 'hearth' | 'ora'): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.translate(S / 2, S / 2);
  const gold = '#ffd37a';
  const glow = (r: number, col: string, a: number) => {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, col.replace('A', String(a)));
    g.addColorStop(1, col.replace('A', '0'));
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.fill();
  };
  if (kind === 'ora') {
    // Ora: a small, perfectly round blue-white orb with one faint ring. No spikes.
    glow(124, 'rgba(120,190,255,A)', 0.4);
    glow(52, 'rgba(190,225,255,A)', 0.6);
    glow(26, 'rgba(255,255,255,A)', 0.95);
    x.strokeStyle = 'rgba(200,232,255,0.4)';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(0, 0, 72, 0, Math.PI * 2);
    x.stroke();
  } else {
    glow(126, 'rgba(255,200,110,A)', 0.4);
    x.fillStyle = 'rgba(14,26,58,0.5)';
    x.beginPath();
    x.arc(0, 0, 92, 0, Math.PI * 2);
    x.fill();
    for (const [r, w, a] of [[96, 10, 1], [112, 3, 0.7], [82, 2, 0.6], [120, 1.5, 0.4]] as const) {
      x.strokeStyle = `rgba(255,211,122,${a})`;
      x.lineWidth = w;
      x.beginPath();
      x.arc(0, 0, r, 0, Math.PI * 2);
      x.stroke();
    }
    x.strokeStyle = gold;
    x.fillStyle = gold;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.shadowColor = '#ffb84a';
    x.shadowBlur = 14;
    if (kind === 'road') {
      x.lineWidth = 11;
      x.beginPath();
      x.moveTo(-34, 56);
      x.bezierCurveTo(60, 40, -60, 4, 8, -22);
      x.bezierCurveTo(34, -34, 38, -48, 30, -60);
      x.stroke();
      x.lineWidth = 3;
      x.setLineDash([2, 12]);
      x.beginPath();
      x.moveTo(-34, 56);
      x.bezierCurveTo(60, 40, -60, 4, 8, -22);
      x.stroke();
    } else {
      x.lineWidth = 7;
      x.beginPath(); // the flame
      x.moveTo(0, -62);
      x.bezierCurveTo(36, -30, 44, 6, 22, 24);
      x.bezierCurveTo(30, 6, 12, -10, 4, -14);
      x.bezierCurveTo(10, 8, -6, 14, -10, 26);
      x.bezierCurveTo(-46, 6, -30, -34, 0, -62);
      x.fill();
      x.beginPath(); // the logs
      x.lineWidth = 9;
      x.moveTo(-44, 52);
      x.lineTo(44, 36);
      x.moveTo(-44, 36);
      x.lineTo(44, 52);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----------------------------------------------------------------- the marks

class Mark {
  readonly group = new THREE.Group();
  readonly sprite: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  readonly ground: THREE.Mesh;
  readonly base = new THREE.Vector3();
  /** 0..1 how lit it is right now (hover, chosen). */
  lit = 0;
  private readonly mat: THREE.SpriteMaterial;
  private readonly gmat: THREE.MeshBasicMaterial;

  constructor(kind: 'road' | 'hearth') {
    this.mat = new THREE.SpriteMaterial({ map: emblem(kind), transparent: true, depthWrite: false, fog: false, blending: THREE.NormalBlending });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.scale.set(MARK_SIZE, MARK_SIZE, 1);
    this.sprite.renderOrder = 9;
    // An additive twin, brighter than white so it blooms.
    this.haloMat = new THREE.SpriteMaterial({ map: this.mat.map, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.haloMat.color.setRGB(1.5, 1.25, 0.8);
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.renderOrder = 10;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.9, MARK_HEIGHT, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    beam.position.y = MARK_HEIGHT / 2;
    this.gmat = new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.ground = new THREE.Mesh(new THREE.RingGeometry(MARK_HIT * 0.62, MARK_HIT * 0.74, 56), this.gmat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.3;
    this.ground.renderOrder = 8;
    this.sprite.position.y = MARK_HEIGHT + MARK_SIZE * 0.1;
    this.group.add(this.ground, beam, this.sprite, this.halo);
    this.group.traverse((o) => (o.frustumCulled = false));
  }

  place(x: number, z: number, y: number) {
    this.base.set(x, y, z);
    this.group.position.copy(this.base);
  }

  set(level: number, t: number, phase: number) {
    const k = clamp(level, 0, 1);
    const bob = Math.sin(t * 1.3 + phase) * 0.4;
    this.sprite.position.y = MARK_HEIGHT + MARK_SIZE * 0.1 + bob;
    const s = MARK_SIZE * (1 + 0.1 * this.lit);
    this.sprite.scale.set(s, s, 1);
    this.halo.scale.set(s, s, 1);
    this.halo.position.copy(this.sprite.position);
    this.haloMat.opacity = k * (0.3 + 0.55 * this.lit) * (0.85 + 0.15 * Math.sin(t * 2.4 + phase));
    this.mat.opacity = k * (0.55 + 0.45 * this.lit);
    this.gmat.opacity = k * (0.28 + 0.5 * this.lit);
    this.ground.scale.setScalar(1 + 0.06 * Math.sin(t * 2 + phase) + 0.12 * this.lit);
    this.group.visible = k > 0.01;
  }
}

// --------------------------------------------------------------------- Pace

/**
 * Your pace (VISION "Your pace"): once after the intro Ora asks "Walk on, or stay a while?", and two marks
 * (a road, a hearth) float over the home prayer place; the hand chooses by touching (or dropping something
 * on) one. Walk on: days pass faster, projects need fewer materials, the ending comes when earned.
 * Stay: full depth, and you choose when to ascend (a light rises at the temple once the world is ready).
 * Ora checks in softly at milestones, at most twice a game.
 */
export class Pace {
  choice: PaceChoice | null = null;
  confirmed = false;
  checks = 0;
  readonly group = new THREE.Group();
  private readonly road = new Mark('road');
  private readonly hearth = new Mark('hearth');
  private readonly star: THREE.Sprite;
  private readonly light: THREE.Mesh;
  private readonly lightUni = { uStrength: { value: 0 }, uTime: { value: 0 }, uGold: { value: new THREE.Color(0xffd37a).multiplyScalar(1.7) } };
  private lightLevel = 0;
  private lightWorld = new THREE.Vector3();
  private level = 0;
  private goal = 0;
  private showFor = 0;
  private holdUntilChosen = false;
  private offered = false;
  private offerAge = 0;
  /** The first question's line has shown (or waited long enough): the marks may rise. */
  private spoke = false;
  private wantCheck = false;
  private lastCheck = -1e9;
  private clock = 0;
  private ack = 0;
  private home: Village | null = null;
  private baseNeeds = new Map<ProjectId, { wood: number; stone: number; food: number }>();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly preselect: boolean;

  constructor(private readonly game: Game) {
    this.preselect = new URLSearchParams(location.search).get('from') === 'thepath';
    for (const id of Object.keys(DEFS) as ProjectId[]) {
      const n = DEFS[id].needs;
      this.baseNeeds.set(id, { wood: n.wood, stone: n.stone, food: n.food });
    }
    this.star = new THREE.Sprite(new THREE.SpriteMaterial({ map: emblem('ora'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.star.renderOrder = 9;
    this.star.scale.setScalar(ORA_SIZE);
    const cg = new THREE.CylinderGeometry(1, 1, 1, 36, 1, true);
    cg.translate(0, 0.5, 0);
    this.light = new THREE.Mesh(
      cg,
      new THREE.ShaderMaterial({
        uniforms: this.lightUni,
        vertexShader: /* glsl */ `
          varying float vY; varying float vFace;
          void main() {
            vY = position.y;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vec3 v = cameraPosition - wp.xyz;
            vFace = abs(dot(n, v)) / max(length(v), 1e-4);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStrength; uniform float uTime; uniform vec3 uGold;
          varying float vY; varying float vFace;
          void main() {
            float core = pow(clamp(vFace, 0.0, 1.0), 1.6);
            float rise = smoothstep(0.0, 0.04, vY) * pow(clamp(1.0 - vY, 0.0, 1.0), 1.2);
            float shimmer = 0.8 + 0.2 * sin(vY * 22.0 - uTime * 1.8);
            gl_FragColor = vec4(uGold * core * rise * shimmer * clamp(uStrength, 0.0, 2.0), 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.light.frustumCulled = false;
    this.light.renderOrder = 9;
    this.light.visible = false;
    this.group.add(this.road.group, this.hearth.group, this.star, this.light);
    this.group.visible = false;
    game.scene.add(this.group);

    const ev = game.events;
    ev.on('shrineRaised', () => this.milestone());
    ev.on('seasonChanged', () => this.milestone());
    ev.on('place', ({ x, z }) => this.touchAt(x, z));
    ev.on('landed', ({ entity }) => this.touchAt(entity.pos.x, entity.pos.z));

    // Touching a mark with the hand (before the world sees the click).
    game.renderer.domElement.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const g = game.hand.ground;
        if (game.hand.valid && this.marksUp() && !game.hand.held && this.touchAt(g.x, g.z)) {
          e.stopImmediatePropagation();
          return;
        }
        if (this.lightLevel > 0.5 && this.touchLight(e)) e.stopImmediatePropagation();
      },
      true,
    );
  }

  // ---------------------------------------------------------------- the state

  save(): PaceSave {
    return { choice: this.choice, confirmed: this.confirmed, checks: this.checks };
  }

  load(d: unknown) {
    const s = (d ?? {}) as PaceSave;
    if (s.choice === 'walk' || s.choice === 'stay') this.choice = s.choice;
    this.confirmed = !!s.confirmed;
    this.checks = Math.max(0, Math.floor(Number(s.checks) || 0));
    this.applyChoice();
  }

  /** Whether the ending starts by itself (Walk on) or waits for the player's touch on the light (Stay). */
  autoEnd(): boolean {
    return this.choice !== 'stay';
  }

  /** Set the pace (also the debug handle). */
  choose(c: PaceChoice, confirm = true) {
    this.choice = c;
    if (confirm) {
      this.confirmed = true;
      this.holdUntilChosen = false;
      this.showFor = Math.min(this.showFor, 2.4);
      this.ack = 1;
      const b = this.markOf(c).base;
      this.game.fx.sparkle(b.x, b.y + MARK_HEIGHT, b.z, 60, 0xffe6a0, 4);
      this.game.audio.chime(b);
      if (this.firstPrayerIn < 0) this.firstPrayerIn = FIRST_PRAYER_DELAY;
    }
    this.applyChoice();
  }

  private applyChoice() {
    const f = this.choice === 'walk' ? WALK_COST : 1;
    for (const [id, base] of this.baseNeeds) {
      const n = DEFS[id].needs;
      n.wood = Math.round(base.wood * f);
      n.stone = Math.round(base.stone * f);
      n.food = Math.round(base.food * f);
    }
  }

  private markOf(c: PaceChoice) {
    return c === 'walk' ? this.road : this.hearth;
  }

  private homeVillage(): Village | null {
    if (this.home) return this.home;
    this.home = this.game.villages.find((v) => v.isHome) ?? this.game.villages.find((v) => v.owner === 'player') ?? null;
    return this.home;
  }

  private marksUp() {
    return this.level > 0.35 && this.goal > 0;
  }

  /** The hand touched (or something dropped on) the ground at x, z: chooses a mark if it is there. */
  private touchAt(x: number, z: number): boolean {
    if (!this.marksUp()) return false;
    for (const c of ['walk', 'stay'] as const) {
      const m = this.markOf(c).base;
      if (Math.hypot(m.x - x, m.z - z) < MARK_HIT) {
        this.choose(c);
        return true;
      }
    }
    return false;
  }

  private touchLight(e: PointerEvent): boolean {
    const g = this.game;
    const r = g.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, g.godCam.camera);
    const hit = this.ray.intersectObject(this.light, false).length > 0;
    const near = g.hand.valid && Math.hypot(g.hand.ground.x - this.lightWorld.x, g.hand.ground.z - this.lightWorld.z) < 11;
    if (!hit && !near) return false;
    this.ascend();
    return true;
  }

  /** The player touched the light: Ready to See begins. */
  ascend() {
    const en = (this.game as unknown as { endings?: { phase: string; startAscension(w: boolean): void } }).endings;
    if (en && en.phase === 'play') en.startAscension(false);
  }

  /** A new shrine stage or a new season: maybe Ora checks in. */
  private milestone() {
    const g = this.game;
    if (!this.confirmed || this.checks >= MAX_CHECKS || this.wantCheck) return;
    if (g.time - this.lastCheck < CHECK_GAP || g.time < 60) return;
    const bal = (g as unknown as { balance?: { value: number } }).balance?.value ?? 1;
    if (bal < CHECK_MIN_BALANCE) return;
    const ora = (g as unknown as { ora?: { raise(m: string, f?: boolean): boolean } }).ora;
    if (!ora) return;
    // Season turns are plentiful: only some of them are asked about (the first of each pair, after a long enough stretch).
    if (ora.raise('paceCheck', true)) {
      this.wantCheck = true;
      this.lastCheck = g.time;
      this.offerAge = 0;
    }
  }

  // ---------------------------------------------------------------- per frame

  /** Game seconds: Walk on makes days pass faster. */
  /** Seconds until the first prayer after the pace is chosen (Fable pass: the loop shows itself at once). */
  private firstPrayerIn = -1;

  update(dt: number) {
    if (this.firstPrayerIn > 0) {
      this.firstPrayerIn -= dt;
      if (this.firstPrayerIn <= 0) {
        const g = this.game as unknown as { villages: unknown[]; prayerSystem?: { active: unknown[]; spawnNow: (v: unknown, k: string) => unknown } };
        const home = g.villages[0];
        if (home && g.prayerSystem && g.prayerSystem.active.length === 0) g.prayerSystem.spawnNow(home, 'timber');
      }
    }
    if (this.choice !== 'walk') return;
    const g = this.game;
    const extra = (dt * (WALK_TIME - 1)) / DAY_LENGTH;
    const en = (g as unknown as { endings?: { phase: string } }).endings;
    if (!Number.isFinite(extra) || (en && en.phase !== 'play')) return;
    g.dayTime += extra;
    while (g.dayTime >= 1) {
      g.dayTime -= 1;
      g.day++;
      g.events.emit('newDay', { day: g.day });
    }
  }

  frame(dt: number) {
    const g = this.game;
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const t = g.realTime;
    const home = this.homeVillage();
    if (!home) return;

    // The first question: after the title screen, once the camera has settled.
    const gliding = !!(g.godCam as unknown as { glide?: unknown }).glide;
    const idle = !g.hud.helpOpen && g.saves.armed && !gliding && !g.paused;
    if (!this.confirmed && !this.offered && idle) {
      this.offerAge += dt;
      if (this.offerAge > 2.5) {
        this.offered = true;
        this.wantCheck = false;
        if (this.preselect && this.choice === null) this.choose('walk', false);
        this.holdUntilChosen = true;
        (g as unknown as { ora?: { raise(m: string, f?: boolean): boolean } }).ora?.raise('pace', true);
      }
    }
    // A check-in: the marks show while Ora speaks the line.
    if (this.wantCheck) {
      this.offerAge += dt;
      const showing = (g as unknown as { ora?: { state(): { showing: string | null } } }).ora?.state().showing;
      if (showing && ORA_LINES.paceCheck.includes(showing)) {
        this.wantCheck = false;
        this.checks++;
        this.showFor = CHECK_SHOW;
      } else if (this.offerAge > 75) this.wantCheck = false;
    }
    if (this.holdUntilChosen) {
      const showing = (g as unknown as { ora?: { state(): { showing: string | null } } }).ora?.state().showing;
      // Rise with Ora's line, not before it (Ora waits out a Lumi/Fizz card, and a silent orb reads as a glitch).
      if (this.offered && !this.spoke) {
        this.offerAge += dt;
        if (showing === ORA_LINES.pace[0] || this.offerAge > 20) this.spoke = true;
      }
      if (this.spoke) this.showFor = Math.max(this.showFor, 1);
    }
    this.showFor = Math.max(0, this.showFor - (this.holdUntilChosen ? 0 : dt));
    this.goal = this.holdUntilChosen || this.showFor > 0 ? 1 : 0;
    this.level += (this.goal - this.level) * (1 - Math.exp(-2.2 * dt));
    this.ack = Math.max(0, this.ack - dt / 2.5);

    this.group.visible = this.level > 0.01 || this.lightLevel > 0.01;
    if (this.level > 0.01) this.layOut(home, t);
    this.road.group.visible = this.hearth.group.visible = this.star.visible = this.level > 0.01;
    this.frameLight(dt, home, t);
  }

  private layOut(home: Village, t: number) {
    const g = this.game;
    const fx = -Math.sin(START_YAW);
    const fz = -Math.cos(START_YAW);
    const rx = -fz;
    const rz = fx;
    const cx = home.center.x;
    const cz = home.center.z;
    const put = (m: Mark, side: number) => {
      let d = MARK_DIST;
      let x = cx + rx * side * d + fx * 4;
      let z = cz + rz * side * d + fz * 4;
      for (let i = 0; i < 6 && g.terrain.surfaceAt(x, z) < SEA_LEVEL + 0.6; i++) {
        d *= 0.82;
        x = cx + rx * side * d + fx * 4;
        z = cz + rz * side * d + fz * 4;
      }
      m.place(x, z, g.terrain.surfaceAt(x, z));
    };
    put(this.road, -1);
    put(this.hearth, 1);
    const mid = home.worship.pos;
    this.star.position.set(mid.x, g.terrain.surfaceAt(mid.x, mid.z) + ORA_HEIGHT, mid.z);
        (this.star.material as THREE.SpriteMaterial).opacity = this.level * 0.9;

    // The hand over a mark lights it; the current pace stays lit.
    const h = g.hand;
    for (const [c, m] of [['walk', this.road], ['stay', this.hearth]] as const) {
      const near = h.valid && Math.hypot(m.base.x - h.ground.x, m.base.z - h.ground.z) < MARK_HIT;
      const goal = (near ? 1 : 0) * 0.9 + (this.choice === c ? 0.6 : 0) + (this.ack > 0 && this.choice === c ? this.ack : 0);
      m.lit += (clamp(goal, 0, 1) - m.lit) * 0.15;
      const dim = this.confirmed && this.choice !== c ? 0.55 : 1;
      m.set(this.level * dim, t, c === 'walk' ? 0 : 2.1);
    }
  }

  private frameLight(dt: number, home: Village, t: number) {
    const g = this.game;
    const en = (g as unknown as { endings?: { phase: string } }).endings;
    const bal = (g as unknown as { balance?: { highFor: number } }).balance;
    const ready = this.choice === 'stay' && !!en && en.phase === 'play' && g.allTemplesStand() && !!bal && bal.highFor >= WHOLE_AFTER;
    this.lightLevel += ((ready ? 1 : 0) - this.lightLevel) * (1 - Math.exp(-0.9 * dt));
    this.light.visible = this.lightLevel > 0.01;
    if (!this.light.visible) return;
    const p = home.worship.pos;
    this.lightWorld.set(p.x, g.terrain.surfaceAt(p.x, p.z), p.z);
    this.light.position.copy(this.lightWorld);
    const top = home.worship.topHeight || 14;
    this.light.position.y += top * 0.8;
    const r = 2.2 + 0.25 * Math.sin(t * 1.1);
    this.light.scale.set(r, 70 + 8 * Math.sin(t * 0.7), r);
    this.lightUni.uStrength.value = this.lightLevel * (0.8 + 0.25 * Math.sin(t * 1.7));
    this.lightUni.uTime.value = t;
  }
}
