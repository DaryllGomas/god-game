/**
 * GLSL value-noise helpers shared by the terrain shader and the grass tufts, so a tuft's
 * colour matches the patch of ground it grows from (warm, sunlit areas vs cool, lush ones).
 */
export const GROUND_NOISE_GLSL = /* glsl */ `
float ghash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ghash(i), ghash(i + vec2(1.0, 0.0)), u.x), mix(ghash(i + vec2(0.0, 1.0)), ghash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Broad colour tone of the meadow: 0 = cool and lush, 1 = warm and sunlit.
float grassTone(vec2 p) {
  return gnoise(p * 0.045) * 0.6 + gnoise(p * 0.19 + 7.3) * 0.4;
}
`;
