import * as THREE from 'three';
import type { Game } from '../Game';
import type { Entity } from '../entities/Entity';
import { HandModel } from './HandModel';
import { clamp, damp } from '../util/math';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

const tmp = new THREE.Vector3();

/** The player's avatar: follows the cursor over the land, grabs, carries and throws. */
export class Hand {
  readonly model = new HandModel();
  readonly pos = new THREE.Vector3();
  /** Terrain point under the cursor. */
  readonly ground = new THREE.Vector3();
  valid = false;
  held: Entity | null = null;
  hover: Entity | null = null;
  blocked = false;
  scale = 1;
  private readonly history: Sample[] = [];
  private readonly lastPos = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3(0, 1, 0);
  private swayX = 0;
  private swayZ = 0;
  private initialised = false;
  private aoRegistered = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.model.root);
  }

  /** How far below the palm a held entity's origin sits, so it looks clutched mid-body. */
  private hang(e: Entity): number {
    switch (e.kind) {
      case 'tree':
        return e.topHeight * 0.55;
      case 'villager':
        return 1.0;
      case 'rock':
        return e.radius * 0.3;
      case 'orb':
        return 0;
      default:
        return 0.6;
    }
  }

  update(game: Game, dt: number, realTime: number) {
    const cam = game.godCam;
    // Roughly constant on-screen size: a big, present god-hand.
    this.scale = clamp(cam.distance * 0.075, 1.5, 48);
    const lift = this.scale * 1.2 + (this.held ? this.hang(this.held) : 0);
    // Rise by `lift`, but back along the view ray so the hand stays under the cursor on screen.
    this.toCam.copy(cam.camera.position).sub(this.ground).normalize();
    tmp.copy(this.toCam).multiplyScalar(lift / Math.max(0.25, this.toCam.y)).add(this.ground);
    if (!this.initialised) {
      this.pos.copy(tmp);
      this.lastPos.copy(tmp);
      this.initialised = true;
    }
    this.pos.lerp(tmp, damp(28, dt));

    const root = this.model.root;
    root.position.copy(this.pos);
    root.scale.setScalar(this.scale);
    root.rotation.y = cam.yaw;
    root.visible = this.valid;

    // Sway from motion, in camera space.
    const vx = (this.pos.x - this.lastPos.x) / Math.max(dt, 1e-4);
    const vz = (this.pos.z - this.lastPos.z) / Math.max(dt, 1e-4);
    const right = Math.cos(cam.yaw) * vx - Math.sin(cam.yaw) * vz;
    const fwd = -(Math.sin(cam.yaw) * vx + Math.cos(cam.yaw) * vz);
    const k = 1 / (this.scale * 60);
    this.swayX += (clamp(right * k, -1, 1) - this.swayX) * damp(8, dt);
    this.swayZ += (clamp(fwd * k, -1, 1) - this.swayZ) * damp(8, dt);
    this.lastPos.copy(this.pos);

    this.model.setGrip(this.held ? 0.85 : this.hover ? 0.4 : 0.05);
    if (!this.aoRegistered) {
      const ao = (game as unknown as { aoIgnore?: THREE.Object3D[] }).aoIgnore;
      if (ao) {
        ao.push(...this.model.aoIgnore); // glow sprites stay out of the AO pre-pass
        this.aoRegistered = true;
      }
    }
    this.model.setStroking(game.controls.mode === 'stroke');
    this.model.setAppearance(game.player.alignment, this.blocked);
    this.model.update(dt, this.swayX, this.swayZ);

    if (this.held) {
      // Held just in front of the palm (toward the camera) so it reads as clutched in the fist.
      const e = this.held;
      e.pos.copy(this.pos).addScaledVector(this.toCam, this.scale * 0.9);
      e.pos.y -= this.hang(e);
      e.object.position.copy(e.pos);
      if (e.kind !== 'villager') e.object.rotation.set(0, e.object.rotation.y, 0);
    }

    this.history.push({ t: realTime, x: this.pos.x, y: this.pos.y, z: this.pos.z });
    while (this.history.length > 2 && realTime - this.history[0].t > 0.25) this.history.shift();

    game.terrain.setHandSpot(this.ground.x, this.ground.z, this.valid ? this.scale * 1.6 : 0, this.blocked);
  }

  /** World-space velocity of the hand over the last ~0.1s. */
  velocity(realTime: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.history;
    if (h.length < 2) return out.set(0, 0, 0);
    const last = h[h.length - 1];
    let first = h[0];
    for (let i = h.length - 1; i >= 0; i--) {
      first = h[i];
      if (realTime - h[i].t >= 0.1) break;
    }
    const dt = last.t - first.t;
    if (dt < 1e-3) return out.set(0, 0, 0);
    return out.set((last.x - first.x) / dt, (last.y - first.y) / dt, (last.z - first.z) / dt);
  }

  grab(game: Game, e: Entity) {
    this.held = e;
    e.held = true;
    e.airborne = false;
    e.rolling = false;
    e.vel.set(0, 0, 0);
    e.spin.set(0, 0, 0);
    e.claimedBy = 0;
    e.onPickup(game);
    game.fx.sparkle(e.pos.x, e.pos.y + 1, e.pos.z, 10, 0xffffff, 1.5);
    game.audio.grab(e.pos);
    game.events.emit('grab', { entity: e });
    if (e.kind === 'villager') game.audio.yelp(e.pos);
  }

  /** Fling the held entity with the given velocity. */
  throw(game: Game, vel: THREE.Vector3) {
    const e = this.held;
    if (!e) return;
    this.held = null;
    e.held = false;
    e.airborne = true;
    e.vel.copy(vel);
    const s = vel.length() * 0.08;
    e.spin.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    e.thrownByPlayer = true;
    e.impressPending = true;
    e.launchPoint.copy(e.pos);
    game.onThrow(e, vel.length());
    game.events.emit('throw', { entity: e, speed: vel.length() });
    game.audio.whoosh(e.pos, vel.length());
    if (e.kind === 'villager') game.audio.yelp(e.pos, 1.2);
  }

  /** Set the held entity down gently at a ground point. */
  place(game: Game, at: THREE.Vector3) {
    const e = this.held;
    if (!e) return;
    this.held = null;
    e.held = false;
    e.pos.set(at.x, at.y + e.groundOffset + 0.8, at.z);
    e.vel.set(0, -2, 0);
    e.airborne = true;
    e.thrownByPlayer = false;
    e.impressPending = false;
    e.onDrop(game);
    game.events.emit('place', { entity: e, x: at.x, z: at.z });
  }
}
