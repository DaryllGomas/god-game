import * as THREE from 'three';
import type { Terrain } from '../world/Terrain';
import { clamp, damp } from '../util/math';

const MIN_DIST = 14;
const MAX_DIST = 720;
const MIN_PITCH = 0.22;
const MAX_PITCH = 1.48;
const BOUND = 520;

/**
 * Orbit camera around a ground focus point. Supports B&W-style "grab the land"
 * dragging: the world point under the cursor stays pinned to the cursor.
 */
export class GodCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  yaw = 0.5;
  pitch = 0.85;
  distance = 130;

  private readonly goal = { target: new THREE.Vector3(), yaw: 0.5, pitch: 0.85, distance: 130 };
  private readonly grabPoint = new THREE.Vector3();
  private grabbing = false;
  private shakeAmt = 0;
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.5, 9000);
  }

  jumpTo(x: number, z: number, terrain: Terrain) {
    this.target.set(x, terrain.surfaceAt(x, z), z);
    this.goal.target.copy(this.target);
    this.apply(terrain);
  }

  flyTo(x: number, z: number) {
    this.goal.target.set(x, this.goal.target.y, z);
  }

  beginGrab(point: THREE.Vector3) {
    this.grabPoint.copy(point);
    this.grabbing = true;
  }

  endGrab() {
    this.grabbing = false;
  }

  get isGrabbing() {
    return this.grabbing;
  }

  /** Keep `grabPoint` under the cursor ray. */
  dragGrab(ray: THREE.Ray) {
    if (!this.grabbing) return;
    this.plane.set(new THREE.Vector3(0, 1, 0), -this.grabPoint.y);
    if (ray.direction.y > -0.02) return;
    if (!ray.intersectPlane(this.plane, this.hit)) return;
    let dx = this.grabPoint.x - this.hit.x;
    let dz = this.grabPoint.z - this.hit.z;
    const maxStep = this.distance * 0.6;
    const len = Math.hypot(dx, dz);
    if (len > maxStep) {
      dx *= maxStep / len;
      dz *= maxStep / len;
    }
    this.panBy(dx, dz);
  }

  panBy(dx: number, dz: number) {
    this.target.x = clamp(this.target.x + dx, -BOUND, BOUND);
    this.target.z = clamp(this.target.z + dz, -BOUND, BOUND);
    this.goal.target.x = this.target.x;
    this.goal.target.z = this.target.z;
  }

  /** Pan relative to the view direction (keyboard). */
  panLocal(right: number, forward: number) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.goal.target.x = clamp(this.goal.target.x + c * right - s * forward, -BOUND, BOUND);
    this.goal.target.z = clamp(this.goal.target.z - s * right - c * forward, -BOUND, BOUND);
  }

  rotate(dYaw: number, dPitch: number) {
    this.goal.yaw += dYaw;
    this.goal.pitch = clamp(this.goal.pitch + dPitch, MIN_PITCH, MAX_PITCH);
  }

  /** factor < 1 zooms in. Zooming pulls the focus toward `toward` so you zoom to the cursor. */
  zoom(factor: number, toward?: THREE.Vector3) {
    const before = this.goal.distance;
    this.goal.distance = clamp(before * factor, MIN_DIST, MAX_DIST);
    const actual = this.goal.distance / before;
    if (toward) {
      const k = 1 - actual;
      this.goal.target.x = clamp(this.goal.target.x + (toward.x - this.goal.target.x) * k, -BOUND, BOUND);
      this.goal.target.z = clamp(this.goal.target.z + (toward.z - this.goal.target.z) * k, -BOUND, BOUND);
    }
  }

  setDistance(d: number) {
    this.goal.distance = clamp(d, MIN_DIST, MAX_DIST);
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(2, this.shakeAmt + amount);
  }

  update(dt: number, terrain: Terrain) {
    const k = damp(9, dt);
    if (!this.grabbing) {
      this.target.x += (this.goal.target.x - this.target.x) * k;
      this.target.z += (this.goal.target.z - this.target.z) * k;
    }
    this.yaw += (this.goal.yaw - this.yaw) * damp(12, dt);
    this.pitch += (this.goal.pitch - this.pitch) * damp(12, dt);
    this.distance += (this.goal.distance - this.distance) * damp(10, dt);
    const groundY = terrain.surfaceAt(this.target.x, this.target.z);
    this.target.y += (groundY - this.target.y) * damp(4, dt);
    this.goal.target.y = this.target.y;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    this.apply(terrain);
  }

  private apply(terrain: Terrain) {
    const cp = Math.cos(this.pitch);
    const cam = this.camera;
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const floor = terrain.surfaceAt(cam.position.x, cam.position.z) + 3;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.02;
      cam.rotation.x += (Math.random() - 0.5) * s;
      cam.rotation.y += (Math.random() - 0.5) * s;
    }
    cam.updateMatrixWorld();
  }
}
