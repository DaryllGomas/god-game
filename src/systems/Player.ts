import { PLAYER } from '../config';
import { clamp } from '../util/math';

/** The god: prayer power to spend and a moral reputation. */
export class Player {
  power = PLAYER.startPower;
  readonly maxPower = PLAYER.maxPower;
  /** -1 = pure evil, +1 = pure good. */
  alignment = 0;

  addPower(n: number) {
    this.power = clamp(this.power + n, 0, this.maxPower);
  }

  canAfford(n: number): boolean {
    return this.power >= n;
  }

  spend(n: number): boolean {
    if (this.power < n) return false;
    this.power -= n;
    return true;
  }

  /** Nudge alignment; big deeds move it further when you're near neutral. */
  shiftAlignment(delta: number) {
    this.alignment = clamp(this.alignment + delta * (1 - Math.abs(this.alignment) * 0.5), -1, 1);
  }

  get alignmentLabel(): string {
    const a = this.alignment;
    if (a > 0.6) return 'Benevolent';
    if (a > 0.2) return 'Kind';
    if (a > -0.2) return 'Neutral';
    if (a > -0.6) return 'Cruel';
    return 'Malevolent';
  }
}
