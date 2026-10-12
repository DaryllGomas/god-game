import * as THREE from 'three';

/** A growable set of instances of one geometry: write transforms, then flush once per change. */
export class InstanceSet {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  n = 0;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly capacity: number, shadows = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  clear() {
    this.n = 0;
  }

  push(x: number, y: number, z: number, yaw: number, scale: number, tint?: THREE.Color) {
    if (this.n >= this.capacity) return;
    this.e.set(0, yaw, 0);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(this.n, this.m);
    if (tint) this.mesh.setColorAt(this.n, tint);
    this.n++;
  }

  /** Like push, but also pitched about the instance's local z axis (a fence rail climbing a slope). */
  pushTilted(x: number, y: number, z: number, yaw: number, pitch: number, scale: number) {
    if (this.n >= this.capacity) return;
    this.e.set(0, yaw, pitch, 'YXZ');
    this.q.setFromEuler(this.e);
    this.e.order = 'XYZ';
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(this.n, this.m);
    this.n++;
  }

  flush() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
