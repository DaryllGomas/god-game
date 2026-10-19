import type { Line } from '../prayers/Advisors';
import type { SeasonId } from '../seasons/data';

/**
 * After the true end (2026-10-18): the words of the gentle loop. Text only for now (the voice pass comes later). Ora
 * has no voice ever: its words are italic text with its tone, and it is always "it". Ora says one line per festival
 * (what Telor is short of, noticed, never instructed); Lumi (warm, a little too sweet) and Fizz (a trickster: a dark
 * joke, then a fake backpedal) react as characters. No worship words: Telor celebrates, nobody kneels.
 */

/** The four celebrations of Telor's year, one per season, and the one thing each asks of you. */
export const FESTIVALS: Record<SeasonId, { name: string; icon: string; ask: 'rain' | 'food' | 'timber' | 'fire'; askIcon: string }> = {
  spring: { name: 'Blossom Day', icon: '🌸', ask: 'rain', askIcon: '💧' },
  summer: { name: 'Harvest Feast', icon: '🍎', ask: 'food', askIcon: '🌾' },
  autumn: { name: 'Lantern Night', icon: '🏮', ask: 'timber', askIcon: '🪵' },
  winter: { name: 'Midwinter Fire', icon: '🎆', ask: 'fire', askIcon: '🔥' },
};

/** Ora names what each festival is short of (its one goal line per festival). */
export const ORA_ASK: Record<SeasonId, string> = {
  spring: 'Blossom Day is coming to Telor. The blossom is waiting on rain.',
  summer: 'Telor has set long tables for its Harvest Feast. They are still bare.',
  autumn: 'Lantern Night in Telor. They have the paper and the candles, and no wood for the frames.',
  winter: 'Midwinter. Telor has stacked seven fires in the ring, and not one is lit.',
};

/** A word from Lumi or Fizz when the festival is asked (one each). */
export const ASK_LINES: Record<SeasonId, Line[]> = {
  spring: [{ who: 'spirit', text: 'Blossom Day! Everyone wears flowers and dances until they fall over.' }],
  summer: [{ who: 'imp', text: 'A feast! All those plump, juicy... pies. Pies. I meant pies.' }],
  autumn: [{ who: 'spirit', text: 'On Lantern Night every family sends a light up into the sky. I always cry.' }],
  winter: [{ who: 'imp', text: 'Seven fires. Perfect for roasting. ...Chestnuts. I was going to say chestnuts.' }],
};

/** While the celebration plays (winter's comes with the first firework). */
export const PARTY_LINES: Record<SeasonId, Line[]> = {
  spring: [
    { who: 'spirit', text: 'Look at them dance! There are petals in everybody\'s hair.' },
    { who: 'imp', text: 'There are petals in MY hair. ...Leave them. They suit me.' },
  ],
  summer: [
    { who: 'spirit', text: 'One long table, and the whole city at it. Even the newcomers.' },
    { who: 'imp', text: 'Nobody has passed me the bread. Not once. I am keeping a list.' },
  ],
  autumn: [
    { who: 'spirit', text: 'One light for every family. That gold one is for you.' },
    { who: 'imp', text: 'Hundreds of little fires drifting over the rooftops. Romantic. Flammable. Romantic!' },
  ],
  // At Daryll's last festival Fizz said: "I hear there will be fireworks. (There will not be fireworks.)"
  winter: [
    { who: 'imp', text: 'Fireworks! What did I tell you? I said there would be fireworks.' },
    { who: 'spirit', text: 'You said there would NOT be fireworks.' },
    { who: 'imp', text: 'In brackets. Brackets don\'t count. Everyone knows that.' },
  ],
};

/** The first boat of newcomers. */
export const FIRST_BOAT: Line[] = [{ who: 'spirit', text: 'A boat! Someone over the sea has heard about Telor.' }];
/** Now and then, a later boat (chat: never crowds a real moment). */
export const LATER_BOAT: Line[] = [{ who: 'imp', text: 'More newcomers. Word gets round. I may have mentioned the free bread.' }];
/** The first newcomers move into their house. */
export const FIRST_HOME: Line[] = [{ who: 'spirit', text: 'They have a home now. Look, their lamp is already lit.' }];
/** The city's first house outside its walls (Fizz on the walls in the last age: "To keep out... whom, exactly?"). */
export const PAST_WALLS: Line[] = [{ who: 'imp', text: 'Houses outside the walls now. So the walls keep out nobody. I did say.' }];
/** The first garden (chat). */
export const FIRST_GARDEN: Line[] = [{ who: 'spirit', text: 'Someone has planted beans by the road. That is how you know it is home.' }];
