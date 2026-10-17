import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Prayer, PrayerKind } from './Prayers';

// ------------------------------------------------------------- tuning knobs

/** Chatter: at least this long since the last card ended, and this long between chats (real seconds). */
const CHAT_GAP = 75;
const CHAT_MIN = 150;
/** Default cooldown for one topic of chatter. */
const TOPIC_COOLDOWN = 300;
/** Chance they remark on an ordinary answered prayer (the first one always gets a word). */
const ANSWER_CHANCE = 0.3;
/** Hold a villager this long (or a boulder over a village) and Fizz starts whispering. */
const TEMPT_AFTER = 5;
const ARGUMENT_GAP = 0.35;
const STORE_KEY = 'godgame.advisors.v1';

export type Who = 'spirit' | 'imp';
export interface Line {
  who: Who;
  text: string;
}
type Priority = 'important' | 'chat';

const EATEN: Line[] = [
  { who: 'imp', text: 'Your golem just ate a villager. Chef\'s kiss.' },
  { who: 'spirit', text: 'That is not funny. That was somebody\'s grandad.' },
];

const NAME: Record<Who, string> = { spirit: 'Lumi', imp: 'Fizz' };

/**
 * Their painted portraits (public/advisors, cropped from the NAS board "2026-10-16 Lumi and Fizz portraits"). Lumi
 * is a spirit of light, warm (b) or hurt, one tear of light (c), when you are cruel; Fizz is smug (a) or cackling (b)
 * at mischief. Which face goes with a line is read from the line itself (LUMI_HURT, FIZZ_CACKLE). The little drawn
 * faces they had before are gone.
 */
type Mood = 'speak' | 'hurt' | 'cackle';
const PORTRAIT: Record<Who, Partial<Record<Mood, string>> & { speak: string }> = {
  spirit: { speak: 'lumi-b', hurt: 'lumi-c' },
  imp: { speak: 'fizz-a', cackle: 'fizz-b' },
};
const LUMI_HURT = /^(Oh no|That is not funny|That was somebody|It will\. Sadly|It would also make a hole|Please |Fizz!|Fizz\.\.\.)/;
const FIZZ_CACKLE = /^(Ha\b|Smashing|Whoops|Ooh|Delightfully|Delicious|Echo|They bounce|My favourite part|Your golem|And his face)/;
const moodOf = ({ who, text }: Line): Mood =>
  who === 'spirit' ? (LUMI_HURT.test(text) ? 'hurt' : 'speak') : FIZZ_CACKLE.test(text) ? 'cackle' : 'speak';
export const advisorPortraitUrl = (id: string, size: 192 | 384) => `${import.meta.env.BASE_URL}advisors/${id}-${size}.webp`;
const portraitOf = (line: Line) => PORTRAIT[line.who][moodOf(line)] ?? PORTRAIT[line.who].speak;

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ the words

const ANSWERED: Record<PrayerKind, Line[][]> = {
  timber: [
    [{ who: 'spirit', text: 'Lovely! A new roof means a happy family.' }],
    [{ who: 'imp', text: 'Logs! The thrill never gets old.' }],
  ],
  food: [
    [{ who: 'spirit', text: 'Full tummies make full hearts.' }],
    [{ who: 'imp', text: 'Bread diplomacy. Very effective.' }],
  ],
  rain: [
    [{ who: 'spirit', text: 'Listen to the fields drinking. Lovely.' }],
    [{ who: 'imp', text: 'My favourite part is when it lands on someone else.' }],
  ],
  lost: [
    [{ who: 'spirit', text: 'Home safe! I might cry a little.' }],
    [{ who: 'imp', text: 'Found them! They were behind the tree. I said so. Eventually.' }],
  ],
  fire: [
    [{ who: 'spirit', text: 'Quick thinking! Everyone is safe.' }],
    [{ who: 'imp', text: 'Phew. A shame about the marshmallows.' }],
  ],
  sign: [
    [{ who: 'spirit', text: 'A sign! They will talk about this for years.' }],
    [{ who: 'imp', text: 'Showing off, are we? Fine. Nicely done.' }],
  ],
  project: [
    [{ who: 'spirit', text: 'Look what they built together. That is faith, made of stone and timber.' }],
    [{ who: 'imp', text: 'A building! With walls and everything. I am almost impressed.' }],
  ],
};

const CRUEL_DEATH: Line[][] = [
  [
    { who: 'imp', text: 'Ha! Splat. ...I mean, how dreadful.' },
    { who: 'spirit', text: 'Fizz!', },
  ],
  [
    { who: 'spirit', text: 'Oh no. Please be gentler with them.' },
    { who: 'imp', text: 'They bounce so well, though.' },
  ],
  [
    { who: 'imp', text: 'Whoops. That one will be remembered.' },
    { who: 'spirit', text: 'It will. Sadly.' },
  ],
];

/** The very first answered prayer: where the player first meets them. */
const FIRST_ANSWER: Line[] = [
  { who: 'spirit', text: 'They heard you! Look at those little faces light up.' },
  { who: 'imp', text: 'Fine, that was good. Do not let it go to your head.' },
];

/** Fizz's temptations (and Lumi's answer), when the hand lingers with something it could misuse. */
const TEMPT_VILLAGER: Line[][] = [
  [
    { who: 'imp', text: 'Go on. One little toss. They love it. Probably.' },
    { who: 'spirit', text: 'Fizz! They are not a ball.' },
  ],
  [
    { who: 'imp', text: 'You know, from up here they look very... throwable.' },
    { who: 'spirit', text: 'They can hear you, you know.' },
  ],
];
const TEMPT_BOULDER: Line[][] = [
  [
    { who: 'imp', text: 'That boulder would make such a lovely noise. Right about... there.' },
    { who: 'spirit', text: 'It would also make a hole in somebody\'s roof.' },
  ],
];

// ---------------------------------------------------------------- the class

interface Queued {
  line: Line;
  pri: Priority;
  /** Wait this long (real seconds) after the previous card ended. */
  gap: number;
  argument: boolean;
}

export class Advisors {
  muted = false;
  private readonly card: HTMLDivElement;
  private readonly faceEl: HTMLDivElement;
  private readonly faceImg: HTMLImageElement;
  private readonly nameEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private argument = false;
  private loading = false;
  private generation = 0;
  private stopVoice: (() => void) | null = null;
  private clock = 0;
  private cardLife = 0;
  private showing = false;
  private lastEnd = -999;
  private lastChat = -999;
  private readonly queue: Queued[] = [];
  private readonly topics = new Map<string, number>();
  private moodTopic = 0;
  /** Real seconds the hand has held its current temptation. */
  private holding = 0;
  /** The golem has eaten someone and the first time has not been said yet (it waits for a free moment, never skipped). */
  private eatenPending = false;
  private eatenSaid = false;

  /**
   * Lumi and Fizz are characters, not a tutorial (the no-hints rule): they react to what you do,
   * praise, grumble and tempt, but never explain the controls. The game teaches through play.
   */
  constructor(private readonly game: Game) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { muted?: boolean };
      this.muted = !!raw.muted;
    } catch {
      /* storage unavailable: carry on without it */
    }

    this.card = document.createElement('div');
    this.card.className = 'adv-card';
    this.card.setAttribute('role', 'status');
    this.card.setAttribute('aria-live', 'polite');
    this.card.innerHTML = '<div class="adv-face"><img alt="" draggable="false"></div><div class="adv-body"><div class="adv-name"></div><div class="adv-text"></div></div>';
    this.faceEl = this.card.querySelector('.adv-face')!;
    this.faceImg = this.faceEl.querySelector('img')!;
    // Warm the cache, so the first line of each face never shows an empty circle.
    for (const who of ['spirit', 'imp'] as const) for (const id of Object.values(PORTRAIT[who])) new Image().src = advisorPortraitUrl(id, 192);
    this.nameEl = this.card.querySelector('.adv-name')!;
    this.textEl = this.card.querySelector('.adv-text')!;
    this.card.onclick = () => (this.cardLife = 0);
    game.hud.root.appendChild(this.card);

    this.toggle = document.createElement('button');
    this.toggle.className = 'speed-btn';
    this.toggle.textContent = '💬';
    this.toggle.title = 'Advisors on/off';
    this.toggle.onclick = () => this.setMuted(!this.muted);
    (game.hud.root.querySelector('.speeds') ?? game.hud.root).appendChild(this.toggle);
    this.syncToggle();
    this.listen();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) {
      this.queue.length = 0;
      this.finish();
    }
    this.syncToggle();
    this.save();
  }

  private syncToggle() {
    this.toggle.classList.toggle('active', this.muted);
    this.toggle.style.opacity = this.muted ? '0.55' : '';
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ muted: this.muted }));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------- reactions

  private listen() {
    const g = this.game;
    const ev = g.events;
    ev.on('miracle', ({ id }) => {
      if (id === 'fire') {
        this.say(
          [
            { who: 'imp', text: 'Ooh, fire! Marvellous, in a slightly worrying way.' },
            { who: 'spirit', text: 'Please keep it away from the houses.' },
          ],
          { pri: 'chat', topic: 'fire' },
        );
      }
    });
    ev.on('villageConverted', ({ village }) => this.converted(village));
    ev.on('villageLost', ({ village }) =>
      this.say(
        [
          { who: 'spirit', text: `Oh, ${village.name}. They have stopped believing.` },
          { who: 'imp', text: 'Easy come, easy go.' },
        ],
        { pri: 'chat', topic: 'lost-village', cooldown: 200 },
      ),
    );
    ev.on('villagerDied', ({ cause, byPlayer }) => {
      if (cause === 'eaten') {
        // The first time is always said (2026-10-15 playtest: it ate two villagers without a word); later ones are chatter.
        if (!this.eatenSaid) this.eatenPending = true;
        else this.say(EATEN, { pri: 'chat', topic: 'eaten' });
      } else if (byPlayer) this.react(pick(CRUEL_DEATH), 'death');
    });
    ev.on('houseDestroyed', ({ byPlayer }) => {
      if (!byPlayer) return;
      this.react(
        [
          { who: 'imp', text: 'Smashing! Literally.' },
          { who: 'spirit', text: 'That was somebody\'s home.' },
        ],
        'house',
      );
    });
  }

  private react(lines: Line[], topic: string) {
    if (this.argument || this.queue.some((q) => q.argument)) {
      this.queue.length = 0;
      this.finish();
    }
    this.say(lines, { pri: 'important', topic });
  }

  private converted(v: Village) {
    // It knelt out of fear (Vexahl's ring, src/rival/Ring.ts): no joy; the ring has its own lines.
    if (v.fear) return;
    this.say(
      pick([
        [
          { who: 'spirit', text: `All of ${v.name} believes in you now. I am a little verklempt.` },
          { who: 'imp', text: 'More followers means more dancers. I approve.' },
        ],
        [
          { who: 'imp', text: `${v.name} is yours! Try not to look smug.` },
          { who: 'spirit', text: 'Look at them dance!' },
        ],
      ]),
      { pri: 'important', topic: 'converted', cooldown: 0 },
    );
  }

  /** Called by the plugin whenever a prayer is answered. */
  prayerAnswered(p: Prayer, totalAnswered: number) {
    if (totalAnswered === 1) {
      this.say(FIRST_ANSWER, { pri: 'important', topic: 'answered-first', cooldown: 0 });
      return;
    }
    if (Math.random() < ANSWER_CHANCE) this.say(pick(ANSWERED[p.kind]), { pri: 'chat', topic: 'answered', cooldown: 150 });
  }

  // -------------------------------------------------------------- the queue

  /** Offer something for the advisors to say. Returns false if it was held back (muted, too soon...). */
  say(lines: Line | Line[], opts: { pri?: Priority; topic?: string; cooldown?: number; argument?: boolean } = {}): boolean {
    if (this.muted) return false;
    const arr = (Array.isArray(lines) ? lines : [lines]).filter((line) => line.text.trim());
    if (!arr.length) return false;
    const pri = opts.pri ?? 'chat';
    const topic = opts.topic;
    if (topic && this.clock - (this.topics.get(topic) ?? -1e9) < (opts.cooldown ?? TOPIC_COOLDOWN)) return false;
    const busy = this.showing || this.loading || this.queue.length > 0;
    if (pri === 'chat') {
      if (busy || this.clock - this.lastEnd < CHAT_GAP || this.clock - this.lastChat < CHAT_MIN) return false;
      this.lastChat = this.clock;
    } else if (this.queue.some((q) => q.pri === 'important')) return false;
    if (topic) this.topics.set(topic, this.clock);
    arr.forEach((line, i) => this.queue.push({ line, pri, gap: i === 0 ? (pri === 'important' ? 2 : 0) : opts.argument ? ARGUMENT_GAP : 1, argument: !!opts.argument }));
    return true;
  }

  private finish(keepArgument = false) {
    this.generation++;
    this.loading = false;
    this.stopVoice?.();
    this.stopVoice = null;
    this.showing = false;
    this.cardLife = 0;
    this.lastEnd = this.clock;
    // Between two lines of one argument the bubble stays up and only its words and face change.
    if (!keepArgument) {
      this.card.classList.remove('show');
      this.argument = false;
      // Once it has faded, empty it: its name must not linger next to whoever speaks next (Ora was read as "LUMI").
      const gen = this.generation;
      window.setTimeout(() => {
        if (gen !== this.generation || this.showing || this.card.classList.contains('show')) return;
        this.nameEl.textContent = '';
        this.textEl.textContent = '';
      }, 450);
    }
  }

  private async showNext() {
    const q = this.queue.shift()!;
    const token = ++this.generation;
    this.loading = true;
    const clip = await this.game.audio.advisorClip(q.line.text);
    if (token !== this.generation) return;
    this.loading = false;
    // Vexahl's card took the top centre while this line's voice loaded: wait for it, then say this line.
    if (this.game.hud.root.querySelector('.rv-card.show')) {
      this.queue.unshift(q);
      return;
    }
    const { who, text } = q.line;
    this.argument = q.argument;
    const wasUp = this.card.classList.contains('show');
    this.card.className = `adv-card ${who}${wasUp ? ' show' : ''}`;
    const face = portraitOf(q.line);
    this.faceImg.src = advisorPortraitUrl(face, 192);
    this.faceImg.srcset = `${advisorPortraitUrl(face, 192)} 1x, ${advisorPortraitUrl(face, 384)} 2x`;
    this.card.dataset.face = moodOf(q.line);
    this.nameEl.textContent = NAME[who];
    this.textEl.textContent = text;
    this.showing = true;
    this.cardLife = Math.max(Math.min(9.5, 3.8 + text.length * 0.05), (clip?.duration ?? 0) + 0.6);
    this.place();
    this.game.audio.click();
    if (clip) this.stopVoice = this.game.audio.playAdvisorClip(clip);
    else this.game.audio.advisorVoice(who);
  }

  // -------------------------------------------------------------- per frame

  frame(dt: number) {
    const g = this.game;
    if (g.hud.helpOpen) {
      if (this.showing || this.loading || this.argument) this.finish();
      return;
    }
    this.clock += dt;

    if (this.eatenPending && !this.muted) {
      if (this.argument || this.queue.some((q) => q.argument)) {
        this.queue.length = 0;
        this.finish();
      }
      if (this.say(EATEN, { pri: 'important', topic: 'eaten', cooldown: 0 })) {
        this.eatenPending = false;
        this.eatenSaid = true;
      }
    }

    if (this.showing) {
      this.cardLife -= dt;
      if (this.cardLife <= 0) {
        this.finish(this.argument && !!this.queue[0]?.argument);
      }
    } else if (!this.loading && this.queue.length && this.clock - this.lastEnd >= this.queue[0].gap && !g.hud.root.querySelector('.rv-card.show')) void this.showNext(); // Vexahl's card has the top centre: wait

    this.watchMood();
    this.watchTemptation(dt);
    this.place();
  }

  /** One speech bubble, top centre, and only ever with words in it. */
  private place() {
    this.card.classList.toggle('show', (this.showing || this.argument) && !!this.textEl.textContent?.trim());
  }

  private watchMood() {
    const a = this.game.player.alignment;
    this.moodTopic += 1;
    if (this.moodTopic % 30 !== 0) return;
    if (a > 0.3) {
      this.say(
        [
          { who: 'spirit', text: 'You are becoming such a kind god. The whole island feels warmer.' },
          { who: 'imp', text: 'Ugh. So wholesome. Carry on.' },
        ],
        { pri: 'chat', topic: 'kind', cooldown: 400 },
      );
    } else if (a < -0.3) {
      this.say(
        [
          { who: 'imp', text: 'Delightfully wicked. I am so proud.' },
          { who: 'spirit', text: 'Fizz... they are watching, you know.' },
        ],
        { pri: 'chat', topic: 'cruel', cooldown: 400 },
      );
    }
  }

  /** Fizz notices when the hand lingers with a villager, or with a boulder over a village. */
  private watchTemptation(dt: number) {
    const g = this.game;
    const held = g.hand.held;
    const villager = held?.kind === 'villager';
    const boulder = held?.kind === 'rock' && !!g.villageAt(held.pos.x, held.pos.z);
    this.holding = villager || boulder ? this.holding + dt : 0;
    if (this.holding < TEMPT_AFTER) return;
    this.holding = 0;
    this.say(pick(villager ? TEMPT_VILLAGER : TEMPT_BOULDER), { pri: 'important', topic: 'tempt', cooldown: 420, argument: true });
  }
}
