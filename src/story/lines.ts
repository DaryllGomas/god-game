import type { Line } from '../prayers/Advisors';

/**
 * Story mode's words (Daryll, 2026-10-14). Ora names ONE next goal at a time: a nudge in its calm voice,
 * never a manual. Lumi and Fizz react around the goals (praise, grumble, tempt). Ora is "it".
 *
 * Each goal has a `lead` (spoken when the goal begins, which also closes the one before) and `nudge` lines
 * (when the player has been on it a few minutes). Names come from the villages in play.
 */

const pick = <T>(a: readonly T[], i: number): T => a[((i % a.length) + a.length) % a.length];

export interface Ctx {
  home: string;
  /** The village the goal is about. */
  v: string;
  /** For 'carry': the village whose stones would carry the light to `v`. */
  via?: string;
  /** It has a dream (a project) under way right now. */
  dreaming: boolean;
  /** What it is dreaming of / reaching for next, in words ("a well", "a pyramid", "a temple"). */
  next: string;
  /** The village has turned to the rival. */
  turned: boolean;
  /** The balance is low (the island is out of tune). */
  low: boolean;
  /** This kind of goal has been led before on this island (a second village to win, a later stage). */
  again: boolean;
  /** Spoken after a reload: a gentle reminder of where things stand. */
  reminder: boolean;
  /** For 'carry': the light stands at its prayer place's limit; only the next age (`next`) carries it on. */
  capped?: boolean;
  /** For 'win': families that believe in you, of the homes in the village. */
  families?: number;
  homes?: number;
  /** For 'answer': what home is asking for and how to answer it, in Ora's words (from the prayer on screen). */
  ask?: string;
}

export type StepId = 'answer' | 'stones' | 'win' | 'carry' | 'raise' | 'tune';

export const LEAD: Record<StepId, (c: Ctx) => string> = {
  // The first goal names the prayer and what to do (playtest 2026-10-15: "Can you hear it?" was a riddle).
  answer: (c) =>
    c.ask
      ? c.reminder
        ? `Where were we? ${c.ask}`
        : `Listen. ${c.ask}`
      : c.reminder
        ? `${c.home} is still waiting to be heard. Watch for the prayer rising over it.`
        : `Listen. Soon someone in ${c.home} will ask you for something. Watch for the prayer rising over the village.`,
  stones: (c) =>
    c.dreaming
      ? `${c.home} dreams of a well. Stone from the hills would raise it, and old stones round their prayer place with it.`
      : `They were heard. Now ${c.home} will dream of something that lasts. Watch for it.`,
  win: (c) =>
    c.turned
      ? `${c.v} has turned its face away. It could still turn back, one family at a time.`
      : c.again
        ? `Your light touches ${c.v}. Family by family, they will decide who you are.`
        : `Your light touches ${c.v}. Each family that comes to believe lights its home gold. Hear their prayers, bring what they need, and win most of them.`,
  carry: (c) =>
    c.capped
      ? c.dreaming
        ? `${c.via}'s light has grown as far as it can. Raise ${c.next} there, and it will carry on toward ${c.v}.`
        : `${c.via}'s light has grown as far as it can. When ${c.via} dreams of ${c.next}, help it, and the light carries on toward ${c.v}.`
      : `See the gold leaning toward ${c.v}? Every prayer you answer in ${c.via}, every gift, every dream carries it further.`,
  raise: (c) =>
    c.dreaming
      ? `${c.v} is reaching for ${c.next}. Stone, carried from the hills, will lift it.`
      : `${c.v} will dream of ${c.next} soon. Keep them fed and heard while it takes shape.`,
  tune: () => 'Every temple stands. Now let the island rest in tune a while, and listen.',
};

export const NUDGE: Record<StepId, (c: Ctx, i: number) => string> = {
  answer: (c, i) => pick([c.ask ? `Their wish is still hanging in the air. ${c.ask}` : `Their wish is still hanging in the air over ${c.home}.`, `${c.home} is still waiting to be heard.`], i),
  stones: (c, i) =>
    c.dreaming
      ? pick([`The well is waiting for stone. The hills have plenty.`, `A stone carried with care becomes something they can gather round.`], i)
      : pick([`${c.home} is still dreaming. Answer what they ask while the dream takes shape.`], i),
  win: (c, i) =>
    pick(
      c.dreaming
        ? [`${c.v} is building a dream of its own. It cannot rise without your stone.`, `A gift, a rain, a kindness. ${c.families ?? 0} of ${c.homes ?? 0} families in ${c.v} believe.`]
        : [`${c.v} has needs of its own. Answer their prayers, and another family may believe.`, `A tree, food, a rain on their fields. Each gift to ${c.v} warms another home.`],
      i,
    ),
  carry: (c, i) =>
    c.capped
      ? pick([`${c.via} needs ${c.next} before its light can reach ${c.v}.`, `Stone for ${c.via}'s dream would carry your light to ${c.v}.`], i)
      : pick([`The light creeps toward ${c.v} as ${c.via} is tended.`, `Answer ${c.via}, feed it, help its dreams. The gold is nearly at ${c.v}.`], i),
  raise: (c, i) =>
    c.dreaming
      ? pick([`${c.v} is still waiting for stone.`, `Half a dream stands in ${c.v}. Stone finishes dreams.`], i)
      : pick([`${c.v} is still gathering itself. Fed and heard, it will dream again.`], i),
  tune: (c, i) =>
    c.low
      ? pick([`Something is still out of tune. Who is still waiting to be heard?`, `Not yet in tune. Let the forests grow back, and keep them fed.`], i)
      : pick([`Nearly. Let it be.`, `Listen. It is very close now.`], i),
};

/** Lumi and Fizz when a goal begins (only some goals; their usual reactions cover the rest). */
export const ADVISORS_ON: Partial<Record<StepId, (c: Ctx) => Line[]>> = {
  win: (c) =>
    c.again || c.turned
      ? [
          { who: 'spirit', text: `${c.v} next! I always liked their bread.` },
          { who: 'imp', text: 'Win them over, lose them, win them over. Like a yo-yo with feelings.' },
        ]
      : [
          { who: 'imp', text: `${c.v}, eh? Drop a boulder near them. Nothing says believe in me like a boulder.` },
          { who: 'spirit', text: 'Or bread. Bread says it too, and nobody gets squashed.' },
        ],
  tune: () => [
    { who: 'spirit', text: 'Every temple is standing. Can you feel the whole island humming?' },
    { who: 'imp', text: 'Lovely. Now nobody touch anything. Including me.' },
  ],
};

/** Now and then, with a nudge: one of them, as a character (chat priority, so it never crowds a real moment). */
export const ADVISOR_NUDGES: Line[] = [
  { who: 'imp', text: 'Are we sightseeing? I love sightseeing.' },
  { who: 'spirit', text: 'No rush. They will still be there. Probably.' },
  { who: 'imp', text: 'I am bored. Bored imps make mischief. Just saying.' },
  { who: 'imp', text: 'Ora is never wrong, you know. It is deeply annoying.' },
];
