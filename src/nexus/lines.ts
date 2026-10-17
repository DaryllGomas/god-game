import type { Line } from '../prayers/Advisors';

/**
 * The last age's words (2026-10-17). Unvoiced for now (text only; the voice pass comes later). Ora has no voice ever:
 * its words are italic text with its tone, and it is always "it". Ora names the one goal (the ring), then only
 * notices; Lumi (warm) and Fizz (a playful trickster, never evil) react as characters, never as a tutorial.
 * No Vexahl: he is whole again. No films named.
 */

const pick = <T>(a: readonly T[], i: number): T => a[((i % a.length) + a.length) % a.length];

export interface NexusCtx {
  /** Stones standing, of seven. */
  stones: number;
  /** The village nearest the Nexus, and the two others (for names in lines). */
  near: string;
  others: [string, string];
  reminder: boolean;
}

export const ORA = {
  /** The goal, when the age begins. */
  lead: (c: NexusCtx) =>
    c.reminder
      ? `At the heart of the island the Nexus is rising, ${c.stones} of seven stones. Stone from your hand lifts the rest.`
      : 'The villages are ready to become one. Where their roads meet, at the heart of the island, they will raise the Nexus: seven stones, one for each mark. Stone from your hand will lift them.',
  /** Stuck on the ring a while. */
  nudge: (c: NexusCtx, i: number) =>
    pick(
      [
        'The stones are waiting for stone. The hills still have plenty.',
        'Every prayer you answer, every gift to their stores, carries the Nexus a little higher.',
        `${c.stones} of seven stones stand. All three villages are carrying what they can.`,
      ],
      i,
    ),
  /** The ring stands. */
  ring: 'Seven stones. Seven marks. One ring. Now watch what they make of it.',
  roads: 'The roads come first. All three of them lead here now.',
  built: 'Telor. Not a temple. A city, built round a meeting place.',
  /** In the true end. */
  /** The last line of THE FIRST WORLD, as the people of Telor look up at the lit Nexus (Daryll: "they understand you now"). */
  understand: 'They understand you now.',
};

/** Lumi and Fizz as the stones go up (index = stones standing). */
export const STONE_LINES: Record<number, Line[]> = {
  1: [
    { who: 'spirit', text: 'The first stone! It went up singing. Did you hear it?' },
    { who: 'imp', text: 'Stones do not sing. ...That one did a bit.' },
  ],
  4: [{ who: 'imp', text: 'Four stones. Three to go. I can count, you know. On my fingers. All four of them.' }],
  6: [{ who: 'spirit', text: 'Six! One more and the whole ring can hold hands.' }],
};

/** When the age begins (after Ora's goal). */
export const BEGIN_LINES = (c: NexusCtx): Line[] => [
  { who: 'spirit', text: `${c.near} is already baking bread for everyone. ${c.others[0]} and ${c.others[1]} are bringing the jam.` },
  { who: 'imp', text: 'One big city. Think of the noise. Think of the gossip. I am so happy.' },
];

/** Now and then while the ring rises (chat priority, so it never crowds a real moment). */
export const RING_CHAT: Line[] = [
  { who: 'spirit', text: 'Seven stones, and I have a name for every one already.' },
  { who: 'imp', text: 'Drop a boulder from very high. For the drama. Not on anyone. Probably not on anyone.' },
  { who: 'imp', text: 'If each stone is a mark, which one is mine? The squiggly one. Obviously.' },
  { who: 'spirit', text: 'Look at them on the road, three villages walking the same way. I could cry.' },
];

/** The ring stands. */
export const RING_DONE: Line[] = [
  { who: 'spirit', text: 'All seven! It looks like the night sky came down to stand in a circle.' },
  { who: 'imp', text: 'Everyone holding hands round a ring of big rocks. I will allow it. Once.' },
];

/** As the city grows, one beat per step. `names`: the three villages, nearest the Nexus first. */
export const CITY_LINES = (names: string[]): Record<string, Line[]> => ({
  plaza: [
    { who: 'spirit', text: 'They are laying a floor round the stones. A floor for dancing!' },
    { who: 'imp', text: 'Or for sliding. In socks. I am just saying it is an option.' },
  ],
  district: [
    { who: 'imp', text: 'Houses with UPSTAIRS. Next it will be bathtubs. Mark my words.' },
    { who: 'spirit', text: `Look, families from ${names[0]}, ${names[1]} and ${names[2]}, building side by side.` },
  ],
  avenues: [
    { who: 'spirit', text: `${names[2]}'s houses are reaching out to meet the city. Like it is holding out its hand.` },
    { who: 'imp', text: `${names[1]} is pretending it is not excited. It is very excited. I can tell.` },
  ],
  walls: [
    { who: 'imp', text: 'Walls! To keep out... nobody. There is nobody left. I checked.' },
    { who: 'spirit', text: 'Walls to come home to, Fizz. Not to keep anyone out.' },
  ],
});

/** Back on the island after the true end (only if you stay instead of going on to the RPG). */
export const AFTER_LINES: Line[] = [
  { who: 'spirit', text: 'They looked right up at you. Not scared, not kneeling. They just knew.' },
  { who: 'imp', text: 'Now they will want you at every party. Every single one. Pace yourself.' },
];
