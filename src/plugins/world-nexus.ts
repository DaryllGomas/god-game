import type { Game, GamePlugin } from '../Game';
import { NexusAge } from '../nexus/NexusAge';

/**
 * The last age (src/nexus): after Whole, the three villages raise the Nexus at the heart of the island and Telor grows
 * round it; the true end follows. Named to load after world-endings (it reads the endings' phase and stage on load).
 *
 * On `game.nexus`:
 *   debug('nexus')              start the last age on this island now (every village yours, every temple, Vexahl whole)
 *   debug('stone' | 'ring')     bring in the next stone / finish the ring
 *   debug('city', t?)           jump Telor's build to the next step (or to `t` game seconds)
 *   debug('built' | 'end')      finish Telor / play the true end now
 *   state()                     phase, the site, stones, the city's progress, the true end
 */
export function install(game: Game): GamePlugin {
  const nexus = new NexusAge(game);
  (game as unknown as { nexus: NexusAge }).nexus = nexus;
  return {
    name: 'nexus',
    update: (dt) => nexus.update(dt),
    frame: (dt) => nexus.frame(dt),
    save: () => nexus.save(),
    load: (d) => nexus.load(d),
  };
}
