import type { Game, GamePlugin } from '../Game';
import { Disciples } from '../disciples/Jobs';

export function install(game: Game): GamePlugin {
  game.disciples = new Disciples(game);
  return {
    name: 'disciples',
    update() {
      for (const village of game.villages) {
        if (village.owner === 'player') continue;
        for (const v of village.villagers) if (v.disciple) v.setDisciple(null);
      }
    },
  };
}
