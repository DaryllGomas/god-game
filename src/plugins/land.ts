import type { Game, GamePlugin } from '../Game';
import { VILLAGE_SITES } from '../config';
import { LAND_RES, setLandMask } from '../land/groundLook';
import { CH_FLOOR, CH_PATH, CH_WORN, LandPainter } from '../land/LandMask';
import { findRoad, type Path } from '../land/Roads';
import { buildFlora } from '../land/Flora';
import { VillageDecor } from '../land/VillageDecor';
import type { Village } from '../village/Village';

/**
 * v0.6 "land": the ground and the density of the world. Roads between villages (A* around the mountains), village
 * footpaths and trampled earth around houses, fields and the totem, darker ground under trees (all painted into the
 * land mask the terrain and grass shaders read), plus decorative forests, shrubs, flower clumps, boulders and a stony
 * shore (instanced, drawn only near the camera). The decorative trees are NOT game entities: they start past the
 * real groves (2 village radii), so every tree a villager or the hand can reach is still a real, choppable one.
 */
const CHECK = 1.5; // seconds between "did the buildings or trees change?" checks
const ROAD_HALF = 2.3;
const FOOTPATH_HALF = 1.25;
/** Worn ring paths round the totem, as fractions of the village radius (panel 2's concentric rings). */
const RINGS = [0.24, 0.37, 0.53];
const RING_HALF = 0.95;

function mix32(n: number) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/** A gently bent footpath from a to b (the bend is fixed per pair, so it never wiggles between rebuilds). */
function footpath(ax: number, az: number, bx: number, bz: number): Path {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const bend = (mix32(Math.round(ax * 7 + bz * 13 + bx * 3)) - 0.5) * len * 0.22;
  const nx = -dz / len;
  const nz = dx / len;
  const pts: Path = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const off = Math.sin(t * Math.PI) * bend;
    pts.push({ x: ax + dx * t + nx * off, z: az + dz * t + nz * off });
  }
  return pts;
}

export function install(game: Game): GamePlugin {
  // ---- roads between the villages (static)
  const roadPaths: Path[] = [];
  const used = new Set<number>(); // later roads reuse earlier ones instead of running alongside
  const sites = VILLAGE_SITES;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i];
      const b = sites[j];
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / d;
      const uz = (b.z - a.z) / d;
      const p = findRoad(game.terrain, a.x + ux * a.radius * 0.3, a.z + uz * a.radius * 0.3, b.x - ux * b.radius * 0.3, b.z - uz * b.radius * 0.3, used);
      if (p) roadPaths.push(p);
    }
  }
  const roads = new LandPainter();
  for (const p of roadPaths) roads.path(p, ROAD_HALF, CH_PATH, 0.95, 0.35);

  // ---- decorative nature (static)
  const flora = buildFlora(game, roads);
  (game as unknown as { landFlora: unknown }).landFlora = flora.count;
  // The base mask: roads and the forest floor under decorative trees. The live one adds buildings and real trees.
  const base = new LandPainter();
  base.copyFrom(roads);
  for (let i = 0; i < LAND_RES * LAND_RES; i++) base.data[i * 4 + CH_FLOOR] = flora.floor.data[i * 4 + CH_FLOOR];
  const live = new LandPainter();
  // Village density: decorative clumps, gardens and walkers (visual only; re-checked against the live mask each repaint).
  const decor = new VillageDecor(game, roads);
  flora.sets.push(...decor.sets);
  (game as unknown as { landFlora: Record<string, number> }).landFlora = { ...flora.count, ...decor.count };
  const routes = new Map<Village, Path[]>();

  let lastSig = NaN;
  let timer = 0;
  const rebuild = () => {
    let sig = 0;
    let n = 0;
    for (const e of game.entities) {
      if (!e.alive) continue;
      if (e.kind === 'tree' || e.kind === 'house' || e.kind === 'field' || e.kind === 'store' || e.kind === 'worship') {
        sig += e.pos.x * 3.1 + e.pos.z * 5.7 + ++n;
      }
    }
    if (Math.abs(sig - lastSig) < 1e-6) return;
    lastSig = sig;
    live.copyFrom(base);
    routes.clear();
    for (const v of game.villages) {
      const vroutes: Path[] = [];
      routes.set(v, vroutes);
      const cx = v.center.x;
      const cz = v.center.z;
      live.disc(cx, cz, v.radius * 0.5, CH_WORN, 0.55, 0.3);
      const spots: { x: number; z: number; r: number }[] = [];
      for (const e of game.entities) {
        if (!e.alive) continue;
        if (e.kind !== 'house' && e.kind !== 'field' && e.kind !== 'store') continue;
        if (Math.hypot(e.pos.x - cx, e.pos.z - cz) > v.radius * 1.5) continue;
        const r = e.kind === 'field' ? 9 : 7;
        spots.push({ x: e.pos.x, z: e.pos.z, r });
        live.disc(e.pos.x, e.pos.z, r, CH_WORN, e.kind === 'field' ? 0.7 : 0.85, 0.45);
      }
      // Footpaths: from the totem to every building, and each building to its nearest neighbour.
      for (const s of spots) {
        const fp = footpath(cx, cz, s.x, s.z);
        live.path(fp, FOOTPATH_HALF, CH_PATH, 0.9, 0.3);
        vroutes.push(fp);
      }
      // Concentric worn rings round the totem, broken wherever a building stands in the way.
      const wp = v.worship.pos;
      for (const f of RINGS) {
        const rad = v.radius * f;
        const steps = Math.max(36, Math.round(rad * 2.2));
        let run: Path = [];
        const flush = () => {
          if (run.length > 1) {
            live.path(run, RING_HALF, CH_PATH, 0.75, 0.3);
            vroutes.push(run);
          }
          run = [];
        };
        for (let k = 0; k <= steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          const x = wp.x + Math.cos(a) * rad;
          const z = wp.z + Math.sin(a) * rad;
          const blocked = !game.terrain.isLand(x, z, 1.2) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < s.r * 0.62);
          if (blocked) flush();
          else run.push({ x, z });
        }
        flush();
      }
      for (const s of spots) {
        let best: (typeof spots)[number] | null = null;
        let bd = 30;
        for (const o of spots) {
          if (o === s) continue;
          const d = Math.hypot(o.x - s.x, o.z - s.z);
          if (d < bd && d > 4) {
            bd = d;
            best = o;
          }
        }
        if (best && s.x + s.z < best.x + best.z) live.path(footpath(s.x, s.z, best.x, best.z), FOOTPATH_HALF * 0.9, CH_PATH, 0.8, 0.3);
      }
    }
    for (const e of game.entities) {
      if (e.alive && e.kind === 'tree') live.disc(e.pos.x, e.pos.z, 3.6 + e.object.scale.x * 1.4, CH_FLOOR, 0.9, 0.3);
    }
    setLandMask(live.data);
    decor.refresh(live, routes);
  };
  rebuild();

  return {
    name: 'land',
    frame(realDt) {
      decor.frame(realDt, game.godCam.distance);
      timer -= realDt;
      if (timer <= 0) {
        timer = CHECK;
        rebuild();
      }
      const cam = game.godCam;
      const dist = cam.distance;
      const q = (game as unknown as { postfx?: { quality: string } }).postfx?.quality ?? 'high';
      const k = q === 'high' ? 1 : q === 'medium' ? 0.75 : 0.5;
      const cx = cam.target.x;
      const cz = cam.target.z;
      for (const s of flora.sets) {
        let r = 0;
        if (s.kind === 'tree') r = Math.min(1100, dist * 2.6 + 140) * (0.5 + 0.5 * k);
        else if (dist < s.maxCam * k) r = Math.min(s.kind === 'rock' ? 700 : 420, dist * 2.3 + 100) * k;
        s.set.update(cx, cz, r);
        if (s.kind === 'tree') s.set.mesh.castShadow = dist < 320 * k + 60;
      }
    },
  };
}
