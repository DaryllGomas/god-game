import * as THREE from 'three';

/**
 * A few flocks of gulls circling over the island: one InstancedMesh, flapped in the vertex shader
 * (wing tips move, phase per bird), placed on the CPU along slow circles with a little drift.
 */
const FLOCKS = 4;
const PER_FLOCK = 8;
const COUNT = FLOCKS * PER_FLOCK;

interface Flock {
  cx: number;
  cz: number;
  r: number;
  h: number;
  w: number;
  a0: number;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly uTime = { value: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly tmp = new THREE.Color();
  private readonly phase = new Float32Array(COUNT);

  constructor(scene: THREE.Scene, centers: { x: number; z: number }[]) {
    // A wedge body and two wings (triangles), +z is forward; the shader lifts wing tips by |x|.
    const pos = new Float32Array([
      0, 0, 0.55, -0.12, 0, -0.3, 0.12, 0, -0.3, // body
      -0.1, 0, 0.15, -1, 0, -0.2, -0.1, 0, -0.25, // left wing
      0.1, 0, 0.15, 0.1, 0, -0.25, 1, 0, -0.2, // right wing
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.phase, 1));
    for (let i = 0; i < COUNT; i++) this.phase[i] = Math.random() * 6.28;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xf4ecda, side: THREE.DoubleSide, fog: true });
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += abs(position.x) * sin(uTime * 7.0 + aPhase) * 0.55;');
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    const cs = centers.length ? centers : [{ x: 0, z: 0 }];
    for (let f = 0; f < FLOCKS; f++) {
      const c = cs[f % cs.length];
      this.flocks.push({
        cx: c.x + (Math.random() - 0.5) * 80,
        cz: c.z + (Math.random() - 0.5) * 80,
        r: 28 + Math.random() * 30,
        h: 34 + Math.random() * 16,
        w: (0.16 + Math.random() * 0.1) * (f % 2 ? 1 : -1),
        a0: Math.random() * 6.28,
      });
    }
  }

  /** `groundAt` keeps them a safe height above hills; `daylight` dims them at night. */
  update(time: number, daylight: number, groundAt: (x: number, z: number) => number) {
    this.uTime.value = time;
    this.mat.color.copy(this.tmp.set(0xf4ecda)).multiplyScalar(0.3 + 0.7 * daylight);
    let i = 0;
    for (let f = 0; f < FLOCKS; f++) {
      const fl = this.flocks[f];
      for (let b = 0; b < PER_FLOCK; b++, i++) {
        const a = fl.a0 + time * fl.w + b * 0.33 + Math.sin(b * 12.9) * 0.2;
        const r = fl.r * (1 + 0.12 * Math.sin(b * 3.1 + time * 0.2)) + Math.sin(b * 5.7) * 4;
        const x = fl.cx + Math.cos(a) * r + Math.sin(time * 0.05 + f) * 14;
        const z = fl.cz + Math.sin(a) * r;
        const y = Math.max(fl.h, groundAt(x, z) + 14) + Math.sin(time * 0.6 + b * 1.7) * 1.5 + b * 0.5;
        // Heading is the circle's tangent; bank into the turn.
        const dir = Math.sign(fl.w);
        const yaw = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
        this.q.setFromAxisAngle(this.up, yaw);
        const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.35 * dir);
        this.q.multiply(bank);
        this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(2.3));
        this.mesh.setMatrixAt(i, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
