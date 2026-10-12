import * as THREE from 'three';

/**
 * THE STUDIO LOOK KIT, shared with the RPG (atlas-hd2d).
 *
 * One place for the numbers that make a diorama read as a diorama: the golden-hour palette, exposure, the
 * warm/cool split-tone grade, the haze, and the tilt-shift depth-of-field recipe. The RPG keeps the same values in
 * its day-cycle keys (src/engine/lighting/daycycle.js: dusk `shadowTint`/`highTint`/`exposure`/`sat`/`contrast`/`vignette`)
 * and its post chain (src/engine/postfx.js: ACES + grade, focus-band DoF with `uTilt`, golden-angle bokeh gather).
 * When one game changes a value here, change it in the other so both stay one world. Colours are sRGB hex; the
 * multipliers (`TINT_*`, `WARMTH`) are applied in linear light.
 */
export const LOOK = {
  /** Renderer tone-mapping exposure (ACES). */
  exposure: 1.34,

  // ---- golden-hour light ----
  /** Sun colour at its warmest (low sun) and its coolest (high noon). */
  sunGold: new THREE.Color(1.0, 0.72, 0.38),
  sunNoon: new THREE.Color(1.0, 0.93, 0.82),
  /** Sun elevation is flattened so shadows stay long all day: y' = elev * SUN_FLATTEN + SUN_LIFT * smoothstep(0, 0.15, elev). */
  sunFlatten: 0.5,
  sunLift: 0.14,
  sunIntensity: 3.7,
  /** Fill light: cool sky, warm bounce from the ground. Cool shadows are what make the gold read as gold. */
  hemiSky: new THREE.Color('#8fb4ff'),
  hemiGround: new THREE.Color('#a8913f'),
  hemiIntensity: 1.5,
  /** How golden the day is at noon (0..1); morning and late afternoon are always 1. */
  goldenAtNoon: 0.4,
  /** Horizon / zenith colours for the golden sky (peach haze, deep saturated blue like the storyboard). */
  horizonGold: new THREE.Color('#f6c79a'),
  zenithGold: new THREE.Color('#2f6fcf'),

  // ---- atmosphere ----
  /** Fog starts at fogNear0 + dist * fogNearK and ends at fogFar0 + dist * fogFarK (dist = camera distance). */
  fogNear0: 140, fogNearK: 0.6, fogFar0: 800, fogFarK: 2.0,

  // ---- grade (linear light, applied in the Grade pass) ----
  warmth: new THREE.Vector3(1.06, 1.0, 0.92),
  /** Split tone: shadows pushed cool teal-blue, highlights pushed warm gold. */
  tintShadow: new THREE.Vector3(0.9, 0.98, 1.12),
  tintHigh: new THREE.Vector3(1.22, 1.04, 0.76),
  saturation: 1.1,
  contrast: 1.1, // around mid grey (0.18 linear)
  vignette: 0.26,

  // ---- soft glow ----
  bloomStrength: 0.42, bloomRadius: 0.6, bloomThreshold: 0.95,
  aoIntensity: 1.0, aoRadius: 4,

  // ---- tilt-shift depth of field ----
  /** Max blur radius in px at 1080p when the camera is as close as it goes (scaled with frame height). */
  dofMaxRadius: 15,
  /** Camera distance (world units) where the effect is full strength and where it fades to dofFar. */
  dofNearDist: 40, dofFarDist: 620, dofFarStrength: 0.1,
  /** Sharp band half-height (screen fraction) and where the blur reaches full. Above the focus the sky side blurs a bit less. */
  dofBand: 0.1, dofFull: 0.5, dofUpperScale: 0.7,
} as const;

/** DoF strength 0..1 from the camera distance: strong when close (the storyboard), gentle when zoomed out. */
export function dofStrength(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - LOOK.dofNearDist) / (LOOK.dofFarDist - LOOK.dofNearDist)));
  const s = t * t * (3 - 2 * t);
  return 1 + (LOOK.dofFarStrength - 1) * s;
}
