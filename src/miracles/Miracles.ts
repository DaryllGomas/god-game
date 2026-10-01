import * as THREE from 'three';
import type { Game } from '../Game';
import { Entity, ownedMesh } from '../entities/Entity';
import { Pile, Tree } from '../entities/Nature';
import { Field, House } from '../entities/Buildings';
import { Villager } from '../entities/Villager';
import { MAT, cloudGeometry } from '../art/Models';
import { MIRACLES } from '../config';
import { damp } from '../util/math';
import { rng } from '../util/rng';

export type MiracleId = 'water' | 'food' | 'fire';

export const MIRACLE_INFO: Record<MiracleId, { name: string; cost: number; key: string; color: number; icon: string; blurb: string }> = {
  water: { name: 'Water', cost: MIRACLES.water.cost, key: MIRACLES.water.key, color: 0x5ab8ff, icon: '💧', blurb: 'Rain that douses fires and makes crops and forests grow.' },
  food: { name: 'Food', cost: MIRACLES.food.cost, key: MIRACLES.food.key, color: 0xffcf4a, icon: '🌾', blurb: 'A bounty of grain. Feeds the hungry and wins hearts.' },
  fire: { name: 'Fire', cost: MIRACLES.fire.cost, key: MIRACLES.fire.key, color: 0xff5a1f, icon: '🔥', blurb: 'A fireball. Terrifying, destructive and very impressive.' },
};

// ------------------------------------------------------------------------ orb

/** A miracle held in the Hand; it takes effect where it lands. */
export class Orb extends Entity {
  readonly kind = 'orb' as const;
  readonly miracle: MiracleId;
  private readonly core: THREE.Mesh;
  private t = 0;

  constructor(miracle: MiracleId) {
    super();
    this.miracle = miracle;
    const info = MIRACLE_INFO[miracle];
    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 2),
      new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 2.2, roughness: 0.3 }),
    );
    this.core.userData.ownsGeometry = true;
    this.object.add(this.core);
    this.radius = 1;
    this.groundOffset = 0.5;
  }

  update(game: Game, dt: number) {
    this.t += dt;
    const s = (this.held ? game.hand.scale * 0.55 : 1.2) * (1 + Math.sin(this.t * 8) * 0.08);
    this.core.scale.setScalar(s);
    const { x, y, z } = this.object.position;
    const info = MIRACLE_INFO[this.miracle];
    const rate = this.airborne ? 90 : 30;
    const n = Math.floor(rate * dt + Math.random());
    for (let i = 0; i < n; i++) {
      if (this.miracle === 'fire') game.fx.fire(x, y - 0.3 * s, z, s * 0.9);
      else game.fx.sparkle(x, y, z, 1, info.color, s * 1.6);
    }
  }

  onImpact(game: Game) {
    castMiracle(game, this.miracle, this.pos.x, this.pos.z, this.vel);
    game.remove(this);
  }

  onWater(game: Game) {
    game.fx.splash(this.pos.x, this.pos.z, 30, 1.5);
    if (this.miracle === 'fire') for (let i = 0; i < 12; i++) game.fx.smoke(this.pos.x, 0.5, this.pos.z, 2, 0.85);
    game.message(`Your ${MIRACLE_INFO[this.miracle].name} miracle fizzled in the sea.`, 'info');
    game.remove(this);
  }
}

// ---------------------------------------------------------------- the effects

export function castMiracle(game: Game, id: MiracleId, x: number, z: number, vel: THREE.Vector3) {
  const y = game.terrain.surfaceAt(x, z);
  game.audio.miracle(id, new THREE.Vector3(x, y, z));
  game.events.emit('miracle', { id, x, z });
  switch (id) {
    case 'water': {
      const cloud = new RainCloud(x, z, vel.x * 0.06, vel.z * 0.06);
      game.add(cloud);
      game.fx.sparkle(x, y + 2, z, 30, 0x9fd8ff, 6);
      game.player.shiftAlignment(0.01);
      game.impress(x, z, 6, 0, 'Rain from the heavens');
      break;
    }
    case 'food': {
      const store = game.storeNear(x, z, 10);
      if (store) {
        store.deposit('food', 110);
        game.fx.sparkle(store.pos.x, store.pos.y + 4, store.pos.z, 60, 0xffe28a, 6);
        game.floatText(store.pos.x, store.pos.y + 8, store.pos.z, '+110 food', '#ffe9a8');
        game.giftToVillage(store.village, 110, 'food');
      } else {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + rng.range(0, 1);
          const px = x + Math.cos(a) * rng.range(1.5, 4);
          const pz = z + Math.sin(a) * rng.range(1.5, 4);
          if (!game.terrain.isLand(px, pz, 0.2)) continue;
          const p = new Pile('food', px, pz, 27);
          p.pos.y = game.terrain.heightAt(px, pz);
          p.droppedByPlayer = true;
          game.add(p);
        }
        game.fx.sparkle(x, y + 2, z, 50, 0xffe28a, 6);
        game.impress(x, z, 25, 0.02, 'A gift of food');
      }
      game.player.shiftAlignment(0.03);
      break;
    }
    case 'fire': {
      game.fx.explosion(x, y, z, 1.2);
      game.shake(1.2);
      let burnt = 0;
      game.forEachNear(x, z, 10, (e) => {
        if (!e.flammable || e.held) return;
        const d = Math.hypot(e.pos.x - x, e.pos.z - z);
        e.ignitedByPlayer = true;
        e.ignite(game);
        if (e.burning) burnt++;
        if (e instanceof House && d < 7) e.damage(game, 0.25, true);
        if (e instanceof Villager && d < 3) e.health -= 0.5;
      });
      game.player.shiftAlignment(-0.025 - burnt * 0.004);
      game.impress(x, z, 10 + Math.min(20, burnt * 2), 0, 'Fire rains down');
      break;
    }
  }
}

// ----------------------------------------------------------------- rain cloud

const RAIN_RADIUS = 14;

export class RainCloud extends Entity {
  readonly kind = 'cloud' as const;
  private life = 0;
  private readonly duration = 14;
  private tick = 0;
  private readonly drift: THREE.Vector2;
  private readonly impressed = new Set<string>();
  private readonly mesh: THREE.Mesh;
  /** Nature's own rain (e.g. the end of a dry spell): it waters things, but nobody credits you for it. */
  natural = false;

  constructor(x: number, z: number, dx: number, dz: number) {
    super();
    this.drift = new THREE.Vector2(dx, dz).clampLength(0, 3);
    this.mesh = ownedMesh(cloudGeometry(rng.int(0, 1e6)), MAT.cloud, true);
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 3;
    this.object.add(this.mesh);
    this.pos.set(x, 0, z);
    this.mesh.scale.setScalar(0.01);
  }

  update(game: Game, dt: number) {
    this.life += dt;
    this.pos.x += this.drift.x * dt;
    this.pos.z += this.drift.y * dt;
    const targetY = game.terrain.surfaceAt(this.pos.x, this.pos.z) + 34;
    this.pos.y = this.pos.y === 0 ? targetY : this.pos.y + (targetY - this.pos.y) * damp(1, dt);
    const grow = Math.min(1, this.life / 1.2) * Math.min(1, (this.duration - this.life) / 1.5);
    this.mesh.scale.setScalar(Math.max(0.01, grow));
    this.mesh.rotation.y += dt * 0.05;
    this.syncObject();

    if (this.life < this.duration - 1.5) {
      game.fx.rain(this.pos.x, this.pos.y - 2, this.pos.z, RAIN_RADIUS * 0.8, Math.floor(160 * dt + Math.random()));
    }

    this.tick += dt;
    if (this.tick >= 0.5) {
      this.tick = 0;
      this.soak(game);
    }
    if (this.life >= this.duration) game.remove(this);
  }

  private soak(game: Game) {
    const { x, z } = this.pos;
    let doused = 0;
    game.forEachNear(x, z, RAIN_RADIUS, (e) => {
      if (e.burning) {
        e.extinguish(game);
        game.events.emit('fireOut', { entity: e });
        doused++;
      }
      if (e instanceof Tree) e.water(0.05);
      else if (e instanceof Field) e.water(0.09);
    });
    // Saplings spring up on bare grass.
    if (Math.random() < 0.35) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * RAIN_RADIUS;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (game.canPlantTree(sx, sz)) {
        const t = new Tree(rng.int(0, 1e6), sx, sz, 0.05);
        t.pos.y = game.terrain.heightAt(sx, sz);
        game.add(t);
      }
    }
    if (this.natural) return;
    if (doused > 0) {
      game.player.shiftAlignment(0.006 * doused);
      game.impress(x, z, 5 * doused, 0, 'The fires are quenched');
    }
    for (const v of game.villages) {
      if (this.impressed.has(v.name) || !v.contains(x, z, 1.4)) continue;
      this.impressed.add(v.name);
      game.events.emit('rainedOn', { village: v });
      if (v.owner !== 'player') game.impress(v.center.x, v.center.z, 12, 0, `${v.name} rejoices in the rain`);
    }
  }
}
