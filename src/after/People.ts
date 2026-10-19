import * as THREE from 'three';
import { WALKER_MAT, walkerGeometry } from '../land/VillageDecor';

/** The people of Telor: the three villages' colours and two of the city's own (navy, cream), as in src/nexus/Telor.ts. */
export const TUNICS = [0x3f6fc4, 0xc4803f, 0x7a4fb0, 0x2c3e6a, 0xe8dcc0];

export interface Person {
  look: number;
  i: number;
}

/**
 * The after-loop's people (festival crowds, newcomers off the boats): one instanced mesh per look, the same little
 * walkers as Telor's streets (their legs and arms swing in the shader, per instance). Slots are taken and given back;
 * a look with nobody out is not drawn at all, so between festivals this costs nothing.
 */
export class People {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly swing: THREE.InstancedBufferAttribute[] = [];
  private readonly free: number[][] = [];
  private readonly used: number[] = [];
  private readonly dirty: boolean[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly SIDE = new THREE.Vector3(1, 0, 0);

  constructor(group: THREE.Group, perLook: number) {
    TUNICS.forEach((tunic, k) => {
      const geo = walkerGeometry(7400 + k * 17, tunic);
      const sw = new THREE.InstancedBufferAttribute(new Float32Array(perLook), 1);
      sw.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aSwing', sw);
      const mesh = new THREE.InstancedMesh(geo, WALKER_MAT, perLook);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < perLook; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      mesh.visible = false;
      mesh.name = `after-people-${k}`;
      group.add(mesh);
      this.meshes.push(mesh);
      this.swing.push(sw);
      this.free.push(Array.from({ length: perLook }, (_, i) => perLook - 1 - i));
      this.used.push(0);
      this.dirty.push(false);
    });
  }

  /** A person in look `look` (or the next look with room), or null if everyone is out. */
  take(look: number): Person | null {
    for (let n = 0; n < TUNICS.length; n++) {
      const k = (look + n) % TUNICS.length;
      const i = this.free[k].pop();
      if (i === undefined) continue;
      this.used[k]++;
      this.meshes[k].visible = true;
      return { look: k, i };
    }
    return null;
  }

  release(p: Person | null) {
    if (!p) return;
    this.meshes[p.look].setMatrixAt(p.i, this.m.makeScale(0, 0, 0));
    this.dirty[p.look] = true;
    this.free[p.look].push(p.i);
    this.used[p.look] = Math.max(0, this.used[p.look] - 1);
  }

  /** Stand `p` at (x, y, z) facing `yaw`, legs swinging `swing` (0..1), at `scale`, leaning back `tilt` (looking up). */
  set(p: Person, x: number, y: number, z: number, yaw: number, swing: number, scale = 1, tilt = 0) {
    this.q.setFromAxisAngle(People.UP, yaw);
    if (tilt) this.q.multiply(this.tilt.setFromAxisAngle(People.SIDE, -tilt));
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(Math.max(0.0001, scale)));
    this.meshes[p.look].setMatrixAt(p.i, this.m);
    this.swing[p.look].setX(p.i, swing);
    this.dirty[p.look] = true;
  }

  /** Upload what moved this frame; a look with nobody out is hidden. */
  flush() {
    for (let k = 0; k < this.meshes.length; k++) {
      if (!this.dirty[k]) continue;
      this.dirty[k] = false;
      this.meshes[k].instanceMatrix.needsUpdate = true;
      this.swing[k].needsUpdate = true;
      this.meshes[k].visible = this.used[k] > 0;
    }
  }

  /** How many are out (for tests). */
  get out(): number {
    return this.used.reduce((a, b) => a + b, 0);
  }
}
