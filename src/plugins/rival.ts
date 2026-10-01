import type { Game, GamePlugin } from '../Game';
import { Rival } from '../rival/Rival';

/**
 * The Rival God (see src/rival): a jealous lord from across the sea who arrives when your Wonder is
 * complete and plays a telegraphed, counterable tug-of-war for your villages' hearts: whispers, blight,
 * a grasping hand and a violet storm. Needs the prayers plugin (loads before this one); the seasons plugin loads after it, so `game.seasons` is only read lazily.
 *
 * Debug hooks on `game.rival`:
 *   arriveNow(quick?)                          bring him in now (quick skips the camera glance and speeches)
 *   trigger('whispers' | 'blight' | 'hand' | 'storm', villageName?)
 *   state()                                    stage, mood, scheme, counts, peace timer
 *   slapHand(), retreatNow(), forceTurn(villageName), setDifficulty('gentle' | 'steady' | 'cunning')
 */
export function install(game: Game): GamePlugin {
  const rival = new Rival(game);
  (game as unknown as { rival: Rival }).rival = rival;
  return {
    name: 'rival',
    update: (dt) => rival.update(dt),
    save: () => rival.save(),
    load: (d) => rival.load(d),
    frame: (dt) => rival.frame(dt),
  };
}
