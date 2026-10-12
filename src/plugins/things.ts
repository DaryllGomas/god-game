import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { House } from '../entities/Buildings';
import type { Tree } from '../entities/Nature';
import { MAT } from '../art/Models';
import { Rng } from '../util/rng';
import { SEA_LEVEL } from '../config';
import { InstanceSet } from '../things/Instanced';
import { Birds } from '../things/Birds';
import {
  barrelGeometry,
  crateGeometry,
  fenceGeometry,
  lanternGlowGeometry,
  lanternPostGeometry,
  stumpGeometry,
} from '../things/propGeometry';

/**
 * v0.6 "things": village props (barrels, crates, fence, lantern), tree stumps that stay, chimney smoke
 * from lived-in houses, window glow at dusk, and gulls circling over the island.
 */
const SMOKE_RATE = 1.5; // puffs per second per lived-in house
const STUMP_CAP = 700;
const STUMP_REGROW_DIST = 1.6;
const MASS_REMOVAL = 8; // more trees than this vanishing in one scan = a reload, not felling

interface Stump {
  x: number;
  z: number;
  s: number;
  yaw: number;
  charred: boolean;
}

export function install(game: Game): GamePlugin {
  const scene = game.scene;
  const white = new THREE.Color(1, 1, 1);
  const charred = new THREE.Color(0x3a3430);

  // ---- props
  const barrels = new InstanceSet(scene, barrelGeometry(), MAT.base, 160);
  const crates = new InstanceSet(scene, crateGeometry(), MAT.base, 160);
  const fences = new InstanceSet(scene, fenceGeometry(), MAT.base, 260);
  const posts = new InstanceSet(scene, lanternPostGeometry(), MAT.base, 100);
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x3a2c18, emissive: 0xffa84a, emissiveIntensity: 0, roughness: 0.6 });
  const lanterns = new InstanceSet(scene, lanternGlowGeometry(), lanternMat, 100, false);
  let propSig = '';
  let propTimer = 0;

  const placeProps = (houses: House[]) => {
    for (const s of [barrels, crates, fences, posts, lanterns]) s.clear();
    for (const h of houses) {
      const rng = new Rng(h.seed ^ 0x5bd1);
      const a = h.object.rotation.y;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const W = h.footW;
      const D = h.footD;
      // local (lx, lz) -> world
      const wx = (lx: number, lz: number) => h.pos.x + lx * c + lz * sn;
      const wz = (lx: number, lz: number) => h.pos.z - lx * sn + lz * c;
      const gy = (lx: number, lz: number) => game.terrain.heightAt(wx(lx, lz), wz(lx, lz));
      const side = rng.next() < 0.5 ? -1 : 1;
      // Barrels by the door.
      if (rng.next() < 0.8) {
        const x = side * (W / 2 - 0.35);
        const z = D / 2 + 0.75;
        barrels.push(wx(x, z), gy(x, z), wz(x, z), rng.range(0, 6), 1);
        if (rng.next() < 0.6) {
          const x2 = x - side * 0.85;
          barrels.push(wx(x2, z + 0.15), gy(x2, z + 0.15), wz(x2, z + 0.15), rng.range(0, 6), 0.85);
        }
      }
      // Crates, sometimes stacked, on the other side.
      if (rng.next() < 0.75) {
        const x = -side * (W / 2 - 0.5);
        const z = D / 2 + 0.7;
        const y = gy(x, z);
        const yaw = a + rng.range(-0.3, 0.3);
        crates.push(wx(x, z), y, wz(x, z), yaw, 1);
        if (rng.next() < 0.5) crates.push(wx(x, z), y + 0.7, wz(x, z), yaw + 0.5, 0.78);
      }
      // A lantern post at the door.
      if (rng.next() < 0.85) {
        const x = 1.15;
        const z = D / 2 + 0.55;
        posts.push(wx(x, z), gy(x, z), wz(x, z), a, 1);
        lanterns.push(wx(x, z), gy(x, z), wz(x, z), a, 1);
      }
      // A short fence run along the side of the house.
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const z = D / 2 + 1.2 - k * 2.1;
        const x = (-side) * (W / 2 + 1.3);
        fences.push(wx(x, z), gy(x, z), wz(x, z), a + Math.PI / 2, 1);
      }
    }
    for (const s of [barrels, crates, fences, posts, lanterns]) s.flush();
  };

  const syncProps = () => {
    const hs = game.entities.filter((e): e is House => e instanceof House && e.complete);
    const sig = hs.map((h) => h.id).join(',');
    if (sig === propSig) return;
    propSig = sig;
    placeProps(hs);
  };

  // ---- stumps
  const stumpSet = new InstanceSet(scene, stumpGeometry(), MAT.base, STUMP_CAP);
  stumpSet.mesh.setColorAt(0, white);
  let stumps: Stump[] = [];
  let seenTrees = new Map<Tree, Stump>();
  let stumpTimer = 0;
  let primed = false;

  const flushStumps = () => {
    stumpSet.clear();
    for (const s of stumps) stumpSet.push(s.x, game.terrain.heightAt(s.x, s.z) - 0.05, s.z, s.yaw, s.s, s.charred ? charred : white);
    stumpSet.flush();
  };

  const scanTrees = () => {
    const now = new Map<Tree, Stump>();
    for (const e of game.entities) {
      if (e.kind !== 'tree') continue;
      const t = e as Tree;
      const prev = seenTrees.get(t);
      if (prev && !t.airborne && !t.held) {
        prev.charred = t.charred;
        now.set(t, prev);
      } else {
        now.set(t, { x: t.pos.x, z: t.pos.z, s: 0.8 + t.growth * 1.1, yaw: (t.seed % 628) / 100, charred: t.charred });
      }
    }
    const gone: Stump[] = [];
    for (const [t, st] of seenTrees) if (!now.has(t) && t.growth >= 0.4) gone.push(st);
    let dirty = false;
    if (primed && gone.length <= MASS_REMOVAL) {
      for (const st of gone) {
        if (game.terrain.heightAt(st.x, st.z) < SEA_LEVEL + 0.4) continue;
        if (stumps.length >= STUMP_CAP) stumps.shift();
        stumps.push(st);
        dirty = true;
      }
    }
    // A tree growing back where a stump stands (care, replanting) takes the stump's place.
    let fresh = 0;
    for (const [t] of now) if (!seenTrees.has(t)) fresh++;
    if (stumps.length && fresh <= MASS_REMOVAL) {
      const keep = stumps.filter((st) => {
        for (const [t] of now) if (!seenTrees.has(t) && Math.hypot(t.pos.x - st.x, t.pos.z - st.z) < STUMP_REGROW_DIST) return false;
        return true;
      });
      if (keep.length !== stumps.length) {
        stumps = keep;
        dirty = true;
      }
    }
    seenTrees = now;
    primed = true;
    if (dirty) flushStumps();
  };

  // ---- gulls
  const birds = new Birds(
    scene,
    game.villages.map((v) => ({ x: v.center.x, z: v.center.z })),
  );

  // ---- chimney smoke and window glow
  const smokeCol = new THREE.Color();
  const smokeEnd = new THREE.Color();
  let smokeAcc = 0;
  const windOf = (t: number): [number, number] => {
    const w = ((game as unknown as { seasons?: unknown }).seasons as unknown as { wind?: { x: number; y: number } } | undefined)?.wind;
    const wx = (w ? w.x : 0.9) * 0.5 + 0.9 + Math.sin(t * 0.11) * 0.35;
    const wz = (w ? w.y : 0.3) * 0.5 + 0.25 * Math.sin(t * 0.07 + 1);
    return [wx, wz];
  };

  const emitSmoke = (dt: number) => {
    smokeAcc += dt * SMOKE_RATE;
    if (smokeAcc < 1) return;
    const n = Math.floor(smokeAcc);
    smokeAcc -= n;
    const light = game.fx.light;
    const [wvx, wvz] = windOf(game.time);
    for (const e of game.entities) {
      if (e.kind !== 'house') continue;
      const h = e as House;
      if (!h.complete || h.residents.length === 0 || h.burning) continue;
      const a = h.object.rotation.y;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cx = h.chimney.x;
      const cz = h.chimney.z;
      for (let k = 0; k < n; k++) {
        const g = 0.74 + Math.random() * 0.1;
        smokeCol.setScalar(g * (0.18 + 0.82 * light));
        smokeEnd.setScalar(Math.min(1, g * 1.1) * (0.2 + 0.8 * light));
        game.fx.soft.spawn({
          x: h.pos.x + cx * c + cz * s + (Math.random() - 0.5) * 0.2,
          y: h.pos.y + h.chimney.y,
          z: h.pos.z - cx * s + cz * c + (Math.random() - 0.5) * 0.2,
          vx: wvx * (0.5 + Math.random() * 0.5),
          vy: 1.6 + Math.random() * 0.6,
          vz: wvz * (0.5 + Math.random() * 0.5),
          life: 4 + Math.random() * 1.5,
          size: 0.55,
          sizeEnd: 2.8,
          color: smokeCol,
          colorEnd: smokeEnd,
          alpha: 0.4,
          gravity: 0.35, // slows the climb while the wind keeps carrying it: the plume bends over
          drag: 0.25,
        });
      }
    }
  };

  flushStumps();
  return {
    name: 'things',
    update(dt) {
      emitSmoke(dt);
    },
    frame(realDt) {
      // Warm windows and lanterns come up with the dusk (after Game's own pass, so this one wins).
      const dusk = Math.max(0, 1 - game.sky.daylight * 1.5);
      MAT.window.emissiveIntensity = dusk * 2.6;
      lanternMat.emissiveIntensity = dusk * 3.2;
      propTimer -= realDt;
      if (propTimer <= 0) {
        propTimer = 0.6;
        syncProps();
      }
      stumpTimer -= realDt;
      if (stumpTimer <= 0) {
        stumpTimer = 0.4;
        scanTrees();
      }
      birds.update(game.realTime, game.sky.daylight, (x, z) => game.terrain.heightAt(x, z));
    },
    save: () => stumps.slice(-STUMP_CAP).map((s) => [Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10, Math.round(s.s * 100) / 100, Math.round(s.yaw * 100) / 100, s.charred ? 1 : 0]),
    load: (data) => {
      if (!Array.isArray(data)) return;
      stumps = data
        .filter((r): r is number[] => Array.isArray(r) && r.length >= 5 && r.every((v) => Number.isFinite(v)))
        .map(([x, z, s, yaw, ch]) => ({ x, z, s, yaw, charred: ch === 1 }));
      flushStumps();
    },
  };
}
