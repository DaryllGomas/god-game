import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { House } from '../entities/Buildings';
import { MAT } from '../art/Models';
import { glowTexture } from '../rival/RivalVisuals';
import { clamp, smoothstep } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** Warm gold light, in linear HDR (above 1 blooms). */
const GOLD = new THREE.Color(1.6, 1.08, 0.46);
/** Light pooling on the ground: deeper, more amber than the lamps, so the land stays land. */
const POOL_COLOR = new THREE.Color(1.3, 0.72, 0.26);
const WHITE_GOLD = new THREE.Color(1.7, 1.5, 1.1);
/** The light pillar over each temple: height, radius at the foot and the top. */
const PILLAR = { h: 320, r0: 2.6, r1: 7 };
/** Lanterns ring each village at this many village radii, one every LANTERN_GAP metres. */
const LANTERN_RING = 1.08;
const LANTERN_GAP = 6.5;
/** Warm light pooling on the ground: this many village radii across. */
const POOL = 1.65;
/** How fast the lights spread (metres per second outward from the temple), and the gap between villages lighting up. */
const RIPPLE = 22;
const VILLAGE_GAP = 1.4;
/** Motes rising from each village per second at full light, and sky lanterns released. */
const MOTES = 14;
const SKY_LANTERNS = 5;
/** Roads of light between the villages: one lamp every ROAD_GAP metres, lit outward from both ends. */
const ROAD_GAP = 8;
/** The night lifted a little by the city's glow (hemisphere light, warm). */
const NIGHT_LIFT = 0.42;
const WARM_SKY = new THREE.Color(0xffc98a);
const WARM_GROUND = new THREE.Color(0x6a4a24);

/** Keep see-through glows out of the ambient-occlusion pre-pass (it would draw them as dark shapes). */
export function aoSkip(game: Game, obj: THREE.Object3D) {
  const list = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
  if (list && !list.includes(obj)) list.push(obj);
}

const pillarMat = (color: THREE.Color, power: number) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uStrength: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFace;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vFace = abs(dot(n, normalize(cameraPosition - wp.xyz)));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFace;
      void main() {
        float y = vUv.y;
        // Brightest down the middle of the beam, soft at its edges, fading up into the sky; a slow rising shimmer.
        float a = uStrength * pow(vFace, ${power.toFixed(1)}) * smoothstep(0.0, 0.035, y) * pow(1.0 - y, 1.4);
        a *= 0.82 + 0.18 * sin(uTime * 0.9 - y * 16.0);
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  });

/** A disc that lies on the terrain (each vertex lifted onto the land), for light pooling on the ground. */
function groundDisc(game: Game, cx: number, cz: number, radius: number): THREE.BufferGeometry {
  const rings = 12;
  const segs = 40;
  const pos: number[] = [];
  const rr: number[] = [];
  const idx: number[] = [];
  const y0 = game.terrain.heightAt(cx, cz);
  pos.push(0, 0.5, 0);
  rr.push(0);
  for (let i = 1; i <= rings; i++) {
    const f = i / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * radius * f;
      const z = Math.sin(a) * radius * f;
      pos.push(x, Math.max(game.terrain.heightAt(cx + x, cz + z), 0) - y0 + 0.5, z);
      rr.push(f);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs;
    const a1 = 1 + i * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('r', new THREE.Float32BufferAttribute(rr, 1));
  geo.setIndex(idx);
  return geo;
}

const poolMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: POOL_COLOR }, uStrength: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float r;
      varying float vR;
      void main() { vR = r; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vR;
      void main() {
        float a = uStrength * (pow(1.0 - vR, 2.0) * 0.26 + pow(1.0 - vR, 8.0) * 0.22);
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  });

interface Lit {
  v: Village;
  group: THREE.Group;
  /** When this village starts to light (seconds after the city begins). */
  delay: number;
  pool: THREE.ShaderMaterial;
  pillars: THREE.ShaderMaterial[];
  crown: THREE.Sprite;
  /** Ground height at the prayer place, in the village group's space (the crown sits on top of whatever stands there). */
  crownBase: number;
  halo: THREE.Mesh;
  lanterns: { s: THREE.Sprite; d: number; base: number }[];
  houses: Map<House, { s: THREE.Sprite; d: number }>;
}

/**
 * Ready to See: the people's villages become a city of light. Every window lit, a glow over every roof,
 * a ring of lanterns, warm light pooling on the ground, a pillar of light over each temple, and gold motes
 * drifting up. It spreads outward from the temples, village by village. After the ending it stays as the
 * island's night: the city lights up at dusk and rests by day.
 */
export class CityLights {
  /** Overall light 0..1 (the sequence and the night drive it). */
  level = 0;
  /** Seconds since the city began to light (drives the ripple). */
  t = 0;
  private readonly lit: Lit[] = [];
  private readonly roads: { lamps: { s: THREE.Sprite; along: number; base: number }[]; start: number; length: number }[] = [];
  private skyAcc = 0;
  private readonly root = new THREE.Group();
  private readonly tex = glowTexture();
  private moteAcc = 0;
  private rescan = 0;
  private time = 0;

  constructor(private readonly game: Game) {
    this.root.name = 'city-lights';
    game.scene.add(this.root);
    aoSkip(game, this.root);
    const home = game.villages.find((v) => v.isHome) ?? game.villages[0];
    const order = [...game.villages].sort((a, b) => (a === home ? -1 : b === home ? 1 : a.center.distanceTo(home.center) - b.center.distanceTo(home.center)));
    order.forEach((v, i) => this.lit.push(this.build(v, i * VILLAGE_GAP)));
    for (let i = 0; i < this.lit.length; i++) for (let j = i + 1; j < this.lit.length; j++) this.buildRoad(this.lit[i], this.lit[j]);
  }

  /** A road of lamps from one village's edge to another's, following the land (over the hills if it must). */
  private buildRoad(a: Lit, b: Lit) {
    const g = this.game;
    const ax = a.v.center.x;
    const az = a.v.center.z;
    const dx = b.v.center.x - ax;
    const dz = b.v.center.z - az;
    const d = Math.hypot(dx, dz);
    const from = a.v.radius * LANTERN_RING;
    const to = d - b.v.radius * LANTERN_RING;
    const lamps: { s: THREE.Sprite; along: number; base: number }[] = [];
    // A gentle bend, so it reads as a road rather than a ruler line.
    const bend = (k: number) => Math.sin(k * Math.PI) * d * 0.08;
    for (let s = from + ROAD_GAP; s < to; s += ROAD_GAP) {
      const k = s / d;
      const x = ax + dx * k - (dz / d) * bend(k);
      const z = az + dz * k + (dx / d) * bend(k);
      if (g.terrain.heightAt(x, z) < 0.6) continue;
      const sp = this.sprite(GOLD, 2.9);
      sp.position.set(x, g.terrain.heightAt(x, z) + 2.2, z);
      this.root.add(sp);
      lamps.push({ s: sp, along: Math.min(s - from, to - s), base: 0.7 + 0.3 * Math.sin(s * 0.7) });
    }
    this.roads.push({ lamps, start: Math.max(a.delay, b.delay) + 1.2, length: to - from });
  }

  private sprite(color: THREE.Color, scale: number): THREE.Sprite {
    const m = new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(scale);
    return s;
  }

  private build(v: Village, delay: number): Lit {
    const g = this.game;
    const group = new THREE.Group();
    group.position.set(v.center.x, g.terrain.heightAt(v.center.x, v.center.z), v.center.z);
    this.root.add(group);
    const local = (x: number, z: number, lift: number) => new THREE.Vector3(x - v.center.x, Math.max(g.terrain.heightAt(x, z), 0) - group.position.y + lift, z - v.center.z);

    const pool = poolMat();
    const disc = new THREE.Mesh(groundDisc(g, v.center.x, v.center.z, v.radius * POOL), pool);
    disc.renderOrder = 3;
    group.add(disc);

    // The temple (the village's prayer place): a pillar of light, a crown of light and a halo on the ground.
    const w = v.worship.pos;
    const wl = local(w.x, w.z, 0);
    const outer = pillarMat(GOLD, 2.2);
    const inner = pillarMat(WHITE_GOLD, 3.5);
    for (const [mat, k] of [[outer, 1], [inner, 0.38]] as [THREE.ShaderMaterial, number][]) {
      const geo = new THREE.CylinderGeometry(PILLAR.r1 * k, PILLAR.r0 * k, PILLAR.h, 28, 1, true);
      geo.translate(0, PILLAR.h / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(wl);
      m.renderOrder = 6;
      m.frustumCulled = false;
      group.add(m);
    }
    const crown = this.sprite(WHITE_GOLD, 15);
    crown.position.copy(wl).setY(wl.y + 7);
    group.add(crown);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(5.5, 9.5, 48, 1),
      new THREE.MeshBasicMaterial({ map: this.tex, color: GOLD, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.copy(wl).setY(wl.y + 0.6);
    group.add(halo);

    // Lanterns along the village edge (never a perfect ring: a lane of lamps), and more among the houses.
    const lanterns: Lit['lanterns'] = [];
    const ringR = v.radius * LANTERN_RING;
    const count = Math.round((Math.PI * 2 * ringR) / LANTERN_GAP);
    let seed = Math.abs(Math.round(v.center.x * 13 + v.center.z * 7)) + 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lamp = (x: number, z: number, size: number) => {
      if (g.terrain.heightAt(x, z) < 0.4) return;
      const s = this.sprite(GOLD, size);
      s.position.copy(local(x, z, 1.8 + rnd() * 1.6));
      group.add(s);
      lanterns.push({ s, d: Math.hypot(x - w.x, z - w.z), base: 0.55 + 0.45 * rnd() });
    };
    for (let i = 0; i < count; i++) {
      if (rnd() < 0.18) continue;
      const a = ((i + rnd() * 0.5) / count) * Math.PI * 2;
      const r = ringR * (0.94 + rnd() * 0.16);
      lamp(v.center.x + Math.cos(a) * r, v.center.z + Math.sin(a) * r, 2.4 + rnd() * 1.4);
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * v.radius * 0.9;
      lamp(v.center.x + Math.cos(a) * r, v.center.z + Math.sin(a) * r, 2.2 + rnd() * 1.6);
    }
    const lit: Lit = { v, group, delay, pool, pillars: [outer, inner], crown, crownBase: wl.y, halo, lanterns, houses: new Map() };
    this.scanHouses(lit);
    return lit;
  }

  /** A glow over every standing roof (houses get built and lost, so this is re-run now and then). */
  private scanHouses(l: Lit) {
    const g = this.game;
    const w = l.v.worship.pos;
    for (const h of l.v.houses) {
      if (l.houses.has(h) || !h.complete) continue;
      const s = this.sprite(GOLD, 10.5);
      s.position.set(h.pos.x - l.v.center.x, Math.max(g.terrain.heightAt(h.pos.x, h.pos.z), 0) - l.group.position.y + h.topHeight * 0.7, h.pos.z - l.v.center.z);
      l.group.add(s);
      l.houses.set(h, { s, d: Math.hypot(h.pos.x - w.x, h.pos.z - w.z) });
    }
    for (const [h, e] of l.houses) {
      if (h.complete && h.alive) continue;
      l.group.remove(e.s);
      e.s.material.dispose();
      l.houses.delete(h);
    }
  }

  /** How lit a thing `d` metres from its temple is, in village `l`, right now (0..1). */
  private reach(l: Lit, d: number): number {
    return smoothstep(0, 1.6, this.t - l.delay - d / RIPPLE);
  }

  /** Per rendered frame (real seconds). `motes` scales the rising motes (0 = none). */
  frame(dt: number, motes = 1) {
    const g = this.game;
    this.time += dt;
    this.t += dt;
    const L = clamp(this.level, 0, 1.5);
    this.root.visible = L > 0.002;
    this.rescan -= dt;
    const rescan = this.rescan <= 0;
    if (rescan) this.rescan = 3;
    let anyWindows = false;
    for (const l of this.lit) {
      if (rescan) this.scanHouses(l);
      const start = this.reach(l, 0);
      l.pool.uniforms.uStrength.value = L * start;
      // Gentler up close, so a camera standing at the temple isn't blinded.
      const near = 0.18 + 0.82 * smoothstep(15, 170, g.godCam.camera.position.distanceTo(l.v.worship.pos));
      for (const p of l.pillars) {
        p.uniforms.uStrength.value = L * near * smoothstep(0, 2.5, this.t - l.delay);
        p.uniforms.uTime.value = this.time;
      }
      l.crown.material.opacity = L * start * (0.75 + 0.15 * Math.sin(this.time * 1.1));
      l.crown.position.y = l.crownBase + Math.max(7, l.v.worship.topHeight * 0.92);
      (l.halo.material as THREE.MeshBasicMaterial).opacity = L * start * 0.8;
      l.halo.rotation.z = this.time * 0.05;
      for (const ln of l.lanterns) ln.s.material.opacity = L * this.reach(l, ln.d) * ln.base * (0.85 + 0.15 * Math.sin(this.time * 1.7 + ln.d));
      for (const [h, e] of l.houses) {
        const k = this.reach(l, e.d);
        e.s.material.opacity = L * k * 0.5;
        // Every window lit (the house's own rule only lights them while someone sleeps inside).
        if (k > 0.3 && L > 0.15 && !h.destroyed) {
          const win = (h as unknown as { windows?: THREE.Mesh }).windows;
          if (win) win.material = MAT.window;
          anyWindows = true;
        }
      }
      // Motes drifting up through the village.
      if (motes > 0 && L > 0.05) {
        this.moteAcc += dt * MOTES * motes * L * start;
        while (this.moteAcc >= 1) {
          this.moteAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * l.v.radius * 1.15;
          const x = l.v.center.x + Math.cos(a) * r;
          const z = l.v.center.z + Math.sin(a) * r;
          g.fx.glow.spawn({
            x,
            y: Math.max(g.terrain.heightAt(x, z), 0) + 1 + Math.random() * 3,
            z,
            vx: (Math.random() - 0.5) * 0.8,
            vy: 1.6 + Math.random() * 2.4,
            vz: (Math.random() - 0.5) * 0.8,
            life: 5 + Math.random() * 4,
            size: 0.8 + Math.random() * 0.9,
            sizeEnd: 0.15,
            color: 0xffd27a,
            colorEnd: 0xfff2c8,
            alpha: 0.95,
            drag: 0.15,
          });
        }
      }
    }
    if (anyWindows) MAT.window.emissiveIntensity = Math.max(MAT.window.emissiveIntensity, 3.2 * L);

    // Roads of light between the villages, lit from both ends toward the middle.
    for (const r of this.roads) {
      for (const lp of r.lamps) lp.s.material.opacity = L * lp.base * smoothstep(0, 1.2, this.t - r.start - lp.along / (RIPPLE * 1.6));
    }

    // Sky lanterns released from every village, rising slowly into the dusk.
    if (motes > 0 && L > 0.2) {
      this.skyAcc += dt * SKY_LANTERNS * motes * this.lit.length * Math.min(1, L);
      while (this.skyAcc >= 1) {
        this.skyAcc -= 1;
        const l = this.lit[Math.floor(Math.random() * this.lit.length)];
        if (this.t < l.delay + 1.5) continue;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * l.v.radius;
        const x = l.v.center.x + Math.cos(a) * r;
        const z = l.v.center.z + Math.sin(a) * r;
        g.fx.glow.spawn({
          x,
          y: Math.max(g.terrain.heightAt(x, z), 0) + 4,
          z,
          vx: 0.5 + (Math.random() - 0.5) * 0.8,
          vy: 3 + Math.random() * 2.5,
          vz: -0.3 + (Math.random() - 0.5) * 0.8,
          life: 16 + Math.random() * 7,
          size: 1.4 + Math.random() * 0.9,
          sizeEnd: 0.9,
          color: 0xffa24a,
          colorEnd: 0xffd890,
          alpha: 0.95,
        });
      }
    }

    // The city's glow lifts the night a little, warm.
    const lift = L * (1 - g.sky.daylight);
    if (lift > 0.01) {
      g.sky.hemi.intensity += NIGHT_LIFT * lift;
      g.sky.hemi.color.lerp(WARM_SKY, 0.35 * lift);
      g.sky.hemi.groundColor.lerp(WARM_GROUND, 0.4 * lift);
    }
  }

  /** Where each temple's light stands (world positions), for the camera. */
  temples(): THREE.Vector3[] {
    return this.lit.map((l) => l.v.worship.pos.clone());
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}
