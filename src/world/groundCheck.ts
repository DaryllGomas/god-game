import * as THREE from 'three';
import type { Game } from '../Game';
import { House, Store, WorshipSite, Field } from '../entities/Buildings';
import { Site } from '../projects/Site';
import { BUILT_AT_SHRINE } from '../shrines/stages';
import { SHRINE } from '../shrines/ShrineModels';
import { soilCells } from '../art/FieldMesh';
import { HOUSE_SKIRT, STORE_SKIRT, SOIL_LIFT, SHRINE_FLOOR, SHRINE_COURT, SITE_SKIRT } from './groundRules';

/**
 * Ground contact check (`game.debug.groundCheck()`): for every placed object, sample its footprint
 * against the terrain MESH as drawn (triangles read back from the geometry, not the height array)
 * and list the points where the object floats above the ground (gap) or is buried under it.
 *
 * A point is an offender when:  gap = (contact y - skirt) - ground > eps   (daylight under it)
 *                          or   buried = ground - contact y > eps          (ground eats it)
 * `skirt` is a hidden skirt the object carries below its contact plane.
 */
export interface GroundOffender {
  what: string;
  id: number;
  /** Index of the sample point within the object, its contact height and the ground height there. */
  i: number;
  y: number;
  ground: number;
  x: number;
  z: number;
  gap: number;
  buried: number;
}
export interface GroundReport {
  eps: number;
  objects: number;
  samples: number;
  offenders: GroundOffender[];
  byKind: Record<string, { objects: number; samples: number; worstGap: number; worstBuried: number; bad: number }>;
}

/** A thing placed on the ground by something outside the entity list (props, fences, stumps...). */
export interface GroundProp {
  what: string;
  /** World points to test: [x, z, contactY]. */
  pts: [number, number, number][];
  skirt?: number;
  /** Organic things (stumps, roots) may sink into rising ground. */
  allowBury?: number;
}

/** Terrain height straight from the rendered mesh triangles. */
export class MeshSampler {
  private readonly pos: Float32Array;
  private readonly res: number;
  private readonly size: number;
  constructor(game: Game) {
    const t = game.terrain;
    this.pos = (t.mesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    this.res = t.res;
    this.size = t.size;
  }
  at(x: number, z: number): number {
    const { res, size, pos } = this;
    const cell = size / (res - 1);
    const fx = (x + size / 2) / cell;
    const fz = (z + size / 2) / cell;
    const ix = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = fx - ix;
    const tz = fz - iz;
    const y = (i: number, j: number) => pos[((iz + j) * res + ix + i) * 3 + 1];
    // PlaneGeometry splits every cell into (a,b,d) and (b,c,d): the diagonal runs b-d.
    if (tx + tz <= 1) return y(0, 0) + tx * (y(1, 0) - y(0, 0)) + tz * (y(0, 1) - y(0, 0));
    return y(1, 1) + (1 - tx) * (y(0, 1) - y(1, 1)) + (1 - tz) * (y(1, 0) - y(1, 1));
  }
}

function rectPts(cx: number, cz: number, rot: number, hx: number, hz: number, y: number): [number, number, number][] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: [number, number, number][] = [];
  const add = (lx: number, lz: number) => out.push([cx + lx * c + lz * s, cz - lx * s + lz * c, y]);
  add(0, 0);
  for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 1]) {
    add(u * hx, v * hz);
    add(v * hx, u * hz);
  }
  return out;
}

function ringPts(cx: number, cz: number, r: number, y: number, n = 16): [number, number, number][] {
  const out: [number, number, number][] = [[cx, cz, y]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, y]);
  }
  return out;
}

/** The footprints of the entities that stand on the ground. */
export function entityProps(game: Game): GroundProp[] {
  const props: GroundProp[] = [];
  for (const e of game.entities) {
    if (!e.alive) continue;
    if (e instanceof House && !e.destroyed) {
      props.push({ what: 'house', pts: rectPts(e.pos.x, e.pos.z, e.object.rotation.y, (e.footW + 0.3) / 2, (e.footD + 0.3) / 2, e.pos.y), skirt: HOUSE_SKIRT });
    } else if (e instanceof Store) {
      props.push({ what: 'store', pts: ringPts(e.pos.x, e.pos.z, 3.7, e.pos.y), skirt: STORE_SKIRT });
    } else if (e instanceof WorshipSite) {
      const stage = e.shrine.stage;
      if (stage === 'totem' || stage === 'stone_circle') {
        props.push({ what: 'shrine-floor', pts: ringPts(e.pos.x, e.pos.z, 8, e.pos.y + SHRINE_FLOOR.top, 20), skirt: SHRINE_FLOOR.skirt });
      } else {
        props.push({ what: 'shrine-court', pts: ringPts(e.pos.x, e.pos.z, SHRINE.court, e.pos.y + SHRINE_COURT.top, 24), skirt: SHRINE_COURT.skirt });
      }
    } else if (e instanceof Site && !e.complete && !BUILT_AT_SHRINE.has(e.def.id)) {
      // (Sites raised at a prayer place stand on its court, checked above.)
      props.push({ what: 'site', pts: ringPts(e.pos.x, e.pos.z, e.def.radius, e.pos.y), skirt: SITE_SKIRT });
    } else if (e instanceof Field) {
      const g = e.soilGeometry();
      if (g) {
        const p = g.attributes.position as THREE.BufferAttribute;
        const m = e.object.matrixWorld;
        const pts: [number, number, number][] = [];
        const nx = soilCells(e.width);
        const nz = soilCells(e.depth);
        // The soil geometry is non-indexed: its first 2*nx*nz triangles are the draped top (the skirt follows and is
        // hidden). Test one corner, the centroid and one edge midpoint of every top triangle.
        const tris = 2 * nx * nz;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < tris; t++) {
          a.fromBufferAttribute(p, t * 3).applyMatrix4(m);
          b.fromBufferAttribute(p, t * 3 + 1).applyMatrix4(m);
          c.fromBufferAttribute(p, t * 3 + 2).applyMatrix4(m);
          pts.push([a.x, a.z, a.y - SOIL_LIFT]);
          pts.push([(a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3 - SOIL_LIFT]);
          pts.push([(a.x + c.x) / 2, (a.z + c.z) / 2, (a.y + c.y) / 2 - SOIL_LIFT]);
        }
        props.push({ what: 'field', pts, skirt: 0.5 });
      }
    }
  }
  return props;
}

export function groundCheck(game: Game, extra: GroundProp[] = [], eps = 0.15): GroundReport {
  game.terrain.commit();
  game.scene.updateMatrixWorld(true);
  const mesh = new MeshSampler(game);
  const rep: GroundReport = { eps, objects: 0, samples: 0, offenders: [], byKind: {} };
  let id = 0;
  for (const p of [...entityProps(game), ...extra]) {
    id++;
    const k = (rep.byKind[p.what] ??= { objects: 0, samples: 0, worstGap: 0, worstBuried: 0, bad: 0 });
    k.objects++;
    rep.objects++;
    let bad = false;
    let pi = -1;
    for (const [x, z, y] of p.pts) {
      pi++;
      const ground = mesh.at(x, z);
      const gap = y - (p.skirt ?? 0) - ground;
      const buried = ground - y - (p.allowBury ?? 0);
      rep.samples++;
      k.samples++;
      k.worstGap = Math.max(k.worstGap, gap);
      k.worstBuried = Math.max(k.worstBuried, buried);
      if (gap > eps || buried > eps) {
        bad = true;
        rep.offenders.push({ what: p.what, id, i: pi, y: +y.toFixed(2), ground: +ground.toFixed(2), x: +x.toFixed(1), z: +z.toFixed(1), gap: +Math.max(0, gap).toFixed(2), buried: +Math.max(0, buried).toFixed(2) });
      }
    }
    if (bad) k.bad++;
  }
  return rep;
}

export function summarize(r: GroundReport): string {
  const lines = [`ground check: ${r.objects} objects, ${r.samples} samples, eps ${r.eps} m, ${r.offenders.length} offending samples`];
  for (const [kind, k] of Object.entries(r.byKind))
    lines.push(`  ${kind.padEnd(13)} objects ${String(k.objects).padStart(3)}  bad ${String(k.bad).padStart(3)}  worst gap ${k.worstGap.toFixed(2)}  worst buried ${k.worstBuried.toFixed(2)}`);
  return lines.join('\n');
}
