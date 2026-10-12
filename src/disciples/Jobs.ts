import * as THREE from 'three';
import type { Game } from '../Game';
import type { Villager } from '../entities/Villager';
import { SEA_LEVEL } from '../config';

export const JOBS = ['forester', 'builder', 'farmer', 'fisher', 'worshipper'] as const;
export type Job = typeof JOBS[number];
export const WORK_RANGE = 60;
export const FISH_TIME = 8;
export const STONE_TRIP = 2;

/** Find dry shoreline rather than asking fishers to stand in deep water. */
export function shoreNear(game: Game, x: number, z: number): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let distance = Infinity;
  for (let dx = -WORK_RANGE; dx <= WORK_RANGE; dx += 2) {
    for (let dz = -WORK_RANGE; dz <= WORK_RANGE; dz += 2) {
      const d = dx * dx + dz * dz;
      if (d >= distance) continue;
      const y = game.terrain.heightAt(x + dx, z + dz);
      if (y < SEA_LEVEL + 0.15 || y > SEA_LEVEL + 1.5) continue;
      if (![[-2, 0], [2, 0], [0, -2], [0, 2]].some(([a, b]) => game.terrain.heightAt(x + dx + a, z + dz + b) <= SEA_LEVEL)) continue;
      best = new THREE.Vector3(x + dx, y, z + dz);
      distance = d;
    }
  }
  return best;
}

export class Disciples {
  constructor(private readonly game: Game) {
    game.events.on('place', ({ entity, x, z }) => {
      if (entity.kind === 'villager') this.drop(entity as Villager, x, z);
    });
    game.events.on('landed', ({ entity }) => {
      if (entity.kind === 'villager') this.drop(entity as Villager, entity.pos.x, entity.pos.z);
    });
  }

  assign(v: Villager, job: Job | null, x = v.pos.x, z = v.pos.z): boolean {
    if (v.dead || v.village.owner !== 'player' || (job !== null && !JOBS.includes(job))) return false;
    v.setDisciple(job, x, z);
    if (job) {
      this.game.fx.sparkle(x, this.game.terrain.heightAt(x, z) + 0.8, z, 12, 0xffe6a0, 1);
      this.game.audio.chime(v.pos);
    }
    return true;
  }

  private drop(v: Villager, x: number, z: number) {
    if (v.dead || v.village.owner !== 'player') return;
    const village = v.village;
    const near = (p: THREE.Vector3, r: number) => Math.hypot(p.x - x, p.z - z) <= r;
    const site = village.projectSite;
    let job: Job | null = null;
    if (site && !site.complete && near(site.pos, site.radius + 2)) job = 'builder';
    else if (near(village.worship.pos, village.worship.ringRadius + 2)) job = 'worshipper';
    else if (village.fields.some(f => f.alive && near(f.pos, f.radius + 1))) job = 'farmer';
    else if (this.game.terrain.heightAt(x, z) <= SEA_LEVEL + 2) {
      const shore = shoreNear(this.game, x, z);
      if (shore && Math.hypot(shore.x - x, shore.z - z) < 5) job = 'fisher';
    }
    if (!job && this.game.nearest('tree', x, z, 7, t => !t.held && !t.airborne && !t.burning)) job = 'forester';
    this.assign(v, job, x, z);
  }
}
