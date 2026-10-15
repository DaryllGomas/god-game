import type { Stage } from './Collapse';

/**
 * THE FINAL BATTLE: the hook, not the battle (Daryll, 2026-10-15: "at the end ... a really cool battle thing, which
 * we're working on in the RPG lab, so we don't need to work on that here, we'll just import that over").
 * The battle will be imported from the RPG lab. Until then the stub below ends at once, and the Ascension carries on
 * into Whole exactly as it did before.
 *
 * Where it sits: the Ascension (src/endings/Ascension.ts) asks for the battle once, the moment Whole begins. His
 * citadel stands in its final form (every temple raised; src/rival progress()), the city below is lit, his spire is
 * coming in close over the sea, and the two hands have not yet met. When the battle is done, the hands meet and he is
 * drawn back in (CANON ruling 8: redemption and reintegration, so the battle ends in that reconciliation).
 *
 * The contract for the import:
 * - `setFinalBattle(start)` registers the real battle (call it from the imported module's install).
 * - `start(stage)` is called once and returns a FinalBattle. While `done` is false the Ascension holds its own clock
 *   (its camera keys, the city lights and the hour stay where they are) and calls `frame(dt)` every rendered frame
 *   with real seconds; the battle owns the screen (stage.cine holds the camera; stage.rival.isle is his citadel).
 * - Set `done` when it is over. `outcome` 'reconciled' carries on into the meeting of the hands; anything else is for
 *   the battle to define with Daryll (today there is only the one way on).
 * - It is never asked for when the sequence starts straight at Whole (debug, or a reload in the middle of it).
 */
export interface FinalBattle {
  done: boolean;
  outcome?: 'reconciled';
  frame(dt: number): void;
}

type Start = (stage: Stage) => FinalBattle;

let start: Start | null = null;

/** Register the imported battle (the RPG lab's). Pass null to go back to the stub. */
export function setFinalBattle(fn: Start | null) {
  start = fn;
}

/** The Ascension asks for the battle as Whole begins. Today: the stub, done at once (the ending goes on as before). */
export function beginFinalBattle(stage: Stage): FinalBattle {
  if (start) return start(stage);
  return { done: true, outcome: 'reconciled', frame() {} };
}
