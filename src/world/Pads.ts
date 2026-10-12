import type { Game } from '../Game';
import type { Entity } from '../entities/Entity';
import { Field, House, Store, WorshipSite } from '../entities/Buildings';
import { Site } from '../projects/Site';
import { BUILT_AT_SHRINE } from '../shrines/stages';
import { footprintPoints, type Footprint } from './Terrain';

/**
 * The ground-contact rule for placed things that stand on the ground (houses, the store, prayer places, build
 * sites): the land under them is levelled into a small flat pad with a soft falloff (Terrain.levelFootprint), and
 * the thing is set to the pad's height. Soft things (fields) drape instead; they re-fit when the land under
 * them changes (Field.conform). Where the slope is too much for a pad the spot is refused (see `spotOk`) and, for
 * things placed anyway (a prayer place), the skirt under the model hides the difference.
 */

/** What happened to each pad request (read it from `game.debug.padLog`). */
export const padLog: { kind: string; x: number; z: number; range: number; taken: boolean; applied: boolean }[] = [];

/** Largest height range under a footprint that we will level, by footprint size. */
const MAX_RANGE_SMALL = 3.2;
const MAX_RANGE_BIG = 3.5;

/** What a flat pad must cover for this entity (null: nothing to level). */
export function padFor(e: Entity): Footprint | null {
  if (e instanceof House) return { x: e.pos.x, z: e.pos.z, rot: e.object.rotation.y, hx: (e.footW + 0.3) / 2 + 0.5, hz: (e.footD + 0.3) / 2 + 0.5 };
  if (e instanceof Store) return { x: e.pos.x, z: e.pos.z, rot: 0, hx: 5.9, hz: 5.9, round: true };
  if (e instanceof WorshipSite) return { x: e.pos.x, z: e.pos.z, rot: 0, hx: 12.4, hz: 12.4, round: true };
  if (e instanceof Site && !BUILT_AT_SHRINE.has(e.def.id)) {
    const r = e.def.radius * 0.95 + 3.4;
    return { x: e.pos.x, z: e.pos.z, rot: 0, hx: r, hz: r, round: true };
  }
  return null;
}

/** The part of the pad the model itself covers (its contact patch). */
function coreOf(e: Entity, f: Footprint): Footprint {
  if (e instanceof House) return { ...f, hx: f.hx - 0.5, hz: f.hz - 0.5 };
  if (e instanceof Store) return { ...f, hx: 3.7, hz: 3.7 };
  if (e instanceof WorshipSite) return { ...f, hx: 8, hz: 8 };
  if (e instanceof Site) return { ...f, hx: e.def.radius, hz: e.def.radius };
  return f;
}

const maxRange = (f: Footprint) => (Math.max(f.hx, f.hz) > 6.5 ? MAX_RANGE_BIG : MAX_RANGE_SMALL);

/** Level the ground under `e` (if it stands on a pad) and put it on the pad. Called as the entity joins the world. */
export function settleOnGround(game: Game, e: Entity) {
  const f = padFor(e);
  if (!f) return;
  const t = game.terrain;
  const m = t.measureFootprint(f);
  const skipped = m.taken || m.range > maxRange(f);
  padLog.push({ kind: e.kind, x: +f.x.toFixed(1), z: +f.z.toFixed(1), range: +m.range.toFixed(2), taken: m.taken, applied: !skipped });
  if (skipped) {
    // No pad (too steep, or it clashes with another): stand on the highest ground under the contact patch, so
    // nothing is buried, and the model's hidden skirt covers the gap on the downhill side.
    let hi = -Infinity;
    for (const [x, z] of footprintPoints(coreOf(e, f), 1)) hi = Math.max(hi, t.heightAt(x, z));
    if (Number.isFinite(hi)) e.pos.y = hi;
    return;
  }
  t.levelFootprint(f, m.mean);
  e.pos.y = m.mean;
  // Draped things nearby re-fit to the new ground.
  for (const o of game.entities) if (o instanceof Field) o.syncLand(game);
}

/** Would a thing with this footprint get a pad here (not too steep, not on another pad)? For choosing a spot. */
export function spotOk(game: Game, f: Footprint): boolean {
  const m = game.terrain.measureFootprint(f);
  return !m.taken && m.range <= maxRange(f);
}
