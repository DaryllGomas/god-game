import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { clamp, damp, lerp, smoothstep } from '../util/math';
import { EMBER, VIOLET, VIOLET_LIGHT } from './data';

// ------------------------------------------------------------------ shared bits

let glowTex: THREE.CanvasTexture | null = null;
/** A soft round gradient (white in the middle, clear at the edge): mist puffs, glows, shadows. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let discTex: THREE.CanvasTexture | null = null;
/** A mostly solid dark disc with a soft edge (the hand's shadow). */
function discTexture(): THREE.CanvasTexture {
  if (discTex) return discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  discTex = new THREE.CanvasTexture(c);
  return discTex;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Keep soft, see-through things (glows, mist, cloud) out of the ambient-occlusion pre-pass, which would draw them as dark boxes. */
function aoSkip(game: Game, obj: THREE.Object3D, on: boolean) {
  const list = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
  if (!list) return;
  const i = list.indexOf(obj);
  if (on && i < 0) list.push(obj);
  else if (!on && i >= 0) list.splice(i, 1);
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

// ----------------------------------------------------------------------- his isle

/** Where his isle sits: far out on the sea, off the island's north-west shoulder (in view of the default camera). */
export const ISLE_POS = new THREE.Vector3(-640, 0, -400);

/**
 * A dark spire-isle out at sea, ringed by a slow violet storm-eye with ember windows.
 * Rises out of the waves when he arrives and sinks away when he retreats.
 */
export class RivalIsle {
  readonly group = new THREE.Group();
  private appear = 0;
  private goal = 0;
  private readonly crown = new THREE.Group();
  private readonly eye = new THREE.Group();
  private readonly glow: THREE.Sprite;
  private readonly beam: THREE.Mesh;
  private readonly bolt: THREE.Line;
  private readonly clouds: THREE.Mesh[] = [];
  private readonly mats: THREE.Material[] = [];
  private t = Math.random() * 10;
  private flash = 0;
  private nextBolt = 3;

  constructor(private readonly game: Game) {
    const scene = game.scene;
    const g = this.group;
    g.position.copy(ISLE_POS);

    const rockMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1c1430, roughness: 0.95, flatShading: true }));
    const spireMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b1d4a, roughness: 0.8, flatShading: true, emissive: 0x2a0f55, emissiveIntensity: 0.55 }));
    const emberMat = this.track(new THREE.MeshBasicMaterial({ color: EMBER }));
    const shardMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a2a8a, emissive: VIOLET, emissiveIntensity: 1.5, roughness: 0.3, flatShading: true }));

    // The rocky foot of the isle, jittered so it looks hewn, half drowned.
    const rock = new THREE.ConeGeometry(78, 46, 9, 3);
    const p = rock.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const j = 1 + 0.18 * Math.sin(x * 0.31 + z * 0.27) * Math.cos(y * 0.2 + x * 0.1);
      p.setXYZ(i, x * j, y + 4 * Math.sin(x * 0.17 + z * 0.23), z * j);
    }
    rock.computeVertexNormals();
    const rockMesh = new THREE.Mesh(rock, rockMat);
    rockMesh.position.y = 14;
    g.add(rockMesh);

    // The crooked spire: three stacked tapers, leaning a little, with lit ember windows.
    const spire = new THREE.Group();
    spire.rotation.z = 0.06;
    spire.scale.y = 1.45;
    spire.position.y = 30;
    const parts: [number, number, number, number][] = [
      [10, 19, 74, 37],
      [5, 10.5, 66, 107],
      [0.8, 5.5, 74, 177],
    ];
    for (const [rt, rb, h, y] of parts) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 7, 1), spireMat);
      m.position.y = y - 30;
      spire.add(m);
    }
    const windows = new THREE.BoxGeometry(2.2, 4.4, 1.2);
    for (let i = 0; i < 12; i++) {
      const lvl = i % 3;
      const a = (i / 12) * Math.PI * 2 * 3.1;
      const y = 28 + lvl * 34 + (i % 4) * 5;
      const r = lerp(18, 7, y / 150) * 0.97;
      const w = new THREE.Mesh(windows, emberMat);
      w.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      w.rotation.y = -a + Math.PI / 2;
      spire.add(w);
    }
    // Buttress spurs.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const s = new THREE.Mesh(new THREE.ConeGeometry(4.5, 40, 5), spireMat);
      s.position.set(Math.cos(a) * 24, 14, Math.sin(a) * 24);
      s.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      spire.add(s);
    }
    g.add(spire);

    // A crown of floating violet shards circling the top.
    this.crown.position.y = 276;
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), shardMat);
      s.scale.set(3, rand(7, 11), 3);
      const a = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(a) * 26, rand(-6, 8), Math.sin(a) * 26);
      s.rotation.set(rand(-0.3, 0.3), a, rand(-0.3, 0.3));
      this.crown.add(s);
    }
    g.add(this.crown);

    // The storm-eye: a slow ring of dark violet cloud around the spire.
    const cloudMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x241638, emissive: 0x2a1052, emissiveIntensity: 0.6, roughness: 1, transparent: true, opacity: 0.94 }),
    );
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + rand(-0.08, 0.08);
      const r = rand(70, 120);
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cloudMat);
      puff.scale.set(rand(22, 38), rand(10, 17), rand(18, 30));
      puff.position.set(Math.cos(a) * r, 92 + rand(-14, 26), Math.sin(a) * r);
      puff.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
      this.eye.add(puff);
      this.clouds.push(puff);
    }
    g.add(this.eye);

    // Glow in the eye, and a faint beacon beam above the crown.
    const glowMat = this.track(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0x8a50ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(260, 260, 1);
    this.glow.position.y = 200;
    g.add(this.glow);
    const beamMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x9060ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 16, 380, 14, 1, true), beamMat);
    this.beam.position.y = 380;
    g.add(this.beam);

    // A bolt from the eye to the spire's tip, flashed now and then.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 9; i++) pts.push(new THREE.Vector3(0, 0, 0));
    const boltMat = this.track(new THREE.LineBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0, fog: false }));
    this.bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), boltMat);
    g.add(this.bolt);

    g.visible = false;
    scene.add(g);
    aoSkip(game, g, true);
  }

  private track<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  get present(): boolean {
    return this.goal > 0;
  }

  /** 0..1 how risen it is. */
  get level(): number {
    return this.appear;
  }

  setPresent(on: boolean, instant = false) {
    this.goal = on ? 1 : 0;
    if (instant) this.appear = this.goal;
  }

  /** A burst of violet lightning (arrival, scheme strikes). */
  pulse(amount = 1) {
    this.flash = Math.min(1.5, this.flash + amount);
  }

  /** World position of the spire's tip (where his schemes seem to come from). */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.group.position.x, this.group.position.y + 255 * this.appear, this.group.position.z);
  }

  frame(dt: number) {
    this.t += dt;
    this.appear += (this.goal - this.appear) * damp(0.5, dt);
    if (Math.abs(this.goal - this.appear) < 0.002) this.appear = this.goal;
    const a = this.appear;
    const e = easeInOut(clamp(a, 0, 1));
    this.group.visible = a > 0.003;
    if (!this.group.visible) return;
    this.group.position.y = ISLE_POS.y - (1 - e) * 150;
    this.group.scale.setScalar((0.4 + 0.6 * e) * 0.8);

    this.crown.rotation.y = this.t * 0.25;
    this.crown.position.y = 276 + Math.sin(this.t * 0.7) * 3;
    this.eye.rotation.y = this.t * 0.04;
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.y += Math.sin(this.t * 0.3 + i) * 0.01;

    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = rand(5, 10);
      this.flash = Math.max(this.flash, 1);
      this.rebuildBolt();
    }
    const throb = 0.55 + 0.25 * Math.sin(this.t * 0.8);
    (this.glow.material as THREE.SpriteMaterial).opacity = e * (throb * 0.5 + this.flash * 0.5);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = e * (0.07 + 0.06 * throb + this.flash * 0.1);
    (this.bolt.material as THREE.LineBasicMaterial).opacity = this.flash > 0.5 ? clamp((this.flash - 0.4) * 1.5, 0, 1) : 0;
  }

  private rebuildBolt() {
    const attr = this.bolt.geometry.attributes.position as THREE.BufferAttribute;
    const a = rand(0, Math.PI * 2);
    const sx = Math.cos(a) * 60;
    const sz = Math.sin(a) * 60;
    for (let i = 0; i < attr.count; i++) {
      const f = i / (attr.count - 1);
      attr.setXYZ(i, lerp(sx, 4, f) + (i && i < attr.count - 1 ? rand(-9, 9) : 0), lerp(120, 270, f) - f * 20 - (1 - f) * 2, lerp(sz, 0, f) + (i && i < attr.count - 1 ? rand(-9, 9) : 0));
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    aoSkip(this.game, this.group, false);
    disposeGroup(this.group);
    for (const m of this.mats) m.dispose();
  }
}

// -------------------------------------------------------------------- the mist

/** A violet mist that settles over a village while Whispers are on it. */
export class Mist {
  private readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; a: number; r: number; h: number; sp: number; size: number }[] = [];
  private strength = 0;
  private goal = 1;
  private t = Math.random() * 10;
  private sparkle = 0;

  constructor(
    private readonly game: Game,
    private readonly village: Village,
  ) {
    const mat0 = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7a46d8, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const m = mat0.clone();
      const s = new THREE.Sprite(m);
      const r = Math.sqrt(Math.random()) * village.radius * 0.95;
      const a = rand(0, Math.PI * 2);
      const size = rand(34, 62);
      s.scale.set(size, size * 0.55, 1);
      this.puffs.push({ s, a, r, h: rand(3, 12), sp: rand(0.02, 0.07) * (Math.random() < 0.5 ? -1 : 1), size });
      this.group.add(s);
    }
    mat0.dispose();
    game.scene.add(this.group);
    aoSkip(game, this.group, true);
  }

  /** 0..1 how thick it is; ramps in and out smoothly. */
  setGoal(v: number) {
    this.goal = v;
  }

  get thick(): number {
    return this.strength;
  }

  frame(dt: number) {
    this.t += dt;
    this.strength += (this.goal - this.strength) * damp(0.8, dt);
    const c = this.village.center;
    for (const p of this.puffs) {
      p.a += p.sp * dt;
      const x = c.x + Math.cos(p.a) * p.r;
      const z = c.z + Math.sin(p.a) * p.r;
      p.s.position.set(x, this.game.terrain.heightAt(x, z) + p.h + Math.sin(this.t * 0.6 + p.a * 3) * 1.2, z);
      (p.s.material as THREE.SpriteMaterial).opacity = 0.34 * this.strength * (0.75 + 0.25 * Math.sin(this.t * 0.9 + p.r));
    }
  }

  /** Simulation step: little wisps rise from the mist. */
  step(dt: number) {
    this.sparkle -= dt;
    if (this.sparkle > 0 || this.strength < 0.2) return;
    this.sparkle = 0.35;
    const c = this.village.center;
    const a = rand(0, Math.PI * 2);
    const r = Math.sqrt(Math.random()) * this.village.radius * 0.8;
    this.game.fx.sparkle(c.x + Math.cos(a) * r, c.y + rand(2, 6), c.z + Math.sin(a) * r, 2, VIOLET_LIGHT, 2.5);
  }

  dispose() {
    this.game.scene.remove(this.group);
    aoSkip(this.game, this.group, false);
    for (const p of this.puffs) (p.s.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ the dark hand

export type HandMode = 'hover' | 'strike' | 'lift' | 'recoil' | 'gone';

/**
 * His Grasping Hand: a gnarled dark hand with ember fingertips that lowers from a violet cloud
 * toward a point on the ground, where its shadow (and a closing ember ring) grows to warn you.
 */
export class DarkHand {
  readonly group = new THREE.Group();
  mode: HandMode = 'hover';
  /** Ground point it reaches for. */
  readonly aim = new THREE.Vector3();
  private readonly hand = new THREE.Group();
  private readonly fingers: { pivot: THREE.Group; tip: THREE.Group; base: number }[] = [];
  private readonly hit: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly arm: THREE.Mesh;
  private readonly cloud: THREE.Sprite;
  private readonly held = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  private readonly mats: THREE.Material[] = [];
  private curl = 0.15;
  private curlGoal = 0.15;
  private height = 95;
  private t = 0;
  private modeT = 0;
  private fade = 0;
  private hover = false;
  private shadowR = 0;
  private liftDir = new THREE.Vector2(-1, -1);
  private readonly skin: THREE.MeshStandardMaterial;

  constructor(private readonly game: Game) {
    const ember = new THREE.MeshBasicMaterial({ color: EMBER });
    const skin = new THREE.MeshStandardMaterial({ color: 0x1d1034, roughness: 0.55, emissive: 0x3a1470, emissiveIntensity: 0.5, transparent: true });
    this.skin = skin;
    this.mats.push(skin, ember);
    const S = 1.05;
    // Palm and knuckles.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
    palm.scale.set(4.6 * S, 1.7 * S, 5 * S);
    this.hand.add(palm);
    // Four fingers + thumb: two segments each, curled by `curl`.
    const finger = (x: number, z: number, len: number, rad: number, yaw: number, thumb = false) => {
      const pivot = new THREE.Group();
      pivot.position.set(x * S, 0, z * S);
      pivot.rotation.y = yaw;
      const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(rad * S, len * S, 4, 8), skin);
      seg1.rotation.x = Math.PI / 2;
      seg1.position.z = (len * S) / 2 + rad * S;
      pivot.add(seg1);
      const tip = new THREE.Group();
      tip.position.z = len * S + rad * 2 * S;
      const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(rad * 0.82 * S, len * 0.8 * S, 4, 8), skin);
      seg2.rotation.x = Math.PI / 2;
      seg2.position.z = (len * 0.8 * S) / 2 + rad * 0.8 * S;
      tip.add(seg2);
      const nail = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.7 * S, 8, 6), ember);
      nail.position.z = len * 0.8 * S + rad * 1.9 * S;
      tip.add(nail);
      pivot.add(tip);
      this.hand.add(pivot);
      this.fingers.push({ pivot, tip, base: thumb ? 0.6 : 0 });
    };
    finger(-3.3, 4.2, 4.6, 0.75, 0.08);
    finger(-1.1, 4.6, 5.4, 0.8, 0.02);
    finger(1.1, 4.6, 5.2, 0.8, -0.03);
    finger(3.3, 4.0, 4.2, 0.7, -0.1);
    finger(5.2, -0.2, 3.4, 0.85, -1.25, true);

    // The arm reaching up into a violet cloud.
    this.arm = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * S, 3.2 * S, 120, 10, 1, true), skin);
    this.arm.position.set(0, 60, -6);
    this.arm.rotation.x = -0.22;
    this.hand.add(this.arm);
    const cloudMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x4a2090, transparent: true, opacity: 0.8, depthWrite: false });
    this.mats.push(cloudMat);
    this.cloud = new THREE.Sprite(cloudMat);
    this.cloud.scale.set(120, 70, 1);
    this.cloud.position.set(0, 118, -28);
    this.hand.add(this.cloud);

    const heldMat = this.held.material as THREE.MeshStandardMaterial;
    this.mats.push(heldMat);
    this.held.position.set(0, -1.6, 5);
    this.held.visible = false;
    this.hand.add(this.held);

    this.hit = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    this.mats.push(this.hit.material as THREE.Material);
    this.hit.position.set(0, 0, 3);
    this.hand.add(this.hit);

    this.group.add(this.hand);

    // Shadow on the ground and the closing ember ring.
    const shadowMat = new THREE.MeshBasicMaterial({
      map: discTexture(),
      color: 0x0c0214,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mats.push(shadowMat);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    const ringMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.push(ringMat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    game.scene.add(this.group, this.shadow, this.ring);
    for (const o of [this.group, this.shadow, this.ring]) aoSkip(game, o, true);
    this.group.visible = false;
    this.shadow.visible = false;
    this.ring.visible = false;
  }

  /** Is this screen ray over the hand (for the slap)? */
  hitTest(ray: THREE.Raycaster): boolean {
    if (this.mode === 'gone' || this.mode === 'recoil') return false;
    this.group.updateMatrixWorld(true);
    return ray.intersectObject(this.hit, false).length > 0;
  }

  setHover(on: boolean) {
    this.hover = on;
  }

  /** Where the palm is (for effects and the camera). */
  palm(out: THREE.Vector3): THREE.Vector3 {
    return this.hand.getWorldPosition(out);
  }

  /** `p` 0..1 through the shadow phase: the hand lowers, the shadow grows. */
  approach(p: number, radius: number) {
    this.mode = 'hover';
    this.height = lerp(95, 24, easeInOut(clamp(p, 0, 1)));
    this.shadowR = lerp(1.2, radius, easeInOut(clamp(p, 0, 1)));
    this.curlGoal = lerp(0.15, 0.45, p);
  }

  /** Snap shut on the ground. */
  strike(withVillager: number | null) {
    this.mode = 'strike';
    this.modeT = 0;
    this.curlGoal = 1.35;
    if (withVillager !== null) {
      (this.held.material as THREE.MeshStandardMaterial).color.setHex(withVillager);
    }
  }

  /** Rise away; carrying a villager if `carry` is set. */
  lift(carry: number | null) {
    this.mode = 'lift';
    this.modeT = 0;
    this.curlGoal = 1.1;
    this.held.visible = carry !== null;
    if (carry !== null) (this.held.material as THREE.MeshStandardMaterial).color.setHex(carry);
    // Head back toward his isle.
    this.liftDir.set(ISLE_POS.x - this.aim.x, ISLE_POS.z - this.aim.z).normalize();
  }

  /** Slapped: spin away and fade, with comic speed. */
  recoil() {
    this.mode = 'recoil';
    this.modeT = 0;
    this.curlGoal = 0.1;
  }

  get done(): boolean {
    return this.mode === 'gone';
  }

  frame(dt: number) {
    if (this.mode === 'gone') return;
    this.t += dt;
    this.modeT += dt;
    const g = this.game;
    this.curl += (this.curlGoal - this.curl) * damp(this.mode === 'strike' ? 14 : 5, dt);
    this.fade = Math.min(1, this.fade + dt * 1.2);

    const sway = Math.sin(this.t * 1.7) * 0.6;
    let h = this.height;
    let ox = 0;
    let oz = 0;
    let spin = 0;
    let alpha = this.fade;
    if (this.mode === 'hover') {
      h += Math.sin(this.t * 2.2) * 1.2;
      ox = Math.sin(this.t * 1.3) * 1.4;
      oz = Math.cos(this.t * 1.1) * 1.2;
    } else if (this.mode === 'strike') {
      const k = clamp(this.modeT / 0.3, 0, 1);
      h = lerp(this.height, 4.2, k * k);
    } else if (this.mode === 'lift') {
      const k = clamp(this.modeT / 3.2, 0, 1);
      h = lerp(4.2, 150, k * k);
      ox = this.liftDir.x * k * k * 160;
      oz = this.liftDir.y * k * k * 160;
      alpha = 1 - smoothstep(0.55, 1, k);
      if (k >= 1) this.finish();
    } else if (this.mode === 'recoil') {
      const k = clamp(this.modeT / 1.1, 0, 1);
      h = this.height + k * 90;
      spin = k * 9;
      ox = k * 40;
      alpha = 1 - smoothstep(0.35, 1, k);
      if (k >= 1) this.finish();
    }
    const gy = g.terrain.heightAt(this.aim.x, this.aim.z);
    this.group.position.set(this.aim.x + ox, gy + h, this.aim.z + oz);
    this.group.rotation.set(0, sway * 0.12 + spin, spin * 0.3);
    this.hand.rotation.x = 0.1;
    for (const f of this.fingers) {
      const c = this.curl;
      f.pivot.rotation.x = f.base ? 0.35 + c * 0.45 : c * 0.5; // knuckle
      f.tip.rotation.x = f.base ? c * 0.6 : c * 0.9; // second joint
    }
    this.skin.opacity = clamp(alpha, 0, 1);
    this.skin.emissiveIntensity = 0.5 + (this.hover ? 0.9 : 0) + Math.sin(this.t * 6) * 0.05;
    this.cloud.visible = this.mode !== 'recoil';
    (this.cloud.material as THREE.SpriteMaterial).opacity = 0.8 * alpha;
    this.arm.visible = this.mode !== 'recoil';
    this.group.visible = alpha > 0.01;

    // Shadow + ring on the ground below the aim point; they stay put while the hand sways.
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    const showGround = this.mode === 'hover' || this.mode === 'strike';
    const r = Math.max(0.01, this.shadowR);
    this.shadow.visible = this.ring.visible = showGround && this.fade > 0.02;
    this.shadow.position.set(this.aim.x, gy + 0.35, this.aim.z);
    this.shadow.scale.set(r * 1.35, r * 1.35, 1);
    sm.opacity = 0.85 * this.fade;
    this.ring.position.set(this.aim.x, gy + 0.45, this.aim.z);
    this.ring.scale.set(r * 1.05, r * 1.05, 1);
    rm.opacity = this.fade * (0.45 + 0.35 * Math.sin(this.t * 7) * (this.mode === 'hover' ? 1 : 0));
  }

  private finish() {
    this.mode = 'gone';
    this.group.visible = false;
    this.shadow.visible = false;
    this.ring.visible = false;
  }

  dispose() {
    this.game.scene.remove(this.group, this.shadow, this.ring);
    for (const o of [this.group, this.shadow, this.ring]) aoSkip(this.game, o, false);
    disposeGroup(this.group);
    this.shadow.geometry.dispose();
    this.ring.geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}

// ------------------------------------------------------------- a village that turned

/** What marks a village as his: a violet banner pole and a flickering violet-and-ember flame over the totem. */
export class TurnedMark {
  private readonly group = new THREE.Group();
  private readonly flame: THREE.Sprite;
  private readonly cloth: THREE.Mesh;
  private readonly mats: THREE.Material[] = [];
  private strength = 0;
  private goal = 1;
  private t = Math.random() * 10;
  private sparkle = 0;

  constructor(
    private readonly game: Game,
    private readonly village: Village,
  ) {
    const w = village.worship.pos;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1034, roughness: 0.7, emissive: 0x2a0f55, emissiveIntensity: 0.4 });
    const clothMat = new THREE.MeshStandardMaterial({ color: VIOLET, emissive: 0x3a1a78, emissiveIntensity: 0.5, roughness: 0.7, side: THREE.DoubleSide });
    this.mats.push(poleMat, clothMat);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 14, 6), poleMat);
    pole.position.set(0, 7, -5);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(5.2, -1.2);
    shape.lineTo(3.4, -2.8);
    shape.lineTo(5.2, -4.4);
    shape.lineTo(0, -5.2);
    shape.closePath();
    this.cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), clothMat);
    this.cloth.position.set(0.2, 13.4, -5);
    // Ember trim along the pole's top.
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: EMBER }));
    this.mats.push(orb.material as THREE.Material);
    orb.position.set(0, 14.4, -5);
    this.group.add(pole, this.cloth, orb);

    const flameMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9a60ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.push(flameMat);
    this.flame = new THREE.Sprite(flameMat);
    this.flame.scale.set(14, 20, 1);
    this.flame.position.set(0, 7, 4.2);
    this.group.add(this.flame);

    this.group.position.set(w.x, w.y, w.z);
    game.scene.add(this.group);
    aoSkip(game, this.group, true);
    this.group.scale.setScalar(0.01);
    village.store.setColor(VIOLET);
  }

  release() {
    this.goal = 0;
    this.village.store.setColor(this.village.color);
  }

  get gone(): boolean {
    return this.goal === 0 && this.strength < 0.02;
  }

  frame(dt: number) {
    this.t += dt;
    this.strength += (this.goal - this.strength) * damp(1.4, dt);
    this.group.scale.setScalar(Math.max(0.01, this.strength));
    this.cloth.rotation.y = Math.sin(this.t * 1.7) * 0.35;
    (this.flame.material as THREE.SpriteMaterial).opacity = this.strength * (0.55 + 0.25 * Math.sin(this.t * 7) * Math.sin(this.t * 3.1));
  }

  step(dt: number) {
    this.sparkle -= dt;
    if (this.sparkle > 0 || this.strength < 0.5) return;
    this.sparkle = 0.5;
    const w = this.village.worship.pos;
    this.game.fx.sparkle(w.x + rand(-2, 2), w.y + 8, w.z + 4 + rand(-1, 1), 1, Math.random() < 0.3 ? EMBER : VIOLET_LIGHT, 1.5);
  }

  dispose() {
    this.game.scene.remove(this.group);
    aoSkip(this.game, this.group, false);
    disposeGroup(this.group);
    for (const m of this.mats) m.dispose();
  }
}
