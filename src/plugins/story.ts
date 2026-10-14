import type * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { Story } from '../story/Story';

/**
 * Story mode (src/story): Ora names one goal at a time on the road to the Ascension, and a soft light marks it.
 * Only in story mode (src/pace PlayMode); free play, unlocked by beating the story, has none of it.
 * Debug: `game.story.state()`, `game.story.nudge()`, `?unlock=free` / `?unlock=story`.
 */
export function install(game: Game): GamePlugin {
  const story = new Story(game);
  (game as unknown as { story: Story }).story = story;
  return {
    name: 'story',
    frame(dt) {
      story.frame(dt);
      // Keep the light out of the ambient-occlusion pre-pass (see plugins/postfx.ts).
      const ao = (game as unknown as { postfx?: { aoIgnore?: THREE.Object3D[] } }).postfx?.aoIgnore;
      if (ao && !ao.includes(story.beacon.group)) ao.push(story.beacon.group);
    },
    save: () => story.save(),
    load: (d) => story.load(d),
  };
}
