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

const FACE: Record<Who, string> = {
  spirit: `<svg viewBox="0 0 52 52" aria-hidden="true">
    <circle class="adv-spirit-glow" cx="26" cy="28" r="22" fill="#bfe6ff" opacity="0.25"/>
    <ellipse cx="26" cy="9.5" rx="10" ry="3" fill="none" stroke="#ffe9a8" stroke-width="2"/>
    <circle cx="26" cy="29" r="15" fill="#eef8ff"/>
    <circle cx="26" cy="29" r="15" fill="none" stroke="#bfe6ff" stroke-width="1.5"/>
    <path d="M18.5 27.5q3-3.2 6 0M27.5 27.5q3-3.2 6 0" fill="none" stroke="#4a6f94" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="19" cy="33" r="2.6" fill="#ffb5c0" opacity="0.65"/><circle cx="33" cy="33" r="2.6" fill="#ffb5c0" opacity="0.65"/>
    <path class="adv-mouth" d="M22.5 34q3.5 4 7 0" fill="none" stroke="#4a6f94" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M42 11l1.2 2.6 2.6 1.2-2.6 1.2L42 18.6l-1.2-2.6-2.6-1.2 2.6-1.2z" fill="#fff3c4"/>
  </svg>`,
  imp: `<svg viewBox="0 0 52 52" aria-hidden="true">
    <path d="M14 20L10 6l11 8zM38 20l4-14-11 8z" fill="#7a1f16"/>
    <path d="M11 30l-7-4 5 9zM41 30l7-4-5 9z" fill="#d95a36"/>
    <circle cx="26" cy="30" r="15" fill="#f0764d"/>
    <ellipse cx="20" cy="28" rx="3.4" ry="3.8" fill="#fff6e0"/><ellipse cx="32" cy="28" rx="3.4" ry="3.8" fill="#fff6e0"/>
    <circle cx="21" cy="28.6" r="1.7" fill="#2a1410"/><circle cx="33" cy="28.6" r="1.7" fill="#2a1410"/>
    <path d="M15.5 22.5l8 2.4M36.5 22.5l-8 2.4" stroke="#7a1f16" stroke-width="2" stroke-linecap="round"/>
    <path class="adv-mouth" d="M17 35q9 8 18 0z" fill="#3a1410"/>
    <path d="M23 35.6l1.8 3 1.8-3z" fill="#fff6e0"/>
  </svg>`,
};

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
    this.card.innerHTML = '<div class="adv-face"></div><div class="adv-body"><div class="adv-name"></div><div class="adv-text"></div></div>';
    this.faceEl = this.card.querySelector('.adv-face')!;
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
    this.faceEl.innerHTML = FACE[who];
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
