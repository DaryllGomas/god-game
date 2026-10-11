import * as THREE from 'three';
import type { Game } from '../Game';
import { SEA_LEVEL } from '../config';
import { Rng } from '../util/rng';
import type { Ruin } from './memory';

// ------------------------------------------------------------------ tuning knobs

/** Footprint radius: trees and boulders inside it are cleared, and villages keep this far away. */
export const RUIN_RADIUS = 9;
/** A village's edge: the ruin is pushed out to at least this many village radii from its centre. */
const VILLAGE_CLEAR = 1.25;

const STONE = new THREE.MeshStandardMaterial({ color: 0x9c958a, roughness: 0.95, flatShading: true });
const STONE_DARK = new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.97, flatShading: true });
const MOSS = new THREE.MeshStandardMaterial({ color: 0x5d7d3a, roughness: 1, flatShading: true });
const CHAR = new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 1, flatShading: true });
const PETAL = new THREE.MeshStandardMaterial({ color: 0xf4f0e2, roughness: 0.8, emissive: 0x262418, flatShading: true });
const PETAL_GOLD = new THREE.MeshStandardMaterial({ color: 0xf3cf5a, roughness: 0.8, emissive: 0x2a2008, flatShading: true });

/** Jitter a geometry's vertices so stone looks hewn and weathered, not machined. */
function weather(geo: THREE.BufferGeometry, rng: Rng, amount: number, keepBase = true): THREE.BufferGeometry {
  const p = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const base = keepBase && y - minY < 0.05;
    p.setXYZ(i, p.getX(i) + rng.range(-amount, amount), y + (base ? 0 : rng.range(-amount, amount)), p.getZ(i) + rng.range(-amount, amount));
  }
  geo.computeVertexNormals();
  return geo;
}

/** A column snapped off at `h`: its top is a ragged break, not a flat cut. */
function brokenColumn(rng: Rng, r: number, h: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r * 0.92, r, h, 8, 3);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > h / 2 - 0.01) p.setY(i, y - rng.range(0, h * 0.28));
  }
  geo.translate(0, h / 2, 0);
  return weather(geo, rng, r * 0.08);
}

/**
 * A ruin where the worst act of a fallen world happened: broken columns and a fallen lintel on a cracked
 * plinth, moss and a few wildflowers. A scar, kept quietly; never a monument to guilt. What happened
 * shapes it a little: fire leaves charred timbers, a life taken leaves a toppled standing stone.
 */
export class RuinModel {
  readonly group = new THREE.Group();

  constructor(
    private readonly game: Game,
    readonly ruin: Ruin,
  ) {
    const rng = new Rng(Math.floor(ruin.x * 7 + ruin.z * 13 + ruin.world * 101) >>> 0);
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // The plinth: two cracked, sunken steps.
    // The lower step runs deep, so on a slope it sinks into the hill instead of floating.
    add(weather(new THREE.CylinderGeometry(7.2, 8.4, 6, 9, 1).translate(0, -2.45, 0), rng, 0.25), STONE_DARK, 0, -0.2, 0, rng.range(0, 6));
    add(weather(new THREE.CylinderGeometry(5.6, 6.2, 0.9, 8, 1), rng, 0.22), STONE, 0.4, 0.6, -0.3, rng.range(0, 6));

    // A ring of columns, most snapped off; one still stands nearly whole.
    const n = 5;
    const tall = rng.int(0, n - 1);
    for (let i = 0; i < n; i++) {
      if (i === (tall + 2) % n) continue; // a gap where one has fallen
      const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const h = i === tall ? rng.range(8.5, 10) : rng.range(2.2, 5.5);
      const col = add(brokenColumn(rng, 0.85, h), i % 2 ? STONE : STONE_DARK, Math.cos(a) * 4.4, 0.9, Math.sin(a) * 4.4, rng.range(0, 6));
      col.rotation.z = rng.range(-0.06, 0.06);
      // Moss creeping up from the foot.
      add(weather(new THREE.SphereGeometry(1.05, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), rng, 0.15), MOSS, col.position.x, 0.9, col.position.z, 0, false).scale.set(1, 0.55, 1);
    }
    // The fallen one, lying across the plinth's edge in pieces.
    const fa = ((tall + 2) / n) * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const seg = add(brokenColumn(rng, 0.8, rng.range(2.2, 3)), STONE, Math.cos(fa) * (5.8 + k * 2.6), 0.75, Math.sin(fa) * (5.8 + k * 2.6), 0);
      seg.rotation.set(Math.PI / 2 + rng.range(-0.15, 0.15), 0, fa + Math.PI / 2 + rng.range(-0.3, 0.3));
      seg.position.y = this.localGround(seg.position.x, seg.position.z) + 0.7;
    }
    // A lintel that once spanned two columns, tipped against the tall one.
    const ta = (tall / n) * Math.PI * 2;
    const lintel = add(weather(new THREE.BoxGeometry(6.5, 1.1, 1.3, 3, 1, 1), rng, 0.12), STONE, Math.cos(ta) * 2.6, 3.2, Math.sin(ta) * 2.6, -ta);
    lintel.rotation.z = 0.62;

    // What happened here.
    const what = ruin.what;
    if (/fire|home|burn/.test(what)) {
      for (let k = 0; k < 4; k++) {
        const b = add(new THREE.BoxGeometry(0.5, 0.5, rng.range(3, 5.5)), CHAR, rng.range(-3, 3), 1.3, rng.range(-3, 3), rng.range(0, Math.PI));
        b.rotation.x = rng.range(-0.25, 0.25);
      }
    } else if (/kill|thrown|eaten|starv|died/.test(what)) {
      const stone = add(weather(new THREE.BoxGeometry(1.6, 4.2, 0.7, 1, 2, 1), rng, 0.1), STONE_DARK, 1.2, 1.2, 1.4, rng.range(0, 6));
      stone.rotation.z = 1.2; // toppled
      stone.position.y = 1.5;
    }

    // Rubble scattered around the plinth.
    for (let k = 0; k < 16; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(5.5, 9.5);
      const s = rng.range(0.35, 0.95);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const block = add(weather(new THREE.DodecahedronGeometry(s, 0), rng, s * 0.15, false), k % 3 ? STONE : STONE_DARK, x, this.localGround(x, z) + s * 0.4, z, rng.range(0, 6));
      block.rotation.x = rng.range(0, 6);
    }

    // Life comes back: a few small white and gold flowers in the cracks.
    const flower = new THREE.IcosahedronGeometry(0.22, 0);
    for (let k = 0; k < 22; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(1.5, 8.5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const y = d < 6 ? 1.05 : this.localGround(x, z) + 0.15;
      add(flower, k % 3 ? PETAL : PETAL_GOLD, x, y, z, 0, false);
    }

    const y = game.terrain.heightAt(ruin.x, ruin.z);
    g.position.set(ruin.x, y, ruin.z);
    g.name = 'ruin';
  }

  /** Ground height around the ruin, relative to its centre (the plinth sits level, the rubble follows the land). */
  private localGround(lx: number, lz: number): number {
    const t = this.game.terrain;
    return t.heightAt(this.ruin.x + lx, this.ruin.z + lz) - t.heightAt(this.ruin.x, this.ruin.z);
  }

  /** Put it in the world and clear its footprint of trees and boulders. */
  place() {
    const g = this.game;
    g.scene.add(this.group);
    g.forEachNear(this.ruin.x, this.ruin.z, RUIN_RADIUS + 1.5, (e) => {
      if (e.kind === 'tree' || e.kind === 'rock') g.remove(e);
    });
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/**
 * Where a ruin can stand for a deed done at (x, z): on dry, fairly level land, outside every village.
 * Searches outward from the deed (a villager thrown into the sea leaves its ruin on the nearest shore).
 */
export function ruinSite(game: Game, x: number, z: number): { x: number; z: number } | null {
  const t = game.terrain;
  const n = new THREE.Vector3();
  const ok = (px: number, pz: number) => {
    if (t.heightAt(px, pz) < SEA_LEVEL + 1.6 || t.heightAt(px, pz) > 55) return false;
    if (t.normalAt(px, pz, n).y < 0.93) return false;
    const h0 = t.heightAt(px, pz);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hk = t.heightAt(px + Math.cos(a) * RUIN_RADIUS * 0.8, pz + Math.sin(a) * RUIN_RADIUS * 0.8);
      if (hk < SEA_LEVEL + 0.6 || Math.abs(hk - h0) > 2.6) return false;
    }
    return !game.villages.some((v) => Math.hypot(v.center.x - px, v.center.z - pz) < v.radius * VILLAGE_CLEAR + RUIN_RADIUS);
  };
  // Inside a village: start from its edge, on the same side as the deed.
  let sx = x;
  let sz = z;
  for (const v of game.villages) {
    const dx = x - v.center.x;
    const dz = z - v.center.z;
    const d = Math.hypot(dx, dz);
    const edge = v.radius * VILLAGE_CLEAR + RUIN_RADIUS + 2;
    if (d < edge) {
      const a = d > 0.5 ? Math.atan2(dz, dx) : 0.6;
      sx = v.center.x + Math.cos(a) * edge;
      sz = v.center.z + Math.sin(a) * edge;
    }
  }
  if (ok(sx, sz)) return { x: sx, z: sz };
  for (let r = 6; r <= 260; r += 6) {
    const steps = Math.max(8, Math.round(r / 3));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = sx + Math.cos(a) * r;
      const pz = sz + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
