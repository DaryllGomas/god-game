import * as THREE from 'three';

/** One static candidate: position, spin, per-axis scale and a tint index. */
export interface ScatterItem {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  tint: number;
}

/**
 * A big static scatter of one geometry (trees, shrubs, rocks, ...), drawn as a single InstancedMesh.
 * Only the items near the camera target are written into the instance buffer (`update`), so distant clutter
 * costs nothing and the draw call stays small; the set is rebuilt only when the view moves or changes.
 */
export class ScatterSet {
  readonly mesh: THREE.InstancedMesh;
  readonly items: ScatterItem[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private lastX = 1e9;
  private lastZ = 1e9;
  private lastR = -1;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, items: ScatterItem[], private readonly tints: THREE.Color[], name: string) {
    this.items = items;
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    this.mesh.count = 0;
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, tints[0]);
    scene.add(this.mesh);
  }

  /** Draw the items within `radius` of (cx, cz); radius <= 0 hides the set. Cheap when nothing changed. */
  update(cx: number, cz: number, radius: number) {
    if (radius <= 0) {
      this.mesh.visible = false;
      this.lastR = -1;
      return;
    }
    this.mesh.visible = true;
    const moved = Math.hypot(cx - this.lastX, cz - this.lastZ);
    if (moved < radius * 0.04 && Math.abs(radius - this.lastR) < radius * 0.06) return;
    this.lastX = cx;
    this.lastZ = cz;
    this.lastR = radius;
    const r2 = radius * radius;
    let n = 0;
    for (const it of this.items) {
      const dx = it.x - cx;
      const dz = it.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      this.e.set(0, it.yaw, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(it.x, it.y, it.z), this.q, this.s.set(it.sx, it.sy, it.sz));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.tints[it.tint % this.tints.length]);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Force a rebuild on the next update (after the items themselves changed). */
  invalidate() {
    this.lastR = -1;
    this.lastX = 1e9;
  }
}
