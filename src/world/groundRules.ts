/** Shared numbers for the ground-contact rule (see groundCheck.ts and Pads.ts). */
export const SOIL_LIFT = 0.1;
/**
 * Hidden stone skirt under a cottage's footing, and under the store's wall. Buried on the flat pad a house normally
 * gets; on a slope with no pad (an old save, a spot that clashed) it shows as a tall foundation on the downhill side.
 */
export const HOUSE_SKIRT = 6; // 6 since the village art pass: the bigger cottages span more of a slope
export const STORE_SKIRT = 3;
/** The prayer place's floor disc and court: top height above the pad, and how far their hidden skirt reaches below it. */
export const SHRINE_FLOOR = { top: 0.2, skirt: 1.0 };
export const SHRINE_COURT = { top: 0.15, skirt: 3.0 };
/** How far a stump's trunk runs below its ground line (local units, scaled with the stump). */
export const STUMP_SKIRT = 0.9;
/** Building sites (the well): its stone ring runs down below the ground line this far. */
export const SITE_SKIRT = 2.8;
/** A field's soil grid spacing in metres (finer than the terrain's 3.1 m cells, so it hugs the creases between them). */
export const SOIL_STEP = 0.25;
/** Largest height difference under a small prop's base (barrel, crate, lantern post) before it is not placed there. */
export const PROP_MAX_RANGE = 0.3;
