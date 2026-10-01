import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Entity } from '../entities/Entity';
import { MIRACLE_INFO, type MiracleId } from '../miracles/Miracles';
import { Villager } from '../entities/Villager';
import { Tree, Pile } from '../entities/Nature';
import { Field, House, Store, WorshipSite } from '../entities/Buildings';
import { VILLAGE } from '../config';
import { Golem } from '../creature/Golem';
import './hud.css';

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
  private readonly messages: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly banner: HTMLDivElement;
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
      b.title = `${info.name} miracle: ${info.blurb}`;
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
    this.tooltip = el('div', 'tooltip hidden');
    this.root.appendChild(this.tooltip);
    this.banner = el('div', 'banner');
    this.root.appendChild(this.banner);

    // --- Help overlay (also the title screen)
    this.help = el('div', 'overlay help');
    this.help.innerHTML = `
      <div class="overlay-card">
        <h1>God Game</h1>
        <p class="tagline">An island of villagers awaits a god. What kind of god will you be?</p>
        <div class="help-grid">
          <div><b>Grab</b><span>Left-click a villager, tree, rock or food</span></div>
          <div><b>Drag the land</b><span>Left-drag the ground</span></div>
          <div><b>Set down</b><span>Left-click the ground while holding</span></div>
          <div><b>Throw</b><span>Hold right button, flick the mouse, release</span></div>
          <div><b>Rotate / tilt</b><span>Right- or middle-drag (empty hand), Q/E, T/G</span></div>
          <div><b>Zoom</b><span>Mouse wheel, R/F. Double-click to fly somewhere</span></div>
          <div><b>Miracles</b><span>1 Water · 2 Food · 3 Fire, then throw or set down. Esc refunds</span></div>
          <div><b>Village</b><span>Click a building to see it and set how many worship</span></div>
          <div><b>Your creature</b><span>C finds your golem, L calls it over. Stroke it (left-click &amp; rub) when it does something you like, slap it (right-click) when it doesn't</span></div>
        </div>
        <div class="help-goal">
          <b>Your goal:</b> worshippers dancing at your village totem generate <i>prayer power</i>.
          Win over the neutral villages of the island by <i>impressing</i> them: gifts of food, rain, spectacular
          throws, or terrifying fire. Your hand only works inside your golden ring of influence, but you can throw anything beyond it.
          Kindness and cruelty both work. The island will remember which you chose.
        </div>
        <div class="save-summary hidden"></div>
        <button class="begin">Begin</button>
        <div class="new-island"></div>
        <div class="hint">Press <b>H</b> any time for this screen · <b>Space</b> returns home · <b>P</b> pauses · <b>M</b> mutes · <b>N</b> music</div>
      </div>`;
    this.help.querySelector<HTMLButtonElement>('.begin')!.onclick = () => this.toggleHelp(false);
    this.root.appendChild(this.help);
    this.setupSaveControls();

    this.win = el('div', 'overlay win hidden');
    this.root.appendChild(this.win);

    for (const v of game.villages) this.addVillage(v);
  }

  private addVillage(v: Village) {
    const row = el('div', 'v-row');
    row.innerHTML = `<span class="v-dot"></span><span class="v-name">${v.name}</span><span class="v-status"></span><div class="v-bar"><div class="v-fill"></div></div>`;
    row.querySelector<HTMLSpanElement>('.v-dot')!.style.background = hex(v.color);
    row.onclick = () => {
      this.game.selectVillage(v);
      this.game.godCam.flyTo(v.center.x, v.center.z);
    };
    this.villageList.appendChild(row);
    this.villageRows.set(v, row);

    const label = el('div', 'v-label');
    label.innerHTML = `<div class="vl-name">${v.name}</div><div class="vl-bar"><div class="vl-fill"></div></div>`;
    this.labelLayer.appendChild(label);
    this.labels.set(v, label);
  }

  // ------------------------------------------------------------- public api

  get helpOpen() {
    return !this.help.classList.contains('hidden');
  }

  toggleHelp(force?: boolean) {
    const show = force ?? !this.helpOpen;
    this.help.classList.toggle('hidden', !show);
    if (!show) {
      // Closing the title screen starts (or continues) the island: from here on it is autosaved.
      this.game.saves.arm();
      this.begun = true;
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
    box.appendChild(el('span', 'warn', 'This wipes your saved island for good.'));
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
    this.powerVal.innerHTML = `${Math.floor(p.power)} <span class="rate">${rate > 0 ? `+${rate.toFixed(1)}/s` : 'no worshippers'}</span>`;

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

    this.updateLabels();
    this.updateFloats(dt);
    this.updateTooltip();

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

  private updateLabels() {
    for (const [v, label] of this.labels) {
      const s = this.project(new THREE.Vector3(v.center.x, v.center.y + 18, v.center.z));
      if (!s.visible || s.dist > 1400) {
        label.style.display = 'none';
        continue;
      }
      label.style.display = '';
      const scale = Math.max(0.65, Math.min(1.1, 260 / s.dist));
      label.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%) scale(${scale})`;
      const fill = label.querySelector<HTMLDivElement>('.vl-fill')!;
      const name = label.querySelector<HTMLDivElement>('.vl-name')!;
      const owned = v.owner === 'player';
      const rival = v.owner === 'rival';
      label.classList.toggle('owned', owned);
      label.classList.toggle('rival', rival);
      fill.style.width = `${Math.min(100, v.belief)}%`;
      name.textContent = owned ? `${v.name} ✦` : rival ? `☾ ${v.name}  ${Math.floor(v.belief)}%` : `${v.name}  ${Math.floor(v.belief)}%`;
    }
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

  private updateTooltip() {
    const g = this.game;
    const e: Entity | null = g.hand.held ?? g.hand.hover ?? g.hoverBuilding;
    const tip = this.tooltip;
    if (!e || g.controls.mode === 'pan' || g.controls.mode === 'rotate' || this.helpOpen) {
      tip.classList.add('hidden');
      return;
    }
    let html = describe(e);
    if (!g.hand.held && g.hand.hover === e) {
      html += g.hand.blocked ? `<div class="tip-hint bad">Outside your influence</div>` : `<div class="tip-hint">Click to pick up</div>`;
    } else if (g.hand.held === e) {
      html += `<div class="tip-hint">Right-flick to throw · click ground to set down</div>`;
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const x = Math.min(window.innerWidth - 240, g.input.x + 22);
    const y = Math.min(window.innerHeight - 90, g.input.y + 18);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  private updateVillageList() {
    for (const [v, row] of this.villageRows) {
      const owned = v.owner === 'player';
      const rival = v.owner === 'rival';
      row.classList.toggle('owned', owned);
      row.classList.toggle('rival', rival);
      row.classList.toggle('selected', this.game.selectedVillage === v);
      row.querySelector('.v-status')!.textContent = owned ? `${v.population} ✦` : rival ? `☾ ${Math.floor(v.belief)}%` : `${Math.floor(v.belief)}%`;
      row.querySelector<HTMLDivElement>('.v-fill')!.style.width = `${Math.min(100, v.belief)}%`;
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
              : `<div class="d-note">Impress them: feed them, water their crops, throw wonders into their midst... or frighten them with fire.</div>`
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
    this.detail.querySelector('.d-belief-label')!.textContent = owned ? `Faith ${Math.floor(v.belief)}%` : `Belief in you ${Math.floor(v.belief)}%`;
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

function describe(e: Entity): string {
  if (e instanceof Golem)
    return `<div class="tip-title">Your golem</div><div class="tip-body">${e.statusText}</div><div class="tip-hint">Left-click &amp; rub to stroke · right-click to slap</div>`;
  if (e instanceof Villager) {
    const hunger = Math.round(e.hunger * 100);
    return `<div class="tip-title">Villager of ${e.village.name}</div><div class="tip-body">${e.statusText} · Hunger ${hunger}%${e.health < 0.99 ? ` · Health ${Math.round(e.health * 100)}%` : ''}</div>`;
  }
  if (e instanceof Tree) {
    const state = e.charred ? 'Charred' : e.burning ? 'Burning!' : e.growth < 0.65 ? 'Young tree' : 'Tree';
    return `<div class="tip-title">${state}</div><div class="tip-body">${Math.floor(e.wood)} wood · drop it on a village store as timber</div>`;
  }
  if (e instanceof Pile) return `<div class="tip-title">${e.kind === 'food' ? 'Food' : 'Wood'}</div><div class="tip-body">${Math.floor(e.amount)} units. Drop it on a store</div>`;
  if (e.kind === 'rock') return `<div class="tip-title">Boulder</div><div class="tip-body">Heavy. Throw it for a spectacle</div>`;
  if (e.kind === 'orb') {
    const id = (e as unknown as { miracle: MiracleId }).miracle;
    return `<div class="tip-title">${MIRACLE_INFO[id].icon} ${MIRACLE_INFO[id].name} miracle</div><div class="tip-body">${MIRACLE_INFO[id].blurb}</div>`;
  }
  if (e.kind === 'site') return (e as unknown as { tooltip(): string }).tooltip();
  if (e instanceof Store) return `<div class="tip-title">${e.village.name} Store</div><div class="tip-body">Food ${Math.floor(e.food)} · Wood ${Math.floor(e.wood)}</div>`;
  if (e instanceof House) {
    const s = e.destroyed ? 'Ruins' : e.progress < 1 ? `Under construction ${Math.round(e.progress * 100)}%` : `${e.residents.length}/${VILLAGE.houseCapacity} residents`;
    return `<div class="tip-title">House, ${e.village.name}</div><div class="tip-body">${s}${e.burning ? ' · Burning!' : ''}</div>`;
  }
  if (e instanceof WorshipSite) return `<div class="tip-title">${e.village.name} Worship Site</div><div class="tip-body">${e.village.dancers} dancing${e.village.owner === 'player' ? ' for you' : ''}</div>`;
  if (e instanceof Field) return `<div class="tip-title">Field, ${e.village.name}</div><div class="tip-body">${e.ripe ? 'Ripe for harvest' : `Growing ${Math.round(e.growth * 100)}%`}</div>`;
  return `<div class="tip-title">${e.kind}</div>`;
}
