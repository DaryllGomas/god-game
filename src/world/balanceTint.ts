/**
 * The world's balance, painted onto the land (see src/balance). One pair of uniforms shared by the
 * terrain, grass and tree shaders, written each frame by the balance look:
 * - `uDrain` 0..1: colour drains toward a dull grey-olive as the world falls out of balance.
 * - `uRich` 0..1: a little extra saturation and warmth while it is in tune.
 */
export const BALANCE_TINT = {
  uDrain: { value: 0 },
  uRich: { value: 0 },
};

/** GLSL: declares the uniforms and `balanceTint(colour, amount)`; `amount` scales the drain for this surface. */
export const BALANCE_TINT_GLSL = /* glsl */ `
uniform float uDrain;
uniform float uRich;
vec3 balanceTint(vec3 c, float amt) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 rich = mix(vec3(l), c, 1.0 + 0.05 * uRich) * mix(vec3(1.0), vec3(1.025, 1.0, 0.96), uRich);
  // Drained: a darker, dull grey-olive that keeps a trace of the colour underneath.
  vec3 grey = vec3(l) * vec3(1.07, 1.02, 0.7) * 0.64;
  return mix(rich, grey, clamp(uDrain * amt, 0.0, 1.0) * 0.88);
}
`;
