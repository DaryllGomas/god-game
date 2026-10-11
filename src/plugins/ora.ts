import type { Game, GamePlugin } from '../Game';
import { Ora, ORA_LINES } from '../ora/Ora';

/**
 * Ora, the third voice: balance. Rare and subtle, never instructing (see src/ora/Ora.ts).
 * Reads `game.balance` (0..1) when the balance system provides it, with a rough estimate until then.
 */
export function install(game: Game): GamePlugin {
  const ora = new Ora(game);

  // Debug/test handle: game.ora.raise('kind', true), game.ora.state(), game.ora.lines.
  (game as unknown as { ora: unknown }).ora = Object.assign(ora, { lines: ORA_LINES });

  return {
    name: 'ora',
    update: (dt) => ora.update(dt),
    frame: (dt) => ora.frame(dt),
    save: () => ora.save(),
    load: (d) => ora.load(d),
  };
}
