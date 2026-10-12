import { WORLD_SIZE } from '../config';
import { LAND_RES } from './groundLook';
import type { Path } from './Roads';

const K = LAND_RES / WORLD_SIZE; // texels per metre
const idxOf = (x: number, z: number) => ({ u: (x + WORLD_SIZE / 2) * K, v: (z + WORLD_SIZE / 2) * K });

/** Channel offsets into the RGBA mask. */
export const CH_PATH = 0;
export const CH_FLOOR = 1;
export const CH_WORN = 2;

/** CPU painter for the land mask: soft discs and soft-edged capsules, combined with max. */
export class LandPainter {
  readonly data = new Uint8Array(LAND_RES * LAND_RES * 4);

  clear() {
    this.data.fill(0);
  }

  copyFrom(o: LandPainter) {
    this.data.set(o.data);
  }

  private put(i: number, ch: number, v: number) {
    const o = i * 4 + ch;
    const b = v * 255;
    if (b > this.data[o]) this.data[o] = b;
  }

  /** Soft disc: full inside `r * core`, falling smoothly to 0 at `r`. */
  disc(x: number, z: number, r: number, ch: number, strength = 1, core = 0.4) {
    const { u, v } = idxOf(x, z);
    const rp = r * K;
    const x0 = Math.max(0, Math.floor(u - rp));
    const x1 = Math.min(LAND_RES - 1, Math.ceil(u + rp));
    const z0 = Math.max(0, Math.floor(v - rp));
    const z1 = Math.min(LAND_RES - 1, Math.ceil(v + rp));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i + 0.5 - u, j + 0.5 - v) / rp;
        if (d >= 1) continue;
        const t = d <= core ? 1 : 1 - (d - core) / (1 - core);
        this.put(j * LAND_RES + i, ch, strength * t * t * (3 - 2 * t));
      }
    }
  }

  /** Soft capsule along a polyline: full on the centre line out to `width * core`, fading to 0 at `width` (metres, half width). */
  path(p: Path, width: number, ch: number, strength = 1, core = 0.3) {
    for (let s = 0; s < p.length - 1; s++) this.segment(p[s].x, p[s].z, p[s + 1].x, p[s + 1].z, width, ch, strength, core);
  }

  private segment(ax: number, az: number, bx: number, bz: number, width: number, ch: number, strength: number, core: number) {
    const a = idxOf(ax, az);
    const b = idxOf(bx, bz);
    const wp = width * K;
    const x0 = Math.max(0, Math.floor(Math.min(a.u, b.u) - wp));
    const x1 = Math.min(LAND_RES - 1, Math.ceil(Math.max(a.u, b.u) + wp));
    const z0 = Math.max(0, Math.floor(Math.min(a.v, b.v) - wp));
    const z1 = Math.min(LAND_RES - 1, Math.ceil(Math.max(a.v, b.v) + wp));
    const dx = b.u - a.u;
    const dz = b.v - a.v;
    const len2 = Math.max(dx * dx + dz * dz, 1e-6);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const px = i + 0.5 - a.u;
        const pz = j + 0.5 - a.v;
        const t = Math.min(1, Math.max(0, (px * dx + pz * dz) / len2));
        const d = Math.hypot(px - dx * t, pz - dz * t) / wp;
        if (d >= 1) continue;
        const f = d <= core ? 1 : 1 - (d - core) / (1 - core);
        this.put(j * LAND_RES + i, ch, strength * f * f * (3 - 2 * f));
      }
    }
  }
}
