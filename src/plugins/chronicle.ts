import type { Game, GamePlugin } from '../Game';
import { Villager } from '../entities/Villager';
import { House } from '../entities/Buildings';
import { Chronicle, type ChronicleSave } from '../chronicle/Chronicle';
import { ageDays, firstBornAt, lifespanDays } from '../people/age';

// ------------------------------------------------------------------ tuning knobs

/** A villager carried at least this far by the Hand and set down gently is remembered for it (metres). */
const CARRY_DIST = 30;
/** A throw at least this fast is remembered (the same line the balance draws for cruelty). */
const THROW_SPEED = 25;
/** A gift of food counts as feeding a famine if the store had less than this before it, or people were starving. */
const FAMINE_STORE = 15;
/** How hungry a villager must be to be remembered as fed in a famine, and how many per gift at most. */
const FAMINE_HUNGER = 0.65;
const FAMINE_FED = 3;
/** Seconds a burning villager picked up by the Hand has to be put out to count as saved. */
const SAVE_WINDOW = 30;
/** Old age: in the morning, at most one per village per day, and never the village's last few people. */
const MORNING = 0.3;
const MIN_POPULATION = 4;

interface PeopleSave {
  /** [seed, bornAt] for villagers born on the island (the first islanders' ages come from their seeds). */
  born: [number, number][];
}

/**
 * The chronicle (src/chronicle) and the people's lives (src/people): names come from each villager's
 * seed, children are born with a birthday, the eldest pass away in the morning after a long life, and
 * the notable moments of the island and its people are written down, saved, and read by the endings
 * and the legacy record (`game.chronicle.people(n)`). Nothing is shown on screen.
 */
export function install(game: Game): GamePlugin {
  const chronicle = new Chronicle(game);
  game.chronicle = chronicle;
  const ev = game.events;

  const who = (v: Villager) => ({ villagerSeed: v.seed, name: v.name, village: v.village.name, x: v.pos.x, z: v.pos.z });

  // ---------------------------------------------------------------- people
  ev.on('villagerBorn', ({ villager }) => {
    villager.bornAt = game.time;
    chronicle.add({ kind: 'born', ...who(villager) });
  });
  ev.on('villagerDied', ({ villager, cause, byPlayer }) => {
    if (cause === 'eaten') chronicle.add({ kind: 'eaten_by_golem', ...who(villager) });
    else if (byPlayer) chronicle.add({ kind: 'killed', ...who(villager), note: cause });
    else if (cause === 'old') chronicle.add({ kind: 'died_old', ...who(villager) });
    else chronicle.add({ kind: 'died', ...who(villager), note: cause });
  });
  ev.on('prayerAnswered', ({ kind, villager, house }) => {
    if (kind === 'lost' && villager && !villager.dead) chronicle.add({ kind: 'lost_child_home', ...who(villager) });
    if (kind === 'fire' && house) for (const r of house.residents) chronicle.add({ kind: 'saved_from_fire', ...who(r), note: 'home' });
  });
  ev.on('fireOut', ({ entity }) => {
    if (entity instanceof Villager && !entity.dead) chronicle.add({ kind: 'saved_from_fire', ...who(entity), note: 'rain' });
    else if (entity instanceof House) for (const r of entity.residents) chronicle.add({ kind: 'saved_from_fire', ...who(r), note: 'home' });
  });
  ev.on('gift', ({ village, kind, amount }) => {
    if (kind !== 'food') return;
    const before = village.store.food - amount;
    if (before >= FAMINE_STORE && village.starving === 0) return;
    const hungry = village.villagers.filter((v) => !v.dead && v.hunger >= FAMINE_HUNGER).sort((a, b) => b.hunger - a.hunger);
    for (const v of hungry.slice(0, FAMINE_FED)) chronicle.add({ kind: 'fed_in_famine', ...who(v) });
  });

  // Carried by the Hand: remember where they were picked up; a burning one is watched until the fire is out.
  const pickedUp = new Map<Villager, { x: number; z: number; t: number }>();
  const burningHeld = new Map<Villager, number>();
  ev.on('grab', ({ entity }) => {
    if (!(entity instanceof Villager)) return;
    pickedUp.set(entity, { x: entity.pos.x, z: entity.pos.z, t: game.time });
    if (entity.burning) burningHeld.set(entity, game.time);
  });
  ev.on('place', ({ entity, x, z }) => {
    if (!(entity instanceof Villager)) return;
    const from = pickedUp.get(entity);
    pickedUp.delete(entity);
    if (!from || Math.hypot(x - from.x, z - from.z) < CARRY_DIST) return;
    // A lost child carried home is remembered as that (its prayer answers it), and one carried
    // burning to the water as saved from the fire (watched above), not as a carry.
    if (entity.lost || entity.burning) return;
    const to = game.villageAt(x, z);
    chronicle.add({ kind: 'carried_by_hand', ...who(entity), note: to && to !== entity.village ? to.name : undefined });
  });
  ev.on('throw', ({ entity, speed }) => {
    if (!(entity instanceof Villager)) return;
    pickedUp.delete(entity);
    if (speed > THROW_SPEED) chronicle.add({ kind: 'thrown', ...who(entity) });
  });

  // -------------------------------------------------------------- the island
  ev.on('shrineRaised', ({ village, stage }) =>
    chronicle.add({ kind: 'shrine_raised', village: village.name, x: village.worship.pos.x, z: village.worship.pos.z, note: stage }),
  );
  ev.on('villageConverted', ({ village }) => chronicle.add({ kind: 'village_joined', village: village.name, x: village.center.x, z: village.center.z }));
  ev.on('villageTurned', ({ village }) => chronicle.add({ kind: 'village_turned', village: village.name, x: village.center.x, z: village.center.z }));
  ev.on('schemeFoiled', ({ kind, village }) =>
    chronicle.add({ kind: 'scheme_foiled', village: village.name, x: village.center.x, z: village.center.z, note: kind }),
  );

  /** The worst thing you did (from the balance): one entry, replaced when something worse happens. */
  type Worst = { x: number; z: number; what: string; points: number; day: number } | null;
  let lastWorst: Worst = null;
  const watchWorst = () => {
    const w = (game as unknown as { balance?: { worst: Worst } }).balance?.worst ?? null;
    if (!w || w === lastWorst) return;
    lastWorst = w;
    const prev = chronicle.last('worst_act');
    if (prev && prev.note === w.what && prev.x === Math.round(w.x) && prev.z === Math.round(w.z)) return;
    chronicle.removeKind('worst_act');
    chronicle.add({ kind: 'worst_act', x: w.x, z: w.z, day: w.day, note: w.what, village: game.villageAt(w.x, w.z)?.name });
  };

  // ------------------------------------------------------------- old age
  let mornings = game.day;
  const passInTheMorning = () => {
    for (const village of game.villages) {
      if (village.population <= MIN_POPULATION) continue;
      let eldest: Villager | null = null;
      let over = 0;
      for (const v of village.villagers) {
        if (v.dead || v.held || v.airborne || v.burning || v.lost || !v.alive) continue;
        const o = ageDays(v.bornAt, game.time) - lifespanDays(v.seed);
        if (o >= 0 && o >= over) {
          over = o;
          eldest = v;
        }
      }
      if (eldest) eldest.die(game, 'old', false);
    }
  };

  let tick = 0;
  return {
    name: 'chronicle',
    update(dt) {
      tick += dt;
      if (tick < 0.5) return;
      tick = 0;
      watchWorst();
      for (const [v, since] of burningHeld) {
        if (v.dead || game.time - since > SAVE_WINDOW) burningHeld.delete(v);
        else if (!v.burning && !v.held) {
          burningHeld.delete(v);
          chronicle.add({ kind: 'saved_from_fire', ...who(v), note: 'water' });
        }
      }
      if (game.day > mornings && game.dayTime >= MORNING) {
        mornings = game.day;
        passInTheMorning();
      }
    },
    save: () => {
      const born: [number, number][] = [];
      for (const v of game.villages) {
        for (const p of v.villagers) if (!p.dead && p.bornAt !== firstBornAt(p.seed)) born.push([p.seed, Math.round(p.bornAt)]);
      }
      const people: PeopleSave = { born };
      return { ...chronicle.save(), people };
    },
    load: (data) => {
      const d = data as Partial<ChronicleSave> & { people?: Partial<PeopleSave> };
      chronicle.load(d);
      const born = new Map<number, number>();
      for (const row of d.people?.born ?? []) if (Array.isArray(row) && typeof row[0] === 'number' && typeof row[1] === 'number') born.set(row[0], row[1]);
      for (const v of game.villages) for (const p of v.villagers) if (born.has(p.seed)) p.bornAt = born.get(p.seed)!;
      // Keep the worst act as it was saved; only something worse replaces it.
      lastWorst = (game as unknown as { balance?: { worst: Worst } }).balance?.worst ?? null;
      mornings = game.dayTime >= MORNING ? game.day : game.day - 1;
    },
  };
}
