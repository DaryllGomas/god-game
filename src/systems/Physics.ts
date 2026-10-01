import * as THREE from 'three';
import type { Game } from '../Game';
import type { Entity } from '../entities/Entity';
import { House } from '../entities/Buildings';
import { GRAVITY, SEA_LEVEL } from '../config';

const n = new THREE.Vector3();
const AIR_DRAG = 0.04;
const RESTITUTION = 0.35;
const BOUNCE_FRICTION = 0.6;
const ROLL_FRICTION = 1.1;

/** Ballistic flight, bouncing and rolling for anything the Hand lets go of. */
export function updatePhysics(game: Game, dt: number) {
  for (const e of game.entities) {
    if (!e.alive || e.held) continue;
    if (e.airborne) stepAirborne(game, e, dt);
    else if (e.rolling) stepRolling(game, e, dt);
  }
}

function stepAirborne(game: Game, e: Entity, dt: number) {
  const speed = e.vel.length();
  const steps = Math.min(8, Math.max(1, Math.ceil((speed * dt) / 1.5)));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    e.vel.y -= GRAVITY * h;
    e.vel.multiplyScalar(1 - AIR_DRAG * h);
    e.pos.addScaledVector(e.vel, h);
    e.object.rotation.x += e.spin.x * h;
    e.object.rotation.y += e.spin.y * h;
    e.object.rotation.z += e.spin.z * h;

    if (e.kind !== 'orb') flightCollisions(game, e);
    if (!e.alive || !e.airborne) break;

    const ground = game.terrain.heightAt(e.pos.x, e.pos.z);
    if (e.pos.y - e.groundOffset > Math.max(ground, SEA_LEVEL)) continue;

    if (ground < SEA_LEVEL - 0.6) {
      e.pos.y = SEA_LEVEL;
      e.syncObject();
      game.onSplash(e);
      e.onWater(game);
      return;
    }

    e.pos.y = ground + e.groundOffset;
    const impact = e.vel.length();
    game.onLanding(e, impact);
    if (e.impressPending) {
      e.impressPending = false;
      game.onThrownLanding(e);
    }
    e.onImpact(game, impact);
    if (!e.alive || !e.airborne) break;

    // Bounce off the slope.
    game.terrain.normalAt(e.pos.x, e.pos.z, n);
    const vn = e.vel.dot(n);
    if (vn < 0) e.vel.addScaledVector(n, -(1 + RESTITUTION) * vn);
    e.vel.x *= BOUNCE_FRICTION;
    e.vel.z *= BOUNCE_FRICTION;
    e.spin.multiplyScalar(0.5);
    if (Math.abs(e.vel.y) < 3.5) {
      e.airborne = false;
      e.vel.y = 0;
      if (e.canRoll && Math.hypot(e.vel.x, e.vel.z) > 1.5) e.rolling = true;
      else settle(e);
      break;
    }
  }
  e.syncObject();
}

function stepRolling(game: Game, e: Entity, dt: number) {
  game.terrain.normalAt(e.pos.x, e.pos.z, n);
  // Gravity along the slope, then rolling friction.
  e.vel.x += n.x * GRAVITY * dt;
  e.vel.z += n.z * GRAVITY * dt;
  const f = Math.exp(-ROLL_FRICTION * dt);
  e.vel.x *= f;
  e.vel.z *= f;
  e.pos.x += e.vel.x * dt;
  e.pos.z += e.vel.z * dt;
  const ground = game.terrain.heightAt(e.pos.x, e.pos.z);
  if (ground < SEA_LEVEL - 0.6) {
    e.rolling = false;
    e.pos.y = SEA_LEVEL;
    e.syncObject();
    game.onSplash(e);
    e.onWater(game);
    return;
  }
  e.pos.y = ground + e.groundOffset;
  flightCollisions(game, e);
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.slowRoll = sp < 0.8 ? e.slowRoll + dt : 0;
  if ((sp < 0.5 && n.y > 0.93) || e.slowRoll > 1.5) {
    e.rolling = false;
    e.slowRoll = 0;
    settle(e);
  }
  e.syncObject();
}

function settle(e: Entity) {
  e.vel.set(0, 0, 0);
  e.spin.set(0, 0, 0);
  e.thrownByPlayer = false;
  e.thrownByCreature = false;
  e.impressPending = false;
}

/** Things in flight smash into houses on the way. */
function flightCollisions(game: Game, e: Entity) {
  const speed = e.vel.length();
  if (speed < 7) return;
  game.forEachNear(e.pos.x, e.pos.z, e.radius + 5, (o) => {
    if (!(o instanceof House) || o.destroyed || o === e) return;
    const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
    if (d > o.radius + e.radius * 0.5) return;
    if (e.pos.y - e.groundOffset > o.pos.y + 6) return;
    const dmg = speed * e.mass * 0.012;
    o.damage(game, dmg, e.thrownByPlayer);
    game.onBuildingHit(o, dmg, e.thrownByPlayer);
    // Rebound off the wall.
    const ox = (e.pos.x - o.pos.x) / (d || 1);
    const oz = (e.pos.z - o.pos.z) / (d || 1);
    const vIn = e.vel.x * ox + e.vel.z * oz;
    if (vIn < 0) {
      e.vel.x -= 1.4 * vIn * ox;
      e.vel.z -= 1.4 * vIn * oz;
    }
    e.vel.multiplyScalar(0.45);
    e.pos.x = o.pos.x + ox * (o.radius + e.radius * 0.5 + 0.05);
    e.pos.z = o.pos.z + oz * (o.radius + e.radius * 0.5 + 0.05);
  });
}
