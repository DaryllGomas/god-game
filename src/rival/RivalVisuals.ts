import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { HandRig } from '../hand/HandRig';
import { SkinnedHand } from '../hand/SkinnedHand';
import { ProceduralHand } from '../hand/ProceduralHand';
import { assets } from '../assets';
import { clamp, damp, lerp, smoothstep } from '../util/math';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EMBER, ISLE_DRIFT, ISLE_GROW, ISLE_HAZE, ISLE_NEAR, ISLE_STORM, LEVEL_SECONDS, RISE, VIOLET, VIOLET_LIGHT } from './data';

// ------------------------------------------------------------------ shared bits

let glowTex: THREE.CanvasTexture | null = null;
/** A soft round gradient (white in the middle, clear at the edge): mist puffs, glows, shadows. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let discTex: THREE.CanvasTexture | null = null;
/** A mostly solid dark disc with a soft edge (the hand's shadow). */
function discTexture(): THREE.CanvasTexture {
  if (discTex) return discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  discTex = new THREE.CanvasTexture(c);
  return discTex;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const easeInOut = (t: number) => t * t * (3 - 2 * t);
/** 0..1 through [a, b]. */
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/** Keep soft, see-through things (glows, mist, cloud) out of the ambient-occlusion pre-pass, which would draw them as dark boxes. */
function aoSkip(game: Game, obj: THREE.Object3D, on: boolean) {
  const list = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
  if (!list) return;
  const i = list.indexOf(obj);
  if (on && i < 0) list.push(obj);
  else if (!on && i >= 0) list.splice(i, 1);
}

/**
 * Let a distant silhouette read through the haze: the fog never covers more than `cap` of this material.
 * `haze` (shared uniform, 0..1) veils it toward the fog colour whatever the distance: his isle sits at the sea
 * edge of the default view, so while the world is in tune it must look far off and faint, not merely small.
 */
function capFog(mat: THREE.Material, cap: number | { value: number }, haze?: { value: number }) {
  const live = typeof cap !== 'number';
  mat.customProgramCacheKey = () => `capfog-${live ? 'live' : cap.toFixed(2)}-${haze ? 'haze' : ''}`;
  mat.onBeforeCompile = (shader) => {
    if (haze) shader.uniforms.uHaze = haze;
    if (live) shader.uniforms.uFogCap = cap;
    shader.fragmentShader = (haze ? 'uniform float uHaze;\n' : '') + (live ? 'uniform float uFogCap;\n' : '') + shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#if defined(USE_FOG) && !defined(FOG_EXP2)
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(smoothstep(fogNear, fogFar, vFogDepth) * ${live ? 'uFogCap' : (cap as number).toFixed(2)}, ${haze ? 'uHaze' : '0.0'}));
      #else
        #include <fog_fragment>
      #endif`,
    );
  };
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

// ----------------------------------------------------------------------- his isle

/**
 * Where his isle rests: out on the sea off Ashford's shore, a little past the top-left sea edge of the view the game
 * starts on, hidden under the water until your first pyramid stands (2026-10-15; before, it stood 312 m out from the
 * first day). ISLE_GROW sets how far out along this line it stands as it grows.
 */
export const ISLE_POS = new THREE.Vector3(-349, 0, 129);
/** How far behind a turned village's prayer place his banner stands (z), clear of the pyramid (v0.5 shrines). */
const BANNER_BACK = -12;
const ISLE_DIR = new THREE.Vector2(ISLE_POS.x, ISLE_POS.z).normalize();
/** His citadel faces the island: local +z points home, so local x runs left to right as you look out at him. */
const FACING = Math.atan2(-ISLE_DIR.x, -ISLE_DIR.y);
/** Local height of the rock's top, where the citadel stands. */
const PLATEAU = 34;
/** Local depth the isle starts from under the sea (its whole height: nothing shows before it rises). */
const SUNK = 380;

/** A part of the citadel that climbs out of the rock (or the sea) when his citadel reaches `tier`. */
interface Part {
  obj: THREE.Object3D;
  tier: number;
  y: number;
  sink: number;
}

/** One ember window: where it sits (isle-local), and the step of his citadel that lights it. */
interface Window {
  m: THREE.Matrix4;
  tier: number;
  y: number;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);

/** Roughen a geometry's surface (hewn stone, not a primitive). */
function hew(geo: THREE.BufferGeometry, amt: number, seed: number): THREE.BufferGeometry {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const j = 1 + amt * Math.sin(x * 0.31 + z * 0.27 + seed) * Math.cos(y * 0.2 + x * 0.1 + seed * 0.7);
    p.setXYZ(i, x * j, y + amt * 20 * Math.sin(x * 0.17 + z * 0.23 + seed), z * j);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Vexahl's citadel: a dark spire-isle out at sea, the shining city's shadow. Hidden under the water until your first
 * pyramid stands; then it rises (the sea darkens, a shockwave rings out, the isle surfaces through mist, violet light
 * runs up the spire). From then on it grows a step with every age you raise, up to TIERS (every temple standing): two
 * flanking spires, a curtain wall, a crown of shards and dark cloud, taller spires behind, claws of rock out of the sea,
 * the main spire's needle, and at the last a violet eye in the cloud. Ember windows light as it grows, and the sea
 * around it darkens. His temper (the storm-eye, bolts, glow) still follows the world's balance. Sinks away if he retreats.
 */
export class RivalIsle {
  readonly group = new THREE.Group();
  /** Sea-level effects (darkened water, shockwave rings, mist), in metres, unscaled, under the isle. */
  private readonly sea = new THREE.Group();
  private appear = 0;
  private goal = 0;
  /** Has it risen (the rising began), and real seconds since it began. */
  private riseT = -1;
  /** Steps of his citadel: the goal (the world's progress) and where its growth is now (eased, real time). */
  private tierGoal = 0;
  private lvl = 0;
  private tiers = 8;
  /** v0.5 endings (src/endings): hold the isle at this nearness (0 = where it stands .. 1 = ISLE_NEAR); null = it stands where its growth puts it. */
  hold: number | null = null;
  private near = 0;
  /** 0 = still .. 1 = his storm fully awake (eased), and its goal. */
  private storm = 0;
  private stormGoal = 0;
  private awake = false;
  private readonly crown = new THREE.Group();
  private readonly eye = new THREE.Group();
  private readonly cloudCrown = new THREE.Group();
  private readonly glow: THREE.Sprite;
  private readonly eyeGlow: THREE.Sprite;
  private readonly runner: THREE.Sprite;
  private readonly beam: THREE.Mesh;
  private readonly bolt: THREE.Line;
  private readonly clouds: THREE.Sprite[] = [];
  private readonly crownPuffs: { s: THREE.Sprite; base: THREE.Vector3; size: THREE.Vector3 }[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly puffScale: THREE.Vector3[] = [];
  private readonly parts: Part[] = [];
  private readonly wins: Window[] = [];
  private readonly windows: THREE.InstancedMesh;
  private litWindows = -1;
  private spireMat!: THREE.MeshStandardMaterial;
  private shardMat!: THREE.MeshStandardMaterial;
  private cloudMats: THREE.SpriteMaterial[] = [];
  private crownMats: THREE.SpriteMaterial[] = [];
  private readonly darkSea: THREE.Mesh;
  private readonly rings: { m: THREE.Mesh; t: number; dur: number; r: [number, number]; o: number }[] = [];
  private readonly mist: { s: THREE.Sprite; a: number; r: number; h: number; size: number; ph: number }[] = [];
  private t = Math.random() * 10;
  private flash = 0;
  private nextBolt = 3;
  /** Far-off veil (see capFog). */
  private readonly haze = { value: ISLE_HAZE };
  /** How much of the fog his citadel takes (see capFog): less as he grows, so his final form stands dark and clear. */
  private readonly fogCap = { value: 0.4 };

  constructor(private readonly game: Game) {
    const scene = game.scene;
    const g = this.group;
    g.position.copy(ISLE_POS);
    g.rotation.y = FACING;

    const rockMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0d0a14, roughness: 1, flatShading: true, envMapIntensity: 0.25 }));
    const spireMat = this.track(new THREE.MeshStandardMaterial({ color: 0x130d1e, roughness: 0.8, flatShading: true, emissive: 0x24093f, emissiveIntensity: 0.3, envMapIntensity: 0.3 }));
    const wallMat = this.track(new THREE.MeshStandardMaterial({ color: 0x120e1c, roughness: 0.95, flatShading: true, emissive: 0x14082c, emissiveIntensity: 0.3, envMapIntensity: 0.25 }));
    const emberMat = this.track(new THREE.MeshBasicMaterial({ color: EMBER }));
    const shardMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a2a8a, emissive: VIOLET, emissiveIntensity: 1.5, roughness: 0.3, flatShading: true }));
    this.spireMat = spireMat;
    this.shardMat = shardMat;
    // Far out at sea it must still read as a dark citadel on the horizon, not vanish into the haze.
    for (const m of [rockMat, spireMat, wallMat, emberMat, shardMat]) capFog(m, this.fogCap, this.haze);

    // ---- the rock: a broad, hewn, half-drowned foot with a plateau the citadel stands on.
    const rock = hew(new THREE.CylinderGeometry(40, 84, 46, 11, 3), 0.16, 1);
    const rockMesh = new THREE.Mesh(rock, rockMat);
    rockMesh.position.y = PLATEAU - 23;
    g.add(rockMesh);
    const crag = hew(new THREE.ConeGeometry(30, 38, 7, 2), 0.2, 4);
    for (const [x, z, s] of [[-46, -22, 1], [40, -30, 0.8], [8, -52, 1.1]] as [number, number, number][]) {
      const c = new THREE.Mesh(crag, rockMat);
      c.position.set(x, PLATEAU - 12, z);
      c.scale.setScalar(s);
      g.add(c);
    }

    // ---- the spires. The main one stands from the rising; the others climb out of the rock as he grows.
    const main = this.spire(spireMat, shardMat, [[10, 19, 74], [5, 10.5, 66], [0.8, 5.5, 74]], 1.45, 1, 14);
    main.position.set(0, PLATEAU - 4, 0);
    main.rotation.z = 0.06;
    this.part(main, 1, main.position.y, 0);
    // Buttress spurs round its foot.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const s = new THREE.Mesh(new THREE.ConeGeometry(4.5, 40, 5), spireMat);
      s.position.set(Math.cos(a) * 24, PLATEAU - 4 + 14, Math.sin(a) * 24);
      s.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      g.add(s);
    }
    // Two flanking spires (step 2), two taller ones behind (step 5), and three small ones on the wall (step 7).
    const flanks: [number, number, number, number][] = [[-36, 2, 0.1, 2], [35, 6, -0.12, 2], [-19, -30, 0.05, 5], [22, -27, -0.07, 5]];
    for (const [x, z, lean, tier] of flanks) {
      const tall = tier === 5;
      const s = this.spire(spireMat, shardMat, tall ? [[6.5, 12, 70], [3.4, 7, 64], [0.6, 3.6, 60]] : [[5.5, 10, 56], [2.8, 6, 50], [0.5, 3, 44]], tall ? 1.3 : 1.2, tier, tall ? 10 : 8);
      s.position.set(x, PLATEAU - 6, z);
      s.rotation.z = lean;
      this.part(s, tier, s.position.y, 200);
    }
    for (const [a, h] of [[0.5, 1], [2.4, 0.85], [-2.2, 0.95]] as [number, number][]) {
      const s = this.spire(spireMat, shardMat, [[3.4, 6, 34 * h], [0.5, 3.2, 30 * h]], 1, 7, 4);
      s.position.set(Math.cos(a) * 44, PLATEAU - 8, Math.sin(a) * 44);
      this.part(s, 7, s.position.y, 90);
    }
    // The main spire's needle (step 7): it climbs out of the top.
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.6, 52, 6), spireMat);
    needle.position.set(0, 0, 0);
    const needleHolder = new THREE.Group();
    needleHolder.add(needle);
    needle.position.y = 26;
    needleHolder.position.set(-Math.sin(0.06) * 288, PLATEAU - 4 + Math.cos(0.06) * 288, 0);
    needleHolder.rotation.z = 0.06;
    this.part(needleHolder, 7, needleHolder.position.y, 56);
    g.add(needleHolder);

    // ---- the curtain wall (step 3): a ring of battlemented wall with round towers on the plateau's rim.
    const wallGeos: THREE.BufferGeometry[] = [];
    const N = 16;
    const R = 42;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.2) continue; // the gate, facing home
      const seg = new THREE.BoxGeometry(2 * R * Math.sin(Math.PI / N) + 1, 15, 3.4);
      seg.rotateY(-a + Math.PI / 2);
      seg.translate(Math.cos(a) * R, 7.5, Math.sin(a) * R);
      wallGeos.push(seg);
      for (let k = -1; k <= 1; k += 2) {
        const c = new THREE.BoxGeometry(2.6, 3, 3.6);
        const ca = a + k * (Math.PI / N) * 0.5;
        c.rotateY(-ca + Math.PI / 2);
        c.translate(Math.cos(ca) * R, 16.4, Math.sin(ca) * R);
        wallGeos.push(c);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const tower = new THREE.CylinderGeometry(4.6, 5.4, 26, 8);
      tower.translate(Math.cos(a) * R, 13, Math.sin(a) * R);
      const roof = new THREE.ConeGeometry(6, 12, 8);
      roof.translate(Math.cos(a) * R, 32, Math.sin(a) * R);
      wallGeos.push(tower, roof);
      for (const y of [11, 19]) this.window(new THREE.Vector3(Math.cos(a) * (R + 5.1), PLATEAU - 4 + y, Math.sin(a) * (R + 5.1)), -a + Math.PI / 2, 6, 0.9);
    }
    const wall = new THREE.Mesh(mergeGeometries(wallGeos.map((x) => x.toNonIndexed())), wallMat);
    for (const x of wallGeos) x.dispose();
    wall.position.y = PLATEAU - 4;
    g.add(wall);
    this.part(wall, 3, wall.position.y, 40);

    // ---- claws of rock out of the sea round him (step 6), curving in.
    const clawGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.35 * Math.sin(i * 3.1);
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.35) continue; // keep the view home clear
      const h = 70 + 50 * ((i * 7) % 5) / 4;
      const c = hew(new THREE.ConeGeometry(9, h, 6, 4), 0.12, i);
      const pos = c.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k) / h + 0.5;
        pos.setX(k, pos.getX(k) - y * y * 26); // curl the tip inward (toward local -x, turned to the isle below)
      }
      c.computeVertexNormals();
      c.rotateY(Math.PI - a);
      const r = 112 + 20 * Math.sin(i * 1.7);
      c.translate(Math.cos(a) * r, h / 2 - 22, Math.sin(a) * r);
      clawGeos.push(c);
    }
    const claws = new THREE.Mesh(mergeGeometries(clawGeos.map((x) => x.toNonIndexed())), rockMat);
    for (const x of clawGeos) x.dispose();
    g.add(claws);
    this.part(claws, 6, 0, 120);

    // ---- ember windows: one instanced mesh, lit step by step.
    this.placeWindows();
    this.wins.sort((a, b) => a.tier - b.tier || a.y - b.y);
    this.windows = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 4.4, 1.2), emberMat, Math.max(1, this.wins.length));
    this.wins.forEach((w, i) => this.windows.setMatrixAt(i, w.m));
    this.windows.count = 0;
    g.add(this.windows);

    // ---- a crown of floating violet shards circling the top (step 4).
    this.crown.position.y = 276;
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), shardMat);
      s.scale.set(3, rand(7, 11), 3);
      const a = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(a) * 26, rand(-6, 8), Math.sin(a) * 26);
      s.rotation.set(rand(-0.3, 0.3), a, rand(-0.3, 0.3));
      this.crown.add(s);
    }
    g.add(this.crown);

    // ---- the storm-eye: a slow ring of dark violet cloud round the spire that gathers as the world falls (balance).
    const cloudMat = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x1e1236, transparent: true, opacity: 0, depthWrite: false }));
    const litMat = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6a3cc0, transparent: true, opacity: 0, depthWrite: false }));
    capFog(cloudMat, 0.5);
    capFog(litMat, 0.5);
    this.cloudMats = [cloudMat, litMat];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 * 2.3 + rand(-0.1, 0.1);
      const h = rand(0, 1);
      const r = lerp(105, 40, h) + rand(-12, 12);
      const puff = new THREE.Sprite(i % 4 === 0 ? litMat : cloudMat);
      const w = lerp(120, 60, h) * rand(0.8, 1.15);
      puff.scale.set(w, w * rand(0.55, 0.85), 1);
      puff.position.set(Math.cos(a) * r, lerp(70, 215, h), Math.sin(a) * r);
      this.eye.add(puff);
      this.clouds.push(puff);
      this.puffScale.push(puff.scale.clone());
    }
    g.add(this.eye);

    // ---- the crown of dark cloud above him (step 4, full at his final form): his progress, not his temper.
    const crownDark = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x150c26, transparent: true, opacity: 0, depthWrite: false }));
    const crownLit = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6a3cc0, transparent: true, opacity: 0, depthWrite: false }));
    capFog(crownDark, 0.5);
    capFog(crownLit, 0.5);
    this.crownMats = [crownDark, crownLit];
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 * 1.6 + rand(-0.12, 0.12);
      const r = rand(20, 125);
      const lit = i % 4 === 0;
      const s = new THREE.Sprite(lit ? crownLit : crownDark);
      const w = rand(70, 120) * (lit ? 0.7 : 1);
      const size = new THREE.Vector3(w, w * rand(0.4, 0.6), 1);
      const base = new THREE.Vector3(Math.cos(a) * r - 12, rand(330, 372) - (lit ? 12 : 0) - (r > 95 ? 14 : 0), Math.sin(a) * r);
      s.scale.copy(size);
      s.position.copy(base);
      this.cloudCrown.add(s);
      this.crownPuffs.push({ s, base, size });
    }
    g.add(this.cloudCrown);

    // ---- glows: in the storm-eye, the eye in his cloud crown (final form), the light that runs up the spire at the rising.
    const glowMat = this.track(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0x8a50ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(260, 260, 1);
    this.glow.position.y = 200;
    g.add(this.glow);
    const eyeMat = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7a40e0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.eyeGlow = new THREE.Sprite(eyeMat);
    this.eyeGlow.scale.set(90, 60, 1);
    this.eyeGlow.position.set(-14, 350, 0);
    g.add(this.eyeGlow);
    const runMat = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xa070ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.runner = new THREE.Sprite(runMat);
    this.runner.scale.set(46, 70, 1);
    g.add(this.runner);
    const beamMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x9060ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 16, 380, 14, 1, true), beamMat);
    this.beam.position.y = 380;
    g.add(this.beam);

    // A bolt from the eye to the spire's tip, flashed now and then.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 9; i++) pts.push(new THREE.Vector3(0, 0, 0));
    const boltMat = this.track(new THREE.LineBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0, fog: false }));
    this.bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), boltMat);
    g.add(this.bolt);

    // ---- the sea round him: darkened water, the rising's shockwave rings and mist.
    const darkMat = this.track(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x080312, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    capFog(darkMat, 0.3);
    this.darkSea = new THREE.Mesh(new THREE.CircleGeometry(1, 48), darkMat);
    this.darkSea.rotation.x = -Math.PI / 2;
    this.darkSea.renderOrder = 2;
    this.sea.add(this.darkSea);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 96),
        this.track(new THREE.MeshBasicMaterial({ color: 0xd6cbff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.4;
      m.renderOrder = 3;
      m.visible = false;
      this.sea.add(m);
      this.rings.push({ m, t: -1, dur: 3, r: [10, 200], o: 0.5 });
    }
    const mistMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9a92b4, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const m = this.track(mistMat.clone());
      capFog(m, 0.35);
      const s = new THREE.Sprite(m);
      const size = rand(50, 95);
      s.scale.set(size, size * 0.6, 1);
      this.sea.add(s);
      this.mist.push({ s, a: (i / 20) * Math.PI * 2 + rand(-0.2, 0.2), r: rand(14, 34), h: rand(2, 16), size, ph: rand(0, 1) });
    }
    mistMat.dispose();

    g.visible = false;
    this.sea.visible = false;
    scene.add(g, this.sea);
    aoSkip(game, g, true);
    aoSkip(game, this.sea, true);
  }

  private track<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private part(obj: THREE.Object3D, tier: number, y: number, sink: number) {
    if (!obj.parent) this.group.add(obj);
    this.parts.push({ obj, tier, y, sink });
  }

  /** An ember window at an isle-local point, facing out along `yaw`. */
  private window(p: THREE.Vector3, yaw: number, tier: number, size = 1) {
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    tmpS.setScalar(size);
    this.wins.push({ m: new THREE.Matrix4().compose(p.clone(), tmpQ.clone(), tmpS.clone()), tier, y: p.y });
  }

  /**
   * A crooked spire: stacked tapers [top radius, bottom radius, height], scaled up `stretch`, a violet shard on the
   * tip, and `n` ember windows that light at `tier` (the lower ones) and the steps after (the upper ones).
   */
  private spire(mat: THREE.Material, shard: THREE.Material, segs: [number, number, number][], stretch: number, tier: number, n: number): THREE.Group {
    const s = new THREE.Group();
    const body = new THREE.Group();
    body.scale.y = stretch;
    let y = 0;
    const rings: { y: number; r: number }[] = [];
    segs.forEach(([rt, rb, h], i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 7, 1), mat);
      m.position.y = y + h / 2;
      body.add(m);
      rings.push({ y: y + h * 0.3, r: lerp(rb, rt, 0.3) }, { y: y + h * 0.62, r: lerp(rb, rt, 0.62) });
      y += h * 0.92;
      if (i === segs.length - 1) return;
      // A ledge where one taper meets the next, and on the bigger spires a ring of pinnacles on it: built, not grown.
      const lr = Math.max(rt * 1.45, segs[i + 1][1] * 1.25) + 0.8;
      const ledge = new THREE.Mesh(new THREE.CylinderGeometry(lr, lr * 0.82, 2.6 / stretch, 7, 1), mat);
      ledge.position.y = y + 1;
      body.add(ledge);
      if (rb < 8) return;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const pin = new THREE.Mesh(new THREE.ConeGeometry(1.4, 16 / stretch, 5), mat);
        pin.position.set(Math.cos(a) * lr * 0.9, y + 1 + 8 / stretch, Math.sin(a) * lr * 0.9);
        body.add(pin);
      }
    });
    s.add(body);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), shard);
    tip.scale.set(1.6, 6, 1.6);
    tip.position.y = y * stretch + 7;
    s.add(tip);
    s.userData.windows = { rings, stretch, tier, n };
    // Windows are placed once the spire is positioned (see placeWindows).
    this.pendingSpires.push(s);
    return s;
  }

  private readonly pendingSpires: THREE.Group[] = [];

  /** Ember windows for every spire, in isle-local space at the spire's final pose. */
  private placeWindows() {
    for (const s of this.pendingSpires) {
      const d = s.userData.windows as { rings: { y: number; r: number }[]; stretch: number; tier: number; n: number };
      s.updateMatrix();
      for (let i = 0; i < d.n; i++) {
        const ring = d.rings[i % d.rings.length];
        const a = (i / d.n) * Math.PI * 2 * 3.1 + s.position.x;
        const r = ring.r * 0.97;
        tmpV.set(Math.cos(a) * r, ring.y * d.stretch + (i % 3) * 3, Math.sin(a) * r).applyMatrix4(s.matrix);
        // The lower windows light with the spire; the ones above with the steps after, until his final form.
        const frac = i / Math.max(1, d.n - 1);
        const tier = d.tier + Math.floor(frac * 3.2) * (d.tier === 1 ? 2 : 1);
        this.window(tmpV.clone(), -a + Math.PI / 2 - s.rotation.y, tier);
      }
    }
    this.pendingSpires.length = 0;
  }

  get present(): boolean {
    return this.goal > 0;
  }

  /** Has his isle risen from the sea (or begun to)? */
  get risen(): boolean {
    return this.riseT >= 0;
  }

  /** Real seconds since the rising began (-1 before). */
  get risingFor(): number {
    return this.riseT;
  }

  /** How far his citadel has grown (steps, eased; 0 before the rising). */
  get growth(): number {
    return this.lvl;
  }

  setPresent(on: boolean, instant = false) {
    this.goal = on ? 1 : 0;
    if (instant) this.appear = this.goal;
  }

  /** It rises from the sea (the RISE timeline), or stands risen already (`instant`: a loaded island). */
  rise(instant = false) {
    if (this.riseT >= 0) return;
    this.riseT = instant ? 1e4 : 0;
    if (instant) this.lvl = Math.max(this.lvl, Math.min(this.tierGoal, 1));
  }

  /** His citadel grows to step `tier` of `of` (one per age you raise). `instant` snaps (a loaded island). */
  setTier(tier: number, of: number, instant = false) {
    this.tiers = Math.max(2, of);
    this.tierGoal = Math.max(0, tier);
    if (instant) this.lvl = this.tierGoal;
    this.litWindows = -1;
  }

  /** A burst of violet light (the rising, a step of growth, scheme strikes). */
  pulse(amount = 1) {
    this.flash = Math.min(1.5, this.flash + amount);
  }

  /** A ring of light out over the water round his isle (the rising, a step of growth). */
  ring(radius: [number, number] = [12, 120], seconds = 2.6, opacity = 0.35) {
    const r = this.rings.find((x) => x.t < 0) ?? this.rings[0];
    r.t = 0;
    r.dur = seconds;
    r.r = radius;
    r.o = opacity;
  }

  /** The world's balance (0..1) sets how awake his storm is: his temper, not his size. `instant` skips the drift. */
  setBalance(balance: number, instant = false) {
    this.near = this.hold ?? 0;
    this.stormGoal = Math.max(smoothstep(ISLE_STORM[0], ISLE_STORM[1], balance), this.awake ? 0.12 : 0);
    if (instant) this.storm = this.stormGoal;
  }

  /** He has shown himself (his panel is up): a little storm-light even when the world is calm. */
  setAwake(on: boolean) {
    this.awake = on;
  }

  /** 0 (where it stands) .. 1 (held near by the endings). */
  get nearness(): number {
    return this.near;
  }

  /** World position of the spire's tip (where his schemes seem to come from). */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return this.crown.getWorldPosition(out);
  }

  /** World height of his citadel's top (the tip, or the cloud crown once it gathers): for framing the camera. */
  get height(): number {
    return (this.lvl >= 4 ? 385 : 330) * this.group.scale.y;
  }

  frame(dt: number) {
    this.t += dt;
    // The endings bring him up even if the world never raised a pyramid.
    if (this.hold !== null && this.riseT < 0) this.rise();
    this.appear += (this.goal - this.appear) * damp(0.5, dt);
    if (Math.abs(this.goal - this.appear) < 0.002) this.appear = this.goal;
    this.storm += (this.stormGoal - this.storm) * damp(1 / ISLE_DRIFT, dt);
    if (this.riseT >= 0) this.riseT += dt;
    const rt = this.riseT;
    const surfaced = rt >= RISE.surface[1];
    // Growth: one step every LEVEL_SECONDS (the first step is the rising itself).
    const cap = rt < 0 ? 0 : surfaced ? this.tiers : 1;
    const want = Math.min(this.tierGoal, cap);
    const before = this.lvl;
    if (rt >= 0 && this.lvl < 1) this.lvl = Math.min(1, want);
    else if (this.lvl < want) this.lvl = Math.min(want, this.lvl + dt / LEVEL_SECONDS);
    else if (this.lvl > want) this.lvl = want;
    if (Math.floor(this.lvl + 1e-6) !== Math.floor(before + 1e-6) && rt > RISE.surface[1] + 0.5) this.litWindows = -1;

    const a = this.appear;
    const e = easeInOut(clamp(a, 0, 1));
    const up = rt < 0 ? 0 : easeInOut(span(rt, RISE.surface[0], RISE.surface[1]));
    const showing = rt >= 0 && a > 0.003;
    this.group.visible = showing && up > 0.001;
    this.sea.visible = showing;
    if (!showing) return;

    // Where it stands and how big: its growth, or held near by the endings.
    const grow = clamp((this.lvl - 1) / Math.max(1, this.tiers - 1), 0, 1);
    const n = this.near;
    const dist = lerp(lerp(ISLE_GROW.dist[0], ISLE_GROW.dist[1], grow), ISLE_NEAR.dist, n);
    const scale = lerp(lerp(ISLE_GROW.scale[0], ISLE_GROW.scale[1], grow), ISLE_NEAR.scale, n);
    const sink = Math.max(1 - up, 1 - e);
    this.group.position.set(ISLE_DIR.x * dist, ISLE_POS.y - sink * SUNK * scale, ISLE_DIR.y * dist);
    this.group.scale.setScalar(scale);
    this.haze.value = ISLE_HAZE * (1 - 0.5 * grow) * (1 - clamp(n, 0, 1));
    this.fogCap.value = lerp(0.24, 0.15, grow) * (1 - 0.5 * clamp(n, 0, 1));

    // The parts that climb out of the rock (or the sea) as he grows; none before the isle has surfaced.
    for (const p of this.parts) {
      const k = p.tier <= 1 ? 1 : easeInOut(clamp(this.lvl - (p.tier - 1), 0, 1));
      p.obj.visible = k > 0.002;
      p.obj.position.y = p.y - (1 - k) * p.sink;
    }
    this.litUp(rt);

    // His storm (the world's balance): the storm-eye gathers, the shards burn, bolts come.
    const st = this.storm;
    const eyeK = smoothstep(0.08, 0.7, st);
    this.eye.visible = eyeK > 0.01;
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].scale.copy(this.puffScale[i]).multiplyScalar(0.7 + 0.3 * eyeK);
    this.cloudMats[0].opacity = 0.9 * eyeK;
    this.cloudMats[1].opacity = 0.55 * eyeK * (0.8 + 0.2 * Math.sin(this.t * 0.9));

    // His progress: the crown of shards (step 4), the crown of dark cloud (4 .. final), the eye in it (final form).
    const shardK = easeInOut(clamp(this.lvl - 3, 0, 1));
    this.crown.visible = shardK > 0.01;
    this.crown.scale.setScalar(Math.max(0.01, shardK));
    const crownK = smoothstep(3, this.tiers, this.lvl);
    this.cloudCrown.visible = crownK > 0.01;
    this.crownMats[0].opacity = 0.85 * crownK;
    this.crownMats[1].opacity = 0.5 * crownK * (0.75 + 0.25 * Math.sin(this.t * 0.7));
    for (const c of this.crownPuffs) {
      c.s.scale.copy(c.size).multiplyScalar(0.55 + 0.45 * crownK);
      c.s.position.set(c.base.x * (0.6 + 0.4 * crownK), c.base.y + Math.sin(this.t * 0.25 + c.base.x) * 2, c.base.z * (0.6 + 0.4 * crownK));
    }
    this.cloudCrown.rotation.y = -this.t * 0.025;
    const finalK = easeInOut(clamp(this.lvl - (this.tiers - 1), 0, 1));

    // The rising: violet light runs up the spire and flares at its tip.
    const run = rt < 0 ? 1 : span(rt, RISE.light[0], RISE.light[1]);
    const running = run > 0 && run < 1;
    this.runner.visible = running;
    if (running) {
      this.runner.position.set(0, lerp(PLATEAU, 300, easeInOut(run)), 0);
      this.runner.material.opacity = 0.75 * Math.sin(run * Math.PI);
    }
    const surge = rt < 0 ? 0 : Math.exp(-Math.pow((rt - (RISE.light[0] + RISE.light[1]) / 2) / 1.1, 2));
    this.spireMat.emissiveIntensity = 0.3 + 1.1 * surge + 0.12 * grow;
    this.shardMat.emissiveIntensity = 0.5 + 1.3 * st + 0.8 * surge + 0.3 * finalK;

    this.crown.rotation.y = this.t * (0.1 + 0.2 * st);
    this.crown.position.y = 276 + Math.sin(this.t * 0.7) * 3;
    this.eye.rotation.y = this.t * 0.04;
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.y += Math.sin(this.t * 0.3 + i) * 0.01;

    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      // Bolts once his storm is properly awake (more often the further the world falls), and now and then in his final form.
      this.nextBolt = rand(5, 10) * lerp(1.6, 0.8, st);
      if (st > 0.35 || (finalK > 0.9 && Math.random() < 0.35)) {
        this.flash = Math.max(this.flash, 1);
        this.rebuildBolt();
      }
    }
    const throb = 0.55 + 0.25 * Math.sin(this.t * 0.8);
    const vis = e * up;
    (this.glow.material as THREE.SpriteMaterial).opacity = vis * (throb * 0.5 * (0.15 + 0.85 * st) + this.flash * 0.5);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = vis * ((0.07 + 0.06 * throb) * Math.max(st, 0.35 * finalK) + this.flash * 0.1);
    (this.bolt.material as THREE.LineBasicMaterial).opacity = this.flash > 0.5 ? clamp((this.flash - 0.4) * 1.5, 0, 1) : 0;
    this.eyeGlow.material.opacity = vis * finalK * (0.22 + 0.1 * Math.sin(this.t * 0.6)) + vis * crownK * this.flash * 0.15;

    this.frameSea(dt, rt, grow, e);
  }

  /** Which ember windows are lit: those of every step reached, and at the rising only below the running light. */
  private litUp(rt: number) {
    const runY = rt < 0 ? -1 : rt >= RISE.light[1] ? Infinity : rt < RISE.light[0] ? -1 : lerp(PLATEAU, 300, easeInOut(span(rt, RISE.light[0], RISE.light[1])));
    let n = 0;
    for (const w of this.wins) {
      if (Math.min(w.tier, this.tiers) > Math.floor(this.lvl + 1e-6)) break;
      if (w.tier <= 1 && w.y > runY) break;
      n++;
    }
    if (n === this.litWindows) return;
    this.litWindows = n;
    this.windows.count = n;
  }

  /** The water round him: darker as he grows, the rising's rings and mist. */
  private frameSea(dt: number, rt: number, grow: number, e: number) {
    const gp = this.group.position;
    this.sea.position.set(gp.x, 0.25, gp.z);
    const s = this.group.scale.x;
    const dk = rt < 0 ? 0 : easeInOut(span(rt, RISE.darken[0], RISE.darken[1]));
    const r = lerp(85, 150, grow) * (0.3 + 0.7 * dk) * (s / lerp(ISLE_GROW.scale[0], ISLE_GROW.scale[1], grow));
    this.darkSea.scale.set(r * 1.7, r * 1.7, 1);
    (this.darkSea.material as THREE.MeshBasicMaterial).opacity = dk * e * lerp(0.85, 1, grow);
    if (rt >= 0 && rt < RISE.surface[1] + 2) {
      for (let i = 0; i < RISE.rings.length; i++) {
        const at = RISE.rings[i];
        if (rt - dt < at && rt >= at) this.ring([14, 230 + i * 40], 3.4, 0.42);
      }
    }
    for (const ring of this.rings) {
      if (ring.t < 0) {
        ring.m.visible = false;
        continue;
      }
      ring.t += dt;
      const k = ring.t / ring.dur;
      if (k >= 1) {
        ring.t = -1;
        ring.m.visible = false;
        continue;
      }
      ring.m.visible = true;
      const rr = lerp(ring.r[0], ring.r[1], 1 - Math.pow(1 - k, 2.2));
      ring.m.scale.set(rr, rr, 1);
      (ring.m.material as THREE.MeshBasicMaterial).opacity = ring.o * Math.pow(1 - k, 1.4) * smoothstep(0, 0.06, k);
    }
    // Mist: thick while it surfaces, thinning to a faint sea-mist round his foot.
    const mk = rt < 0 ? 0 : Math.max(Math.sin(Math.PI * span(rt, RISE.mist[0], RISE.mist[1])) * 0.8, 0.06 * smoothstep(RISE.mist[0], RISE.mist[1], rt));
    const foot = 70 * s;
    for (const m of this.mist) {
      const out = 1 + 0.6 * span(rt, RISE.mist[0], RISE.mist[1]);
      const a = m.a + this.t * 0.02;
      const rr = foot * 0.6 + m.r * out;
      m.s.position.set(Math.cos(a) * rr, m.h + 10 * span(rt, RISE.mist[0], RISE.mist[1]) * m.ph + Math.sin(this.t * 0.5 + m.ph * 6) * 1.2, Math.sin(a) * rr);
      m.s.scale.set(m.size * out, m.size * out * 0.6, 1);
      (m.s.material as THREE.SpriteMaterial).opacity = mk * e * (0.5 + 0.2 * Math.sin(this.t * 0.7 + m.ph * 9));
    }
  }

  private rebuildBolt() {
    const attr = this.bolt.geometry.attributes.position as THREE.BufferAttribute;
    const a = rand(0, Math.PI * 2);
    const sx = Math.cos(a) * 60;
    const sz = Math.sin(a) * 60;
    for (let i = 0; i < attr.count; i++) {
      const f = i / (attr.count - 1);
      attr.setXYZ(i, lerp(sx, 4, f) + (i && i < attr.count - 1 ? rand(-9, 9) : 0), lerp(120, 270, f) - f * 20 - (1 - f) * 2, lerp(sz, 0, f) + (i && i < attr.count - 1 ? rand(-9, 9) : 0));
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.game.scene.remove(this.group, this.sea);
    aoSkip(this.game, this.group, false);
    aoSkip(this.game, this.sea, false);
    disposeGroup(this.group);
    disposeGroup(this.sea);
    for (const m of this.mats) m.dispose();
  }
}

// -------------------------------------------------------------------- the mist

/** A violet mist that settles over a village while Whispers are on it. */
export class Mist {
  private readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; a: number; r: number; h: number; sp: number; size: number }[] = [];
  private strength = 0;
  private goal = 1;
  private t = Math.random() * 10;
  private sparkle = 0;

  constructor(
    private readonly game: Game,
    private readonly village: Village,
  ) {
    const mat0 = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7a46d8, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const m = mat0.clone();
      const s = new THREE.Sprite(m);
      const r = Math.sqrt(Math.random()) * village.radius * 0.95;
      const a = rand(0, Math.PI * 2);
      const size = rand(34, 62);
      s.scale.set(size, size * 0.55, 1);
      this.puffs.push({ s, a, r, h: rand(3, 12), sp: rand(0.02, 0.07) * (Math.random() < 0.5 ? -1 : 1), size });
      this.group.add(s);
    }
    mat0.dispose();
    game.scene.add(this.group);
    aoSkip(game, this.group, true);
  }

  /** 0..1 how thick it is; ramps in and out smoothly. */
  setGoal(v: number) {
    this.goal = v;
  }

  get thick(): number {
    return this.strength;
  }

  frame(dt: number) {
    this.t += dt;
    this.strength += (this.goal - this.strength) * damp(0.8, dt);
    const c = this.village.center;
    for (const p of this.puffs) {
      p.a += p.sp * dt;
      const x = c.x + Math.cos(p.a) * p.r;
      const z = c.z + Math.sin(p.a) * p.r;
      p.s.position.set(x, this.game.terrain.heightAt(x, z) + p.h + Math.sin(this.t * 0.6 + p.a * 3) * 1.2, z);
      (p.s.material as THREE.SpriteMaterial).opacity = 0.34 * this.strength * (0.75 + 0.25 * Math.sin(this.t * 0.9 + p.r));
    }
  }

  /** Simulation step: little wisps rise from the mist. */
  step(dt: number) {
    this.sparkle -= dt;
    if (this.sparkle > 0 || this.strength < 0.2) return;
    this.sparkle = 0.35;
    const c = this.village.center;
    const a = rand(0, Math.PI * 2);
    const r = Math.sqrt(Math.random()) * this.village.radius * 0.8;
    this.game.fx.sparkle(c.x + Math.cos(a) * r, c.y + rand(2, 6), c.z + Math.sin(a) * r, 2, VIOLET_LIGHT, 2.5);
  }

  dispose() {
    this.game.scene.remove(this.group);
    aoSkip(this.game, this.group, false);
    for (const p of this.puffs) (p.s.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ the dark hand

export type HandMode = 'hover' | 'strike' | 'lift' | 'recoil' | 'gone';

/** World size of his hand: about the size yours is at a normal viewing distance. */
const HAND_SCALE = 11;
/** Midnight violet skin with a soft violet sheen; lilac nails and fingertip glow. Never red. */
const HAND_SKIN = 0x160c2a;
const HAND_SHEEN = 0x9a70ff;
const HAND_GLOW = 0x3a1878;
const HAND_NAIL = 0xb48cff;
/** Glow sprites made by the hand rigs, told apart by their render order (see SkinnedHand): fingertips, wrist mist, halo. */
const SPRITE_LOOK: Record<number, { color: number; opacity: number }> = {
  12: { color: 0xc8a8ff, opacity: 0.55 },
  9: { color: 0x7a46d8, opacity: 0.22 },
  8: { color: 0x6a3ad0, opacity: 0.18 },
};

/** The same hand model as the player's (the skinned Blender hand, or the primitive fallback), as its own copy. */
function makeRig(): HandRig {
  return assets.hand ? new SkinnedHand(cloneSkinned(assets.hand)) : new ProceduralHand();
}

/**
 * His Grasping Hand: your own hand, darkened to midnight violet, lowering from a violet cloud toward
 * a point on the ground, where its shadow (and a closing violet ring) grows to warn you. It moves the
 * way yours does: the same model, the same finger sway, the same grip.
 */
export class DarkHand {
  readonly group = new THREE.Group();
  mode: HandMode = 'hover';
  /** Ground point it reaches for. */
  readonly aim = new THREE.Vector3();
  private readonly hand = new THREE.Group();
  private readonly turn = new THREE.Group();
  private readonly rig: HandRig;
  private readonly sprites: { s: THREE.Sprite; base: number }[] = [];
  private readonly skins: THREE.Material[] = [];
  private readonly hit: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly wisp: THREE.Sprite;
  private readonly cloud: THREE.Sprite;
  private readonly held = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  private readonly mats: THREE.Material[] = [];
  private grip = 0.1;
  private height = 95;
  private t = 0;
  private modeT = 0;
  private fade = 0;
  private hover = false;
  private shadowR = 0;
  private liftDir = new THREE.Vector2(-1, -1);
  private readonly lastPos = new THREE.Vector3();
  private readonly skin: THREE.MeshPhysicalMaterial;
  private readonly nail: THREE.MeshStandardMaterial;

  constructor(
    private readonly game: Game,
    /** Where his isle is (he reaches from there, and carries his prize back to it). */
    private readonly isle: THREE.Vector3,
  ) {
    this.skin = new THREE.MeshPhysicalMaterial({
      color: HAND_SKIN,
      roughness: 0.45,
      sheen: 0.55,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(HAND_SHEEN),
      emissive: HAND_GLOW,
      emissiveIntensity: 0.4,
      transparent: true,
    });
    this.nail = new THREE.MeshStandardMaterial({ color: 0x6a48b0, emissive: HAND_NAIL, emissiveIntensity: 0.9, roughness: 0.3, transparent: true });
    this.mats.push(this.skin, this.nail);

    // Your hand, recoloured: the material used by the most meshes is skin, the rest are nails.
    this.rig = makeRig();
    const uses = new Map<THREE.Material, THREE.Mesh[]>();
    this.rig.root.traverse((o) => {
      const sp = o as THREE.Sprite;
      if (sp.isSprite) {
        const look = SPRITE_LOOK[sp.renderOrder];
        const m = sp.material as THREE.SpriteMaterial;
        m.color.setHex(look?.color ?? VIOLET_LIGHT);
        this.sprites.push({ s: sp, base: look?.opacity ?? 0.2 });
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const list = uses.get(m.material) ?? [];
      list.push(m);
      uses.set(m.material, list);
    });
    const skinOld = [...uses.entries()].sort((x, y) => y[1].length - x[1].length)[0]?.[0];
    for (const [mat, meshes] of uses) {
      for (const m of meshes) m.material = mat === skinOld ? this.skin : this.nail;
      this.skins.push(mat);
    }
    this.rig.root.scale.setScalar(HAND_SCALE);
    this.turn.add(this.rig.root);
    this.hand.add(this.turn);

    // A thread of violet mist up from the wrist into a violet cloud.
    const wispMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x5a2aa8, transparent: true, opacity: 0.35, depthWrite: false });
    this.mats.push(wispMat);
    this.wisp = new THREE.Sprite(wispMat);
    this.wisp.scale.set(10, 95, 1);
    this.wisp.position.set(0, 58, 0);
    this.hand.add(this.wisp);
    const cloudMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x4a2090, transparent: true, opacity: 0.8, depthWrite: false });
    this.mats.push(cloudMat);
    this.cloud = new THREE.Sprite(cloudMat);
    this.cloud.scale.set(120, 70, 1);
    this.cloud.position.set(0, 112, 0);
    this.hand.add(this.cloud);

    const heldMat = this.held.material as THREE.MeshStandardMaterial;
    this.mats.push(heldMat);
    // Under the palm, and the slap target over the whole hand (the model reaches along -Z from the wrist).
    this.held.position.set(0, -2.6, -0.45 * HAND_SCALE);
    this.held.visible = false;
    this.turn.add(this.held);

    this.hit = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    this.mats.push(this.hit.material as THREE.Material);
    this.hit.position.set(0, 0, -0.45 * HAND_SCALE);
    this.turn.add(this.hit);

    this.group.add(this.hand);

    // Shadow on the ground and the closing violet ring (yours is gold; his is violet).
    const shadowMat = new THREE.MeshBasicMaterial({
      map: discTexture(),
      color: 0x0c0214,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mats.push(shadowMat);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    const ringMat = new THREE.MeshBasicMaterial({ color: VIOLET_LIGHT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.push(ringMat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    game.scene.add(this.group, this.shadow, this.ring);
    for (const o of [this.group, this.shadow, this.ring]) aoSkip(game, o, true);
    this.group.visible = false;
    this.shadow.visible = false;
    this.ring.visible = false;
  }

  /** Is this screen ray over the hand (for the slap)? */
  hitTest(ray: THREE.Raycaster): boolean {
    if (this.mode === 'gone' || this.mode === 'recoil') return false;
    this.group.updateMatrixWorld(true);
    return ray.intersectObject(this.hit, false).length > 0;
  }

  setHover(on: boolean) {
    this.hover = on;
  }

  /** Where the palm is (for effects and the camera). */
  palm(out: THREE.Vector3): THREE.Vector3 {
    return this.hand.getWorldPosition(out);
  }

  /** `p` 0..1 through the shadow phase: the hand lowers, the shadow grows. */
  approach(p: number, radius: number) {
    this.mode = 'hover';
    this.height = lerp(95, 24, easeInOut(clamp(p, 0, 1)));
    this.shadowR = lerp(1.2, radius, easeInOut(clamp(p, 0, 1)));
    this.grip = lerp(0.08, 0.32, p);
  }

  /** Snap shut on the ground. */
  strike(withVillager: number | null) {
    this.mode = 'strike';
    this.modeT = 0;
    this.grip = 1;
    if (withVillager !== null) {
      (this.held.material as THREE.MeshStandardMaterial).color.setHex(withVillager);
    }
  }

  /** Rise away; carrying a villager if `carry` is set. */
  lift(carry: number | null) {
    this.mode = 'lift';
    this.modeT = 0;
    this.grip = carry !== null ? 0.85 : 0.5;
    this.held.visible = carry !== null;
    if (carry !== null) (this.held.material as THREE.MeshStandardMaterial).color.setHex(carry);
    // Head back toward his isle.
    this.liftDir.set(this.isle.x - this.aim.x, this.isle.z - this.aim.z).normalize();
  }

  /** Slapped: spin away and fade, with comic speed. */
  recoil() {
    this.mode = 'recoil';
    this.modeT = 0;
    this.grip = 0;
    this.rig.swat();
  }

  get done(): boolean {
    return this.mode === 'gone';
  }

  frame(dt: number) {
    if (this.mode === 'gone') return;
    this.t += dt;
    this.modeT += dt;
    const g = this.game;
    this.fade = Math.min(1, this.fade + dt * 1.2);

    const sway = Math.sin(this.t * 1.7) * 0.6;
    let h = this.height;
    let ox = 0;
    let oz = 0;
    let spin = 0;
    let alpha = this.fade;
    if (this.mode === 'hover') {
      h += Math.sin(this.t * 2.2) * 1.2;
      ox = Math.sin(this.t * 1.3) * 1.4;
      oz = Math.cos(this.t * 1.1) * 1.2;
    } else if (this.mode === 'strike') {
      const k = clamp(this.modeT / 0.3, 0, 1);
      h = lerp(this.height, 4.2, k * k);
    } else if (this.mode === 'lift') {
      const k = clamp(this.modeT / 3.2, 0, 1);
      h = lerp(4.2, 150, k * k);
      ox = this.liftDir.x * k * k * 160;
      oz = this.liftDir.y * k * k * 160;
      alpha = 1 - smoothstep(0.55, 1, k);
      if (k >= 1) this.finish();
    } else if (this.mode === 'recoil') {
      const k = clamp(this.modeT / 1.1, 0, 1);
      h = this.height + k * 90;
      spin = k * 9;
      ox = k * 40;
      alpha = 1 - smoothstep(0.35, 1, k);
      if (k >= 1) this.finish();
    }
    const gy = g.terrain.heightAt(this.aim.x, this.aim.z);
    this.group.position.set(this.aim.x + ox, gy + h, this.aim.z + oz);
    this.group.rotation.set(0, sway * 0.08 + spin, spin * 0.3);
    // Fingers point away from his isle: he reaches in from his side of the sea, palm down, fingertips dipping.
    this.turn.rotation.set(-0.35, Math.atan2(-(this.aim.x - this.isle.x), -(this.aim.z - this.isle.z)), 0, 'YXZ');
    // The same rig as yours: grip, finger sway, and a lean with its motion.
    this.rig.setGrip(this.grip);
    const vx = (this.group.position.x - this.lastPos.x) / Math.max(dt, 1e-4);
    const vy = (this.group.position.y - this.lastPos.y) / Math.max(dt, 1e-4);
    this.lastPos.copy(this.group.position);
    this.rig.update(dt, clamp(vx * 0.004, -0.4, 0.4), clamp(-vy * 0.004, -0.4, 0.4));

    const a = clamp(alpha, 0, 1);
    this.skin.opacity = a;
    this.nail.opacity = a;
    this.skin.emissiveIntensity = 0.4 + (this.hover ? 0.9 : 0) + Math.sin(this.t * 2.4) * 0.05;
    for (const { s, base } of this.sprites) (s.material as THREE.SpriteMaterial).opacity = base * a * (this.hover ? 1.6 : 1);
    this.cloud.visible = this.wisp.visible = this.mode !== 'recoil';
    (this.cloud.material as THREE.SpriteMaterial).opacity = 0.8 * a;
    (this.wisp.material as THREE.SpriteMaterial).opacity = 0.32 * a;
    this.group.visible = a > 0.01;

    // Shadow + ring on the ground below the aim point; they stay put while the hand sways.
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    const showGround = this.mode === 'hover' || this.mode === 'strike';
    const r = Math.max(0.01, this.shadowR);
    this.shadow.visible = this.ring.visible = showGround && this.fade > 0.02;
    this.shadow.position.set(this.aim.x, gy + 0.35, this.aim.z);
    this.shadow.scale.set(r * 1.35, r * 1.35, 1);
    sm.opacity = 0.85 * this.fade;
    this.ring.position.set(this.aim.x, gy + 0.45, this.aim.z);
    this.ring.scale.set(r * 1.05, r * 1.05, 1);
    // A slow pulse (under one beat a second, well clear of any flashing).
    rm.opacity = this.fade * (0.5 + 0.3 * Math.sin(this.t * 4) * (this.mode === 'hover' ? 1 : 0));
  }

  private finish() {
    this.mode = 'gone';
    this.group.visible = false;
    this.shadow.visible = false;
    this.ring.visible = false;
  }

  dispose() {
    this.game.scene.remove(this.group, this.shadow, this.ring);
    for (const o of [this.group, this.shadow, this.ring]) aoSkip(this.game, o, false);
    // Leave the hand model's geometry alone: the copy shares it with your own hand.
    this.hand.remove(this.turn);
    disposeGroup(this.group);
    for (const { s } of this.sprites) {
      const m = s.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.shadow.geometry.dispose();
    this.ring.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const m of this.skins) m.dispose();
  }
}

// ------------------------------------------------------------- a village that turned

/** What marks a village as his: a violet banner pole and a flickering violet-and-ember flame over the totem. */
export class TurnedMark {
  private readonly group = new THREE.Group();
  private readonly flame: THREE.Sprite;
  private readonly cloth: THREE.Mesh;
  private readonly mats: THREE.Material[] = [];
  private strength = 0;
  private goal = 1;
  private t = Math.random() * 10;
  private sparkle = 0;

  constructor(
    private readonly game: Game,
    private readonly village: Village,
  ) {
    const w = village.worship.pos;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1034, roughness: 0.7, emissive: 0x2a0f55, emissiveIntensity: 0.4 });
    const clothMat = new THREE.MeshStandardMaterial({ color: VIOLET, emissive: 0x3a1a78, emissiveIntensity: 0.5, roughness: 0.7, side: THREE.DoubleSide });
    this.mats.push(poleMat, clothMat);
    // The banner stands behind the prayer place, clear of the biggest shrine stage (the pyramid), on the ground there.
    const bz = BANNER_BACK;
    const dy = game.terrain.heightAt(w.x, w.z + bz) - w.y;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 14, 6), poleMat);
    pole.position.set(0, 7 + dy, bz);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(5.2, -1.2);
    shape.lineTo(3.4, -2.8);
    shape.lineTo(5.2, -4.4);
    shape.lineTo(0, -5.2);
    shape.closePath();
    this.cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), clothMat);
    this.cloth.position.set(0.2, 13.4 + dy, bz);
    // Ember trim along the pole's top.
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: EMBER }));
    this.mats.push(orb.material as THREE.Material);
    orb.position.set(0, 14.4 + dy, bz);
    this.group.add(pole, this.cloth, orb);

    const flameMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9a60ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.push(flameMat);
    this.flame = new THREE.Sprite(flameMat);
    this.flame.scale.set(14, 20, 1);
    this.flame.position.set(0, 7, 4.2);
    this.group.add(this.flame);

    this.group.position.set(w.x, w.y, w.z);
    game.scene.add(this.group);
    aoSkip(game, this.group, true);
    this.group.scale.setScalar(0.01);
    village.store.setColor(VIOLET);
  }

  release() {
    this.goal = 0;
    this.village.store.setColor(this.village.color);
  }

  get gone(): boolean {
    return this.goal === 0 && this.strength < 0.02;
  }

  frame(dt: number) {
    this.t += dt;
    this.strength += (this.goal - this.strength) * damp(1.4, dt);
    this.group.scale.setScalar(Math.max(0.01, this.strength));
    this.cloth.rotation.y = Math.sin(this.t * 1.7) * 0.35;
    (this.flame.material as THREE.SpriteMaterial).opacity = this.strength * (0.55 + 0.25 * Math.sin(this.t * 7) * Math.sin(this.t * 3.1));
  }

  step(dt: number) {
    this.sparkle -= dt;
    if (this.sparkle > 0 || this.strength < 0.5) return;
    this.sparkle = 0.5;
    const w = this.village.worship.pos;
    this.game.fx.sparkle(w.x + rand(-2, 2), w.y + 8, w.z + 4 + rand(-1, 1), 1, Math.random() < 0.3 ? EMBER : VIOLET_LIGHT, 1.5);
  }

  dispose() {
    this.game.scene.remove(this.group);
    aoSkip(this.game, this.group, false);
    disposeGroup(this.group);
    for (const m of this.mats) m.dispose();
  }
}
