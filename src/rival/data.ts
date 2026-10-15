import { DAY_LENGTH } from '../config';
import { SEASON_DAYS } from '../seasons/data';

// ------------------------------------------------------------------ tuning knobs

export const RIVAL_NAME = 'Vexahl';
export const RIVAL_TITLE = 'Lord of the Far Shore';
/** Deep violet with an ember edge. */
export const VIOLET = 0x5b2a9a;
export const VIOLET_LIGHT = 0xb48cff;
export const EMBER = 0xff7a2a;

/** Seconds after the Wonder is complete before he shows up (the win card has to have its moment first). */
export const ARRIVE_DELAY = 14;
/** If the win card is never dismissed, he arrives anyway after this long. */
export const ARRIVE_PATIENCE = 75;
/** Seconds between his arrival and his first scheme. */
export const FIRST_SCHEME_DELAY = 70;
/** Breathing room between the end of one scheme and the start of the next (game seconds, before the difficulty scale). */
export const SCHEME_GAP: [number, number] = [150, 230];
/** The nearest-to-home end of the island he never schemes inside: schemes are never started while a banner-worthy event is on (a natural storm, say). */
export const MIN_BREATH = 60;

/** How many schemes you must foil, and how long he must hold no village, before he gives up. */
export const FOIL_GOAL = 4;
export const PEACE_SECONDS = SEASON_DAYS * DAY_LENGTH; // one full season

/** Faith a village keeps (never below) when the HOME village is whispered at: it can never turn. */
export const HOME_FAITH_FLOOR = 35;
/** A turned village starts this "belief in you" (win it back to 100). */
export const TURNED_BELIEF = 15;
/** Prayer power as a thank-you for foiling a scheme. */
export const FOIL_POWER = 80;

/** Whispers: seconds of warning, longest it lasts, faith drained per second, repel needed to break it. */
export const WHISPERS = { warn: 28, max: 105, drain: 1.55, repel: 100, golemBase: 3.2, golemGood: 6 };
/** Repel points from your deeds near the whispered village. */
export const REPEL = { gift: 22, miracle: 50, prayer: 40, rain: 40 };
/** Blight: warning, how long it lasts if left alone, how many fields (at most) it withers. */
export const BLIGHT = { warn: 20, max: 150, fields: 3 };
/** The Grasping Hand: seconds of shadow before it strikes (6-8), lock-on seconds, and how near the villager must be. */
export const HAND = { shadow: [6.5, 8] as [number, number], lock: 1.6, reach: 5, absence: [45, 75] as [number, number] };
/** Rival storm: warning (a little shorter than a natural one), faith drained per second while it is unanswered, how many villages it frightens. */
export const STORM = { warn: 55, drain: 0.5, villages: 2, active: 80 };

export type SchemeKind = 'whispers' | 'blight' | 'hand' | 'storm';
export type Difficulty = 'gentle' | 'steady' | 'cunning';

// ------------------------------------------------- v0.5: there from the start (see src/balance)

/** Before the Wonder, he stirs and schemes once the world's balance falls below STIR, and goes quiet again above QUIET. */
export const STIR = 0.5;
export const QUIET = 0.56;
/** At this balance and below, his schemes are at their strongest. */
export const DEPTHS = 0.15;
/**
 * Before the Wonder, by pressure (0 just under STIR, 1 at DEPTHS): how fast the wait between schemes
 * runs down (0.5 = half speed, so twice the wait), and how hard they bite. After the Wonder, the v0.4 rules.
 */
export const EARLY = { pace: [0.5, 1.5] as [number, number], bite: [0.55, 1.25] as [number, number] };
/** He starts small: the least pressure at which each scheme can be picked before the Wonder. */
export const SCHEME_MIN_PRESSURE: Record<SchemeKind, number> = { whispers: 0, blight: 0.2, hand: 0.4, storm: 0.65 };
/**
 * His isle rises with you (Daryll, 2026-10-15: "Vexahl's spire, I don't think should be there at first. Let's move it
 * a little further off coast and have it trigger ... when you get the pyramid, that's when it rises. Like in Breath
 * of the Wild ... they're leveling up together"). Until the first pyramid stands anywhere it lies hidden under the sea,
 * out past the top-left sea edge of the default view (ISLE_POS in RivalVisuals); then it surfaces (RISE) and from then
 * on its citadel grows one step for every age you raise (TIER): its SIZE follows your progress, not the balance.
 * - dist: metres from the island's centre (along ISLE_POS) at the rising, and in his final form (a little further out
 *   as it grows, so its foot stays in deep water).
 * - scale: the citadel's size at the rising, and in his final form.
 */
export const ISLE_GROW = { dist: [372, 392] as [number, number], scale: [0.17, 0.3] as [number, number] };
/** Where the endings bring him when they hold him near (`RivalIsle.hold` 1): src/endings Collapse and Ascension. */
export const ISLE_NEAR = { dist: 420, scale: 0.6 };
/** How strongly his isle is veiled in sea haze (0 = none) at the rising; thins as he grows, gone when held near. */
export const ISLE_HAZE = 0.07;
/** Balance at which his isle is still, and at its stormiest (the violet storm-eye, glow, beam, bolts): his temper, not his size. */
export const ISLE_STORM: [number, number] = [0.62, 0.15];
/** Real seconds for his storm to follow the balance. */
export const ISLE_DRIFT = 6;
/**
 * The rising, in real seconds from the moment your first pyramid stands. The sea out there darkens, a shockwave rings
 * out over the water, the isle surfaces and his spire climbs out of the sea through mist, violet light runs up it and
 * flares at the tip; then he speaks (story mode). The camera glides out at 0 and back at `back`.
 */
export const RISE = {
  darken: [0.2, 3] as [number, number],
  rings: [1.7, 4.8],
  surface: [1.9, 8.2] as [number, number],
  mist: [1.6, 11] as [number, number],
  light: [6.6, 8.4] as [number, number],
  flare: 8.4,
  /** His first line and Fizz's answer, once it stands (Ora names it, text only, as it begins). */
  speak: 9,
  back: 17,
};
/** Real seconds a new step of his citadel takes to grow (new spires climb out of the rock, the sea darkens a little more). */
export const LEVEL_SECONDS = 4.2;
/** Camera beats at the first temple and the last (his final, fullest form): real seconds out at sea. */
export const BEAT_GLANCE = { temple: 11, final: 13 };
/** Game seconds between his lines about going quiet or stirring again. */
export const MOOD_LINE_GAP = 150;

// ------------------------------------------------- story mode: he enters the road (2026-10-14)

/**
 * Story mode (Daryll, 2026-10-14: "I didn't really see Vexahl come in anywhere"; 2026-10-15: he rises with your first
 * pyramid). When your first pyramid stands his isle rises from the sea (a glance out to sea, his first line), and from
 * then on each neighbour your light reaches (the village Ora asks you to win) draws ONE small, counterable move from
 * him (`COURT`); before the rising he makes none. Free play keeps the balance-only rules above (and the same rising).
 * - after: game seconds a neutral village must have been within your light before he moves on it.
 *   Short on purpose: today a village can be won in under a minute, and the move should meet you while you court it.
 * - gap: game seconds after his last scheme ended before the next move.
 * - drain: whispers on a village you are winning pull its belief back this fast (per game second, before `bite`):
 *   about one answered prayer's worth over the whole scheme if left alone. It never turns a neutral village.
 */
export const COURT = { after: 12, gap: 25, drain: 0.3 };

/** The gentle difficulty knob: scales the gap between schemes, how hard they bite, and how long the warnings are. */
export const DIFFICULTY: Record<Difficulty, { label: string; gap: number; bite: number; warn: number; turnWeight: number }> = {
  gentle: { label: 'Gentle', gap: 1.45, bite: 0.7, warn: 1.3, turnWeight: 0.7 },
  steady: { label: 'Steady', gap: 1, bite: 1, warn: 1, turnWeight: 1 },
  cunning: { label: 'Cunning', gap: 0.7, bite: 1.35, warn: 0.8, turnWeight: 1.3 },
};

export const SCHEME_INFO: Record<SchemeKind, { name: string; icon: string; blurb: string }> = {
  whispers: { name: 'Whispers', icon: '🌫️', blurb: 'A violet mist drains the village\'s faith. Answer prayers, give gifts, work a miracle, or bring your golem.' },
  blight: { name: 'Blight', icon: '🥀', blurb: 'The fields wither. A water miracle cleanses them.' },
  hand: { name: 'The Grasping Hand', icon: '🫳', blurb: 'A dark hand reaches for a villager. Snatch them away, or slap the hand.' },
  storm: { name: 'Violet Storm', icon: '⛈️', blurb: 'A violet storm frightens two villages. Give each a sign: a miracle over the village.' },
};

export type Mood = 'brooding' | 'smug' | 'sulking' | 'scheming' | 'gloating' | 'fuming' | 'defeated';
export const MOOD_TEXT: Record<Mood, string> = {
  brooding: 'brooding',
  smug: 'smug',
  sulking: 'sulking',
  scheming: 'scheming',
  gloating: 'gloating',
  fuming: 'fuming',
  defeated: 'defeated',
};

// ------------------------------------------------------------------ his voice

/** Theatrical, jealous, a little petty; never grim. */
export type RivalSpeaker = 'rival' | 'spirit' | 'imp';
export interface Line {
  who: RivalSpeaker;
  text: string;
}

const L = (who: RivalSpeaker, text: string): Line => ({ who, text });

export const ARRIVAL_LINES: Line[] = [
  L('rival', 'So THIS is the little island everyone keeps whispering about. How... quaint.'),
  L('spirit', 'Oh dear. Someone is watching us from across the sea.'),
  L('imp', 'Ooh, a rival! A moody one, with a spire. I love him already.'),
  L('rival', `I am ${RIVAL_NAME}, ${RIVAL_TITLE}. Enjoy your Wonder. Truly. It will look lovely... on MY island.`),
  L('spirit', 'He wants their hearts, not a war. Watch over your villages, and stay kind.'),
  L('imp', 'Translation: he is jealous. Do not let him have the best dancers.'),
];

export const SCHEME_LINES: Record<SchemeKind, { start: Line[]; foiled: Line[]; success: Line[] }> = {
  whispers: {
    start: [
      L('rival', 'A little mist, a little doubt. Nothing personal. Everything personal.'),
      L('rival', 'Hush now, little village... who really loves you? Hmm?'),
      L('rival', 'Listen to the whispers, {village}. They are so much more interesting than your god.'),
    ],
    foiled: [
      L('rival', 'Tch! The mist was a perfectly good mist! Who taught them to ignore me?'),
      L('rival', 'Fine. FINE. They can have a nice day. See if I care.'),
    ],
    success: [L('rival', 'Whispers always win in the end, you know.')],
  },
  blight: {
    start: [
      L('rival', 'Such sweet little crops. It would be a shame if they got... moody.'),
      L('rival', 'Violet suits {village}\'s fields. Do try to appreciate it.'),
    ],
    foiled: [
      L('rival', 'Rain? RAIN?! That was a very expensive blight!'),
      L('rival', 'Oh, how very wet of you.'),
    ],
    success: [L('rival', 'Bare fields. A bare god. I see a theme.')],
  },
  hand: {
    start: [
      L('rival', 'Never mind the grand things. I only want one. That little one. Mine.'),
      L('rival', 'Look up, {village}. Something wants to hold a small person.'),
    ],
    foiled: [
      L('rival', 'Ow! That was my GOOD hand!'),
      L('rival', 'Rude. So rude. Nobody slaps a deity. Well, you did. Rude.'),
    ],
    success: [L('rival', 'Do not fret. I will return them... eventually. They are dreadful company.')],
  },
  storm: {
    start: [
      L('rival', 'Do you hear the thunder? That is me, being dramatic. I have been practising.'),
      L('rival', 'A little violet weather for {village}. Do let me know if it frightens you.'),
    ],
    foiled: [
      L('rival', 'A sign, a sign... everyone is so FOND of signs. Honestly.'),
      L('rival', 'The clouds were going to be magnificent. You have no taste.'),
    ],
    success: [L('rival', 'Storm-frightened and faithless. My favourite combination.')],
  },
};

/** The advisors react to a scheme being announced (one pair, picked at random per kind). */
export const ADVISOR_START: Record<SchemeKind, Line[][]> = {
  whispers: [
    [L('spirit', 'A dark mist is settling on {village}. Answer their prayers, or bring the golem to stand watch.'), L('imp', 'Gifts work too. Bribery! A time-honoured tradition.')],
  ],
  blight: [
    [L('spirit', '{village}\'s fields are going violet and sad. Rain would wash the blight away.'), L('imp', 'Fun fact: crops hate him. They are very loyal. To the sun.')],
  ],
  hand: [
    [L('spirit', 'A hand! It is reaching for someone in {village}. Pick them up before it closes!'), L('imp', 'Or slap it. I would slap it. Click the hand. Hard.')],
  ],
  storm: [
    [L('spirit', 'His storm frightens {village}. A sign from you, a miracle over the village, will calm them.'), L('imp', 'Quick, a little rain on the rain. Very meta.')],
  ],
};

export const ADVISOR_FOILED: Line[][] = [
  [L('spirit', 'You did it! He is cross, and the village is safe.'), L('imp', 'Delicious. Did you see his face? He does not have one, I checked.')],
  [L('imp', 'Ha! Rival: zero. You: lots.'), L('spirit', 'Gently, Fizz. But yes. Well done.')],
];
export const ADVISOR_TURNED: Line[][] = [
  [L('spirit', '{village} has turned to him. Their hearts are not lost, only borrowed. Win them back with kindness.'), L('imp', 'Feed them better bread than he does. That is the whole plan.')],
];
export const ADVISOR_WON_BACK: Line[][] = [
  [L('spirit', '{village} is yours again! Look how they dance!'), L('imp', 'And his face! Still no face. Still funny.')],
];
export const TURN_LINES: Line[] = [
  L('rival', '{village} is MINE. They told me so. Well, they did not say no.'),
  L('rival', 'Lovely, lovely {village}. Violet is the new gold.'),
];
export const WON_BACK_LINES: Line[] = [
  L('rival', 'You took {village} back?! They were just warming up for me!'),
  L('rival', 'Fickle. Villages are so fickle. It is not me, it is them.'),
];
export const RETREAT_LINES: Line[] = [
  L('rival', 'Enough! You have the dancers and the weather, the golem and the good luck.'),
  L('rival', 'I am going home to sulk. Beautifully. For a very long time.'),
  L('rival', 'But mark my words, little god: I\'ll be back... on the next island!'),
];
export const ADVISOR_RETREAT: Line[] = [
  L('spirit', 'He is leaving! Oh, listen to the whole island breathe out.'),
  L('imp', 'The next island, he says. Ominous! I will pack snacks.'),
];

/** The world has tipped far enough that he turns his attention to it (before the Wonder). Never names why. */
export const STIR_LINES: Line[] = [
  L('rival', 'Do not mind me. I was passing. Across the whole sea. Your little island seems... less happy than it was.'),
  L('imp', 'Was his spire always that tall? Asking for a friend. The friend is me.'),
  L('rival', `I am ${RIVAL_NAME}. I will be watching. Closely. More closely every day, I think.`),
];
/** The world recovered: he goes quiet. */
export const QUIET_LINES: Line[] = [
  L('rival', 'Fine. Tend your little garden. I can wait. I am very good at waiting.'),
  L('rival', 'Everyone looks so content. It is unbearable. I shall brood somewhere far away.'),
];
/** It tipped again: he wakes. */
export const RESUME_LINES: Line[] = [
  L('rival', 'Ah. There it is again. That lovely sour note.'),
  L('rival', 'Missed me? Your island did.'),
];
/** The Wonder is finished while he is already here. */
export const WONDER_LINES: Line[] = [
  L('rival', 'A Wonder. How tall. How shiny. It will look lovely... on MY island.'),
  L('imp', 'Uh oh. He has That Look. The one with the eyebrows.'),
];

/**
 * Story mode, the rising: your first pyramid stands and his isle rises from the sea (all lines recorded). Ora's words
 * go to its guide line (text only; Ora is "it").
 */
export const NOTICE_LINES: Line[] = [ARRIVAL_LINES[0], ARRIVAL_LINES[2]];
export const ORA_NOTICE = 'Out at the sea\'s edge, something rises as your people rise. Someone who was always there.';
/** Story mode, the first temple: his citadel has grown with you (recorded), and Ora's one insight (text only). */
export const TEMPLE_LINES: Line[] = [L('rival', 'I have a spire. A BIG spire. Have you seen it? You can see it from here.')];
export const ORA_TEMPLE = 'Every age you raise, his rises too. Light and shadow grow together.';
/**
 * Story mode, the tune step: every temple stands, his citadel is in its final form, and he has nothing left to court
 * (recorded). He doesn't brood far away any more: he is waiting for you (the final battle comes from the RPG lab).
 */
export const FAREWELL_LINES: Line[] = [L('rival', `I am ${RIVAL_NAME}. I will be watching. Closely. More closely every day, I think.`)];

/** Occasional pettiness while he is around and nothing is scheming. */
export const IDLE_TAUNTS: Line[] = [
  L('rival', 'I am not watching. I am merely... looking, intently, at all of it.'),
  L('rival', 'Your Wonder is very tall. Mine is taller. Distance makes everything look smaller. Do not check.'),
  L('rival', 'Do you ever think... what if the villagers like me better? Just a thought. A big one.'),
  L('rival', 'I have a spire. A BIG spire. Have you seen it? You can see it from here.'),
  L('rival', 'Your golem is adorable. I am not jealous. Is it available for borrowing?'),
];

export const CHILD_NAMES = ['Pip', 'Wren', 'Moss', 'Tilly', 'Bram', 'Nettle', 'Posy', 'Fennel', 'Dot', 'Barley'];
