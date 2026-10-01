import type { Entity } from '../entities/Entity';
import type { Villager, DeathCause } from '../entities/Villager';
import type { Field, House } from '../entities/Buildings';
import type { Village } from '../village/Village';
import type { MiracleId } from '../miracles/Miracles';
import type { ProjectId } from '../projects/defs';

/**
 * Everything notable that happens in the world. Systems and plugins subscribe with
 * `game.events.on(...)` instead of editing the code that causes the event.
 */
export interface GameEvents {
  /** Food or wood delivered to a village store by the player (piles, trees, food miracle). */
  gift: { village: Village; kind: 'food' | 'wood'; amount: number };
  /** A miracle took effect at (x, z). */
  miracle: { id: MiracleId; x: number; z: number };
  /** A rain cloud passed over a village (once per cloud per village). */
  rainedOn: { village: Village };
  /** Rain put out a fire on this entity. */
  fireOut: { entity: Entity };
  /** The Hand picked something up. */
  grab: { entity: Entity };
  /** The Hand gently set something down at (x, z). */
  place: { entity: Entity; x: number; z: number };
  /** The Hand threw something. */
  throw: { entity: Entity; speed: number };
  /** A thrown thing landed for the first time, `flight` metres from where it was thrown. */
  landed: { entity: Entity; flight: number };
  villagerBorn: { villager: Villager };
  villagerDied: { villager: Villager; cause: DeathCause; byPlayer: boolean };
  /** A villager moved to another village (e.g. set down there by the Hand). */
  villagerJoined: { villager: Villager; village: Village; from: Village };
  houseBuilt: { house: House };
  houseDestroyed: { house: House; byPlayer: boolean };
  fieldHarvested: { field: Field; food: number };
  villageConverted: { village: Village };
  villageLost: { village: Village };
  /** The golem ate something; `key` is its learning key (e.g. 'eat:rock'). */
  creatureAte: { key: string };
  /** A stroke (+) or slap (-) taught the golem about `key` (null if it wasn't doing anything). */
  creatureTaught: { key: string | null; delta: number };
  newDay: { day: number };
  /** The season turned (spring, summer, autumn, winter). `year` counts from 1. */
  seasonChanged: { season: 'spring' | 'summer' | 'autumn' | 'winter'; year: number };
  /** A nature event (see src/seasons): warned about, under way, or over. */
  weather: { kind: 'dry' | 'storm' | 'coldsnap' | 'bloom'; phase: 'warning' | 'active' | 'ended' };
  /** A village announced its next project (well, temple, festival). */
  projectStarted: { village: Village; project: ProjectId };
  /** A village finished a project and its effect is live. */
  projectCompleted: { village: Village; project: ProjectId };
  /** All villages worship you: the Wonder can be raised. */
  wonderUnlocked: Record<string, never>;
  /** The Wonder is complete (the island's ending). */
  wonderCompleted: Record<string, never>;
  /** The rival god has arrived across the sea (see src/rival). */
  rivalArrived: Record<string, never>;
  /** A rival scheme was announced (its warning has begun). */
  schemeStarted: { kind: 'whispers' | 'blight' | 'hand' | 'storm'; village: Village };
  /** You countered a scheme. */
  schemeFoiled: { kind: 'whispers' | 'blight' | 'hand' | 'storm'; village: Village };
  /** A village's faith hit 0 under his pressure and it now worships him. */
  villageTurned: { village: Village };
  /** He gave up and left (the next island awaits). */
  rivalRetreated: Record<string, never>;
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<keyof GameEvents>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof GameEvents>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<keyof GameEvents>);
    return () => set.delete(handler as Handler<keyof GameEvents>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<K>)(payload);
      } catch (err) {
        console.error(`Event handler for "${type}" failed`, err);
      }
    }
  }
}
