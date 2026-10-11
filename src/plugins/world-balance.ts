import type { Game, GamePlugin } from '../Game';
import { Balance } from '../balance/Balance';
import { BalanceLook } from '../balance/BalanceLook';

/**
 * The balance of the world (see src/balance): 0..1, rising with tending and falling with ruin, shown
 * by the island itself (colour, sky rings, sea, music) and never on screen as a number or a word.
 * Vexahl's spire and schemes answer it (src/rival reads `game.balance`).
 *
 * The file is named so it loads after the seasons plugin: its look is applied on top of the season's.
 *
 * On `game.balance`:
 *   value, target, band ('tune' | 'tipping' | 'falling'), lowFor, highFor, worst
 *   breakdown()                     every term, for tests
 *   force(0.15) / force(null)       debug: pin it, or let the world decide again
 *   deed(points, what, x?, z?)      another system can add a deed
 * Event: `balanceBand` when it crosses into another band.
 */
export function install(game: Game): GamePlugin {
  const balance = new Balance(game);
  const look = new BalanceLook(game, balance);
  (game as unknown as { balance: Balance }).balance = Object.assign(balance, { look });
  return {
    name: 'balance',
    update: (dt) => balance.update(dt),
    frame: (dt) => look.frame(dt),
    save: () => balance.save(),
    load: (d) => {
      balance.load(d);
      look.snap();
    },
  };
}
