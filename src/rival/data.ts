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

/** Occasional pettiness while he is around and nothing is scheming. */
export const IDLE_TAUNTS: Line[] = [
  L('rival', 'I am not watching. I am merely... looking, intently, at all of it.'),
  L('rival', 'Your Wonder is very tall. Mine is taller. Distance makes everything look smaller. Do not check.'),
  L('rival', 'Do you ever think... what if the villagers like me better? Just a thought. A big one.'),
  L('rival', 'I have a spire. A BIG spire. Have you seen it? You can see it from here.'),
  L('rival', 'Your golem is adorable. I am not jealous. Is it available for borrowing?'),
];

export const CHILD_NAMES = ['Pip', 'Wren', 'Moss', 'Tilly', 'Bram', 'Nettle', 'Posy', 'Fennel', 'Dot', 'Barley'];
