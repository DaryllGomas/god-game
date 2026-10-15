/**
 * The shape of your light on the ground (2026-10-14, progression). Each village of yours casts an egg: a round part
 * around the village and a tip that leans along the road toward the nearest village that isn't yours yet, as far as
 * the village's reach has grown. A village your light touches gets its own round patch that widens with its belief.
 *
 * Every shape is an "uneven capsule": a circle (a, ra) joined smoothly to a smaller circle (b, rb). With rb < 0 it is
 * just the circle (a, ra). The terrain shader (src/world/Terrain.ts) draws the same signed distance, so what the
 * hand may touch (Game.inInfluence) is exactly the gold you see.
 */
export interface LightShape {
  ax: number;
  az: number;
  ra: number;
  bx: number;
  bz: number;
  rb: number;
}

export function circle(x: number, z: number, r: number): LightShape {
  return { ax: x, az: z, ra: r, bx: x, bz: z, rb: -1 };
}

/** Signed distance from (x, z) to the shape's edge: negative inside. Mirrors LIGHT_SDF_GLSL. */
export function lightSdf(s: LightShape, x: number, z: number): number {
  const px = x - s.ax;
  const pz = z - s.az;
  if (s.rb < 0) return Math.hypot(px, pz) - s.ra;
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const h = Math.hypot(dx, dz);
  if (h <= Math.abs(s.ra - s.rb) + 1e-3) return Math.min(Math.hypot(px, pz) - s.ra, Math.hypot(x - s.bx, z - s.bz) - s.rb);
  const ux = dx / h;
  const uz = dz / h;
  const py = px * ux + pz * uz;
  const qx = Math.abs(px * uz - pz * ux);
  const b = (s.ra - s.rb) / h;
  const a = Math.sqrt(1 - b * b);
  const k = -b * qx + a * py;
  if (k < 0) return Math.hypot(qx, py) - s.ra;
  if (k > a * h) return Math.hypot(qx, py - h) - s.rb;
  return qx * a + py * b - s.ra;
}

/** The union of shapes: the smallest signed distance. */
export function lightSdfAll(shapes: readonly LightShape[], x: number, z: number): number {
  let d = Infinity;
  for (const s of shapes) d = Math.min(d, lightSdf(s, x, z));
  return d;
}

/** How far the edge of `s` lies from its centre, walking toward (tx, tz) (for paths that start at the ring). */
export function edgeToward(s: LightShape, tx: number, tz: number): number {
  const dx = tx - s.ax;
  const dz = tz - s.az;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return s.ra;
  const ux = dx / d;
  const uz = dz / d;
  let lo = 0;
  let hi = Math.max(s.ra, Math.hypot(s.bx - s.ax, s.bz - s.az) + Math.max(0, s.rb)) + 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (lightSdf(s, s.ax + ux * m, s.az + uz * m) < 0) lo = m;
    else hi = m;
  }
  return lo;
}

/** GLSL twin of lightSdf: `a` = (ax, az, ra), `b` = (bx, bz, rb). */
export const LIGHT_SDF_GLSL = /* glsl */ `
  float lightSdf(vec2 p, vec3 a, vec3 b) {
    vec2 q = p - a.xy;
    if (b.z < 0.0) return length(q) - a.z;
    vec2 d = b.xy - a.xy;
    float h = length(d);
    if (h <= abs(a.z - b.z) + 1e-3) return min(length(q) - a.z, length(p - b.xy) - b.z);
    vec2 u = d / h;
    float py = dot(q, u);
    float qx = abs(q.x * u.y - q.y * u.x);
    float bb = (a.z - b.z) / h;
    float aa = sqrt(max(0.0, 1.0 - bb * bb));
    float k = -bb * qx + aa * py;
    if (k < 0.0) return length(vec2(qx, py)) - a.z;
    if (k > aa * h) return length(vec2(qx, py - h)) - b.z;
    return qx * aa + py * bb - a.z;
  }
`;
