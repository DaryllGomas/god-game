import * as THREE from 'three';
import type { Game } from '../Game';
import type { Telor } from '../nexus/Telor';
import { MAT } from '../art/Models';
import { MARK_COUNT } from '../nexus/glyphs';
import { STONE_RING } from '../nexus/NexusModel';
import type { SeasonId } from '../seasons/data';
import { glowTexture } from '../rival/RivalVisuals';
import { aoSkip } from '../endings/CityLights';
import { Rng } from '../util/rng';
import { clamp, smoothstep } from '../util/math';
import { POLE_TOP, feastGeometry, firePileGeometry, lanternGeometry, poleGeometry, tableGeometry } from './art';
import { TUNICS, type People, type Person } from './People';

// ------------------------------------------------------------------ tuning knobs

/** How long a celebration lasts (game seconds), and its shape: the people come in, it plays, they drift home. */
export const CELEBRATE = 118;
const GATHER = 16;
const DISPERSE = 16;
/** The plaza (src/nexus/Telor.ts): its edge, and where the lantern strings' poles stand. */
const PLAZA_R = 32;
const POLE_R = 30.4;
const DAIS_TOP = 0.55;
/** The crowd's rings round the Nexus (Telor's own dancers turn at 22.5 m, its fountains and stalls stand from 27 m). */
const RINGS = [
  { r: 18.4, n: 30, dir: 1 },
  { r: 20.4, n: 34, dir: -1 },
  { r: 25.3, n: 42, dir: 1 },
];
/** The feast's tables (summer): a ring of long tables between the dais and Telor's dancers. */
const TABLES = 10;
const TABLE_R = 19.4;
/** Midwinter's seven fires, one between each pair of stones, inside the ring. */
const FIRE_R = 7.4;
/** Lantern Night's sky lanterns. */
const SKY = 84;
/** Each kind's colours: the lantern strings, the warm light on the plaza. */
const LOOK: Record<SeasonId, { strings: number[]; floor: THREE.Color; lantern: number }> = {
  spring: { strings: [0xffb7d0, 0xfff2f6, 0xffd6e4, 0xffe9a8], floor: new THREE.Color(1.0, 0.62, 0.66), lantern: 0.8 },
  summer: { strings: [0xffd27a, 0xffb050, 0xfff0c0, 0xff9a4a], floor: new THREE.Color(1.0, 0.72, 0.38), lantern: 1 },
  autumn: { strings: [0xff6a3a, 0xff9a3a, 0xffd06a, 0xe8443a, 0xffb070], floor: new THREE.Color(1.0, 0.55, 0.3), lantern: 1.25 },
  winter: { strings: [0xfff4e0, 0xffe2a0, 0xfff8f0, 0xffd27a], floor: new THREE.Color(1.0, 0.6, 0.32), lantern: 0.75 },
};
/** How big each lantern's glow is (night festivals' lanterns are bigger and warmer). */
const GLOW_SIZE: Record<SeasonId, number> = { spring: 1.2, summer: 1.7, autumn: 2.5, winter: 1.3 };
/** Bunting for the day festivals (pennants along the strings); the night festivals hang lanterns only. */
const BUNTING: Record<SeasonId, number[] | null> = {
  spring: [0xffa9c8, 0xfff4e4, 0xb9e39a, 0xffe08a, 0xc9b4ff, 0xff7fa8],
  summer: [0xc9502a, 0xe8b040, 0xf6ead2, 0x3f6fc4, 0x7aa83a, 0xe0703a],
  autumn: null,
  winter: null,
};
const FIREWORKS = [0xffc040, 0xff4f8a, 0x3fe0d0, 0x9a6bff, 0x7fff6a, 0xff7a2a, 0xff3a4a, 0xffe08a];

export type FestPhase = 'asked' | 'ready' | 'on';

interface Crowd {
  p: Person | null;
  look: number;
  /** Slot: angle and radius round the Nexus, and how they move there. */
  a: number;
  r: number;
  dir: number;
  /** Where they come in from (angle at the plaza's edge) and when (game seconds into the celebration). */
  fromA: number;
  arrive: number;
  leave: number;
  ph: number;
  pose: 'dance' | 'table' | 'watch';
  /** The feast: where this one stands at a table (x, z) and faces. */
  seat: { x: number; z: number; yaw: number } | null;
}

interface Sky {
  x: number;
  z: number;
  y0: number;
  at: number;
  vx: number;
  vz: number;
  vy: number;
  ph: number;
  gold: boolean;
}

interface Rocket {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
  shape: 0 | 1 | 2;
}

/**
 * One of Telor's celebrations (after the true end, src/after), drawn round the Nexus: poles and strings of lanterns
 * over the plaza, a warm light on the paving, the people of the city coming in off the streets to dance in rings round
 * the stones, and music. Each season has its own: Blossom Day (blossom garlands and petals drifting), the Harvest
 * Feast (a ring of long tables, laid once the food has come), Lantern Night (red and gold lanterns, and at its height
 * every family lets a lantern go into the night sky) and Midwinter Fire (seven fires in the ring, and fireworks).
 * Built once and reused; nothing of it is drawn between festivals.
 */
export class FestivalKit {
  readonly group = new THREE.Group();
  private readonly c: THREE.Vector3;
  private readonly poles: THREE.InstancedMesh;
  private readonly strings: THREE.LineSegments;
  private readonly lanterns: THREE.InstancedMesh;
  private readonly glow: THREE.Points;
  private readonly gPos: Float32Array;
  private readonly gCol: Float32Array;
  private readonly gSize: Float32Array;
  private readonly floor: THREE.Mesh;
  private readonly tables: THREE.InstancedMesh;
  private readonly feast: THREE.InstancedMesh;
  private readonly fires: THREE.InstancedMesh;
  private readonly firePos: THREE.Vector3[] = [];
  private readonly tableAt: { x: number; z: number; th: number }[] = [];
  private readonly flagAt: { x: number; y: number; z: number; yaw: number; tone: number }[] = [];
  private flags!: THREE.InstancedMesh;
  /** String lanterns: position and when each lights (0..1 round the strings). */
  private readonly beads: { x: number; y: number; z: number; seq: number; tone: number }[] = [];
  private readonly sky: Sky[] = [];
  private readonly crowd: Crowd[] = [];
  private readonly rockets: Rocket[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly tint = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private kind: SeasonId | null = null;
  private wasLit = true;
  private shown = false;
  private nextRocket = 0;
  private barAt = 0;
  private bar = 0;
  private petalAcc = 0;
  private emberAcc = 0;
  private finale = 0;
  /** The first burst of the night has gone up (Fizz has been waiting for this). */
  firstBurst = false;

  constructor(
    private readonly game: Game,
    telor: Telor,
    private readonly people: People,
  ) {
    this.c = telor.center.clone();
    const c = this.c;
    this.group.name = 'after-festival';
    this.group.visible = false;
    game.scene.add(this.group);
    const gy = (x: number, z: number) => Math.max(game.terrain.heightAt(x, z), 0.2) + 0.14;
    const rng = new Rng(Math.round(c.x * 7 + c.z * 3) ^ 0xfe57);

    // The seven stones, in the plaza's frame (x = cos, z = sin), and their tops.
    const stones: { th: number; top: number }[] = [];
    for (let i = 0; i < MARK_COUNT; i++) {
      const a = (i / MARK_COUNT) * Math.PI * 2 + 0.22;
      const h = 8.4 + ((i * 37) % 5) * 0.3;
      stones.push({ th: Math.atan2(-Math.cos(a), Math.sin(a)), top: c.y + DAIS_TOP - 0.1 + h - 0.9 });
    }

    // Poles at the plaza's edge, two for each stone, where the strings come down.
    const poleAt: THREE.Vector3[] = [];
    const tryPole = (th: number) => {
      for (let k = 0; k < 9; k++) {
        const t = th + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.035;
        const x = c.x + Math.cos(t) * POLE_R;
        const z = c.z + Math.sin(t) * POLE_R;
        if (telor.isClear(x, z, 0.7) && game.terrain.heightAt(x, z) > 0.8) return new THREE.Vector3(x, gy(x, z), z);
      }
      return null;
    };
    const legs: [number, number][] = [];
    stones.forEach((st, i) => {
      for (const s of [-1, 1]) {
        const p = tryPole(st.th + s * 0.36);
        if (!p) continue;
        poleAt.push(p);
        legs.push([i, poleAt.length - 1]);
      }
    });
    this.poles = new THREE.InstancedMesh(poleGeometry(), MAT.base, Math.max(1, poleAt.length));
    poleAt.forEach((p, i) => this.poles.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z)));
    this.poles.frustumCulled = false;
    this.group.add(this.poles);

    // The strings: from each stone's shoulder down to its two poles, and round the plaza from pole to pole.
    const line: number[] = [];
    const hang = (a: THREE.Vector3, b: THREE.Vector3, sag: number, gap: number, seq0: number, seq1: number) => {
      const len = a.distanceTo(b);
      const n = Math.max(2, Math.round(len / 1.2));
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y -= sag * 4 * u * (1 - u);
        if (prev) line.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
      // Bunting along it (the day festivals), a pennant every half metre or so, hanging in the string's line.
      const nf = Math.max(2, Math.round(len / 0.62));
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      for (let k = 1; k < nf; k++) {
        const u = k / nf;
        const p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y -= sag * 4 * u * (1 - u) + 0.02;
        this.flagAt.push({ x: p.x, y: p.y, z: p.z, yaw, tone: rng.next() });
      }
      const m = Math.max(1, Math.round(len / gap));
      for (let k = 1; k < m; k++) {
        const u = k / m;
        const p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y -= sag * 4 * u * (1 - u) + 0.32;
        this.beads.push({ x: p.x, y: p.y, z: p.z, seq: seq0 + (seq1 - seq0) * u, tone: rng.next() });
      }
    };
    for (const [si, pi] of legs) {
      const st = stones[si];
      const a = new THREE.Vector3(c.x + Math.cos(st.th) * (STONE_RING + 0.9), st.top, c.z + Math.sin(st.th) * (STONE_RING + 0.9));
      const b = poleAt[pi].clone();
      b.y += POLE_TOP;
      hang(a, b, 1.6, 1.25, si / MARK_COUNT, si / MARK_COUNT + 0.3);
    }
    const byAngle = poleAt.map((p, i) => ({ i, a: Math.atan2(p.z - c.z, p.x - c.x) })).sort((u, w) => u.a - w.a);
    byAngle.forEach((e, k) => {
      const nx = byAngle[(k + 1) % byAngle.length];
      const a = poleAt[e.i].clone();
      const b = poleAt[nx.i].clone();
      if (a.distanceTo(b) > 26) return;
      a.y += POLE_TOP;
      b.y += POLE_TOP;
      hang(a, b, 1.1, 1.3, 0.55 + (k / byAngle.length) * 0.45, 0.6 + (k / byAngle.length) * 0.45);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
    this.strings = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.85 }));
    this.strings.frustumCulled = false;
    this.group.add(this.strings);
    const pennant = new THREE.BufferGeometry();
    pennant.setAttribute('position', new THREE.Float32BufferAttribute([-0.21, 0, 0, 0.21, 0, 0, 0, -0.52, 0], 3));
    pennant.computeVertexNormals();
    this.flags = new THREE.InstancedMesh(pennant, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }), Math.max(1, this.flagAt.length));
    this.flagAt.forEach((f, i) => {
      this.q.setFromAxisAngle(FestivalKit.UP, f.yaw);
      this.flags.setMatrixAt(i, this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s.set(1, 1, 1)));
      this.flags.setColorAt(i, this.col.set(0xffffff));
    });
    this.flags.frustumCulled = false;
    this.flags.receiveShadow = true;
    this.group.add(this.flags);
    // Thin things stay out of the soft-shadow (AO) pass: it would cost draws for nothing it could shade.
    for (const o of [this.poles, this.strings, this.flags]) aoSkip(game, o);

    // Sky lanterns (Lantern Night): let go from the crowd, rising and drifting on the wind.
    for (let i = 0; i < SKY; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(17.5, 26);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      this.sky.push({ x, z, y0: gy(x, z) + 1.9, at: GATHER + 10 + (i / SKY) * 52 + rng.range(-3, 3), vx: rng.range(0.2, 0.7), vz: rng.range(-0.25, 0.25), vy: rng.range(1.5, 2.3), ph: rng.range(0, 6.28), gold: i % 9 === 4 });
    }

    // Lantern bodies (strings and sky), drawn bright in their own colours.
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lanterns = new THREE.InstancedMesh(lanternGeometry(), lanternMat, this.beads.length + SKY);
    this.lanterns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lanterns.frustumCulled = false;
    this.lanterns.setColorAt(0, this.col.set(0xffffff));
    this.group.add(this.lanterns);
    aoSkip(game, this.lanterns);

    // Glow: one soft point per lantern and per fire.
    const nGlow = this.beads.length + SKY + MARK_COUNT;
    this.gPos = new Float32Array(nGlow * 3);
    this.gCol = new Float32Array(nGlow * 3);
    this.gSize = new Float32Array(nGlow);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aColor', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aSize', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(
      gg,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: glowTexture() }, uScale: { value: 900 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
          attribute vec3 aColor; attribute float aSize; varying vec3 vC; uniform float uScale;
          void main() {
            vC = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(uScale * aSize / max(-mv.z, 1.0), 0.0, 160.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; varying vec3 vC;
          void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.a, 1.0); }`,
      }),
    );
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.group.add(this.glow);
    aoSkip(game, this.glow);

    // A warm light on the paving, strongest at the dancers' rings, hugging the land.
    this.floor = this.floorMesh();
    this.group.add(this.floor);
    aoSkip(game, this.floor);

    // The feast's tables, and what is laid on them.
    this.tables = new THREE.InstancedMesh(tableGeometry(), MAT.base, TABLES);
    this.feast = new THREE.InstancedMesh(feastGeometry(5150), MAT.base, TABLES);
    for (let i = 0; i < TABLES; i++) {
      const th = stones[0].th + Math.PI / MARK_COUNT + (i / TABLES) * Math.PI * 2;
      const x = c.x + Math.cos(th) * TABLE_R;
      const z = c.z + Math.sin(th) * TABLE_R;
      this.q.setFromAxisAngle(FestivalKit.UP, Math.atan2(-Math.cos(th), -Math.sin(th)));
      this.tableAt.push({ x, z, th });
      this.m.compose(this.v.set(x, gy(x, z) - 0.05, z), this.q, this.s.set(1, 1, 1));
      this.tables.setMatrixAt(i, this.m);
      this.feast.setMatrixAt(i, this.m);
    }
    for (const t of [this.tables, this.feast]) {
      t.castShadow = true;
      t.receiveShadow = true;
      t.frustumCulled = false;
      this.group.add(t);
    }

    // Midwinter's woodpiles, between the stones.
    this.fires = new THREE.InstancedMesh(firePileGeometry(77), MAT.base, MARK_COUNT);
    stones.forEach((st, i) => {
      const th = st.th + Math.PI / MARK_COUNT;
      const p = new THREE.Vector3(c.x + Math.cos(th) * FIRE_R, c.y + DAIS_TOP - 0.05, c.z + Math.sin(th) * FIRE_R);
      this.firePos.push(p);
      this.q.setFromAxisAngle(FestivalKit.UP, th * 3);
      this.fires.setMatrixAt(i, this.m.compose(p, this.q, this.s.set(1, 1, 1)));
    });
    this.fires.castShadow = true;
    this.fires.frustumCulled = false;
    this.group.add(this.fires);

    // The crowd's places (people are taken from the pool only while a celebration plays).
    RINGS.forEach((ring, ri) => {
      for (let k = 0; k < ring.n; k++) {
        const a = (k / ring.n) * Math.PI * 2 + ri * 0.4;
        const arrive = rng.range(0, GATHER - 6);
        this.crowd.push({ p: null, look: rng.int(0, TUNICS.length - 1), a, r: ring.r + rng.range(-0.25, 0.25), dir: ring.dir, fromA: a + rng.range(-0.5, 0.5), arrive, leave: CELEBRATE - DISPERSE + rng.range(0, DISPERSE - 6), ph: rng.range(0, 6.28), pose: 'dance', seat: null });
      }
    });
  }

  /** The warm floor light: rings of a soft additive disc that follow the paving. */
  private floorMesh(): THREE.Mesh {
    const g = this.game;
    const c = this.c;
    const pos: number[] = [];
    const al: number[] = [];
    const rings = 22;
    const segs = 56;
    const r0 = 14.5;
    const R = PLAZA_R + 3;
    const vert = (r: number, a: number) => {
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      pos.push(x, Math.max(g.terrain.heightAt(x, z), 0.2) + 0.3, z);
      const u = (r - r0) / (R - r0);
      al.push(Math.sin(Math.PI * clamp(u * 1.05, 0, 1)) ** 1.4);
    };
    for (let k = 0; k < rings; k++) {
      const ra = r0 + ((R - r0) * k) / rings;
      const rb = r0 + ((R - r0) * (k + 1)) / rings;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        vert(ra, a0);
        vert(rb, a1);
        vert(rb, a0);
        vert(ra, a0);
        vert(ra, a1);
        vert(rb, a1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aA', new THREE.Float32BufferAttribute(al, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `attribute float aA; varying float vA; void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor * vA, 1.0); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  // ---------------------------------------------------------------- per frame

  /** Nothing of the festival is drawn, and everyone goes home. */
  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.group.visible = false;
    for (const p of this.crowd) {
      this.people.release(p.p);
      p.p = null;
    }
    this.people.flush();
    this.rockets.length = 0;
    this.kind = null;
  }

  /**
   * Draw the festival of `kind` in `phase`, `t` game seconds into it (the celebration's own clock when 'on'), `night`
   * 0..1. `dt` real seconds (scaled by the game's speed; 0 while paused).
   */
  frame(kind: SeasonId, phase: FestPhase, t: number, night: number, dt: number) {
    const g = this.game;
    const c = this.c;
    if (this.kind !== kind) {
      this.hide();
      this.kind = kind;
      this.setup(kind);
    }
    this.shown = true;
    this.group.visible = true;
    const look = LOOK[kind];
    const on = phase === 'on';
    const ready = phase !== 'asked';
    // How much of it is up: the dressing goes up when it is granted; it all fades as the people go home.
    const fade = on ? 1 - smoothstep(CELEBRATE - 10, CELEBRATE, t) : 1;
    const lit = on ? smoothstep(2, GATHER - 2, t) * fade : 0;
    const strings = ready && fade > 0.01;
    this.poles.visible = this.strings.visible = this.lanterns.visible = strings;
    this.flags.visible = strings && !!BUNTING[kind];
    (this.strings.material as THREE.LineBasicMaterial).opacity = 0.85 * fade;
    // Midwinter's woodpiles stand from the asking; Harvest's tables too (bare until the food comes).
    this.fires.visible = kind === 'winter' && fade > 0.02;
    this.tables.visible = kind === 'summer' && fade > 0.02;
    this.feast.visible = kind === 'summer' && ready && fade > 0.02;
    const bright = (0.4 + night * 0.8) * look.lantern;
    const tt = g.realTime;

    // String lanterns: unlit paper by day until the celebration; they light one after another round the strings.
    let gi = 0;
    let li = 0;
    if (strings || this.wasLit) this.wasLit = strings;
    else {
      // Only the asking: nothing hangs yet, nothing to update.
      gi = this.beads.length + SKY;
      li = this.beads.length + SKY;
    }
    for (const b of li ? [] : this.beads) {
      const on1 = smoothstep(b.seq * 0.7, b.seq * 0.7 + 0.18, lit);
      const flick = 0.88 + 0.12 * Math.sin(tt * 7.3 + b.tone * 40);
      this.col.set(look.strings[Math.floor(b.tone * look.strings.length)]);
      const k = (0.18 + on1 * bright * flick) * (strings ? 1 : 0);
      this.m.makeTranslation(b.x, b.y + Math.sin(tt * 1.3 + b.tone * 9) * 0.04, b.z);
      if (kind === 'spring') this.m.scale(this.s.set(0.75, 0.6, 0.75));
      this.lanterns.setMatrixAt(li, this.m);
      this.lanterns.setColorAt(li, this.tint.copy(this.col).multiplyScalar(Math.max(0.25, k)));
      li++;
      const day = kind === 'spring' || kind === 'summer';
      this.glowAt(gi++, b.x, b.y, b.z, this.col, on1 * fade * (day ? 0.05 + night * 0.5 : 0.1 + night * 0.55) * flick, GLOW_SIZE[kind]);
    }
    // Sky lanterns.
    for (const s of li > this.beads.length ? [] : this.sky) {
      const age = t - s.at;
      const up = kind === 'autumn' && on && age > 0;
      const held = kind === 'autumn' && on && age <= 0 && age > -14 && t > GATHER;
      if (!up && !held) {
        this.lanterns.setMatrixAt(li++, this.m.makeScale(0, 0, 0));
        this.glowAt(gi++, 0, 0, 0, this.col, 0, 0);
        continue;
      }
      const a = Math.max(0, age);
      const sway = Math.sin(a * 0.7 + s.ph) * 1.2;
      const x = s.x + s.vx * a + sway;
      const z = s.z + s.vz * a + Math.cos(a * 0.5 + s.ph) * 0.8;
      const y = s.y0 + s.vy * a + Math.min(a, 3) * 0.2;
      const gone = 1 - smoothstep(48, 62, a);
      this.col.set(s.gold ? 0xffe08a : 0xff9a50);
      const flick = 0.85 + 0.15 * Math.sin(tt * 9 + s.ph * 5);
      this.q.setFromAxisAngle(FestivalKit.UP, s.ph);
      this.m.compose(this.v.set(x, y, z), this.q, this.s.set(1.35, 1.75, 1.35).multiplyScalar(gone > 0.01 ? 1 : 0.0001));
      this.lanterns.setMatrixAt(li, this.m);
      this.lanterns.setColorAt(li, this.tint.copy(this.col).multiplyScalar((0.6 + night * 1.3) * flick * Math.max(0.2, gone)));
      li++;
      this.glowAt(gi++, x, y + 0.1, z, this.col, gone * (0.45 + night * 0.7) * flick, s.gold ? 4.6 : 3.4);
    }
    // Fires (Midwinter): lit once the spark has come.
    for (let i = 0; i < MARK_COUNT; i++) {
      const p = this.firePos[i];
      const burn = kind === 'winter' && ready ? fade * smoothstep(0, 1.5, (on ? t + 10 : t) - i * 0.35) : 0;
      this.glowAt(gi++, p.x, p.y + 1.4, p.z, this.col.set(0xff8a2a), burn * (0.8 + 0.2 * Math.sin(tt * 11 + i)) * (0.35 + night * 0.5), 12);
      if (burn > 0.05 && dt > 0) {
        const n = Math.floor(dt * 46 * burn + Math.random());
        for (let k = 0; k < n; k++) {
          g.fx.fire(p.x, p.y + 0.35, p.z, 1.5);
          if (k % 2) g.fx.fire(p.x, p.y + 1.3, p.z, 0.95);
        }
        this.emberAcc += dt * 4 * burn;
      }
    }
    if (this.emberAcc > 1) {
      this.emberAcc = 0;
      const p = this.firePos[Math.floor(Math.random() * MARK_COUNT)];
      g.fx.sparkle(p.x, p.y + 2.5, p.z, 3, 0xffb050, 1.2);
    }
    this.lanterns.instanceMatrix.needsUpdate = true;
    if (this.lanterns.instanceColor) this.lanterns.instanceColor.needsUpdate = true;
    const geo = this.glow.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    // The warm floor.
    const fl = this.floor.material as THREE.ShaderMaterial;
    fl.uniforms.uColor.value.copy(look.floor).multiplyScalar((on ? lit : ready ? 0.15 : 0) * (0.04 + night * 0.2) * (kind === 'winter' ? 1.25 : 1));
    this.floor.visible = (on || ready) && fade > 0.01;

    // The people.
    this.frameCrowd(kind, phase, t, night);

    // Spring: petals drifting over the plaza.
    if (kind === 'spring' && on && dt > 0) {
      this.petalAcc += dt * 40 * fade;
      while (this.petalAcc > 1) {
        this.petalAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 30;
        const lightK = g.fx.light;
        g.fx.soft.spawn({
          x: c.x + Math.cos(a) * r - 6,
          y: c.y + 12 + Math.random() * 6,
          z: c.z + Math.sin(a) * r,
          vx: 1.2 + Math.random() * 0.8,
          vy: -1.1 - Math.random() * 0.5,
          vz: (Math.random() - 0.5) * 0.8,
          life: 7 + Math.random() * 3,
          size: 0.45,
          color: this.col.set(Math.random() < 0.65 ? 0xff9ec4 : 0xfff0f6).multiplyScalar(Math.max(0.45, lightK)),
          alpha: 0.95,
          drag: 0.2,
        });
      }
    }
    // Midwinter: fireworks.
    if (kind === 'winter' && on && dt > 0) this.fireworks(t, dt, fade);
    // Music while it plays.
    if (on && fade > 0.2 && t > 3) {
      this.barAt -= dt;
      if (this.barAt <= 0) {
        this.barAt = 2.2;
        g.audio.festivalBar(this.v.set(c.x, c.y + 2, c.z), ['spring', 'summer', 'autumn', 'winter'].indexOf(kind), this.bar++);
      }
    }
  }

  private glowAt(i: number, x: number, y: number, z: number, col: THREE.Color, k: number, size: number) {
    this.gPos[i * 3] = x;
    this.gPos[i * 3 + 1] = y;
    this.gPos[i * 3 + 2] = z;
    this.gCol[i * 3] = col.r * k;
    this.gCol[i * 3 + 1] = col.g * k;
    this.gCol[i * 3 + 2] = col.b * k;
    this.gSize[i] = k > 0.001 ? size : 0;
  }

  /** Each kind places its crowd its own way. */
  private setup(kind: SeasonId) {
    const bunting = BUNTING[kind];
    this.flags.visible = !!bunting;
    if (bunting) {
      this.flagAt.forEach((f, i) => this.flags.setColorAt(i, this.col.set(bunting[Math.floor(f.tone * bunting.length)])));
      if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
    }
    this.firstBurst = false;
    this.finale = 0;
    this.nextRocket = GATHER + 2;
    this.bar = 0;
    // The feast: three a side at every table, facing in over it; everyone else dances round the outside.
    const seats: { x: number; z: number; yaw: number }[] = [];
    for (const tb of this.tableAt) {
      const tx = -Math.sin(tb.th);
      const tz = Math.cos(tb.th);
      const rx = Math.cos(tb.th);
      const rz = Math.sin(tb.th);
      for (const side of [-1, 1]) {
        for (const u of [-1.7, 0, 1.7]) {
          const x = tb.x + tx * u + rx * side * 1.45;
          const z = tb.z + tz * u + rz * side * 1.45;
          seats.push({ x, z, yaw: Math.atan2(-rx * side, -rz * side) });
        }
      }
    }
    let n = 0;
    let si = 0;
    for (const p of this.crowd) {
      const outer = p.r > 24;
      p.seat = null;
      if (kind === 'summer' && !outer && si < seats.length) {
        p.pose = 'table';
        p.seat = seats[si++];
      } else if (kind === 'autumn') p.pose = outer && n++ % 2 ? 'dance' : 'watch';
      else if (kind === 'summer' && !outer) p.pose = 'watch';
      else p.pose = 'dance';
    }
  }

  private frameCrowd(kind: SeasonId, phase: FestPhase, t: number, _night: number) {
    const g = this.game;
    const c = this.c;
    const tt = g.realTime;
    const on = phase === 'on';
    // A few early ones mill about while it waits for dusk (Lantern Night, Midwinter).
    const early = phase === 'ready' ? 12 : 0;
    // On the slowest setting (the post-processing has stepped down to 'low') a smaller crowd comes.
    const thin = (g as unknown as { postfx?: { quality: string } }).postfx?.quality === 'low';
    this.crowd.forEach((p, idx) => {
      const present = (on || idx < early) && !(thin && idx % 3 === 2);
      if (!present) {
        if (p.p) {
          this.people.release(p.p);
          p.p = null;
        }
        return;
      }
      if (!p.p) p.p = this.people.take(p.look);
      if (!p.p) return;
      // Where they are in the coming and going.
      const tin = on ? t : 30;
      const comeK = smoothstep(p.arrive, p.arrive + 7, tin);
      const goK = on ? smoothstep(p.leave, p.leave + 7, t) : 0;
      const away = Math.max(1 - comeK, goK);
      let a = p.a;
      let r = p.r;
      let yaw = 0;
      let swing = 0;
      let hop = 0;
      let tilt = 0;
      const pose = on ? p.pose : 'watch';
      if (pose === 'dance') {
        a += p.dir * 0.17 * Math.max(0, tin - p.arrive - 7) * (1 - goK);
        yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + (p.dir > 0 ? Math.PI : 0);
        hop = Math.abs(Math.sin(tt * 3.3 + p.ph)) * 0.24;
        swing = 0.6;
        r += Math.sin(tt * 0.9 + p.ph) * 0.25;
      } else if (pose === 'table' && p.seat) {
        yaw = p.seat.yaw + Math.sin(tt * 0.8 + p.ph) * 0.25;
        hop = Math.abs(Math.sin(tt * 2.1 + p.ph)) * 0.05;
      } else {
        // Watching the lanterns go up.
        yaw = Math.atan2(c.x - (c.x + Math.cos(a) * r), c.z - (c.z + Math.sin(a) * r)) + Math.sin(p.ph) * 0.6;
        tilt = kind === 'autumn' && on ? 0.28 * smoothstep(GATHER + 6, GATHER + 14, t) : 0;
        hop = Math.sin(tt * 1.6 + p.ph) * 0.03;
      }
      let x = pose === 'table' && p.seat ? p.seat.x : c.x + Math.cos(a) * r;
      let z = pose === 'table' && p.seat ? p.seat.z : c.z + Math.sin(a) * r;
      if (away > 0.001) {
        const fx = c.x + Math.cos(p.fromA) * (PLAZA_R + 6);
        const fz = c.z + Math.sin(p.fromA) * (PLAZA_R + 6);
        x += (fx - x) * away;
        z += (fz - z) * away;
        if (away < 0.999) {
          yaw = goK > 0 ? Math.atan2(fx - x, fz - z) : Math.atan2(x - fx, z - fz);
          swing = 1;
          hop = 0;
          tilt = 0;
        }
      }
      const scale = 1 - smoothstep(0.85, 1, away);
      this.people.set(p.p, x, Math.max(g.terrain.heightAt(x, z), 0.2) + 0.16 + hop, z, yaw, swing, scale, tilt);
    });
    this.people.flush();
  }

  /** Rockets up from round the plaza; bursts of colour high over the city; a finale at the end. */
  private fireworks(t: number, dt: number, fade: number) {
    const g = this.game;
    const c = this.c;
    if (fade > 0.6) {
      if (t >= this.nextRocket) {
        const finale = t > CELEBRATE - 34;
        this.nextRocket = t + (finale ? 0.5 + Math.random() * 0.6 : 1.2 + Math.random() * 1.6);
        if (finale) this.finale++;
        // In the finale they go up in volleys.
        const volley = finale ? 2 + Math.floor(Math.random() * 2) : Math.random() < 0.25 ? 2 : 1;
        for (let v = 0; v < volley; v++) {
          const a = Math.random() * Math.PI * 2;
          const r = PLAZA_R + 6 + Math.random() * 12;
          const x = c.x + Math.cos(a) * r;
          const z = c.z + Math.sin(a) * r;
          const y = Math.max(g.terrain.heightAt(x, z), 0.2) + 1;
          const toward = 0.18;
          this.rockets.push({ x, y, z, vx: (c.x - x) * toward * Math.random(), vy: 34 + Math.random() * 10, vz: (c.z - z) * toward * Math.random(), color: FIREWORKS[Math.floor(Math.random() * FIREWORKS.length)], shape: Math.random() < 0.3 ? 2 : 0 });
          if (v === 0) g.audio.firework(this.v.set(x, y, z), 'launch');
        }
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= 12 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      g.fx.glow.spawn({ x: r.x, y: r.y, z: r.z, vy: -2, life: 0.55, size: 0.9, sizeEnd: 0.1, color: 0xffd8a0, colorEnd: 0xff7a2a, alpha: 0.8, drag: 2 });
      if (r.vy > 3) continue;
      this.rockets.splice(i, 1);
      this.burst(r);
    }
  }

  private burst(r: Rocket) {
    const g = this.game;
    const n = r.shape === 2 ? 130 : 160;
    const col = new THREE.Color(r.color).multiplyScalar(1.7);
    const end = r.shape === 2 ? new THREE.Color(0xff8a2a) : col.clone().multiplyScalar(0.4);
    for (let k = 0; k < n; k++) {
      let dx: number;
      let dy: number;
      let dz: number;
      if (r.shape === 1) {
        // A ring.
        const a = (k / n) * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a) * 0.35;
        dz = Math.sin(a);
      } else {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        dx = s * Math.cos(a);
        dy = u;
        dz = s * Math.sin(a);
      }
      const sp = r.shape === 2 ? 15 + Math.random() * 4 : 21 + Math.random() * 4;
      g.fx.glow.spawn({
        x: r.x,
        y: r.y,
        z: r.z,
        vx: dx * sp,
        vy: dy * sp + 2,
        vz: dz * sp,
        life: r.shape === 2 ? 2.8 + Math.random() * 0.8 : 1.8 + Math.random() * 0.7,
        size: r.shape === 2 ? 2.8 : 3.2,
        sizeEnd: 0.3,
        color: col,
        colorEnd: end,
        alpha: 1,
        gravity: r.shape === 2 ? 7 : 4,
        drag: r.shape === 2 ? 1.6 : 1.1,
      });
    }
    g.fx.sparkle(r.x, r.y, r.z, 20, 0xffffff, 3);
    g.audio.firework(this.v.set(r.x, r.y, r.z), 'burst');
    this.firstBurst = true;
  }

  /** How many are out in the plaza (for tests). */
  get crowdOut(): number {
    return this.crowd.filter((p) => p.p).length;
  }

  get skyUp(): number {
    return this.kind === 'autumn' ? this.sky.length : 0;
  }
}
