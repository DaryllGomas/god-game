import * as THREE from 'three';
import type { Game } from '../Game';
import type { Site } from '../projects/Site';
import { ownedMesh, sharedMesh } from '../entities/Entity';
import { MAT, foodHeapGeometry, logStackGeometry } from '../art/Models';
import { scaffoldModel, stoneHeapGeometry } from '../projects/ProjectModels';
import { clamp } from '../util/math';
import type { Res } from '../projects/defs';
import type { ShrineStage } from './stages';
import { SHAFT_Y0, SHRINE, columnBasesGeometry, columnShaftsGeometry, plinthGeometry, pyramidGeometry, templeRingGeometry } from './ShrineModels';

const logsGeo = logStackGeometry();
const foodGeo = foodHeapGeometry();
const stonesGeo = stoneHeapGeometry();

let parts: { plinth: THREE.BufferGeometry; pyramid: THREE.BufferGeometry; bases: THREE.BufferGeometry; shafts: THREE.BufferGeometry; ring: THREE.BufferGeometry } | null = null;

/**
 * The next age going up at the prayer place, as a village project's site: stakes and scaffold, heaps
 * of what has been delivered, and the pyramid (or the temple's columns) rising as the work goes on.
 * The village's WorshipSite keeps drawing the age that stands until the work is done, then takes over.
 * Same contract as Site's own visuals (a group, and an update with the eased progress).
 */
export class ShrineBuildVisual {
  readonly group = new THREE.Group();
  private readonly scaffold: THREE.Mesh;
  private readonly base: THREE.Mesh;
  private readonly upper: THREE.Mesh;
  private readonly ring: THREE.Mesh | null;
  private readonly heaps: Record<Res, THREE.Mesh>;
  private readonly lift: number;

  constructor(
    readonly stage: ShrineStage,
    radius: number,
    height: number,
  ) {
    const P = (parts ??= {
      plinth: plinthGeometry(),
      pyramid: pyramidGeometry(),
      bases: columnBasesGeometry(),
      shafts: columnShaftsGeometry(),
      ring: templeRingGeometry(),
    });
    const temple = stage === 'temple';
    this.scaffold = ownedMesh(scaffoldModel(radius, height * 0.62, temple ? 8 : 6), MAT.base);
    this.base = sharedMesh(temple ? P.bases : P.plinth, MAT.base);
    this.upper = sharedMesh(temple ? P.shafts : P.pyramid, MAT.base);
    // Scale the rising part from its foot: the shafts stand on their bases, the pyramid on its plinth.
    this.lift = temple ? SHAFT_Y0 : SHRINE.pyr.y;
    this.ring = temple ? sharedMesh(P.ring, MAT.base) : null;
    this.group.add(this.scaffold, this.base, this.upper);
    if (this.ring) this.group.add(this.ring);

    const edge = radius * 0.95 + 2.2;
    const mk = (geo: THREE.BufferGeometry, angle: number) => {
      const m = sharedMesh(geo, MAT.base);
      m.position.set(Math.cos(angle) * edge, 0, Math.sin(angle) * edge);
      m.rotation.y = angle * 2;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    // Heaps at the back and sides, clear of the way in (+z).
    this.heaps = { wood: mk(logsGeo, 3.6), stone: mk(stonesGeo, 4.7), food: mk(foodGeo, 5.8) };
  }

  update(_game: Game, site: Site, _dt: number, shown: number) {
    const done = site.complete;
    this.scaffold.visible = !done;
    this.base.visible = true;
    this.upper.visible = done || shown >= 0.08;
    const rise = done ? 1 : clamp((shown - 0.08) / 0.92, 0.03, 1);
    // Scale about the foot of the rising part.
    this.upper.scale.y = rise;
    this.upper.position.y = this.lift * (1 - rise);
    if (this.ring) this.ring.visible = done || shown >= 0.9;
    for (const res of ['wood', 'stone', 'food'] as Res[]) {
      const need = site.def.needs[res];
      const have = site.have[res];
      const h = this.heaps[res];
      h.visible = !done && need > 0 && have > 0.5;
      if (h.visible) h.scale.setScalar(0.6 + 1.0 * clamp(have / need, 0, 1));
    }
  }
}
