import type { Game } from '../Game';
import type { Entity } from '../entities/Entity';
import { House } from '../entities/Buildings';
import { Villager } from '../entities/Villager';

const SPREAD_INTERVAL = 0.5;
const SPREAD_CHANCE = 0.16;

function spreadRadius(e: Entity): number {
  switch (e.kind) {
    case 'house':
      return 9;
    case 'tree':
      return 6.5;
    case 'field':
      return 8;
    default:
      return 3;
  }
}

let spreadTimer = 0;

/** Burning entities consume fuel, hurt, smoke and spread flames to neighbours. */
export function updateFire(game: Game, dt: number) {
  const burning: Entity[] = [];
  for (const e of game.entities) if (e.burning && e.alive) burning.push(e);

  for (const e of burning) {
    e.fuel -= dt;
    const top = e.topHeight;
    const scale = e.kind === 'house' ? 2.2 : e.kind === 'tree' ? 1.5 : e.kind === 'field' ? 1.8 : 0.8;
    const rate = e.kind === 'house' || e.kind === 'field' ? 40 : 25;
    const n = Math.floor(rate * dt + Math.random());
    const baseY = e.object.position.y;
    for (let i = 0; i < n; i++) {
      game.fx.fire(e.object.position.x + (Math.random() - 0.5) * scale * 2, baseY + Math.random() * top, e.object.position.z + (Math.random() - 0.5) * scale * 2, scale);
    }
    if (Math.random() < dt * 6) game.fx.smoke(e.object.position.x, baseY + top + 1, e.object.position.z, scale, 0.18);

    if (e instanceof Villager) {
      e.burnDamage(game, dt);
      if (Math.random() < dt * 0.7) game.audio.yelp(e.pos, 1.35);
    } else if (e instanceof House) e.health -= dt * 0.03;

    if (e.fuel <= 0 && e.burning) {
      e.burning = false;
      e.onBurntOut(game);
    }
  }

  spreadTimer += dt;
  if (spreadTimer < SPREAD_INTERVAL) return;
  spreadTimer = 0;
  for (const e of burning) {
    if (!e.burning || e.held) continue;
    const r = spreadRadius(e);
    game.forEachNear(e.pos.x, e.pos.z, r, (o) => {
      if (o === e || o.burning || !o.flammable || o.held) return;
      if (Math.random() < SPREAD_CHANCE * game.modifiers.fireSpread) {
        o.ignitedByPlayer = e.ignitedByPlayer;
        o.ignite(game);
      }
    });
  }
}
