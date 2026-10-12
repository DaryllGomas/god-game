import type { Game, GamePlugin } from '../Game';
import { House, Field } from '../entities/Buildings';
import * as THREE from 'three';
import { padLog } from '../world/Pads';
import { groundCheck, summarize, type GroundProp, type GroundReport } from '../world/groundCheck';

/**
 * v0.6 "ground": `game.debug.groundCheck()` lists every placed object whose footprint floats above or sinks
 * into the terrain by more than 0.15 m. Other plugins add their props through `game.groundProps`.
 */
export function install(game: Game): GamePlugin {
  const g = game as unknown as { debug?: Record<string, unknown>; groundProps?: () => GroundProp[] };
  const debug = (g.debug ??= {});
  debug.padLog = padLog;
  debug.groundCheck = (eps = 0.15): GroundReport & { text: string } => {
    const r = groundCheck(game, g.groundProps?.() ?? [], eps);
    return Object.assign(r, { text: summarize(r) });
  };
  /** Test helper: grow every village (more houses, fields, a project site, later shrine ages) so the check sees built things. */
  debug.buildMore = (houses = 4, fields = 3, shrineStage?: string) => {
    let n = 0;
    for (const v of game.villages) {
      for (let i = 0; i < houses; i++) {
        const spot = v.findSpot(game, 0.3, 1.1, 6.5, { hx: 3.4, hz: 3.1 });
        if (!spot) continue;
        const h = new House(v, spot.x, spot.y, spot.z, Math.atan2(v.center.x - spot.x, v.center.z - spot.z), 1000 + i * 77 + n, true);
        v.houses.push(h);
        game.add(h);
        n++;
      }
      for (let i = 0; i < fields; i++) {
        const spot = v.findSpot(game, 0.85, 1.4, 9);
        if (!spot) continue;
        const f = new Field(v, spot.x, spot.y, spot.z, Math.atan2(v.center.x - spot.x, v.center.z - spot.z), 0.5);
        v.fields.push(f);
        game.add(f);
        n++;
      }
      if (shrineStage) (game as unknown as { shrines: { setStage(v: unknown, s: string, a?: boolean): unknown } }).shrines.setStage(v, shrineStage, false);
    }
    return n;
  };
  /** Test helper: fell the `n` steepest-standing grown trees (they leave stumps) and start a project in each village. */
  debug.fellAndStart = (n = 12) => {
    const trees = game.entities.filter((e) => e.kind === 'tree' && (e as unknown as { growth: number }).growth >= 0.5);
    const n3 = new THREE.Vector3();
    trees.sort((a, b) => game.terrain.normalAt(a.pos.x, a.pos.z, n3).y - game.terrain.normalAt(b.pos.x, b.pos.z, n3).y);
    for (const t of trees.slice(0, n)) game.remove(t);
    let sites = 0;
    for (const v of game.villages) {
      try {
        if ((game as unknown as { projectSystem: { startNow(v: unknown): unknown } }).projectSystem.startNow(v)) sites++;
      } catch (err) {
        console.warn('startNow failed', err);
      }
    }
    return { felled: Math.min(n, trees.length), sites };
  };
  /** Test helper: drop houses and fields on real slopes (normal.y between lo and hi) near the home village, via game.add. */
  debug.stressSlopes = (n = 8, lo = 0.8, hi = 0.93) => {
    const home = game.villages[0];
    const nv = new THREE.Vector3();
    let placed = 0;
    let tries = 0;
    while (placed < n && tries++ < 4000) {
      const a = Math.random() * Math.PI * 2;
      const d = home.radius * (1.2 + Math.random() * 2.6);
      const x = home.center.x + Math.cos(a) * d;
      const z = home.center.z + Math.sin(a) * d;
      if (!game.terrain.isLand(x, z, 3)) continue;
      const ny = game.terrain.normalAt(x, z, nv).y;
      if (ny < lo || ny > hi) continue;
      let clash = false;
      for (const e of game.entities) if ((e.kind === 'house' || e.kind === 'field') && Math.hypot(e.pos.x - x, e.pos.z - z) < 12) clash = true;
      if (clash) continue;
      const rot = Math.atan2(nv.x, nv.z);
      const y = game.terrain.heightAt(x, z);
      if (placed % 2 === 0) {
        const h = new House(home, x, y, z, rot, 5000 + placed, true);
        home.houses.push(h);
        game.add(h);
      } else {
        const f = new Field(home, x, y, z, rot, 0.6);
        home.fields.push(f);
        game.add(f);
      }
      placed++;
    }
    return placed;
  };
  return { name: 'ground' };
}
