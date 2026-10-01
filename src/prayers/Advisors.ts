import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Prayer, PrayerKind } from './Prayers';

// ------------------------------------------------------------- tuning knobs

/** Real seconds after the game starts before the first onboarding card. */
const ONBOARD_START = 9;
/** Pause after one onboarding step is done before the next is offered. */
const ONBOARD_PAUSE = 8;
/** Give up waiting on a step after this long and move on (never nag). */
const ONBOARD_PATIENCE = 120;
/** Chatter: at least this long since the last card ended, and this long between chats. */
const CHAT_GAP = 45;
const CHAT_MIN = 80;
/** Default cooldown for one topic of chatter. */
const TOPIC_COOLDOWN = 150;
/** The golem key ('C') or call ('L') counts as meeting it. */
const GOLEM_KEYS = new Set(['c', 'l']);
const STORE_KEY = 'godgame.advisors.v1';

export type Who = 'spirit' | 'imp';
export interface Line {
  who: Who;
  text: string;
}
type Priority = 'onboard' | 'important' | 'chat';

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

/** Everything the advisors say that is not an onboarding step. */
const FIRST_ANSWER: Line[] = [
  { who: 'spirit', text: 'They heard you! Look at those little faces light up.' },
  { who: 'imp', text: 'Fine, that was good. Do not let it go to your head.' },
];

interface Step {
  id: string;
  lines: Line[];
}

const STEPS: Step[] = [
  {
    id: 'grab',
    lines: [{ who: 'spirit', text: 'Hello, little god! Click a villager, tree or rock to pick it up. Gently, they are ticklish.' }],
  },
  {
    id: 'pan',
    lines: [{ who: 'imp', text: 'Bored of that view? Drag the ground with the left mouse button and the whole island slides along.' }],
  },
  {
    id: 'prayer',
    lines: [
      { who: 'spirit', text: 'Listen, the villagers are praying! Click a parchment bubble to fly over to them.' },
      { who: 'imp', text: 'They want wood. Carry a tree over and let go on their store. Riveting, I know.' },
    ],
  },
  {
    id: 'golem',
    lines: [{ who: 'imp', text: 'Psst. You own a very large pet rock. Press C to find your golem. It will pretend not to like a pat.' }],
  },
  {
    id: 'miracle',
    lines: [{ who: 'spirit', text: 'When you are ready, press 1 for rain or 2 for food. Hold the miracle over a village and let go.' }],
  },
];

// ---------------------------------------------------------------- the class

interface Queued {
  line: Line;
  pri: Priority;
  /** Wait this long (real seconds) after the previous card ended. */
  gap: number;
}

export class Advisors {
  muted = false;
  private readonly card: HTMLDivElement;
  private readonly faceEl: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly messages: HTMLElement | null;
  private readonly toggle: HTMLButtonElement;
  private clock = 0;
  private cardLife = 0;
  private showing = false;
  private lastEnd = -999;
  private lastChat = -999;
  private readonly queue: Queued[] = [];
  private readonly topics = new Map<string, number>();
  private lastBottom = '';

  // Onboarding progress, remembered between visits so a returning player isn't re-taught.
  private readonly done: Record<string, boolean> = {};
  private step = 0;
  private prompted = false;
  private promptedAt = 0;
  private nextStepAt = ONBOARD_START;
  private startTarget = { x: 0, z: 0 };
  private moodTopic = 0;

  constructor(
    private readonly game: Game,
    private readonly hasPrayers: () => boolean,
  ) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { done?: Record<string, boolean>; muted?: boolean };
      Object.assign(this.done, raw.done ?? {});
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
    this.card.title = 'Click to dismiss';
    this.card.onclick = () => (this.cardLife = 0);
    game.hud.root.appendChild(this.card);
    this.messages = game.hud.root.querySelector('.messages');

    this.toggle = document.createElement('button');
    this.toggle.className = 'speed-btn';
    this.toggle.textContent = '💬';
    this.toggle.title = 'Advisors on/off';
    this.toggle.onclick = () => this.setMuted(!this.muted);
    (game.hud.root.querySelector('.speeds') ?? game.hud.root).appendChild(this.toggle);
    this.syncToggle();

    this.startTarget = { x: game.godCam.target.x, z: game.godCam.target.z };
    this.listen();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) {
      this.queue.length = 0;
      this.cardLife = 0;
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
      localStorage.setItem(STORE_KEY, JSON.stringify({ done: this.done, muted: this.muted }));
    } catch {
      /* ignore */
    }
  }

  private mark(id: string) {
    if (this.done[id]) return;
    this.done[id] = true;
    this.save();
  }

  // ------------------------------------------------------------- reactions

  private listen() {
    const g = this.game;
    const ev = g.events;
    ev.on('grab', () => this.mark('grab'));
    ev.on('miracle', ({ id }) => {
      this.mark('miracle');
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
          { who: 'spirit', text: `${village.name} has lost heart. A kind deed might bring them back.` },
          { who: 'imp', text: 'Easy come, easy go.' },
        ],
        { pri: 'chat', topic: 'lost-village', cooldown: 200 },
      ),
    );
    ev.on('villagerDied', ({ cause, byPlayer }) => {
      if (cause === 'eaten') {
        this.say(
          [
            { who: 'imp', text: 'Your golem just ate a villager. Chef\'s kiss.' },
            { who: 'spirit', text: 'That is not funny. Please feed it a boulder.' },
          ],
          { pri: 'chat', topic: 'eaten' },
        );
      } else if (byPlayer) this.say(pick(CRUEL_DEATH), { pri: 'chat', topic: 'death' });
    });
    ev.on('houseDestroyed', ({ byPlayer }) => {
      if (!byPlayer) return;
      this.say(
        [
          { who: 'imp', text: 'Smashing! Literally.' },
          { who: 'spirit', text: 'They will need timber for that, you know.' },
        ],
        { pri: 'chat', topic: 'house' },
      );
    });
    window.addEventListener('keydown', (e) => {
      if (GOLEM_KEYS.has(e.key.toLowerCase())) this.mark('golem');
    });
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
    this.mark('prayer');
    if (totalAnswered === 1) {
      this.say(FIRST_ANSWER, { pri: 'important', topic: 'answered-first', cooldown: 0 });
      return;
    }
    if (Math.random() < 0.5) this.say(pick(ANSWERED[p.kind]), { pri: 'chat', topic: 'answered', cooldown: 60 });
  }

  // -------------------------------------------------------------- the queue

  /** Offer something for the advisors to say. Returns false if it was held back (muted, too soon...). */
  say(lines: Line | Line[], opts: { pri?: Priority; topic?: string; cooldown?: number } = {}): boolean {
    if (this.muted) return false;
    const arr = Array.isArray(lines) ? lines : [lines];
    const pri = opts.pri ?? 'chat';
    const topic = opts.topic;
    if (topic && this.clock - (this.topics.get(topic) ?? -1e9) < (opts.cooldown ?? TOPIC_COOLDOWN)) return false;
    const busy = this.showing || this.queue.length > 0;
    if (pri === 'chat') {
      if (busy || this.clock - this.lastEnd < CHAT_GAP || this.clock - this.lastChat < CHAT_MIN) return false;
      this.lastChat = this.clock;
    } else if (pri === 'onboard') {
      if (busy) return false;
    } else if (this.queue.some((q) => q.pri === 'important')) return false;
    if (topic) this.topics.set(topic, this.clock);
    arr.forEach((line, i) => this.queue.push({ line, pri, gap: i === 0 ? (pri === 'important' ? 2 : pri === 'onboard' ? 3 : 0) : 1 }));
    return true;
  }

  private showNext() {
    const q = this.queue.shift()!;
    const { who, text } = q.line;
    this.card.className = `adv-card ${who}`;
    this.faceEl.innerHTML = FACE[who];
    this.nameEl.textContent = NAME[who];
    this.textEl.textContent = text;
    // Re-trigger the little entrance and mouth animation.
    void this.card.offsetWidth;
    this.card.classList.add('show');
    this.showing = true;
    this.cardLife = Math.min(9.5, 3.8 + text.length * 0.05);
    this.game.audio.advisorVoice(who);
  }

  // -------------------------------------------------------------- per frame

  frame(dt: number) {
    const g = this.game;
    if (g.hud.helpOpen) {
      this.card.classList.remove('show');
      return;
    }
    this.clock += dt;

    if (this.showing) {
      this.cardLife -= dt;
      if (this.cardLife <= 0) {
        this.showing = false;
        this.lastEnd = this.clock;
        this.card.classList.remove('show');
      }
    } else if (this.queue.length && this.clock - this.lastEnd >= this.queue[0].gap) this.showNext();

    this.watchMood();
    this.onboard();
    this.place();
  }

  /** Sit just above the message feed. */
  private place() {
    const h = this.messages?.offsetHeight ?? 0;
    const bottom = `${18 + h + (h ? 10 : 0)}px`;
    if (bottom !== this.lastBottom) {
      this.lastBottom = bottom;
      this.card.style.bottom = bottom;
    }
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

  // -------------------------------------------------------------- onboarding

  private stepDone(id: string): boolean {
    const g = this.game;
    switch (id) {
      case 'grab':
        return !!this.done.grab;
      case 'pan':
        if (g.controls.mode === 'pan' && Math.hypot(g.godCam.target.x - this.startTarget.x, g.godCam.target.z - this.startTarget.z) > 10) this.mark('pan');
        return !!this.done.pan;
      case 'prayer':
        return !!this.done.prayer;
      case 'golem':
        return !!this.done.golem;
      default:
        if (g.hand.held?.kind === 'orb') this.mark('miracle');
        return !!this.done.miracle;
    }
  }

  /** One step at a time, driven by what the player has actually done. */
  private onboard() {
    const g = this.game;
    // Moving the camera counts even if the prompt hasn't come up yet.
    if (this.step >= STEPS.length) return;
    const s = STEPS[this.step];
    if (this.stepDone(s.id)) {
      // Done (possibly before we even asked): skip quietly, short breather before the next.
      this.step++;
      this.prompted = false;
      this.nextStepAt = Math.max(this.nextStepAt, this.clock + (this.promptedAt ? ONBOARD_PAUSE : 2));
      return;
    }
    if (!this.prompted) {
      if (this.clock < this.nextStepAt || g.time < 3) return;
      // The prayer step waits for a prayer to exist; the later ones wait for it to be answered.
      if (s.id === 'prayer' && !this.hasPrayers()) return;
      if (this.say(s.lines, { pri: 'onboard' })) {
        this.prompted = true;
        this.promptedAt = this.clock;
      }
    } else if (this.clock - this.promptedAt > ONBOARD_PATIENCE) {
      this.step++;
      this.prompted = false;
      this.nextStepAt = this.clock + ONBOARD_PAUSE;
    }
  }
}
