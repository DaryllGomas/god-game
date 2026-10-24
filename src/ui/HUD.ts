import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { MIRACLE_INFO, type MiracleId } from '../miracles/Miracles';
import { mountCloudPanel } from '../cloud/CloudPanel';
import { getLink } from '../cloud/Cloud';
import { SHRINE_STAGES, STAGE_OF_PROJECT, stageIndex, type ShrineStage } from '../shrines/stages';
import type { Entity } from '../entities/Entity';
import { RPG_URL } from '../nexus/TrueEnd';
import { trueEndSeen } from '../story/unlock';
import './hud.css';

/** The prayer place's ages, as the village list and labels name them (Totem 1/4 ... Temple 4/4). */
const AGE_NAME: Record<ShrineStage, string> = { totem: 'Totem', stone_circle: 'Stones', pyramid: 'Pyramid', temple: 'Temple' };

/** How far an owned village has climbed: the age it stands at (1-based), and how far the next age's dream has come (0..1). */
function ageOf(v: Village): { n: number; name: string; next: ShrineStage | null; part: number } {
  const i = stageIndex(v.shrineStage);
  const next = SHRINE_STAGES[i + 1] ?? null;
  const site = v.projectSite as { def?: { id?: string }; fraction?: number } | null;
  const building = site?.def?.id ? STAGE_OF_PROJECT[site.def.id as keyof typeof STAGE_OF_PROJECT] : undefined;
  const part = next && building === next ? Math.max(0, Math.min(0.98, site?.fraction ?? 0)) : 0;
  return { n: i + 1, name: AGE_NAME[v.shrineStage], next, part };
}

/** Village name labels keep this far (px) inside the screen's edge. */
const LABEL_EDGE = 6;

type Tone = 'good' | 'bad' | 'info' | 'warn' | 'divine';

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class HUD {
  readonly root: HTMLDivElement;
  private readonly powerFill: HTMLDivElement;
  private readonly powerVal: HTMLDivElement;
  private powerHtml = '';
  private readonly alignMarker: HTMLDivElement;
  private readonly alignName: HTMLSpanElement;
  private readonly clock: HTMLDivElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly miracleBtns = new Map<MiracleId, HTMLButtonElement>();
  private readonly villageList: HTMLDivElement;
  private readonly villageRows = new Map<Village, HTMLDivElement>();
  private readonly detail: HTMLDivElement;
  private readonly labels = new Map<Village, HTMLDivElement>();
  private readonly labelLayer: HTMLDivElement;
  /** Each label's last measured box (layout px, before its scale), for keeping it on screen. */
  private labelMeasureT = 0;
  private readonly labelSig = new Map<HTMLDivElement, string>();
  private readonly labelSize = new Map<HTMLDivElement, { w: number; h: number }>();
  private readonly messages: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  /** "Storehouse: drop gifts here", over a storehouse the hand is over (or carrying something toward). */
  private readonly storeTip: HTMLDivElement;
  private storeTipFor: Entity | null = null;
  private readonly floats: FloatText[] = [];
  private readonly lastMsg = new Map<string, number>();
  private readonly proj = new THREE.Vector3();
  private detailVillage: Village | null = null;
  private soundBtn!: HTMLButtonElement;
  private musicBtn!: HTMLButtonElement;
  private bannerTimer = 0;
  private slowTimer = 0;
  /** The title screen has been dismissed at least once. */
  private begun = false;

  constructor(
    private readonly game: Game,
    parent: HTMLElement,
  ) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    // Keep buttons from taking keyboard focus, so Space/number keys always reach the game.
    this.root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });

    // --- Power & alignment
    const tl = el('div', 'panel top-left');
    tl.innerHTML = `
      <div class="stat-label">Prayer Power</div>
      <div class="power-bar"><div class="power-fill"></div><div class="power-shine"></div></div>
      <div class="power-val"></div>
      <div class="stat-label align-label">Alignment <span class="align-name"></span></div>
      <div class="align-bar"><div class="align-marker"></div></div>
    `;
    this.root.appendChild(tl);
    this.powerFill = tl.querySelector('.power-fill')!;
    this.powerVal = tl.querySelector('.power-val')!;
    this.alignMarker = tl.querySelector('.align-marker')!;
    this.alignName = tl.querySelector('.align-name')!;

    // --- Villages list
    this.villageList = el('div', 'panel villages');
    this.villageList.appendChild(el('div', 'stat-label', 'Villages'));
    this.root.appendChild(this.villageList);

    // --- Clock & speed
    const tr = el('div', 'panel top-right');
    this.clock = el('div', 'clock');
    tr.appendChild(this.clock);
    const speeds = el('div', 'speeds');
    const labels: [string, number][] = [
      ['❚❚', 0],
      ['1×', 1],
      ['2×', 2],
      ['4×', 4],
    ];
    for (const [label, s] of labels) {
      const b = el('button', 'speed-btn', label);
      b.title = s === 0 ? 'Pause (P)' : `Speed ${label}  ([ / ])`;
      b.onclick = () => (s === 0 ? game.togglePause() : game.setSpeed(s));
      speeds.appendChild(b);
      this.speedBtns.push(b);
    }
    const sound = el('button', 'speed-btn', '🔊');
    sound.title = 'Sound on/off (M)';
    sound.onclick = () => this.toggleSound();
    this.soundBtn = sound;
    speeds.appendChild(sound);
    const music = el('button', 'speed-btn', '♪');
    music.title = 'Music on/off (N)';
    music.onclick = () => this.toggleMusic();
    this.musicBtn = music;
    speeds.appendChild(music);
    const helpBtn = el('button', 'speed-btn help-btn', '?');
    helpBtn.title = 'Controls (H)';
    helpBtn.onclick = () => this.toggleHelp();
    speeds.appendChild(helpBtn);
    tr.appendChild(speeds);
    this.root.appendChild(tr);

    // --- Miracle dock
    const dock = el('div', 'dock');
    for (const id of Object.keys(MIRACLE_INFO) as MiracleId[]) {
      const info = MIRACLE_INFO[id];
      const b = el(
        'button',
        'miracle',
        `<span class="m-icon">${info.icon}</span><span class="m-name">${info.name}</span><span class="m-cost">${info.cost}</span><span class="m-key">${info.key}</span>`,
      );
      b.style.setProperty('--m-color', hex(info.color));
      b.onclick = () => game.selectMiracle(id);
      dock.appendChild(b);
      this.miracleBtns.set(id, b);
    }
    this.root.appendChild(dock);

    // --- Village detail
    this.detail = el('div', 'panel detail hidden');
    this.root.appendChild(this.detail);

    // --- Layers
    this.labelLayer = el('div', 'label-layer');
    this.root.appendChild(this.labelLayer);
    this.messages = el('div', 'messages');
    this.root.appendChild(this.messages);
    this.banner = el('div', 'banner');
    this.root.appendChild(this.banner);
    this.storeTip = el('div', 'store-tip', '<b>Storehouse</b><span>drop gifts here</span>');
    this.labelLayer.appendChild(this.storeTip);

    // --- Help overlay (also the title screen)
    // On the title screen only the essentials show (a name, Begin); the controls wait behind a small link and are
    // open in the ? screen (playtest 2026-10-15: "a wall of controls").
    this.help = el('div', 'overlay help title');
    this.help.innerHTML = `
      <div class="overlay-card">
        <h1>THE FIRST WORLD</h1>
        <p class="tagline">An island of villagers awaits a god. What kind of god will you be?</p>
        <div class="help-more">
        <div class="help-grid">
          <div><b>Grab</b><span>Left-click a villager, tree, rock or food</span></div>
          <div><b>Drag the land</b><span>Left-drag the ground</span></div>
          <div><b>Set down</b><span>Left-click the ground while holding</span></div>
          <div><b>Throw</b><span>Hold right button, flick the mouse, release</span></div>
          <div><b>Rotate / tilt</b><span>Right- or middle-drag (empty hand), Q/E, T/G</span></div>
          <div><b>Zoom</b><span>Mouse wheel, R/F. Double-click to fly somewhere</span></div>
          <div><b>Miracles</b><span>1 Water · 2 Food · 3 Fire, then throw or set down. Esc refunds</span></div>
          <div><b>Draw a mark</b><span>Hold Ctrl, left-drag: wave, spiral, zigzag, or a cradle with a sprout</span></div>
          <div><b>Village</b><span>Click a building to see it and set how many worship</span></div>
          <div class="pad-only"><b>Controller</b><span>Left stick moves your hand · A grabs, A again sets down (or hold A and let go) · hold A on bare land and move to drag the land · B puts back / closes · X home (hold X + right stick to turn the view) · Y finds your golem (hold: calls it; with something in hand: hold, aim, let go to throw) · right stick pans · stick clicks zoom · D-pad: Water, Food, Fire, pause · View: this screen</span></div>
          <div><b>Your creature</b><span>C finds your golem, L calls it over. Stroke it (left-click &amp; rub) when it does something you like, slap it (right-click) when it doesn't</span></div>
        </div>
        <div class="help-goal">
          <b>Your goal:</b> worshippers dancing at your village totem generate <i>prayer power</i>.
          Win over the neutral villages of the island by <i>impressing</i> them: gifts of food, rain, spectacular
          throws, or terrifying fire. Your hand only works inside your golden ring of influence, but you can throw anything beyond it.
          Kindness and cruelty both work. The island will remember which you chose.
        </div>
        <div class="hint">Press <b>H</b> any time for this screen · <b>Space</b> returns home · <b>P</b> pauses · <b>M</b> mutes · <b>N</b> music</div>
        </div>
        <div class="save-summary hidden"></div>
        <button class="begin">Begin</button>
        <button class="talk-next hidden" type="button"><span class="talk-next-label">Continue to Beyond the Nexus</span><small>in development</small></button>
        <div class="new-island"></div>
        <button class="help-toggle" type="button" aria-expanded="false">controls</button>
      </div>`;
    this.help.querySelector<HTMLButtonElement>('.begin')!.onclick = () => this.toggleHelp(false);
    // The ? screen is already up as the title when the page loads (toggleHelp never runs then), so decide Continue's
    // visibility now too; otherwise it only showed after closing and reopening the screen.
    this.help.querySelector('.talk-next')!.classList.toggle('hidden', !trueEndSeen());
    this.help.querySelector<HTMLButtonElement>('.talk-next')!.onclick = () => {
      this.game.saves.save('quiet');
      window.location.href = RPG_URL;
    };
    const more = this.help.querySelector<HTMLButtonElement>('.help-toggle')!;
    more.onclick = () => {
      const open = this.help.classList.toggle('show-controls');
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'hide controls' : 'controls';
    };
    this.root.appendChild(this.help);
    this.setupSaveControls();
    mountCloudPanel(game, this.help);

    this.win = el('div', 'overlay win hidden');
    this.root.appendChild(this.win);

    for (const v of game.villages) this.addVillage(v);
  }

  private addVillage(v: Village) {
    // A row is a way there: click (or Enter) flies to the village and opens what it needs. It looks like one
    // (hover, a chevron, a focus ring): the playtest of 2026-10-15 found it only by accident.
    const row = el('div', 'v-row');
    row.innerHTML = `<span class="v-dot"></span><span class="v-name">${v.name}</span><span class="v-status"></span><span class="v-go" aria-hidden="true">›</span><div class="v-bar"><div class="v-fill"></div><div class="v-segs"></div></div>`;
    row.querySelector<HTMLSpanElement>('.v-dot')!.style.background = hex(v.color);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.onclick = () => {
      this.game.selectVillage(v);
      this.game.godCam.flyTo(v.center.x, v.center.z);
    };
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      row.click();
    });
    // A click must not leave the row focused (Space and the number keys belong to the game), but Tab still reaches it.
    row.addEventListener('mousedown', (e) => e.preventDefault());
    this.villageList.appendChild(row);
    this.villageRows.set(v, row);

    const label = el('div', 'v-label');
    label.innerHTML = `<div class="vl-name">${v.name}</div><div class="vl-bar"><div class="vl-fill"></div><div class="v-segs"></div></div><div class="vl-age"></div>`;
    this.labelLayer.appendChild(label);
    this.labels.set(v, label);
  }

  // ------------------------------------------------------------- public api

  get helpOpen() {
    return !this.help.classList.contains('hidden');
  }

  toggleHelp(force?: boolean) {
    const show = force ?? !this.helpOpen;
    if (show) this.help.querySelector('.talk-next')?.classList.toggle('hidden', !trueEndSeen());
    this.help.classList.toggle('hidden', !show);
    if (!show) {
      // Closing the title screen starts (or continues) the island: from here on it is autosaved.
      this.game.saves.arm();
      this.begun = true;
      // From now on this is the ? screen: the controls are the point of it.
      this.help.classList.remove('title');
      const begin = this.help.querySelector<HTMLButtonElement>('.begin');
      if (begin && begin.textContent !== 'Resume') begin.textContent = 'Resume';
      this.showNewIsland(false);
    }
  }

  /** Title screen: Continue (with a summary) when a save exists; "Start a new island" (with a confirm step) in the help screen. */
  private setupSaveControls() {
    const saves = this.game.saves;
    const begin = this.help.querySelector<HTMLButtonElement>('.begin')!;
    const summary = this.help.querySelector<HTMLDivElement>('.save-summary')!;
    if (saves.loaded) {
      begin.textContent = 'Continue';
      summary.textContent = saves.summary;
      summary.classList.remove('hidden');
      this.showNewIsland(false);
    }
    if (saves.consumeAutostart()) this.toggleHelp(false);
  }

  /** The small "New island" control under the main button; `confirm` swaps it for a yes/no question. */
  private showNewIsland(confirm: boolean) {
    const box = this.help.querySelector<HTMLDivElement>('.new-island')!;
    const saves = this.game.saves;
    box.textContent = '';
    // Nothing to wipe on a brand-new island that has not started yet.
    if (!saves.armed) return;
    if (!confirm) {
      const b = el('button', '', saves.loaded && !this.begun ? 'New island' : 'Start a new island');
      b.onclick = () => this.showNewIsland(true);
      box.appendChild(b);
      return;
    }
    box.appendChild(el('span', 'warn', getLink() ? 'This clears the island on this device. Your island code still opens the old one.' : 'This wipes your saved island for good.'));
    const yes = el('button', 'danger', 'Yes, start anew');
    yes.onclick = () => saves.newIsland();
    const no = el('button', '', 'Keep my island');
    no.onclick = () => this.showNewIsland(false);
    box.append(yes, no);
  }

  toggleSound() {
    const a = this.game.audio;
    a.setMuted(!a.muted);
    this.soundBtn.textContent = a.muted ? '🔇' : '🔊';
    this.soundBtn.classList.toggle('active', a.muted);
  }

  toggleMusic() {
    const a = this.game.audio;
    a.setMusic(!a.musicOn);
    this.musicBtn.classList.toggle('active', !a.musicOn);
    this.musicBtn.style.textDecoration = a.musicOn ? '' : 'line-through';
  }

  closeOverlays() {
    this.toggleHelp(false);
    this.game.selectVillage(null);
  }

  message(text: string, tone: Tone = 'info', key?: string) {
    const k = key ?? text;
    const now = performance.now();
    if (now - (this.lastMsg.get(k) ?? -1e9) < 4000) return;
    this.lastMsg.set(k, now);
    const m = el('div', `msg ${tone}`, text);
    this.messages.prepend(m);
    while (this.messages.children.length > 6) this.messages.lastElementChild!.remove();
    setTimeout(() => m.classList.add('fade'), 7000);
    setTimeout(() => m.remove(), 8200);
  }

  showBanner(text: string, sub = '') {
    this.banner.innerHTML = `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    this.banner.classList.add('show');
    this.bannerTimer = 4.5;
  }

  floatText(x: number, y: number, z: number, text: string, color = '#ffe9a8') {
    const e = el('div', 'float-text', text);
    e.style.color = color;
    this.labelLayer.appendChild(e);
    this.floats.push({ el: e, pos: new THREE.Vector3(x, y, z), age: 0 });
  }

  showWin(stats: { time: string; alignment: string; followers: number }) {
    this.win.innerHTML = `
      <div class="overlay-card">
        <h1>The Island Is Yours</h1>
        <p class="tagline">Your Wonder shines over the island and every village dances for you. They know you as a <b>${stats.alignment.toLowerCase()}</b> god.</p>
        <div class="help-goal">Followers: <b>${stats.followers}</b> · Time: <b>${stats.time}</b></div>
        <p class="tagline"><i>...but far across the sea, something stirs.</i></p>
        <button class="begin">Keep playing</button>
      </div>`;
    this.win.querySelector<HTMLButtonElement>('.begin')!.onclick = () => this.win.classList.add('hidden');
    this.win.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const g = this.game;
    const p = g.player;

    // Power
    this.powerFill.style.width = `${(p.power / p.maxPower) * 100}%`;
    const rate = g.villages.reduce((s, v) => s + v.prayerRate, 0);
    const power = `${Math.floor(p.power)} <span class="rate">${rate > 0 ? `+${rate.toFixed(1)}/s` : this.quietNote()}</span>`;
    if (power !== this.powerHtml) this.powerVal.innerHTML = this.powerHtml = power;

    // Alignment: left = evil, right = good
    this.alignMarker.style.left = `${(p.alignment * 0.5 + 0.5) * 100}%`;
    this.alignName.textContent = p.alignmentLabel;
    this.alignName.className = `align-name ${p.alignment > 0.2 ? 'good' : p.alignment < -0.2 ? 'evil' : ''}`;

    // Miracles
    const heldOrb = g.hand.held?.kind === 'orb' ? (g.hand.held as unknown as { miracle: MiracleId }).miracle : null;
    for (const [id, b] of this.miracleBtns) {
      b.classList.toggle('disabled', !p.canAfford(MIRACLE_INFO[id].cost));
      b.classList.toggle('active', heldOrb === id);
    }

    // Speed
    this.speedBtns.forEach((b, i) => {
      const s = [0, 1, 2, 4][i];
      b.classList.toggle('active', s === 0 ? g.paused : !g.paused && g.speed === s);
    });

    // Clock
    const hours = (g.dayTime * 24) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    const icon = g.sky.isNight ? '🌙' : '☀️';
    this.clock.textContent = `${icon} Day ${g.day}  ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    this.updateLabels(dt);
    this.updateStoreTip();
    this.updateFloats(dt);

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.25;
      this.updateVillageList();
      this.updateDetail();
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  /**
   * The prayer line's words while nobody is dancing this very instant. It counts dancers, not believers (2026-10-18
   * playtest: "no worshippers" showed under a standing temple, at night, in snow and at the start of a game), so it says
   * why the dance is quiet instead.
   */
  private quietNote(): string {
    const g = this.game;
    if (g.sky.isNight) return 'resting for the night';
    let hungry = false;
    for (const v of g.villages) {
      if (v.owner === 'rival') continue;
      if (v.worshipperCount > 0) return 'gathering to pray';
      if (v.owner === 'player' && v.villagers.some((p) => !p.dead && p.hunger >= 0.6)) hungry = true;
    }
    return hungry ? 'the people are hungry' : 'none dancing just now';
  }

  private project(pos: THREE.Vector3): { x: number; y: number; visible: boolean; dist: number } {
    const cam = this.game.godCam.camera;
    const dist = cam.position.distanceTo(pos);
    this.proj.copy(pos).project(cam);
    const visible = this.proj.z < 1 && Math.abs(this.proj.x) < 1.1 && Math.abs(this.proj.y) < 1.1;
    return {
      x: (this.proj.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.proj.y * 0.5 + 0.5) * window.innerHeight,
      visible,
      dist,
    };
  }

  private updateLabels(dt: number) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Pass 1: where each label hangs from, and what it says (written only when it changed).
    const shown: { v: Village; label: HTMLDivElement; x: number; y: number; scale: number }[] = [];
    const measure: HTMLDivElement[] = [];
    this.labelMeasureT -= dt;
    const remeasure = this.labelMeasureT <= 0; // fonts load late and text changes: look again now and then
    if (remeasure) this.labelMeasureT = 2;
    for (const [v, label] of this.labels) {
      const s = this.project(new THREE.Vector3(v.center.x, v.center.y + 18, v.center.z));
      if (!s.visible || s.dist > 1400) {
        label.style.display = 'none';
        continue;
      }
      const wasHidden = label.style.display === 'none';
      label.style.display = '';
      const fill = label.querySelector<HTMLDivElement>('.vl-fill')!;
      const name = label.querySelector<HTMLDivElement>('.vl-name')!;
      const owned = v.owner === 'player';
      const rival = v.owner === 'rival';
      label.classList.toggle('owned', owned);
      label.classList.toggle('rival', rival);
      fill.style.width = `${Math.min(100, v.belief)}%`;
      const neutral = !owned && !rival;
      const n = neutral ? v.households().length : 0;
      const f = neutral ? v.familiesWithYou() : 0;
      fill.style.display = neutral || owned ? 'none' : '';
      // Yours: the prayer place's ages (a segment per age, the next one filling as its dream is built).
      // Being won: a segment per family. Rival-held: belief in you.
      const age = owned ? ageOf(v) : null;
      const segs = label.querySelector<HTMLDivElement>('.v-segs')!;
      if (age) segments(segs, SHRINE_STAGES.length, age.n, age.part);
      else segments(segs, neutral ? n : 0, f, neutral ? v.nextFamilyProgress() : 0);
      const ageText = age ? `${age.name} · ${age.n}/${SHRINE_STAGES.length}` : '';
      const nameText = owned ? `${v.name} ✦` : rival ? `☾ ${v.name}  ${Math.floor(v.belief)}%` : `${v.name}  ${f}/${n} ✦`;
      const ageEl = label.querySelector<HTMLDivElement>('.vl-age')!;
      if (ageEl.textContent !== ageText) ageEl.textContent = ageText;
      if (name.textContent !== nameText) name.textContent = nameText;
      // Its box changes with what it says: measure again when that changes (or when it has just come back into view).
      const sig = `${nameText}|${ageText}|${segs.childElementCount}|${owned ? 1 : rival ? 2 : 0}`;
      if (wasHidden || remeasure || sig !== this.labelSig.get(label)) {
        this.labelSig.set(label, sig);
        measure.push(label);
      }
      shown.push({ v, label, x: s.x, y: s.y, scale: Math.max(0.65, Math.min(1.1, 260 / s.dist)) });
    }
    // Pass 2: measure the ones that need it, all at once (one layout, not one per label).
    for (const label of measure) this.labelSize.set(label, { w: label.offsetWidth, h: label.offsetHeight });
    // Pass 3: place them. A label hangs from its bottom centre. Keep its whole box on screen (a wide view puts villages
    // by the edge, and the layer clips what pokes out: "STONEMERE" read "ONEMERE"): nudge it in, or hide one that is
    // mostly out. It keeps following its village all the while.
    for (const { label, x: sx, y: sy, scale } of shown) {
      const size = this.labelSize.get(label);
      let x = sx;
      let y = sy;
      let hide = false;
      if (size && size.w > 0) {
        const bw = size.w * scale;
        const bh = size.h * scale;
        hide = Math.min(x + bw / 2, W) - Math.max(x - bw / 2, 0) < bw * 0.5 || Math.min(y, H) - Math.max(y - bh, 0) < bh * 0.5;
        x = Math.min(Math.max(x, bw / 2 + LABEL_EDGE), W - bw / 2 - LABEL_EDGE);
        y = Math.min(Math.max(y, bh + LABEL_EDGE), H - LABEL_EDGE);
      }
      label.style.visibility = hide ? 'hidden' : '';
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
    }
  }

  /**
   * Over a storehouse (or carrying something over one) a small label says what it is for: the playtest of
   * 2026-10-15 never learned which building was the storehouse.
   */
  private updateStoreTip() {
    const g = this.game;
    const hand = g.hand;
    let store: Entity | null = g.hoverBuilding?.kind === 'store' ? g.hoverBuilding : null;
    if (!store && hand.valid && !this.helpOpen && g.input.inside) {
      // The game's own building hover gives way to anything grabbable (a villager, the food heap by the door), which
      // is nearly always there at a storehouse: so look for one under the cursor on screen, as the hover does.
      const cam = g.godCam.camera;
      const focal = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      let best = 1;
      for (const v of g.villages) {
        const st = v.store;
        if (!st?.alive) continue;
        const s = this.project(this.proj.set(st.pos.x, st.pos.y + Math.min(st.topHeight * 0.5, 3), st.pos.z).clone());
        if (!s.visible) continue;
        const r = Math.max(((st.radius * 1.1) / s.dist) * focal, 18);
        const score = Math.hypot(s.x - g.input.x, s.y - g.input.y) / r;
        if (score < best) {
          best = score;
          store = st;
        }
      }
    }
    if (store !== this.storeTipFor) {
      this.storeTipFor = store;
      this.storeTip.classList.toggle('show', !!store);
    }
    if (!store) return;
    const s = this.project(new THREE.Vector3(store.pos.x, store.pos.y + store.topHeight + 1.2, store.pos.z));
    this.storeTip.style.visibility = s.visible ? '' : 'hidden';
    this.storeTip.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }

  private updateFloats(dt: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += dt;
      f.pos.y += dt * 4;
      const s = this.project(f.pos);
      f.el.style.display = s.visible ? '' : 'none';
      f.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, 3 - f.age));
      if (f.age > 3) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
  }

  private updateVillageList() {
    for (const [v, row] of this.villageRows) {
      const owned = v.owner === 'player';
      const rival = v.owner === 'rival';
      row.classList.toggle('owned', owned);
      row.classList.toggle('rival', rival);
      row.classList.toggle('selected', this.game.selectedVillage === v);
      // Being won (2026-10-14: households join one by one): a segment per home, gold as each family believes.
      // Yours (2026-10-15, Daryll: "5 of 5, 6 of 6 ... it's got to be like 1 of 6, then 2 of 6"): every family
      // already believes, so the row shows the climb instead: the prayer place's age, Totem 1/4 to Temple 4/4.
      const neutral = !owned && !rival;
      const n = v.households().length;
      const f = v.familiesWithYou();
      const age = owned ? ageOf(v) : null;
      const total = SHRINE_STAGES.length;
      row.querySelector('.v-status')!.textContent = age ? `${age.name} · ${age.n}/${total}` : rival ? `☾ ${Math.floor(v.belief)}%` : `${f}/${n} ✦`;
      row.title = age
        ? `${v.name}: ${age.name}, age ${age.n} of ${total}${age.next ? `. Next: ${AGE_NAME[age.next]}${age.part > 0 ? ` (${Math.round(age.part * 100)}% built)` : ''}` : '. Every age raised'}`
        : neutral
          ? `${v.name}: families with you ${f} of ${n} (most must believe)`
          : `${v.name}: belief in you ${Math.floor(v.belief)}%`;
      const fill = row.querySelector<HTMLDivElement>('.v-fill')!;
      fill.style.width = `${Math.min(100, v.belief)}%`;
      fill.style.display = neutral || owned ? 'none' : '';
      const segs = row.querySelector<HTMLDivElement>('.v-segs')!;
      if (age) segments(segs, total, age.n, age.part);
      else segments(segs, neutral ? n : 0, f, neutral ? v.nextFamilyProgress() : 0);
    }
  }

  private updateDetail() {
    const v = this.game.selectedVillage;
    if (!v) {
      this.detail.classList.add('hidden');
      this.detailVillage = null;
      return;
    }
    this.detail.classList.remove('hidden');
    const owned = v.owner === 'player';
    const rival = v.owner === 'rival';
    const rivalName = (this.game as unknown as { rival?: { name: string } }).rival?.name ?? 'The rival god';
    this.detail.classList.toggle('rival', rival);
    if (this.detailVillage !== v || this.detail.dataset.owned !== `${owned}${rival}`) {
      this.detailVillage = v;
      this.detail.dataset.owned = `${owned}${rival}`;
      this.detail.innerHTML = `
        <div class="d-head"><span class="v-dot" style="background:${hex(v.color)}"></span><h2>${v.name}</h2><button class="d-close">×</button></div>
        <div class="d-owner"></div>
        <div class="d-belief"><div class="stat-label d-belief-label"></div><div class="v-bar big"><div class="v-fill"></div></div></div>
        <div class="d-grid"></div>
        ${
          owned
            ? `<div class="stat-label">Worshippers <span class="d-wval"></span></div>
               <input type="range" class="d-worship" min="0" max="80" step="5" />
               <div class="d-note">More worshippers → more power, but fewer hands in the fields.</div>`
            : rival
              ? `<div class="d-note">Their hearts were turned. Win them back: feed them, water their crops, throw wonders into their midst, and answer their prayers.</div>`
              : `<div class="d-note">Win them family by family: answer their prayers, help their dreams, bring food and timber. Each home that believes glows gold.</div>`
        }`;
      this.detail.querySelector<HTMLButtonElement>('.d-close')!.onclick = () => this.game.selectVillage(null);
      const slider = this.detail.querySelector<HTMLInputElement>('.d-worship');
      if (slider) {
        slider.value = String(Math.round(v.worshipFraction * 100));
        slider.oninput = () => (v.worshipFraction = Number(slider.value) / 100);
      }
    }
    this.detail.querySelector('.d-owner')!.textContent = owned
      ? v.isHome
        ? 'Your home village'
        : 'Worships you'
      : rival
        ? `☾ Holds to ${rivalName}`
        : 'Neutral. Not yet a believer';
    this.detail.querySelector('.d-belief-label')!.textContent = owned
      ? `Faith ${Math.floor(v.belief)}%`
      : rival
        ? `Belief in you ${Math.floor(v.belief)}%`
        : `Families with you ${v.familiesWithYou()} of ${v.households().length} · most must believe`;
    this.detail.querySelector<HTMLDivElement>('.d-belief .v-fill')!.style.width = `${Math.min(100, v.belief)}%`;
    const hungry = v.villagers.filter((x) => x.hunger > 0.7).length;
    this.detail.querySelector('.d-grid')!.innerHTML = `
      <div><span>Villagers</span><b>${v.population} / ${v.capacity}</b></div>
      <div><span>Worshipping</span><b>${v.dancers}</b></div>
      <div><span>Food</span><b>${Math.floor(v.store.food)}</b></div>
      <div><span>Wood</span><b>${Math.floor(v.store.wood)}</b></div>
      <div><span>Houses</span><b>${v.completedHouses}${v.constructionSite() ? ' (+1)' : ''}</b></div>
      <div><span>Hungry</span><b class="${hungry ? 'bad' : ''}">${hungry}</b></div>
      ${owned ? `<div><span>Prayer</span><b>${v.prayerRate.toFixed(1)}/s</b></div><div><span>Influence</span><b>${Math.round(v.influenceRadius)}m</b></div>` : ''}`;
    const w = this.detail.querySelector('.d-wval');
    if (w) w.textContent = `${Math.round(v.worshipFraction * 100)}%`;
  }
}

/** A bar of `n` segments, `full` of them gold and the next one filled to `part` (0..1). Rebuilt only when n changes. */
function segments(box: HTMLDivElement, n: number, full: number, part: number) {
  if (box.childElementCount !== n) {
    box.replaceChildren(...Array.from({ length: n }, () => {
      const seg = document.createElement('div');
      seg.className = 'v-seg';
      seg.appendChild(document.createElement('i'));
      return seg;
    }));
  }
  box.style.display = n ? '' : 'none';
  for (let i = 0; i < n; i++) {
    const seg = box.children[i] as HTMLDivElement;
    const w = i < full ? 1 : i === full ? part : 0;
    seg.classList.toggle('on', i < full);
    (seg.firstChild as HTMLElement).style.width = `${Math.round(w * 100)}%`;
  }
}
