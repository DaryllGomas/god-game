import type * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { Marks } from '../marks/Marks';

/**
 * Drawing marks (src/marks): hold Ctrl and drag the left button to trace a mark in light. Wave = Water,
 * spiral = Food, zigzag = Fire, cradle + sprout = TEND (raises a small grove). `game.marks.last` / `.cast` for tests.
 */
export function install(game: Game): GamePlugin {
  const marks = new Marks(game);
  (game as unknown as { marks: Marks }).marks = marks;
  const seen = new Set<THREE.Object3D>();
  return {
    name: 'marks',
    frame(dt) {
      marks.frame(dt, game.realTime);
      const ao = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
      if (ao) for (const o of marks.aoIgnore) if (!seen.has(o)) (seen.add(o), ao.push(o));
    },
  };
}
