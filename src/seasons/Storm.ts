import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../Game';
import { Tree } from '../entities/Nature';
import { Field } from '../entities/Buildings';
import { clamp, smoothstep } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** How fast the storm front travels across the sea and island (m/s). */
const SPEED = 6;
/** Half-width of the front (across its path); it is shallower along its path. */
const RADIUS = 220;
/** Height of the cloud base above the sea. */
const ALTITUDE = 88;
/** The island's edge, measured from its centre along the storm's path (m). Rain starts as the front reaches it. */
const EDGE = 420;
/** Seconds between lightning strikes while rain is over land. */
const STRIKE_GAP: [number, number] = [10, 22];
/** Chance a strike is allowed near a village (at most one per storm); the rest keep well clear. */
const NEAR_VILLAGE_CHANCE = 0.06;
/** Chance a struck tree catches fire. */
const IGNITE_CHANCE = 0.55;
/** Per second, chance a burning thing under the storm's rain is put out (the player's rain is far quicker). */
const NATURAL_DOUSE = 0.05;

export type StormPhase = 'warning' | 'active' | 'passing' | 'done';

export interface StormOptions {
  /** Seconds of warning before rain reaches the island (60-90 in play; shorter for tests). */
  warning: number;
  /** Direction the front travels, radians (0 = +x). Random when omitted. */
  angle?: number;
}

const DARK = new THREE.Color(0x1f252f);
const LIGHT = new THREE.Color(0x737e8f);
const BOLT = new THREE.Color(3, 3.4, 5);

/**
 * A storm front: a big dark cloud mass that gathers over the sea, rolls in and passes over the
 * island with rain curtains beneath it, lightning that strikes trees (mostly far from villages),
 * and gentle watering. It is a plain object driven by the seasons plugin, not an Entity.
 */
export class Storm {
  readonly group = new THREE.Group();
  phase: StormPhase = 'warning';
  /** Simulation seconds since it began. */
  t = 0;
  /** 0..1: how developed the storm is (gathers in, then fades out). */
  intensity = 0;
  /** Distance travelled along the path from the island's centre (negative = still approaching). */
  along = 0;
  readonly dir = new THREE.Vector2();
  readonly centre = new THREE.Vector2();
  /** 0..1 lightning flash, decays quickly; read by the sky. */
  flash = 0;
  onPhase: ((p: StormPhase) => void) | null = null;
  onStrike: ((info: { x: number; z: number; tree: boolean; near: string | null; ignited: boolean }) => void) | null = null;

  private readonly warning: number;
  private readonly start: number; // distance from the island centre where the front begins
  private readonly clouds: THREE.Mesh;
  private readonly cloudMat: THREE.MeshStandardMaterial;
  private readonly shafts: THREE.Mesh[] = [];
  private readonly shaftMat: THREE.ShaderMaterial;
  private strikeIn = 4;
  private nearStruck = false;
  private soakTimer = 0;
  private flicker = 0;
  private readonly bolts: { group: THREE.Group; life: number }[] = [];
  private readonly thunder: { at: number; far: number }[] = [];
  private readonly boltGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  private readonly boltMat = new THREE.MeshBasicMaterial({ color: BOLT, fog: false });

  constructor(private readonly game: Game, opts: StormOptions) {
    this.warning = Math.max(1, opts.warning);
    const a = opts.angle ?? Math.random() * Math.PI * 2;
    this.dir.set(Math.cos(a), Math.sin(a));
    this.start = EDGE + SPEED * this.warning;
    this.along = -this.start;
    this.centre.copy(this.dir).multiplyScalar(this.along);

    // Cloud mass: lumpy dark puffs, darker underneath, thicker in the middle.
    const { geo, mat } = this.buildClouds();
    this.cloudMat = mat;
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.position.y = ALTITUDE;
    this.clouds.renderOrder = 3;
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);

    // Rain curtains hanging beneath it, visible from far away.
    this.shaftMat = this.buildShaftMaterial();
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    for (let i = 0; i < 12; i++) {
      const r = rnd(12, 26);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, ALTITUDE, 14, 1, true), this.shaftMat);
      const aa = rnd(-1.1, 1.1) * RADIUS * 0.8;
      const bb = rnd(-0.8, 0.8) * RADIUS * 0.5 * Math.sqrt(Math.max(0, 1 - (aa / (RADIUS * 0.9)) ** 2));
      m.position.set(aa, ALTITUDE / 2, bb);
      m.renderOrder = 4;
      m.frustumCulled = false;
      this.shafts.push(m);
      this.group.add(m);
    }
    // Local +z runs along the path, local +x across it.
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.y);
    game.scene.add(this.group);
    // Keep the cloud and curtains out of the ambient-occlusion pre-pass.
    // (Not game.aoIgnore: that is the grass's own mesh list, which the grass shows and hides with the camera zoom.)
    this.aoIgnore()?.push(this.group);
    this.placeCloud();
  }

  // ----------------------------------------------------------------- building

  private buildClouds() {
    const parts: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Color();
    const n = 85;
    for (let i = 0; i < n; i++) {
      // Position in the cloud's own frame: x across the path, z along it.
      const a = (Math.random() * 2 - 1) * RADIUS * 1.1;
      const b = (Math.random() * 2 - 1) * RADIUS * 0.75;
      const e = clamp(Math.hypot(a / (RADIUS * 1.15), b / (RADIUS * 0.8)), 0, 1);
      const thick = Math.pow(1 - e, 0.8);
      const r = (16 + Math.random() * 16) * (0.65 + 0.6 * thick);
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const y = p.getY(k);
        const z = p.getZ(k);
        // Position-keyed lumpiness, so shared corners move together and there are no cracks.
        const lump = 1 + 0.16 * Math.sin(x * 5.1 + i) * Math.sin(y * 4.3 + z * 3.7 + i * 1.7);
        p.setXYZ(k, x * lump, y * lump, z * lump);
      }
      g.scale(r * 1.35, r * 0.85, r * 1.35);
      const y0 = Math.random() * 14 + thick * (Math.random() * 40);
      g.translate(a, y0, b);
      const q = g.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(q.count * 3);
      for (let k = 0; k < q.count; k++) {
        const t = smoothstep(-4, 46, q.getY(k) + Math.sin(q.getX(k) * 0.3) * 2);
        tmp.copy(DARK).lerp(LIGHT, t);
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      g.computeVertexNormals();
      parts.push(g);
    }
    const geo = mergeGeometries(parts)!;
    for (const g of parts) g.dispose();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      transparent: true,
      emissive: 0x1c2330,
      emissiveIntensity: 0.5,
    });
    // Dissolve near the camera, so a cloud overhead never blocks the view.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.a *= smoothstep(30.0, 130.0, length(vViewPosition));',
      );
    };
    return { geo, mat };
  }

  private buildShaftMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 1 } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDist = length(mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform float uAlpha;
        uniform float uLight;
        varying vec2 vUv;
        varying float vDist;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          // Vertical streaks sliding down the curtain, fading toward the ground and into the cloud.
          float col = floor(vUv.x * 130.0);
          float speed = 0.6 + h(col) * 0.9;
          float streak = fract(vUv.y * (2.5 + h(col * 1.7) * 3.0) + uTime * speed + h(col * 3.1));
          float line = smoothstep(0.55, 0.95, streak) * (0.55 + 0.45 * h(col * 7.7));
          float a = uAlpha * (0.06 + 0.94 * line) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * smoothstep(180.0, 650.0, vDist);
          gl_FragColor = vec4(vec3(0.56, 0.62, 0.72) * uLight, a);
          #include <fog_fragment>
        }
      `,
    });
  }

  /** The post-processing plugin's list of things to leave out of the ambient-occlusion pre-pass. */
  private aoIgnore(): THREE.Object3D[] | undefined {
    return (this.game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
  }

  /** Gone for good: over, cleaned up, and no bolt still flickering. */
  get finished(): boolean {
    return this.phase === 'done' && this.bolts.length === 0;
  }

  // ------------------------------------------------------------------ queries

  /** 0..1 how much rain falls at a world point (an ellipse under the front). */
  coverage(x: number, z: number): number {
    if (this.intensity <= 0.01) return 0;
    const dx = x - this.centre.x;
    const dz = z - this.centre.y;
    const along = dx * this.dir.x + dz * this.dir.y;
    const across = -dx * this.dir.y + dz * this.dir.x;
    const f = 0.4 + 0.6 * this.intensity;
    const e = (across / (RADIUS * f)) ** 2 + (along / (RADIUS * 0.8 * f)) ** 2;
    return (1 - smoothstep(0.3, 0.95, e)) * smoothstep(0.1, 0.5, this.intensity);
  }

  /** 0..1 darkening of the whole sky as the storm closes in on (x, z), even before its rain arrives. */
  gloomAt(x: number, z: number): number {
    const d = Math.hypot(x - this.centre.x, z - this.centre.y);
    return Math.max(this.coverage(x, z), 0.6 * smoothstep(950, 280, d) * this.intensity);
  }

  // --------------------------------------------------------------- simulation

  private placeCloud() {
    this.centre.copy(this.dir).multiplyScalar(this.along);
    this.group.position.set(this.centre.x, 0, this.centre.y);
    const s = 0.4 + 0.6 * this.intensity;
    this.group.scale.set(s, 1, s);
    this.cloudMat.opacity = clamp(this.intensity * 3, 0, 0.97);
  }

  update(dt: number) {
    if (this.phase === 'done') return;
    const game = this.game;
    this.t += dt;
    this.along += SPEED * dt;
    const fadeOutAt = EDGE + 120;
    this.intensity = smoothstep(0, 40, this.t) * (1 - smoothstep(fadeOutAt, fadeOutAt + 150, this.along));
    this.placeCloud();

    const next: StormPhase = this.t < this.warning ? 'warning' : this.along < EDGE ? 'active' : this.along < fadeOutAt + 150 ? 'passing' : 'done';
    if (next !== this.phase) {
      this.phase = next;
      this.onPhase?.(next);
      if (next === 'done') {
        this.dispose();
        return;
      }
    }

    // Lightning: only once rain is over land.
    if (this.phase !== 'warning' && this.rainOverLand() > 0.25) {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = STRIKE_GAP[0] + Math.random() * (STRIKE_GAP[1] - STRIKE_GAP[0]);
        this.strike();
      }
    }

    // Delayed thunder: sound travels slower than light.
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      if (this.t >= this.thunder[i].at) {
        game.audio.thunder(this.thunder[i].far);
        this.thunder.splice(i, 1);
      }
    }

    // Rain waters things beneath it, and slowly smothers fires.
    this.soakTimer += dt;
    if (this.soakTimer >= 1) {
      const step = this.soakTimer;
      this.soakTimer = 0;
      for (const e of game.entities) {
        if (!e.alive) continue;
        const cov = this.coverage(e.pos.x, e.pos.z);
        if (cov < 0.3) continue;
        if (e instanceof Tree) e.water(0.006 * cov * step);
        else if (e instanceof Field) e.water(0.02 * cov * step);
        if (e.burning && Math.random() < NATURAL_DOUSE * cov * step) {
          e.extinguish(game);
          game.events.emit('fireOut', { entity: e });
        }
      }
    }
  }

  /** Rough 0..1: how much of the island the rain covers right now. */
  private rainOverLand(): number {
    const tgt = this.game.godCam.target;
    return Math.max(this.coverage(0, 0), this.coverage(tgt.x, tgt.z), this.coverage(this.centre.x, this.centre.y) * 0.6);
  }

  // ---------------------------------------------------------------- lightning

  /** Strike now (also used by the debug hook). */
  strike() {
    const game = this.game;
    const tgt = game.godCam.target;
    const viewRange = Math.max(160, game.godCam.distance * 1.6);
    const cands: { tree: Tree; d: number; near: string | null }[] = [];
    const allowNear = !this.nearStruck && Math.random() < NEAR_VILLAGE_CHANCE;
    for (const e of game.entities) {
      if (!e.alive || !(e instanceof Tree) || e.charred || e.burning) continue;
      if (this.coverage(e.pos.x, e.pos.z) < 0.35) continue;
      let near: string | null = null;
      for (const v of game.villages) if (Math.hypot(e.pos.x - v.center.x, e.pos.z - v.center.z) < v.radius * 1.25) near = v.name;
      if (near && !allowNear) continue;
      cands.push({ tree: e, d: Math.hypot(e.pos.x - tgt.x, e.pos.z - tgt.z), near });
    }
    let pick: (typeof cands)[number] | undefined;
    if (cands.length) {
      const inView = cands.filter((c) => c.d < viewRange);
      const pool = inView.length && Math.random() < 0.8 ? inView : cands;
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
    let x: number;
    let z: number;
    let ignited = false;
    if (pick) {
      x = pick.tree.pos.x;
      z = pick.tree.pos.z;
      if (pick.near) this.nearStruck = true;
      if (Math.random() < (pick.near ? 0.5 : IGNITE_CHANCE) && pick.tree.flammable) {
        pick.tree.ignitedByPlayer = false;
        pick.tree.ignite(game);
        ignited = pick.tree.burning;
      }
    } else {
      // No tree handy: a bolt into open ground or the sea, harmless.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * RADIUS * 0.6;
      x = this.centre.x + Math.cos(a) * r;
      z = this.centre.y + Math.sin(a) * r;
    }
    const gy = game.terrain.surfaceAt(x, z);
    this.makeBolt(x, gy, z);
    this.flash = 1;
    this.flicker = 0;
    game.fx.sparkle(x, gy + 1.5, z, 28, 0xdce8ff, 3);
    const d = Math.hypot(x - tgt.x, z - tgt.z);
    game.shake(0.3 * clamp(1 - d / 250, 0, 1));
    this.thunder.push({ at: this.t + clamp(d / 260, 0.2, 3.5), far: clamp(d / 450, 0, 1) });
    this.onStrike?.({ x, z, tree: !!pick, near: pick?.near ?? null, ignited });
  }

  private makeBolt(x: number, gy: number, z: number) {
    const group = new THREE.Group();
    const cam = this.game.godCam.camera.position;
    const camDist = cam.distanceTo(new THREE.Vector3(x, gy, z));
    const thick = Math.max(0.15, camDist * 0.0016);
    const topY = ALTITUDE + 6;
    const pts: THREE.Vector3[] = [];
    const n = 14;
    let ox = (Math.random() - 0.5) * 14;
    let oz = (Math.random() - 0.5) * 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(x + ox * (1 - t), THREE.MathUtils.lerp(topY, gy, t), z + oz * (1 - t)));
      ox += (Math.random() - 0.5) * 7 * (1 - t);
      oz += (Math.random() - 0.5) * 7 * (1 - t);
    }
    const up = new THREE.Vector3(0, 1, 0);
    const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
      const m = new THREE.Mesh(this.boltGeo, this.boltMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      m.scale.set(w, a.distanceTo(b), w);
      m.frustumCulled = false;
      group.add(m);
    };
    for (let i = 0; i < n; i++) seg(pts[i], pts[i + 1], thick);
    // A couple of forks.
    for (let f = 0; f < 2; f++) {
      let p = pts[3 + Math.floor(Math.random() * 7)].clone();
      const dx = (Math.random() - 0.5) * 16;
      const dz = (Math.random() - 0.5) * 16;
      for (let i = 0; i < 4; i++) {
        const q = p.clone().add(new THREE.Vector3(dx + (Math.random() - 0.5) * 5, -9 - Math.random() * 6, dz + (Math.random() - 0.5) * 5));
        seg(p, q, thick * 0.5);
        p = q;
      }
    }
    this.game.scene.add(group);
    this.bolts.push({ group, life: 0.5 });
  }

  /** Per rendered frame: flash decay, bolt flicker and the rain curtains' look. */
  frame(realDt: number) {
    this.flash = Math.max(0, this.flash - realDt * 2.6);
    this.flicker += realDt;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= realDt;
      // Two quick flickers, then gone.
      const f = this.flicker;
      b.group.visible = b.life > 0 && (f < 0.09 || (f > 0.14 && f < 0.3) || (f > 0.34 && f < 0.42));
      if (b.life <= 0) {
        this.game.scene.remove(b.group);
        this.bolts.splice(i, 1);
      }
    }
    if (this.phase === 'done') return;
    const u = this.shaftMat.uniforms;
    u.uTime.value = this.game.realTime;
    u.uAlpha.value = (0.14 + 0.3 * smoothstep(0, this.warning, this.t)) * smoothstep(0.1, 0.6, this.intensity);
    u.uLight.value = 0.3 + 0.7 * this.game.sky.daylight;
    this.cloudMat.emissiveIntensity = 0.25 + 0.35 * this.game.sky.daylight + this.flash * 1.5;
  }

  dispose() {
    this.phase = 'done';
    this.game.scene.remove(this.group);
    const ao = this.aoIgnore();
    if (ao) {
      const i = ao.indexOf(this.group);
      if (i >= 0) ao.splice(i, 1);
    }
    this.clouds.geometry.dispose();
    this.cloudMat.dispose();
    for (const s of this.shafts) s.geometry.dispose();
    this.shaftMat.dispose();
    // Bolts already in the air finish their flicker (frame() keeps ticking them); their geometry is shared and tiny.
  }
}
