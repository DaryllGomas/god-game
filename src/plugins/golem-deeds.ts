import type { Game, GamePlugin } from '../Game';
import type { Entity } from '../entities/Entity';
import { Pile } from '../entities/Nature';
import type { Site } from '../projects/Site';
import type { GoodKey } from '../creature/Deeds';

/**
 * Learning by watching (the golem's good side, see src/creature/Golem.ts `observe`): when your hand
 * hauls to a build site, plants, waters, puts out a fire, brings a lost villager home or faces down the
 * dark hand, the golem glances over and wants to do the same. It also takes food you put down by it.
 */
export function install(game: Game): GamePlugin {
  const ev = game.events;
  const seen = (key: GoodKey, x: number, z: number) => game.creature?.observe(game, key, x, z);

  /** A thing the hand set down (or threw) on or near a build site counts as hauling. */
  const siteNear = (e: Entity): Site | null =>
    game.nearest<Site>('site', e.pos.x, e.pos.z, 40, (s) => {
      const site = s as Site;
      return !site.complete && Math.hypot(s.pos.x - e.pos.x, s.pos.z - e.pos.z) < site.def.radius + 4;
    });

  const delivered = (e: Entity, x: number, z: number) => {
    if (e.kind !== 'rock' && e.kind !== 'tree' && e.kind !== 'wood') return false;
    if (!siteNear(e)) return false;
    seen('deed:haul', x, z);
    return true;
  };

  ev.on('place', ({ entity, x, z }) => {
    if (delivered(entity, x, z)) return;
    if (entity.kind === 'tree') seen('deed:plant', x, z);
    else if (entity instanceof Pile && entity.kind === 'food') game.creature?.feedFromHand(game, entity);
  });
  ev.on('landed', ({ entity }) => {
    if (entity.thrownByPlayer) delivered(entity, entity.pos.x, entity.pos.z);
  });
  ev.on('miracle', ({ id, x, z }) => {
    if (id === 'water') seen('deed:plant', x, z);
  });
  ev.on('fireOut', ({ entity }) => {
    if (!game.creature || game.creature.action.kind === 'fire') return;
    seen('deed:fire', entity.pos.x, entity.pos.z);
  });
  ev.on('prayerAnswered', ({ kind, village, villager }) => {
    if (kind === 'lost') seen('deed:rescue', villager?.pos.x ?? village.center.x, villager?.pos.z ?? village.center.z);
  });
  ev.on('schemeFoiled', ({ kind, village }) => {
    if (kind === 'hand') seen('deed:guard', village.center.x, village.center.z);
  });

  return { name: 'golem-deeds' };
}
