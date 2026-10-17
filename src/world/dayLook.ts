/**
 * World look pass 6 (2026-10-17): how strongly the meadows, grass tufts and tree crowns are pulled from lime toward a
 * deep warm green. Full by day, none at night, so nights keep the brightness they had (Daryll asked for brighter nights
 * on 10-15). Shared by the terrain, grass and tree shaders; the sky writes it each frame from its daylight.
 */
export const DAY_LOOK = {
  uMeadowDeep: { value: 1 },
};
