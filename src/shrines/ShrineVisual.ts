import * as THREE from 'three';
import { sharedMesh } from '../entities/Entity';
import { MAT } from '../art/Models';
import { clamp, smoothstep } from '../util/math';
import { LAYOUT, stageIndex, type ShrineStage } from './stages';
import {
  CAPSTONE_Y,
  SHRINE,
  SHRINE_BEAM,
  SHRINE_GOLD,
  SHRINE_SUN,
  beamGeometry,
  capstoneGeometry,
  columnBasesGeometry,
  columnShaftsGeometry,
  courtGeometry,
  danceInlayGeometry,
  friezeGeometry,
  friezeTexture,
  muralMaterial,
  muralPlanes,
  muralTexture,
  obeliskTipGeometry,
  obelisksGeometry,
  orbitRingGeometry,
  plinthGeometry,
  pyramidGeometry,
  pyramidGoldGeometry,
  stoneGlyphGeometry,
  stonesGeometry,
  templeGoldGeometry,
  templeRingGeometry,
  totemEmblemGeometry,
  totemFloorGeometry,
  totemGeometry,
  type MuralId,
} from './ShrineModels';

// ------------------------------------------------------------------ tuning knobs

/** Seconds (real time) for the standing stones to rise out of the ground. */
const STONES_RISE = 4.2;
/** Seconds for the murals to glow into being on a new pyramid or temple. */
const MURAL_FADE = 3.5;
/** Seconds for the capstone to lift off and the orbit rings to open when the temple is raised. */
const CROWN_RISE = 5;

/** Geometry is the same for every village: build it once. */
let GEO: ReturnType<typeof buildGeometry> | null = null;
function buildGeometry() {
  return {
    totemFloor: totemFloorGeometry(),
    totem: totemGeometry(),
    emblem: totemEmblemGeometry(),
    courtEarth: courtGeometry(true),
    courtPaved: courtGeometry(false),
    inlay: danceInlayGeometry(),
    stones: stonesGeometry(),
    stoneGlyphs: stoneGlyphGeometry(),
    plinth: plinthGeometry(),
    pyramid: pyramidGeometry(),
    pyramidGold: pyramidGoldGeometry(),
    capstone: capstoneGeometry(),
    obelisks: obelisksGeometry(),
    obeliskTips: obeliskTipGeometry(),
    colBases: columnBasesGeometry(),
    colShafts: columnShaftsGeometry(),
    templeRing: templeRingGeometry(),
    templeGold: templeGoldGeometry(),
    frieze: friezeGeometry(),
    orbitA: orbitRingGeometry(2.5),
    orbitB: orbitRingGeometry(3.3),
    sun: new THREE.SphereGeometry(0.7, 16, 12),
    beam: beamGeometry(),
    murals: muralPlanes(),
  };
}

/**
 * The prayer place of one village, drawn at whichever age it has reached (see stages.ts). Owned by the
 * village's WorshipSite. `setStage` switches it; when it is not a load, the new age arrives with a
 * moment: the stones rise out of the earth, the murals glow into the stone, the capstone lifts off.
 */
export class ShrineVisual {
  readonly group = new THREE.Group();
  stage: ShrineStage = 'totem';
  /** The age being built here right now (a project site at the prayer place), so dancers keep clear of the work. */
  building: ShrineStage | null = null;

  private readonly totemFloor: THREE.Mesh;
  private readonly totem: THREE.Group;
  private readonly courtEarth: THREE.Mesh;
  private readonly courtPaved: THREE.Mesh;
  private readonly inlay: THREE.Mesh;
  private readonly stones: THREE.Group;
  private readonly pyramid: THREE.Group;
  private readonly capstone: THREE.Mesh;
  private readonly temple: THREE.Group;
  private readonly crown: THREE.Group;
  private readonly orbitA: THREE.Mesh;
  private readonly orbitB: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly muralMats: THREE.MeshStandardMaterial[] = [];
  private readonly friezeMat: THREE.MeshStandardMaterial;

  /** Animations, in real seconds since they began (-1 = not running). */
  private stonesT = -1;
  private muralT = -1;
  private crownT = -1;
  private t = Math.random() * 100;

  constructor() {
    const G = (GEO ??= buildGeometry());
    this.totemFloor = sharedMesh(G.totemFloor, MAT.base);
    this.totem = new THREE.Group();
    this.totem.add(sharedMesh(G.totem, MAT.base), sharedMesh(G.emblem, SHRINE_GOLD, false));
    this.courtEarth = sharedMesh(G.courtEarth, MAT.base);
    this.courtPaved = sharedMesh(G.courtPaved, MAT.base);
    this.inlay = sharedMesh(G.inlay, SHRINE_GOLD, false);
    this.stones = new THREE.Group();
    this.stones.add(sharedMesh(G.stones, MAT.base), sharedMesh(G.stoneGlyphs, SHRINE_GOLD, false));

    this.pyramid = new THREE.Group();
    this.pyramid.add(
      sharedMesh(G.plinth, MAT.base),
      sharedMesh(G.pyramid, MAT.base),
      sharedMesh(G.pyramidGold, SHRINE_GOLD, false),
      sharedMesh(G.obelisks, MAT.base),
      sharedMesh(G.obeliskTips, SHRINE_GOLD, false),
    );
    for (const m of G.murals) {
      const mat = muralMaterial(muralTexture(m.id as MuralId));
      this.muralMats.push(mat);
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.renderOrder = 2;
      this.pyramid.add(mesh);
    }
    this.capstone = sharedMesh(G.capstone, SHRINE_GOLD);

    this.temple = new THREE.Group();
    this.friezeMat = muralMaterial(friezeTexture());
    const frieze = new THREE.Mesh(G.frieze, this.friezeMat);
    frieze.renderOrder = 2;
    this.temple.add(
      sharedMesh(G.colBases, MAT.base),
      sharedMesh(G.colShafts, MAT.base),
      sharedMesh(G.templeRing, MAT.base),
      sharedMesh(G.templeGold, SHRINE_GOLD, false),
      frieze,
    );
    this.crown = new THREE.Group();
    const sun = new THREE.Mesh(G.sun, SHRINE_SUN);
    sun.position.y = SHRINE.crown.orb - SHRINE.crown.cap;
    this.orbitA = new THREE.Mesh(G.orbitA, SHRINE_GOLD);
    this.orbitB = new THREE.Mesh(G.orbitB, SHRINE_GOLD);
    for (const o of [this.orbitA, this.orbitB]) o.position.y = sun.position.y;
    this.crown.add(sun, this.orbitA, this.orbitB);
    this.beam = new THREE.Mesh(G.beam, SHRINE_BEAM);
    this.beam.position.y = SHRINE.crown.orb;
    this.beam.frustumCulled = false;
    this.temple.add(this.crown, this.beam);

    this.group.add(this.totemFloor, this.totem, this.courtEarth, this.courtPaved, this.inlay, this.stones, this.pyramid, this.capstone, this.temple);
    this.show(false);
  }

  get ringRadius(): number {
    return Math.max(LAYOUT[this.stage].ring, this.building ? LAYOUT[this.building].ring : 0);
  }

  get solidRadius(): number {
    return LAYOUT[this.stage].solid;
  }

  get topHeight(): number {
    return LAYOUT[this.stage].top;
  }

  get pickRadius(): number {
    return LAYOUT[this.stage].pick;
  }

  /** Height prayers rise from. */
  get motesHeight(): number {
    return LAYOUT[this.stage].motes;
  }

  /** Where the fire burns (local space): the pit before the totem, then the bowls on the pylon towers. */
  firePoints(): [number, number, number][] {
    if (stageIndex(this.stage) < stageIndex('pyramid')) return [[0, 0.8, 4.2]];
    const y = SHRINE.pyr.y + 4.42;
    const z = SHRINE.pyr.hw + 0.05;
    return [
      [-1.75, y, z],
      [1.75, y, z],
    ];
  }

  /** Switch to `stage`. `animate`: it is happening now (not a load), so let the new age arrive. */
  setStage(stage: ShrineStage, animate: boolean) {
    const from = this.stage;
    this.stage = stage;
    if (!animate || from === stage) {
      this.stonesT = this.muralT = this.crownT = -1;
      this.show(false);
      return;
    }
    if (stage === 'stone_circle') this.stonesT = 0;
    if (stage === 'pyramid' || stage === 'temple') this.muralT = 0;
    if (stage === 'temple') this.crownT = 0;
    this.show(true);
  }

  private show(animating: boolean) {
    const i = stageIndex(this.stage);
    this.totemFloor.visible = i === 0;
    this.totem.visible = i <= 1;
    this.courtEarth.visible = i === 1;
    this.courtPaved.visible = i >= 2;
    this.inlay.visible = i >= 2;
    this.stones.visible = i >= 1;
    this.pyramid.visible = i >= 2;
    this.capstone.visible = i >= 2;
    this.temple.visible = i >= 3;
    if (!animating) {
      this.stones.position.y = 0;
      for (const m of this.muralMats) m.opacity = 1;
      this.friezeMat.opacity = 1;
      this.crown.scale.setScalar(1);
    }
    this.placeCapstone(i >= 3 ? 1 : 0);
  }

  /** 0: seated on the pyramid; 1: lifted to hang over the little sun. */
  private placeCapstone(k: number) {
    const y = CAPSTONE_Y + (SHRINE.crown.cap - CAPSTONE_Y) * smoothstep(0, 1, k);
    this.capstone.position.y = y;
  }

  /** Per rendered frame (real seconds): the arrivals, the crown turning, the beam at night. */
  frame(dt: number, night: number) {
    this.t += dt;
    const glow = 0.45 + night * 1.1;
    for (const m of this.muralMats) m.emissiveIntensity = glow;
    this.friezeMat.emissiveIntensity = glow;
    if (this.stonesT >= 0) {
      this.stonesT += dt;
      const k = clamp(this.stonesT / STONES_RISE, 0, 1);
      // They come up out of the earth, slowing as they settle.
      this.stones.position.y = -5.6 * (1 - smoothstep(0, 1, k)) ** 1.4;
      if (k >= 1) this.stonesT = -1;
    }
    if (this.muralT >= 0) {
      this.muralT += dt;
      const k = smoothstep(0, 1, clamp((this.muralT - 0.6) / MURAL_FADE, 0, 1));
      // On a new temple the pyramid's murals are already there; only the frieze arrives.
      if (this.stage === 'pyramid') for (const m of this.muralMats) m.opacity = k;
      this.friezeMat.opacity = this.stage === 'temple' ? k : 1;
      if (this.muralT >= MURAL_FADE + 0.6) this.muralT = -1;
    }
    let crownK = 1;
    if (this.crownT >= 0) {
      this.crownT += dt;
      crownK = clamp(this.crownT / CROWN_RISE, 0, 1);
      if (crownK >= 1) this.crownT = -1;
    }
    if (this.stage === 'temple') {
      const lift = smoothstep(0, 0.7, crownK);
      this.placeCapstone(lift);
      this.capstone.position.y += Math.sin(this.t * 0.8) * 0.12 * lift;
      this.capstone.rotation.y = this.t * 0.25;
      const open = smoothstep(0.35, 1, crownK);
      this.crown.scale.setScalar(0.001 + open);
      this.crown.position.y = SHRINE.crown.cap + Math.sin(this.t * 0.8) * 0.12;
      this.orbitA.rotation.set(1.2 + Math.sin(this.t * 0.3) * 0.08, this.t * 0.45, 0.35);
      this.orbitB.rotation.set(1.9, -this.t * 0.32, -0.4 + Math.cos(this.t * 0.27) * 0.08);
      this.beam.visible = night > 0.05;
      this.beam.scale.set(1, open, 1);
    }
  }
}

/**
 * Shared glow for every shrine: gold warms at dusk and glows at night, the beam shows only in the dark.
 * Called once per frame by the shrines plugin.
 */
export function shrineGlow(night: number, t: number) {
  SHRINE_GOLD.emissiveIntensity = 0.22 + night * 0.95 + Math.sin(t * 1.3) * 0.03;
  SHRINE_SUN.emissiveIntensity = 1.8 + night * 1.6 + Math.sin(t * 2.1) * 0.25;
  SHRINE_BEAM.uniforms.uOpacity.value = night * 0.42 * (0.85 + Math.sin(t * 0.7) * 0.15);
}
