import * as THREE from 'three';
import type { Game } from '../Game';

export type Kind = 'villager' | 'tree' | 'rock' | 'food' | 'wood' | 'house' | 'store' | 'worship' | 'field' | 'orb' | 'cloud' | 'creature' | 'site';

let nextId = 1;

/** Anything that lives in the world. Physics, fire and the Hand all work on this base. */
export abstract class Entity {
  readonly id = nextId++;
  abstract readonly kind: Kind;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly spin = new THREE.Vector3();
  readonly object = new THREE.Group();

  alive = true;
  grabbable = false;
  held = false;
  airborne = false;
  rolling = false;
  canRoll = false;
  /** Seconds spent rolling slowly; lets rocks settle in steep gullies instead of jittering forever. */
  slowRoll = 0;
  /** Picking / collision radius. */
  radius = 1;
  mass = 1;
  /** Distance from `pos` down to the entity's contact point with the ground. */
  groundOffset = 0;
  /** Id of the villager that has reserved this (tree to chop, pile to collect...). */
  claimedBy = 0;

  // Fire
  flammable = false;
  burning = false;
  fuel = 0;
  health = 1;

  /** Whoever lit this fire gets the blame (alignment) for what it destroys. */
  ignitedByPlayer = false;

  // Throw bookkeeping, used for impressiveness and blame.
  thrownByPlayer = false;
  /** Thrown by the player's creature: its deeds shape its own alignment. */
  thrownByCreature = false;
  /** Set on throw; cleared once the first landing has impressed onlookers. */
  impressPending = false;
  readonly launchPoint = new THREE.Vector3();

  update(_game: Game, _dt: number): void {}

  /** Airborne body touched the ground at `speed`. Physics settles/bounces afterwards unless airborne is cleared. */
  onImpact(_game: Game, _speed: number): void {}

  /** Landed in deep water. Default: sinks without a trace. */
  onWater(game: Game): void {
    game.fx.splash(this.pos.x, this.pos.z, 20, Math.min(2, this.radius));
    game.remove(this);
  }

  onPickup(_game: Game): void {}
  onDrop(_game: Game): void {}

  ignite(game: Game): void {
    if (!this.flammable || this.burning || this.fuel <= 0 || !this.alive) return;
    this.burning = true;
    this.onIgnite(game);
  }

  extinguish(game: Game): void {
    if (!this.burning) return;
    this.burning = false;
    game.fx.smoke(this.pos.x, this.pos.y + 1, this.pos.z, 1.5, 0.7);
    this.onExtinguish(game);
  }

  protected onIgnite(_game: Game): void {}
  protected onExtinguish(_game: Game): void {}
  /** Fuel ran out while burning. */
  onBurntOut(_game: Game): void {}

  /** Height above `pos` where fire particles and labels should sit. */
  get topHeight(): number {
    return this.radius * 1.5;
  }

  syncObject(): void {
    this.object.position.copy(this.pos);
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      // Geometries built per-entity are owned; shared materials are never disposed here.
      if (m.isMesh && m.userData.ownsGeometry) m.geometry.dispose();
    });
  }
}

export function ownedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.userData.ownsGeometry = true;
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export function sharedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}
