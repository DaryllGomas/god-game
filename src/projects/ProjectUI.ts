import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Projects, VillageProjects } from './Projects';
import { DEFS, FESTIVAL_TIME, type Res } from './defs';
import { WONDER } from './ProjectModels';
import type { Site } from './Site';
import './projects.css';

const RES_ICON: Record<Res, string> = { wood: '🪵', stone: '🪨', food: '🍞' };
const RES_ORDER: Res[] = ['wood', 'stone', 'food'];

const pct = (f: number) => `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;

/**
 * Project UI, drawn in DOM on the HUD: a small chip by each village's label while it builds,
 * a panel under the village detail panel, and a Wonder banner once it unlocks.
 */
export class ProjectUI {
  private readonly layer = document.createElement('div');
  private readonly chips = new Map<Village, HTMLDivElement>();
  private wonderChip: HTMLDivElement | null = null;
  private readonly panel = document.createElement('div');
  private readonly wonderPanel = document.createElement('div');
  private readonly proj = new THREE.Vector3();
  private slow = 0;
  private panelKey = '';
  private wonderKey = '';

  constructor(
    private readonly game: Game,
    private readonly sys: Projects,
  ) {
    const root = game.hud.root;
    this.layer.className = 'pj-layer';
    root.appendChild(this.layer);
    this.panel.className = 'panel pj-panel hidden';
    root.appendChild(this.panel);
    this.wonderPanel.className = 'panel pj-wonder hidden';
    root.appendChild(this.wonderPanel);
    for (const v of game.villages) this.chips.set(v, this.makeChip(() => this.fly(this.sys.states.get(v)?.site ?? this.sys.states.get(v)?.festivalSite ?? null, v)));
  }

  private makeChip(onClick: () => void, wonder = false): HTMLDivElement {
    const c = document.createElement('div');
    c.className = `pj-chip${wonder ? ' wonder' : ''}`;
    c.innerHTML = '<span class="pj-ic"></span><span class="pj-nm"></span><span class="pj-pc"></span><span class="pj-mini"><i></i></span>';
    c.style.display = 'none';
    c.onclick = onClick;
    this.layer.appendChild(c);
    return c;
  }

  private fly(site: Site | null, v?: Village) {
    const g = this.game;
    if (site) {
      g.godCam.flyTo(site.pos.x, site.pos.z);
      g.godCam.setDistance(site.def.id === 'wonder' ? 150 : 70);
    } else if (v) g.godCam.flyTo(v.center.x, v.center.z);
    g.audio.click();
  }

  frame(_dt: number) {
    const g = this.game;
    const hidden = g.hud.helpOpen;
    this.layer.style.display = hidden ? 'none' : '';
    this.slow -= _dt;
    const refresh = this.slow <= 0;
    if (refresh) this.slow = 0.25;

    // Village chips.
    for (const [v, chip] of this.chips) {
      const vs = this.sys.states.get(v)!;
      const site = vs.site;
      const festive = !!vs.festivalSite && vs.festivalUntil > 0;
      if ((!site && !festive) || hidden) {
        chip.style.display = 'none';
        continue;
      }
      if (!this.place(chip, new THREE.Vector3(v.center.x, v.center.y + 18, v.center.z), 6)) continue;
      if (refresh) {
        chip.classList.toggle('festive', festive);
        const def = site ? site.def : DEFS.festival;
        const f = site ? site.fraction : Math.max(0, (vs.festivalUntil - g.time) / FESTIVAL_TIME);
        chip.children[0].textContent = def.icon;
        chip.children[1].textContent = festive ? 'Festival!' : def.name;
        chip.children[2].textContent = festive ? '' : pct(f);
        (chip.children[3].firstElementChild as HTMLElement).style.width = pct(f);
        chip.title = site ? `${def.name}: ${site.progressText()}` : 'The village is celebrating';
      }
    }

    // The Wonder.
    const w = this.sys.wonder;
    if (w && !hidden) {
      if (!this.wonderChip) this.wonderChip = this.makeChip(() => this.fly(w), true);
      if (w.complete) this.wonderChip.style.display = 'none';
      else if (this.place(this.wonderChip, new THREE.Vector3(w.pos.x, w.pos.y + 46, w.pos.z), 0) && refresh) {
        const c = this.wonderChip;
        c.children[0].textContent = DEFS.wonder.icon;
        c.children[1].textContent = 'The Wonder';
        c.children[2].textContent = pct(w.fraction);
        (c.children[3].firstElementChild as HTMLElement).style.width = pct(w.fraction);
      }
    } else if (this.wonderChip) this.wonderChip.style.display = 'none';

    if (refresh) {
      this.updatePanel(hidden);
      this.updateWonderPanel(hidden);
    }
  }

  /** Project a world point to the screen and position a chip there. Returns false when off-screen. */
  private place(el: HTMLElement, world: THREE.Vector3, dy: number): boolean {
    const cam = this.game.godCam.camera;
    const dist = cam.position.distanceTo(world);
    this.proj.copy(world).project(cam);
    const visible = this.proj.z < 1 && Math.abs(this.proj.x) < 1.05 && Math.abs(this.proj.y) < 1.05 && dist < 1500;
    if (!visible) {
      el.style.display = 'none';
      return false;
    }
    const x = (this.proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.proj.y * 0.5 + 0.5) * window.innerHeight;
    const scale = Math.max(0.7, Math.min(1.1, 260 / dist));
    el.style.display = '';
    el.style.transform = `translate(${x}px, ${y + dy}px) translate(-50%, 0) scale(${scale})`;
    return true;
  }

  // ------------------------------------------------------------- panels

  private resRows(site: Site): string {
    let html = '';
    for (const r of RES_ORDER) {
      const need = site.def.needs[r];
      if (need <= 0) continue;
      const have = Math.floor(site.have[r]);
      html += `<span>${RES_ICON[r]}</span><div class="pj-bar"><i class="${r}" style="width:${pct(have / need)}"></i></div><b>${have}/${need}</b>`;
    }
    return `<div class="pj-res">${html}</div>`;
  }

  private updatePanel(hidden: boolean) {
    const g = this.game;
    const v = g.selectedVillage;
    if (!v || hidden) {
      this.panel.classList.add('hidden');
      return;
    }
    const vs = this.sys.states.get(v)!;
    const detail = g.hud.root.querySelector<HTMLElement>('.detail');
    const top = detail && !detail.classList.contains('hidden') ? detail.getBoundingClientRect().bottom + 8 : 64;
    this.panel.style.top = `${top}px`;

    const site = vs.site;
    let html = '';
    if (site) {
      const d = site.def;
      html += `<div class="stat-label">Project</div>
        <div class="pj-title"><span>${d.icon}</span>${d.name}<button class="pj-btn pj-go">Show</button></div>
        <div class="pj-effect">${d.effect}</div>${this.resRows(site)}
        <div class="pj-note">${d.needs.stone > 0 ? 'Builders carry the timber. <b>Drop or throw boulders onto the site</b> for stone.' : 'Builders carry timber and food from the store. Gifts of food and wood help.'}${v.owner !== 'player' ? ' Helping them builds belief.' : ''}</div>`;
    } else if (vs.festivalSite && vs.festivalUntil > 0) {
      html += `<div class="stat-label">Project</div><div class="pj-title"><span>🏮</span>Harvest Festival<button class="pj-btn pj-go">Show</button></div><div class="pj-effect">The whole village is dancing under the lanterns.</div>`;
    } else if (vs.index < 3) {
      html += `<div class="stat-label">Project</div><div class="pj-note" style="margin-top:0">${v.population < 3 ? 'Too few people to dream big yet.' : 'The village is thinking about what to build next...'}</div>`;
    } else {
      html += `<div class="stat-label">Projects</div><div class="pj-note" style="margin-top:0">Everything they dreamed of is built.</div>`;
    }
    if (vs.done.size) {
      const names = [...vs.done].map((id) => `✓ ${DEFS[id].name}`).join(' · ');
      html += `<div class="pj-built">${names}</div>`;
    }
    if (this.sys.wonder && !this.sys.wonder.complete && v.owner === 'player') {
      html += `<div class="pj-note">Their builders also bring timber and food to the Wonder.</div>`;
    }
    const key = html;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panel.innerHTML = html;
      const btn = this.panel.querySelector<HTMLButtonElement>('.pj-go');
      if (btn) btn.onclick = () => this.fly(vs.site ?? vs.festivalSite, v);
    }
    this.panel.classList.remove('hidden');
  }

  private updateWonderPanel(hidden: boolean) {
    const w = this.sys.wonder;
    if (!w || hidden) {
      this.wonderPanel.classList.add('hidden');
      return;
    }
    const wv = w.wonderVisual;
    const lit = wv?.litRunes ?? 0;
    const total = wv?.totalRunes ?? WONDER.stones + WONDER.spireSegments;
    let runes = '';
    for (let i = 0; i < total; i++) runes += `<span class="${i < lit || w.complete ? 'on' : 'off'}">✦</span>`;
    let html: string;
    if (w.complete) {
      html = `<div class="stat-label"><span>The Wonder</span><button class="pj-btn pj-go">Visit</button></div><div class="pj-wbar"><i style="width:100%"></i></div><div class="pj-runes">${runes}</div><div class="pj-note" style="margin-top:6px">It stands complete. The island is yours.</div>`;
      this.wonderPanel.classList.add('done');
    } else {
      html = `<div class="stat-label"><span>The Wonder · ${pct(w.fraction)}</span><button class="pj-btn pj-go">Go</button></div>
        <div class="pj-wbar"><i style="width:${pct(w.fraction)}"></i></div>${this.resRows(w)}<div class="pj-runes">${runes}</div>`;
    }
    if (html !== this.wonderKey) {
      this.wonderKey = html;
      this.wonderPanel.innerHTML = html;
      const btn = this.wonderPanel.querySelector<HTMLButtonElement>('.pj-go');
      if (btn) btn.onclick = () => this.fly(w);
    }
    this.wonderPanel.classList.remove('hidden');
  }

  /** Test hook. */
  states(): VillageProjects[] {
    return [...this.sys.states.values()];
  }
}
