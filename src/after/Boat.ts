import * as THREE from 'three';
import type { Game } from '../Game';
import { MAT } from '../art/Models';
import { SEA_LEVEL } from '../config';
import { glowTexture } from '../rival/RivalVisuals';
import { aoSkip } from '../endings/CityLights';
import { clamp, smoothstep } from '../util/math';
import { BOAT_LANTERN, boatGeometry } from './art';

// ------------------------------------------------------------------ tuning knobs

/** Game seconds: sailing in from the open sea, lying in the shallows while the family steps off, sailing away. */
export const BOAT_IN = 46;
export const BOAT_MOORED = 10;
export const BOAT_OUT = 40;
/** How far out the boat is first seen (m beyond where it stops). */
const SEA_RUN = 210;
/** Seats (boat-local, the bow toward +z) for up to four people. */
const SEATS = [
  [-0.75, 0.62, -1.9],
  [0.75, 0.62, -1.9],
  [-0.7, 0.62, 0.7],
  [0.7, 0.62, 0.7],
];

export interface Landing {
  /** Last dry ground, where the family comes ashore. */
  shore: THREE.Vector3;
  /** Where the boat lies, in the shallows. */
  water: THREE.Vector3;
  /** Out to sea from the shore (unit). */
  out: THREE.Vector3;
}

export type BoatPhase = 'off' | 'in' | 'moored' | 'out';

/**
 * The newcomers' boat (after the true end, src/after): now and then a small sailing boat comes in from the open sea to
 * the shore nearest Telor, lies in the shallows while a family steps off, and sails away again. One mesh (the stripe
 * on its sail in the family's colour) and the lantern on its bow, drawn only while it is out.
 */
export class Boat {
  readonly group = new THREE.Group();
  readonly landing: Landing | null;
  phase: BoatPhase = 'off';
  /** Game seconds into the phase. */
  t = 0;
  stripe = 0xc4803f;
  private mesh: THREE.Mesh | null = null;
  private readonly geos = new Map<number, THREE.BufferGeometry>();
  private readonly lantern: THREE.Sprite;
  private readonly from = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private side = 1;
  private yaw = 0;
  private wake = 0;
  private readonly obj = new THREE.Object3D();

  constructor(
    private readonly game: Game,
    center: THREE.Vector3,
  ) {
    this.group.name = 'after-boat';
    this.group.visible = false;
    game.scene.add(this.group);
    this.landing = this.findLanding(center);
    this.lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.6, 1.1, 0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.lantern.scale.setScalar(3.2);
    this.group.add(this.lantern);
    aoSkip(game, this.lantern);
  }

  /**
   * The shore nearest Telor that a boat can reach from the open sea: dry ground to walk up from, shallows to lie in,
   * open water behind, not in a village, and not up a cliff.
   */
  private findLanding(c: THREE.Vector3): Landing | null {
    const g = this.game;
    const h = (x: number, z: number) => g.terrain.baseHeightAt(x, z);
    let best: { score: number; l: Landing } | null = null;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let shoreR = -1;
      for (let r = 60; r < 360; r += 2) {
        if (h(c.x + dx * r, c.z + dz * r) < SEA_LEVEL - 0.2) {
          shoreR = r - 2;
          break;
        }
      }
      if (shoreR < 0) continue;
      let waterR = -1;
      for (let r = shoreR + 2; r < shoreR + 40; r += 1.5) {
        if (h(c.x + dx * r, c.z + dz * r) < SEA_LEVEL - 2.2) {
          waterR = r;
          break;
        }
      }
      if (waterR < 0) continue;
      // Open sea behind, all the way out, and inside the world.
      let open = true;
      for (let r = waterR + 6; r <= waterR + SEA_RUN; r += 6) {
        const x = c.x + dx * r;
        const z = c.z + dz * r;
        if (h(x, z) > SEA_LEVEL - 2.5 || Math.abs(x) > 395 || Math.abs(z) > 395) {
          open = false;
          break;
        }
      }
      if (!open) continue;
      const sx = c.x + dx * shoreR;
      const sz = c.z + dz * shoreR;
      if (g.villages.some((v) => Math.hypot(v.center.x - sx, v.center.z - sz) < v.radius * 1.3 + 10)) continue;
      // The walk up from the shore toward the city: no cliffs.
      let steep = 0;
      let prev = h(sx, sz);
      for (let r = shoreR - 3; r > 100; r -= 3) {
        const hh = h(c.x + dx * r, c.z + dz * r);
        steep = Math.max(steep, Math.abs(hh - prev) / 3);
        prev = hh;
      }
      if (steep > 0.9) continue;
      const score = shoreR + steep * 120 + (waterR - shoreR) * 2;
      if (!best || score < best.score) {
        best = {
          score,
          l: {
            shore: new THREE.Vector3(sx, Math.max(h(sx, sz), SEA_LEVEL), sz),
            water: new THREE.Vector3(c.x + dx * (waterR - 1), SEA_LEVEL, c.z + dz * (waterR - 1)),
            out: new THREE.Vector3(dx, 0, dz),
          },
        };
      }
    }
    return best?.l ?? null;
  }

  private geometry(stripe: number): THREE.BufferGeometry {
    let geo = this.geos.get(stripe);
    if (!geo) {
      geo = boatGeometry(stripe);
      this.geos.set(stripe, geo);
    }
    return geo;
  }

  /** A boat sets out for the shore, its sail striped `stripe`. */
  sail(stripe: number, t = 0) {
    if (!this.landing) return false;
    this.stripe = stripe;
    this.phase = 'in';
    this.t = t;
    this.side = Math.random() < 0.5 ? -1 : 1;
    if (this.mesh) this.group.remove(this.mesh);
    this.mesh = new THREE.Mesh(this.geometry(stripe), MAT.base);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    this.group.visible = true;
    return true;
  }

  /** Where the boat is at `u` (0 far out .. 1 lying in the shallows) on its way in, and which way it heads. */
  private course(u: number, out: THREE.Vector3) {
    const L = this.landing!;
    const e = 1 - (1 - u) * (1 - u);
    this.from.copy(L.water).addScaledVector(L.out, SEA_RUN);
    out.lerpVectors(this.from, L.water, e);
    // A gentle curve in, never straight at the beach.
    const px = -L.out.z;
    const pz = L.out.x;
    const bend = Math.sin(Math.PI * e) * 28 * this.side;
    out.x += px * bend;
    out.z += pz * bend;
    return out;
  }

  /** Simulation step (game seconds). Returns the phase it has just entered, if it changed. */
  update(dt: number): BoatPhase | null {
    if (this.phase === 'off') return null;
    this.t += dt;
    const dur = this.phase === 'in' ? BOAT_IN : this.phase === 'moored' ? BOAT_MOORED : BOAT_OUT;
    if (this.t < dur) return null;
    this.t = 0;
    this.phase = this.phase === 'in' ? 'moored' : this.phase === 'moored' ? 'out' : 'off';
    if (this.phase === 'off') this.group.visible = false;
    return this.phase;
  }

  /** Per frame: sail, bob and roll; a wake while moving; the lantern brighter at night. */
  frame(dt: number, night: number) {
    if (this.phase === 'off' || !this.landing || !this.mesh) return;
    const g = this.game;
    const L = this.landing;
    let u = 1;
    let moving = 0;
    if (this.phase === 'in') {
      u = clamp(this.t / BOAT_IN, 0, 1);
      moving = 1 - smoothstep(0.8, 1, u);
    } else if (this.phase === 'out') {
      u = 1 - clamp(this.t / BOAT_OUT, 0, 1);
      moving = smoothstep(0, 0.15, 1 - u);
    }
    this.course(u, this.pos);
    // Heading: along the course (out: turned round toward the sea).
    this.course(clamp(u + (this.phase === 'out' ? -0.02 : 0.02), 0, 1), this.ahead);
    let want = Math.atan2(this.ahead.x - this.pos.x, this.ahead.z - this.pos.z);
    if (this.phase === 'moored' || Math.hypot(this.ahead.x - this.pos.x, this.ahead.z - this.pos.z) < 0.01) want = Math.atan2(-L.out.x, -L.out.z);
    if (this.phase === 'out') want = Math.atan2(L.out.x, L.out.z) + (1 - u) * 0.2 * this.side;
    const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    this.yaw += d * Math.min(1, dt * 1.6);
    const tt = g.realTime;
    this.obj.position.set(this.pos.x, SEA_LEVEL - 0.15 + Math.sin(tt * 1.1) * 0.14, this.pos.z);
    this.obj.rotation.set(Math.sin(tt * 0.7) * 0.035, this.yaw, Math.sin(tt * 0.9) * 0.05, 'YXZ');
    this.obj.updateMatrix();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(this.obj.matrix);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.lantern.position.copy(BOAT_LANTERN).applyMatrix4(this.obj.matrix);
    (this.lantern.material as THREE.SpriteMaterial).opacity = 0.25 + night * 0.75;
    // Fade in from far out, fade away going.
    const vis = this.phase === 'in' ? smoothstep(0, 0.08, u) : this.phase === 'out' ? smoothstep(0, 0.12, u) : 1;
    this.group.visible = vis > 0.01;
    // A wake behind it while it moves.
    this.wake += dt * moving * 14;
    while (this.wake > 1) {
      this.wake -= 1;
      const bx = this.pos.x - Math.sin(this.yaw) * 4;
      const bz = this.pos.z - Math.cos(this.yaw) * 4;
      g.fx.soft.spawn({ x: bx + (Math.random() - 0.5) * 1.5, y: SEA_LEVEL + 0.15, z: bz + (Math.random() - 0.5) * 1.5, vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 2.4, size: 1.1, sizeEnd: 3.4, color: new THREE.Color(0xeaf6ff).multiplyScalar(g.fx.light), alpha: 0.45 * vis, drag: 1.2 });
    }
  }

  /** Where seat `k` is in the world right now (a passenger stands there). */
  seat(k: number, out: THREE.Vector3): THREE.Vector3 {
    const s = SEATS[k % SEATS.length];
    return out.set(s[0], s[1], s[2]).applyMatrix4(this.obj.matrix);
  }

  get heading(): number {
    return this.yaw;
  }

  /** How far it has come in (0..1), for a test. */
  get progress(): number {
    return this.phase === 'in' ? this.t / BOAT_IN : this.phase === 'moored' ? 1 : this.phase === 'out' ? 1 - this.t / BOAT_OUT : 0;
  }
}
