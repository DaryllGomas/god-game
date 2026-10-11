import { Rng } from '../util/rng';

/**
 * Villager names: warm, simple and original, made from a villager's `seed` by a small syllable
 * generator, so the same villager always has the same name (and no name is ever stored in a save).
 * Names never appear on screen as labels (the no-hints rule); they live in data: the chronicle and the
 * legacy record the RPG reads.
 */

// ------------------------------------------------------------------ tuning knobs

/** How many syllables a name has, by weight: short names are the warmest, a few run long. */
const LENGTHS: [number, number][] = [
  [1, 0.26],
  [2, 0.6],
  [3, 0.14],
];

/** Soft onsets, most of them single letters (weights). */
const ONSETS: [string, number][] = [
  ['b', 3], ['d', 3], ['f', 2], ['g', 1.5], ['h', 2], ['j', 1], ['k', 1.5], ['l', 3.5], ['m', 3.5], ['n', 3],
  ['p', 2.5], ['r', 3], ['s', 3], ['t', 3], ['v', 1.2], ['w', 2], ['y', 0.6], ['z', 0.4],
  ['br', 1], ['dr', 0.6], ['fl', 0.6], ['gr', 0.6], ['pr', 0.4], ['tr', 0.6], ['sh', 0.8], ['th', 0.8], ['wr', 0.4], ['', 2.2],
];
/** Onsets inside a word (after the first syllable): kept simple so names stay easy to say. */
const INNER: [string, number][] = [
  ['b', 2], ['d', 2.5], ['f', 1], ['l', 4], ['m', 3], ['n', 3.5], ['p', 1.5], ['r', 3.5], ['s', 2], ['t', 2.5], ['v', 1.5],
  ['w', 1.2], ['th', 0.6], ['nd', 0.6], ['lw', 0.3], ['rr', 0.3], ['ll', 0.8], ['nn', 0.6], ['mb', 0.4],
];
const VOWELS: [string, number][] = [['a', 5], ['e', 4], ['i', 3.5], ['o', 4], ['u', 1.4]];
/** Long vowels: only ever one per name, and only in its first syllable ("Bree", "Lail", "Moon"). */
const LONG_VOWELS: [string, number][] = [['ai', 1], ['ea', 0.8], ['ee', 1], ['oo', 0.6], ['ia', 0.5]];
/** Word endings: the consonant (or soft vowel) a name closes on. */
const ENDS: [string, number][] = [
  ['', 3.5], ['n', 3], ['l', 2], ['m', 1], ['r', 1.2], ['s', 1], ['th', 0.7], ['ck', 0.6], ['nn', 0.5], ['ll', 0.8], ['sh', 0.4],
  ['wyn', 0.5], ['bel', 0.4], ['wick', 0.3], ['let', 0.4], ['ry', 0.6], ['sy', 0.5], ['by', 0.5], ['do', 0.4], ['ka', 0.3], ['pa', 0.2],
];
/** A one-syllable name needs a closing sound that rings ("Bram", "Tull", "Wynn"), not a hiss ("Gas"). */
const SHORT_ENDS: [string, number][] = [['n', 3], ['ll', 2], ['nn', 1.2], ['m', 1.2], ['th', 1], ['wyn', 0.8], ['l', 1], ['r', 0.6]];
/** Long names close softly: on their vowel, or a single n, l or r. */
const LONG_ENDS: [string, number][] = [['', 4], ['n', 2], ['l', 1], ['r', 0.6]];

/**
 * Generated names that happen to be a brand, a famous person, a word that reads badly, or one of the
 * game's own characters. A blocked name is re-rolled. Lower case.
 */
const BLOCKED = new Set([
  // brands and products
  'nike', 'tesla', 'lego', 'sony', 'ikea', 'kia', 'mazda', 'zara', 'rolex', 'pepsi', 'coke', 'nokia', 'fanta', 'lexus', 'prada',
  'gucci', 'volvo', 'audi', 'tata', 'visa', 'dior', 'fila', 'puma', 'sega', 'mars', 'lotus', 'bose', 'dell', 'honda', 'toyota',
  'subaru', 'nissan', 'fiat', 'seat', 'skoda', 'opel', 'dodge', 'jeep', 'ford', 'mini', 'vespa', 'yamaha', 'casio', 'canon',
  'nikon', 'ricoh', 'lenovo', 'acer', 'asus', 'intel', 'amd', 'nvidia', 'google', 'meta', 'apple', 'amazon', 'alexa', 'siri',
  'cortana', 'tinder', 'uber', 'lyft', 'zoom', 'slack', 'skype', 'tiktok', 'roku', 'hulu', 'disney', 'pixar', 'marvel', 'nestle',
  'kraft', 'heinz', 'oreo', 'kitkat', 'twix', 'lindt', 'evian', 'volvic', 'bacardi', 'smirnoff', 'remy', 'moet', 'nivea', 'dove',
  'olay', 'loreal', 'avon', 'boss', 'hermes', 'chanel', 'fendi', 'tods', 'reebok', 'umbro', 'kappa', 'diadora', 'lacoste',
  'ralph', 'tommy', 'levi', 'wrangler', 'lee', 'gap', 'h&m', 'primark', 'tesco', 'aldi', 'lidl', 'asda', 'costco', 'target',
  'walmart', 'kmart', 'sears', 'macy', 'boots', 'shell', 'esso', 'bp', 'total', 'mobil', 'texaco', 'gulf', 'aramco', 'pemex',
  'robo', 'xbox', 'wii', 'atari', 'nintendo', 'mario', 'luigi', 'zelda', 'link', 'sonic', 'kirby', 'yoshi', 'pikachu', 'bowser',
  // famous people (first names that read as one person)
  'elon', 'oprah', 'adele', 'beyonce', 'rihanna', 'madonna', 'shakira', 'drake', 'cher', 'bono', 'sting', 'prince', 'elvis',
  'kanye', 'taylor', 'britney', 'miley', 'selena', 'ariana', 'gaga', 'lizzo', 'banksy', 'pele', 'messi', 'neymar', 'ronaldo',
  'kobe', 'shaq', 'lebron', 'serena', 'venus', 'tiger', 'usain', 'zuck', 'bezos', 'jobs', 'gates', 'obama', 'trump', 'biden',
  'putin', 'boris', 'hitler', 'stalin', 'lenin', 'mao', 'nero', 'judas', 'satan', 'lucifer', 'jesus', 'moses', 'allah', 'buddha',
  'thor', 'odin', 'loki', 'zeus', 'hera', 'ra', 'isis', 'osiris', 'horus', 'anubis', 'set', 'kali', 'shiva', 'vishnu',
  // words that read badly as a name
  'dead', 'die', 'kill', 'hate', 'war', 'sin', 'evil', 'doom', 'damn', 'hell', 'nazi', 'poo', 'pee', 'butt', 'bum', 'fart', 'puke',
  'snot', 'turd', 'dick', 'cock', 'tit', 'tits', 'twat', 'slut', 'whore', 'shit', 'piss', 'fuck', 'cunt', 'wank', 'nob', 'knob',
  'fag', 'gay', 'homo', 'rape', 'anal', 'anus', 'porn', 'sex', 'sexy', 'nude', 'bitch', 'bastard', 'crap', 'arse', 'ass', 'cum',
  'dildo', 'penis', 'vagina', 'boob', 'boobs', 'spunk', 'jizz', 'semen', 'pube', 'muff', 'minge', 'prick', 'pussy', 'tosser',
  'bollock', 'bollocks', 'bugger', 'sod', 'git', 'twit', 'moron', 'idiot', 'dumb', 'loser', 'fat', 'ugly', 'stink', 'smelly',
  'kike', 'paki', 'coon', 'chink', 'gook', 'spic', 'wop', 'dago', 'jap', 'nig', 'negro', 'retard', 'spaz', 'mong', 'lame',
  'nazi', 'kkk', 'isis', 'gun', 'bomb', 'nuke', 'drug', 'meth', 'weed', 'dope', 'coke', 'crack', 'smack', 'heroin',
  // everyday words that read oddly as a name
  'lick', 'lock', 'luck', 'suck', 'sick', 'mean', 'feel', 'feeling', 'ball', 'bell', 'bill', 'wash', 'lol', 'son', 'sun', 'gin',
  'rival', 'trim', 'dull', 'fell', 'fill', 'full', 'fall', 'hall', 'hill', 'mill', 'mall', 'pill', 'pull', 'poll', 'roll', 'sell',
  'tell', 'till', 'toll', 'tall', 'wall', 'well', 'will', 'yell', 'bun', 'ban', 'bin', 'den', 'din', 'fan', 'fun', 'hen', 'man',
  'men', 'nun', 'pan', 'pen', 'pin', 'pun', 'ran', 'run', 'tan', 'ten', 'tin', 'ton', 'van', 'win', 'won', 'ham', 'him', 'hum',
  'ram', 'rim', 'rum', 'sum', 'dam', 'dim', 'gum', 'mum', 'mom', 'yum', 'beam', 'team', 'seam', 'seem', 'lean', 'bean', 'teen',
  'moon', 'noon', 'soon', 'loon', 'bath', 'path', 'math', 'moth', 'myth', 'meal', 'deal', 'heal', 'real', 'seal', 'veal', 'peel',
  'reel', 'heel', 'keel', 'cool', 'fool', 'pool', 'tool', 'wool', 'bark', 'dark', 'lark', 'mark', 'park', 'deer', 'beer', 'near',
  'dear', 'fear', 'gear', 'hear', 'rear', 'tear', 'year', 'rain', 'pain', 'main', 'gain', 'vain', 'nail', 'mail', 'pail', 'rail',
  'sail', 'tail', 'wail', 'hail', 'bail', 'fail', 'jail', 'hair', 'fair', 'pair', 'lair', 'talon', 'melon', 'lemon', 'demon',
  'salon', 'baron', 'bacon', 'denim', 'venom', 'tumor', 'humor', 'rumor', 'manor', 'minor', 'motor', 'robin', 'satin', 'ruin',
  'ruined', 'sinew', 'widow', 'pity', 'pony', 'bony', 'tiny', 'dumber', 'meany', 'needy', 'seedy', 'weedy', 'rotten', 'sodden',
  'hidden', 'bidden', 'molten', 'lumpy', 'bumpy', 'dumpy', 'grumpy', 'pudding', 'loony', 'goon', 'boon', 'dune', 'lune', 'tomb',
  // the game's own characters and places
  'ora', 'lumi', 'fizz', 'atlas', 'veyr', 'vexahl', 'vex', 'ashford', 'brambleholt', 'stonemere', 'nexus', 'tend', 'golem',
]);

// ------------------------------------------------------------------ the generator

function weighted<T>(r: Rng, list: [T, number][]): T {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r.next() * total;
  for (const [v, w] of list) {
    x -= w;
    if (x <= 0) return v;
  }
  return list[list.length - 1][0];
}

const isVowel = (c: string) => 'aeiouy'.includes(c);

/** One attempt: a word of `n` syllables. */
function word(r: Rng): string {
  const n = weighted(r, LENGTHS);
  const first = weighted(r, ONSETS);
  let s = first;
  let last = first;
  let long = false;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // Always a consonant between syllables (vowels meeting blur together), and never the same one
      // twice running ("Wobobem", "Sudeda").
      let inner = weighted(r, INNER);
      for (let k = 0; k < 4 && inner[0] === last[0]; k++) inner = weighted(r, INNER);
      s += inner;
      last = inner;
    }
    if (i === 0 && n < 3 && r.next() < 0.14) long = true;
    s += weighted(r, long && i === 0 ? LONG_VOWELS : VOWELS);
  }
  const end = weighted(r, n === 1 ? SHORT_ENDS : n === 3 || long ? LONG_ENDS : ENDS);
  // A soft vowel ending ("do", "ka") after a vowel would stack vowels; "ck" only after a short vowel.
  if (isVowel(s.slice(-1)) && isVowel(end[0] ?? '')) return s;
  if (end === 'ck' && isVowel(s.slice(-2, -1))) return s + 'n';
  return s + end;
}

/** Reads well: not too short, not too long, no awkward clusters. */
function acceptable(w: string): boolean {
  if (w.length < 3 || w.length > 9) return false;
  if (/(.)\1\1/.test(w)) return false; // three of a letter in a row
  if (/[^aeiouy]{4}/.test(w)) return false; // four consonants in a row
  if (/^[^aeiouy]{3}/.test(w)) return false; // three consonants to start
  if (/(yy|uu|ii|aa|ao|uo|iu|ui|ue)/.test(w)) return false;
  if (/r[aeiouy]r/.test(w)) return false; // tongue-twisters ("Trirary")
  if (BLOCKED.has(w)) return false;
  for (const b of BLOCKED) if (b.length >= 4 && w.includes(b) && !['lee', 'ford'].includes(b)) return false;
  return true;
}

const cache = new Map<number, string>();

/** The name of the villager with this seed. Deterministic: the same seed always gives the same name. */
export function villagerName(seed: number): string {
  const hit = cache.get(seed);
  if (hit) return hit;
  // Mix the seed so neighbouring seeds (1, 2, 3...) give unrelated names.
  const r = new Rng(Math.imul(seed ^ 0x5f3759df, 0x9e3779b1) ^ 0x2545f491);
  let w = '';
  for (let i = 0; i < 40; i++) {
    w = word(r);
    if (acceptable(w)) break;
    w = '';
  }
  if (!w) w = ['pip', 'wren', 'moss', 'tilly', 'bram'][seed % 5];
  const name = w[0].toUpperCase() + w.slice(1);
  cache.set(seed, name);
  return name;
}
