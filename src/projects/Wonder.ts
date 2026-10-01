import * as THREE from 'three';
import { MAT } from '../art/Models';
import { ownedMesh } from '../entities/Entity';
import { clamp, smoothstep } from '../util/math';
import {
  BEAM,
  CRYSTAL,
  RUNE_OFF,
  RUNE_ON,
  WONDER,
  crystalGeometry,
  scaffoldModel,
  wonderCapGeometry,
  wonderDaisGeometry,
  wonderLintelGeometry,
  wonderRuneGeometry,
  wonderSpireGeometry,
  wonderStoneGeometry,
  wonderStoneHeight,
} from './ProjectModels';

interface StoneParts {
  group: THREE.Group;
  stone: THREE.Mesh;
  rune: THREE.Mesh;
  /** Progress at which it starts to rise, and at which its rune lights. */
  from: number;
  lit: number;
}

interface SpireParts {
  group: THREE.Group;
  drum: THREE.Mesh;
  rune: THREE.Mesh;
  from: number;
  lit: number;
}

interface LintelParts {
  mesh: THREE.Mesh;
  /** The stone it rests on (index of the later one of its pair). */
  after: number;
}

/**
 * The Wonder: a ring of twelve standing stones round a tall spire, on a stepped dais. It rises
 * piece by piece with progress; each stone and spire band lights its runes as it goes, and the
 * finished monument crowns itself with a floating crystal and a soft column of light.
 */
export class WonderVisual {
  readonly group = new THREE.Group();
  private readonly scaffold: THREE.Mesh;
  private readonly dais: THREE.Mesh;
  private readonly stones: StoneParts[] = [];
  private readonly lintels: LintelParts[] = [];
  private readonly spire: SpireParts[] = [];
  private readonly cap: THREE.Mesh;
  private readonly crystal: THREE.Mesh;
  private readonly shards: THREE.Mesh[] = [];
  private readonly beam: THREE.Mesh;
  private t = 0;
  /** Number of runes currently lit, for the UI. */
  litRunes = 0;
  readonly totalRunes = WONDER.stones + WONDER.spireSegments;

  constructor() {
    this.scaffold = ownedMesh(scaffoldModel(21.5, 11, 8), MAT.base);
    this.dais = ownedMesh(wonderDaisGeometry(), MAT.base);
    this.group.add(this.scaffold, this.dais);

    const n = WONDER.stones;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const group = new THREE.Group();
      group.position.set(Math.cos(a) * WONDER.ringRadius, WONDER.daisTop, Math.sin(a) * WONDER.ringRadius);
      group.rotation.y = Math.PI / 2 - a;
      const stone = ownedMesh(wonderStoneGeometry(i), MAT.base);
      const rune = ownedMesh(wonderRuneGeometry(i), RUNE_OFF, false);
      group.add(stone, rune);
      this.group.add(group);
      this.stones.push({ group, stone, rune, from: 0.05 + i * 0.04, lit: 0.12 + i * 0.045 });
    }
    // Lintels across each pair of stones.
    const lin = wonderLintelGeometry();
    for (let k = 0; k < n / 2; k++) {
      const a0 = ((2 * k) / n) * Math.PI * 2;
      const a1 = ((2 * k + 1) / n) * Math.PI * 2;
      const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * WONDER.ringRadius;
      const mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * WONDER.ringRadius;
      const mesh = ownedMesh(lin.geo.clone(), MAT.base);
      mesh.position.set(mx, WONDER.daisTop + wonderStoneHeight(2 * k) + 0.55, mz);
      mesh.rotation.y = -Math.atan2(Math.sin(a1) - Math.sin(a0), Math.cos(a1) - Math.cos(a0));
      this.group.add(mesh);
      this.lintels.push({ mesh, after: 2 * k + 1 });
    }

    // The spire: drums stacked on the podium.
    let y = WONDER.daisTop + 1.6;
    for (let j = 0; j < WONDER.spireSegments; j++) {
      const g = wonderSpireGeometry(j);
      const group = new THREE.Group();
      group.position.y = y;
      const drum = ownedMesh(g.drum, MAT.base);
      const rune = ownedMesh(g.runes, RUNE_OFF, false);
      group.add(drum, rune);
      this.group.add(group);
      this.spire.push({ group, drum, rune, from: 0.3 + j * 0.095, lit: 0.37 + j * 0.095 });
      y += WONDER.segmentHeight;
    }
    this.cap = ownedMesh(wonderCapGeometry(), MAT.base);
    this.cap.position.y = y;
    this.group.add(this.cap);

    this.crystal = ownedMesh(crystalGeometry(1.7), CRYSTAL, false);
    this.crystal.position.y = y + 5.2;
    this.group.add(this.crystal);
    for (let i = 0; i < 5; i++) {
      const s = ownedMesh(crystalGeometry(0.55), CRYSTAL, false);
      this.shards.push(s);
      this.group.add(s);
    }
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.4, 160, 16, 1, true), BEAM);
    this.beam.userData.ownsGeometry = true;
    this.beam.position.y = y + 5.2 + 80;
    this.beam.renderOrder = 5;
    this.group.add(this.beam);
    this.topY = y + 5.2;
  }

  /** World-space height of the crystal above the site origin. */
  readonly topY: number;

  /**
   * `p` is the eased progress 0..1. Returns true on the frame a new rune lights, so the caller can chime.
   */
  update(dt: number, p: number, complete: boolean, night: number): boolean {
    this.t += dt;
    const prevLit = this.litRunes;
    let lit = 0;
    const q = complete ? 1.01 : p;

    this.scaffold.visible = !complete && p < 0.995;
    this.dais.visible = q > 0.012;

    for (const s of this.stones) {
      const grow = complete ? 1 : smoothstep(s.from, s.from + 0.05, q);
      s.group.visible = grow > 0.001;
      s.stone.scale.y = Math.max(0.02, grow);
      const on = grow >= 1 && q >= s.lit;
      s.rune.visible = grow >= 1;
      s.rune.material = on ? RUNE_ON : RUNE_OFF;
      if (on) lit++;
    }
    for (const l of this.lintels) {
      const need = this.stones[l.after].from + 0.06;
      const grow = complete ? 1 : smoothstep(need, need + 0.04, q);
      l.mesh.visible = grow > 0.001;
      l.mesh.scale.set(1, grow, 1);
    }
    for (const s of this.spire) {
      const grow = complete ? 1 : smoothstep(s.from, s.from + 0.08, q);
      s.group.visible = grow > 0.001;
      s.drum.scale.y = Math.max(0.02, grow);
      const on = grow >= 1 && q >= s.lit;
      s.rune.visible = grow >= 1;
      s.rune.material = on ? RUNE_ON : RUNE_OFF;
      if (on) lit++;
    }
    this.cap.visible = complete || q > 0.92;
    const crowned = complete;
    this.crystal.visible = crowned;
    this.beam.visible = crowned;
    for (const s of this.shards) s.visible = crowned;
    if (crowned) {
      this.crystal.position.y = this.topY + Math.sin(this.t * 1.1) * 0.5;
      this.crystal.rotation.y = this.t * 0.6;
      this.shards.forEach((s, i) => {
        const a = this.t * 0.35 + (i / this.shards.length) * Math.PI * 2;
        s.position.set(Math.cos(a) * 7.5, this.topY - 14 + Math.sin(this.t * 0.9 + i * 1.7) * 2.2 + i * 2.5, Math.sin(a) * 7.5);
        s.rotation.y = this.t * 1.2 + i;
      });
      BEAM.opacity = clamp(0.025 + night * 0.04 + Math.sin(this.t * 0.8) * 0.006, 0.02, 0.08);
    }
    this.litRunes = lit;
    return lit > prevLit;
  }

  /** Where a rune is lighting, for sparkles (the top of the most recently lit stone/segment). */
  litPoint(out: THREE.Vector3): THREE.Vector3 {
    const n = this.litRunes;
    if (n <= WONDER.stones) {
      const i = Math.max(0, n - 1);
      const g = this.stones[i % this.stones.length].group;
      return out.set(g.position.x, g.position.y + wonderStoneHeight(i) * 0.55, g.position.z);
    }
    const g = this.spire[Math.min(this.spire.length - 1, n - WONDER.stones - 1)].group;
    return out.set(0, g.position.y + 2.5, 0);
  }
}
