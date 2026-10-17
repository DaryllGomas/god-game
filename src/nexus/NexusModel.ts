import * as THREE from 'three';
import type { Game } from '../Game';
import type { Site } from '../projects/Site';
import { MAT, foodHeapGeometry, jitterVerts, logStackGeometry, merge, paint } from '../art/Models';
import { stoneHeapGeometry } from '../projects/ProjectModels';
import { glowTexture } from '../rival/RivalVisuals';
import { pillarMat } from '../endings/CityLights';
import { Rng } from '../util/rng';
import { clamp, damp, smoothstep } from '../util/math';
import { MARK_COUNT, markTexture } from './glyphs';

// ------------------------------------------------------------------ tuning knobs

/** The ring: stones stand this far from the centre (m); the dais is this wide and stands this high above the site. */
export const STONE_RING = 11.5;
export const DAIS_R = 15;
const DAIS_TOP = 0.55;
/** A stone rises over this many seconds (game time) once its share of the materials is in. */
const RISE_TIME = 3.2;
/** Warm stone (the boards' carved stone, gold on near-black when lit). */
const STONE = [0xb9a888, 0xae9d7f, 0xc4b394, 0xa69676];
const SLAB = [0xd8c7a2, 0xcfbd96, 0xe0d0ad, 0xc8b68e];
const GOLD = 0xd9b25a;
const NAVY = 0x1b2a4a;
/** Light, in linear HDR (above 1 blooms). */
const GLYPH_LIT = new THREE.Color(2.2, 1.6, 0.7);
const COLUMN = new THREE.Color(1.6, 1.25, 0.7);
const COLUMN_CORE = new THREE.Color(1.8, 1.65, 1.3);

/** The inlay of gold in the floor and on the orrery: it glows as the ring wakes. */
const INLAY = new THREE.MeshStandardMaterial({ color: 0xc9a456, emissive: 0xffb84a, emissiveIntensity: 0.05, roughness: 0.35, metalness: 0.6 });

interface Stone {
  holder: THREE.Group;
  /** 0 = in the ground .. 1 = standing. */
  up: number;
  want: number;
  height: number;
  carve: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  angle: number;
  dusted: boolean;
}

/** One standing stone: tapered, its edges worn, a band of gold at its foot. Its mark faces the centre (local -z). */
function stoneGeometry(seed: number, h: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(2.5, h, 1.35, 2, 6, 1);
  const pos = body.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h + 0.5;
    const k = 1 - 0.26 * y;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * (1 - 0.16 * y));
    // A rounded crown.
    if (y > 0.98) pos.setY(i, pos.getY(i) - Math.abs(pos.getX(i)) * 0.35);
  }
  body.translate(0, h / 2, 0);
  parts.push(paint(jitterVerts(body, 0.07, rng), rng.pick(STONE), 0.1, rng));
  // The foot: a plinth stone, and a band of worked gold.
  parts.push(paint(new THREE.BoxGeometry(3.1, 0.7, 1.9).translate(0, 0.1, 0), 0x9a8c70, 0.08, rng));
  parts.push(paint(new THREE.BoxGeometry(2.62, 0.16, 1.44).translate(0, 0.62, 0), GOLD));
  // Below the ground, so a stone never floats on a slope.
  parts.push(paint(new THREE.BoxGeometry(2.4, 3, 1.3).translate(0, -1.4, 0), 0x8f8268));
  return merge(parts);
}

/** The dais top: rings of slabs, each a slightly different stone, with gaps between. */
function daisGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const rings = [2.6, 5.2, 7.6, 9.6, 13.2, DAIS_R];
  let r0 = 0;
  for (const r1 of rings) {
    const n = r0 === 0 ? 1 : Math.max(8, Math.round((Math.PI * (r0 + r1)) / 2.6));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + 0.02;
      const a1 = ((i + 1) / n) * Math.PI * 2 - 0.02;
      const g = r0 === 0 ? new THREE.CircleGeometry(r1 - 0.06, 24) : new THREE.RingGeometry(r0 + 0.06, r1 - 0.06, Math.max(2, Math.round((a1 - a0) * 8)), 1, a0, a1 - a0);
      g.rotateX(-Math.PI / 2).translate(0, DAIS_TOP + rng.range(0, 0.03), 0);
      parts.push(paint(g, rng.pick(SLAB), 0.12, rng));
    }
    r0 = r1;
  }
  // Grout under the gaps, and the dais wall down into the ground; a low step round it.
  parts.push(paint(new THREE.CircleGeometry(DAIS_R, 64).rotateX(-Math.PI / 2).translate(0, DAIS_TOP - 0.03, 0), 0x7d715c));
  parts.push(paint(new THREE.CylinderGeometry(DAIS_R, DAIS_R + 0.3, 5.6, 64, 1, true).translate(0, DAIS_TOP - 2.8, 0), 0xa89878, 0.06, rng));
  parts.push(paint(new THREE.RingGeometry(DAIS_R, DAIS_R + 1.5, 64, 1).rotateX(-Math.PI / 2).translate(0, 0.22, 0), 0xb5a383, 0.08, rng));
  parts.push(paint(new THREE.CylinderGeometry(DAIS_R + 1.5, DAIS_R + 1.7, 5, 64, 1, true).translate(0, 0.22 - 2.5, 0), 0x9d8e70, 0.06, rng));
  return merge(parts);
}

/** The gold in the floor: two rings and seven spokes from the centre to the stones (the orbit arcs of the mark). */
function inlayGeometry(angles: number[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const y = DAIS_TOP + 0.05;
  for (const r of [4.05, 8.6, 13.25]) parts.push(paint(new THREE.RingGeometry(r - 0.13, r + 0.13, 96).rotateX(-Math.PI / 2).translate(0, y, 0), 0xffffff));
  for (const a of angles) {
    const len = STONE_RING - 1.4 - 2.7;
    const g = new THREE.PlaneGeometry(0.22, len).rotateX(-Math.PI / 2).translate(0, y, -(2.7 + len / 2));
    g.rotateY(-a);
    parts.push(paint(g, 0xffffff));
  }
  return merge(parts);
}

/** The orrery at the centre: a plinth, the world orb in navy, its gold band and a sprout of gold above (the TEND mark). */
function orreryBase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.CylinderGeometry(2.3, 2.6, 1.1, 24).translate(0, DAIS_TOP + 0.55, 0), 0xc9b690));
  parts.push(paint(new THREE.CylinderGeometry(1.7, 2.1, 0.5, 24).translate(0, DAIS_TOP + 1.35, 0), 0xb7a47e));
  parts.push(paint(new THREE.SphereGeometry(1.15, 24, 16).translate(0, DAIS_TOP + 2.75, 0), NAVY));
  return merge(parts);
}

function orreryGold(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const y = DAIS_TOP + 2.75;
  parts.push(paint(new THREE.TorusGeometry(1.2, 0.07, 6, 48).rotateX(Math.PI / 2).translate(0, y, 0), 0xffffff));
  // The sprout: a stem and two leaves.
  parts.push(paint(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6).translate(0, y + 1.55, 0), 0xffffff));
  for (const s of [-1, 1]) {
    const leaf = new THREE.SphereGeometry(0.3, 8, 6).scale(1.5, 0.35, 0.7).rotateZ(s * 0.5).translate(s * 0.38, y + 1.85, 0);
    parts.push(paint(leaf, 0xffffff));
  }
  return merge(parts);
}

/**
 * The Nexus (the last age, src/nexus): a druidic ring of seven standing stones, one for each mark, on a round dais of
 * warm stone at the heart of the island, with an orrery at its centre. Not a temple: there is no altar and nothing to
 * kneel to; it is a meeting place. It rises a stone at a time as the materials come in (the fraction of the site), and
 * wakes in two steps the age drives: the marks light (`lit`), then the column of light at the true end (`column`).
 */
export class NexusVisual {
  readonly group = new THREE.Group();
  /** 0..1: the marks and the gold inlay glow (set by the age). */
  lit = 0;
  /** 0..1: the column and the rings of light over the centre (the true end). */
  column = 0;
  readonly stones: Stone[] = [];
  private litShown = 0;
  private colShown = 0;
  private t = 0;
  private readonly orbits: THREE.Mesh[] = [];
  private readonly lightRings: THREE.Mesh[] = [];
  private readonly pillars: THREE.ShaderMaterial[] = [];
  private readonly pillarGroup = new THREE.Group();
  private readonly star: THREE.Sprite;
  private readonly heaps: THREE.Mesh[];
  private readonly sockets: THREE.Mesh[] = [];
  /** Called when a stone begins to rise (index 0..6). */
  onStoneRise: ((i: number) => void) | null = null;

  constructor() {
    const seed = 7177;
    this.group.add(new THREE.Mesh(daisGeometry(seed), MAT.base));
    (this.group.children[0] as THREE.Mesh).receiveShadow = true;
    const angles: number[] = [];
    for (let i = 0; i < MARK_COUNT; i++) angles.push((i / MARK_COUNT) * Math.PI * 2 + 0.22);
    const inlay = new THREE.Mesh(inlayGeometry(angles), INLAY);
    this.group.add(inlay);

    const base = new THREE.Mesh(orreryBase(), MAT.base);
    base.castShadow = true;
    this.group.add(base, new THREE.Mesh(orreryGold(), INLAY));
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.75 + i * 0.55, 0.045, 6, 64), INLAY);
      m.position.y = DAIS_TOP + 2.75;
      this.orbits.push(m);
      this.group.add(m);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), INLAY);
      bead.position.x = 1.75 + i * 0.55;
      m.add(bead);
    }

    angles.forEach((a, i) => {
      const h = 8.4 + ((i * 37) % 5) * 0.3;
      const holder = new THREE.Group();
      // Stone i stands at angle a, its face (-z) toward the centre.
      holder.position.set(Math.sin(a) * STONE_RING, DAIS_TOP - 0.1, -Math.cos(a) * STONE_RING);
      holder.rotation.y = Math.PI - a;
      const mesh = new THREE.Mesh(stoneGeometry(seed + i * 13, h), MAT.base);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
      const carve = new THREE.MeshBasicMaterial({ map: markTexture(i), color: 0x4a3a24, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const glow = new THREE.MeshBasicMaterial({ map: markTexture(i, true), color: GLYPH_LIT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3 });
      const w = 1.9;
      const zFace = -0.675 * (1 - 0.16 * 0.55) - 0.03;
      for (const mat of [carve, glow]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w), mat);
        p.position.set(0, h * 0.55, zFace);
        p.rotation.y = Math.PI;
        holder.add(p);
      }
      // Its mark on the outer face too, smaller (seen from the streets).
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), glow);
      back.position.set(0, h * 0.55, -zFace);
      holder.add(back);
      this.group.add(holder);
      // Where it will stand: a socket ringed in gold.
      const socket = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.55, 24).rotateX(-Math.PI / 2), INLAY);
      socket.position.set(holder.position.x, DAIS_TOP + 0.07, holder.position.z);
      this.sockets.push(socket);
      this.group.add(socket);
      this.stones.push({ holder, up: 0, want: 0, height: h, carve, glow, angle: a, dusted: false });
    });

    // The column of light and the three rings over the centre (the true end), and a star at the top of the orb.
    const tex = glowTexture();
    for (const [k, color, power] of [[1, COLUMN, 2.2], [0.4, COLUMN_CORE, 3.5]] as [number, THREE.Color, number][]) {
      const mat = pillarMat(color, power);
      const geo = new THREE.CylinderGeometry(6.5 * k, 3 * k, 420, 32, 1, true);
      geo.translate(0, 210, 0);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.pillars.push(mat);
      this.pillarGroup.add(m);
    }
    this.pillarGroup.position.y = DAIS_TOP + 3;
    this.pillarGroup.visible = false;
    this.group.add(this.pillarGroup);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(6.5 + i * 2.6, 0.07 + i * 0.02, 6, 160),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.35, 0.75), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      m.position.y = DAIS_TOP + 13 + i * 2.2;
      m.visible = false;
      this.lightRings.push(m);
      this.group.add(m);
    }
    this.star = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2, 1.6, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.star.position.y = DAIS_TOP + 4.6;
    this.group.add(this.star);


    // Heaps of what has been brought, at the dais edge, while it is being raised.
    const heap = (geo: THREE.BufferGeometry, a: number) => {
      const m = new THREE.Mesh(geo, MAT.base);
      m.position.set(Math.cos(a) * (DAIS_R + 4), 0, Math.sin(a) * (DAIS_R + 4));
      m.rotation.y = a * 2;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.heaps = [heap(logStackGeometry(), 2.5), heap(stoneHeapGeometry(), 3.5), heap(foodHeapGeometry(), 4.4)];
  }

  /** How many stones stand (or are rising). */
  get raised(): number {
    return this.stones.filter((s) => s.want > 0).length;
  }

  /** The share of the materials at which stone `i` rises (the last one when everything is in). */
  static threshold(i: number): number {
    return i === MARK_COUNT - 1 ? 0.999 : (i + 1) / MARK_COUNT - 0.03;
  }

  /** Every stone straight to standing (a reload, or a debug jump). */
  standAll() {
    for (const s of this.stones) {
      s.want = 1;
      s.up = 1;
      s.dusted = true;
    }
  }

  /** Site visual contract (src/projects/Site.ts): `shown` is the eased share of the materials. */
  update(game: Game, site: Site, dt: number, shown: number) {
    this.t += dt;
    const frac = site.complete ? 1 : site.fraction;
    void shown;
    this.stones.forEach((s, i) => {
      if (s.want === 0 && frac >= NexusVisual.threshold(i)) {
        s.want = 1;
        this.onStoneRise?.(i);
      }
      if (s.up < s.want) {
        if (!s.dusted) {
          s.dusted = true;
          const p = s.holder.position.clone();
          site.object.localToWorld(p);
          game.fx.dust(p.x, p.y + 0.5, p.z, 26, 1.4, 0xb8a888);
          game.audio.stoneSet(p, 2.4);
        }
        s.up = Math.min(s.want, s.up + dt / RISE_TIME);
        if (Math.random() < dt * 8) {
          const p = s.holder.position.clone();
          site.object.localToWorld(p);
          game.fx.dust(p.x + (Math.random() - 0.5) * 2.5, p.y + 0.4, p.z + (Math.random() - 0.5) * 2.5, 3, 0.8, 0xb8a888);
        }
      }
      const e = smoothstep(0, 1, s.up);
      s.holder.position.y = DAIS_TOP - 0.1 - (1 - e) * (s.height + 0.8);
      s.holder.visible = s.up > 0.001;
      // A rising stone sways a little as it settles.
      s.holder.rotation.z = (1 - e) * 0.05 * Math.sin(this.t * 7 + i);
      this.sockets[i].visible = s.up < 0.98;
    });

    // The marks and the inlay wake (eased), then breathe.
    this.litShown += (this.lit - this.litShown) * damp(1.2, dt);
    const night = 1 - clamp(game.sky.daylight * 1.3, 0, 1);
    const L = this.litShown;
    this.stones.forEach((s, i) => {
      const own = clamp(L * MARK_COUNT - i * 0.85, 0, 1); // they light one after another, round the ring
      s.glow.opacity = own * (0.72 + 0.28 * night) * (0.88 + 0.12 * Math.sin(this.t * 1.3 + i * 0.9));
      s.carve.opacity = 0.85 - 0.5 * own;
    });
    INLAY.emissiveIntensity = 0.05 + L * (0.9 + 1.6 * night) * (0.9 + 0.1 * Math.sin(this.t * 0.9));
    this.orbits.forEach((m, i) => {
      m.rotation.set(Math.PI / 2 + (i ? 0.55 : -0.4), 0, this.t * (0.12 + i * 0.07) * (0.3 + L));
    });
    this.star.material.opacity = L * (0.55 + 0.4 * night);
    this.star.scale.setScalar(3.5 + 2.5 * L + Math.sin(this.t * 1.7) * 0.3);

    // The column and the rings (the true end; they stay after it, softly, at night).
    this.colShown += (this.column - this.colShown) * damp(1.4, dt);
    const C = this.colShown;
    this.pillarGroup.visible = C > 0.003;
    for (const p of this.pillars) {
      p.uniforms.uStrength.value = C;
      p.uniforms.uTime.value = this.t;
    }
    this.lightRings.forEach((m, i) => {
      m.visible = C > 0.003;
      (m.material as THREE.MeshBasicMaterial).opacity = C * (0.75 - i * 0.15);
      m.rotation.set(Math.PI / 2 + Math.sin(this.t * 0.2 + i) * 0.35 + (i - 1) * 0.5, this.t * 0.1 * (i % 2 ? -1 : 1), this.t * (0.15 + i * 0.05));
    });

    // Heaps of what has come in, while it rises.
    (['wood', 'stone', 'food'] as const).forEach((res, i) => {
      const need = site.def.needs[res];
      const h = this.heaps[i];
      h.visible = !site.complete && need > 0 && site.have[res] > 1;
      if (h.visible) h.scale.setScalar(1 + 0.9 * clamp(site.have[res] / need, 0, 1));
    });
  }
}
