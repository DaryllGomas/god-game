import * as THREE from 'three';
import type { Game } from '../Game';
import type { Prayer, PrayerListener } from './Prayers';
import './prayers.css';

/** How long a fulfilled bubble lingers (with its check mark) before fading, in real seconds. */
const DONE_LINGER = 2.4;
const FADE = 0.6;
/** World height above a village centre where bubbles start (the name label sits just below). */
const ANCHOR_Y = 18;
/** Pixels between the village label and the first bubble, and between stacked bubbles. */
const LABEL_GAP = 44;
const STACK_GAP = 8;
/** Edge pills stay clear of the HUD panels. */
const EDGE = { left: 310, right: 70, top: 90, bottom: 150 };

interface Entry {
  prayer: Prayer;
  el: HTMLDivElement;
  bar: HTMLDivElement;
  help: HTMLDivElement | null;
  age: number;
  state: 'active' | 'done' | 'gone';
  /** Real seconds since the state changed. */
  stateAge: number;
}

/** Soft parchment speech bubbles floating over villages, drawn in DOM and projected each frame. */
export class PrayerBubbles implements PrayerListener {
  private readonly layer: HTMLDivElement;
  private readonly entries: Entry[] = [];
  private readonly v = new THREE.Vector3();

  constructor(private readonly game: Game) {
    this.layer = document.createElement('div');
    this.layer.className = 'prayer-layer';
    game.hud.root.appendChild(this.layer);
  }

  added(p: Prayer) {
    const el = document.createElement('div');
    el.className = 'pr-bubble';
    el.innerHTML = `<div class="pr-icon">${p.icon}</div><div class="pr-text"><div class="pr-line"></div><div class="pr-bar"><div></div></div></div>`;
    el.querySelector('.pr-line')!.textContent = p.text;
    const bar = el.querySelector<HTMLDivElement>('.pr-bar > div')!;
    if (p.need <= 0) el.querySelector<HTMLElement>('.pr-bar')!.style.display = 'none';
    el.onclick = () => this.flyTo(p);
    this.layer.appendChild(el);

    let help: HTMLDivElement | null = null;
    if (p.kind === 'lost' && p.villager) {
      help = document.createElement('div');
      help.className = 'pr-help';
      help.innerHTML = '<b>!</b> ';
      help.append(`${p.childName} needs help`);
      help.onclick = () => this.flyTo(p, true);
      this.layer.appendChild(help);
    }
    this.entries.push({ prayer: p, el, bar, help, age: 0, state: 'active', stateAge: 0 });
  }

  fulfilled(p: Prayer) {
    const e = this.find(p);
    if (!e) return;
    e.state = 'done';
    e.stateAge = 0;
    e.el.classList.add('done');
    e.el.querySelector('.pr-icon')!.textContent = '✓';
    e.el.querySelector('.pr-line')!.textContent = p.thanks;
    e.el.querySelector<HTMLElement>('.pr-bar')!.style.display = 'none';
    e.help?.remove();
    e.help = null;
  }

  gone(p: Prayer) {
    const e = this.find(p);
    if (!e) return;
    e.state = 'gone';
    e.stateAge = 0;
    e.el.classList.add('fading');
    e.help?.remove();
    e.help = null;
  }

  private find(p: Prayer) {
    return this.entries.find((e) => e.prayer === p);
  }

  private flyTo(p: Prayer, child = false) {
    const g = this.game;
    const c = p.villager;
    // A lost child is worth flying straight to; everything else, the village.
    if ((child || p.kind === 'lost') && c && !c.dead) {
      g.godCam.flyTo(c.pos.x, c.pos.z);
      g.godCam.setDistance(Math.min(g.godCam.distance, 80));
    } else g.godCam.flyTo(p.village.center.x, p.village.center.z);
    g.audio.click();
  }

  /** Every rendered frame (real seconds). */
  frame(dt: number) {
    const g = this.game;
    const cam = g.godCam.camera;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const perVillage = new Map<object, number>();
    const hidden = g.hud.helpOpen;
    this.layer.style.display = hidden ? 'none' : '';

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.age += dt;
      e.stateAge += dt;
      if ((e.state === 'done' && e.stateAge > DONE_LINGER + FADE) || (e.state === 'gone' && e.stateAge > FADE)) {
        e.el.remove();
        e.help?.remove();
        this.entries.splice(i, 1);
        continue;
      }
      if (e.state === 'done' && e.stateAge > DONE_LINGER) e.el.classList.add('fading');
    }

    for (const e of this.entries) {
      const p = e.prayer;
      const vil = p.village;
      e.el.classList.toggle('show', e.age > 0.05);
      if (p.need > 0 && e.state === 'active') e.bar.style.width = `${Math.min(100, (p.progress / p.need) * 100)}%`;

      // Project the anchor above the village.
      this.v.set(vil.center.x, vil.center.y + ANCHOR_Y, vil.center.z);
      const dist = cam.position.distanceTo(this.v);
      this.v.project(cam);
      const behind = this.v.z > 1;
      const onScreen = !behind && Math.abs(this.v.x) < 0.97 && this.v.y > -0.95 && this.v.y < 0.9;
      const idx = perVillage.get(vil) ?? 0;
      perVillage.set(vil, idx + 1);

      if (onScreen) {
        e.el.classList.remove('edge');
        const sx = (this.v.x * 0.5 + 0.5) * w;
        const sy = (-this.v.y * 0.5 + 0.5) * hgt;
        const scale = Math.max(0.78, Math.min(1.05, 300 / dist));
        let lift = LABEL_GAP;
        for (let k = 0; k < idx; k++) lift += 56 + STACK_GAP;
        e.el.style.display = '';
        e.el.style.transform = `translate(${sx}px, ${sy - lift * scale}px) translate(-50%, -100%) scale(${scale})`;
      } else if (idx === 0) {
        // Off-screen: a small pill pinned to the edge, pointing the way.
        let dx = this.v.x;
        let dy = this.v.y;
        if (behind) {
          dx = -dx;
          dy = -dy;
        }
        const m = Math.max(Math.abs(dx), Math.abs(dy), 0.001);
        const cx = w / 2;
        const cy = hgt / 2;
        const ex = Math.min(w - EDGE.right, Math.max(EDGE.left, cx + (dx / m) * cx));
        const ey = Math.min(hgt - EDGE.bottom, Math.max(EDGE.top, cy - (dy / m) * cy));
        e.el.classList.add('edge');
        e.el.style.display = '';
        e.el.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%)`;
      } else {
        e.el.style.display = 'none';
      }

      // The little "help" flag over the lost villager.
      if (e.help) {
        const c = p.villager!;
        this.v.set(c.pos.x, c.pos.y + 3.6, c.pos.z);
        const d = cam.position.distanceTo(this.v);
        this.v.project(cam);
        const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05 && !c.held && !c.dead;
        e.help.classList.toggle('show', vis && e.age > 0.3);
        if (vis) {
          const sx = (this.v.x * 0.5 + 0.5) * w;
          const sy = (-this.v.y * 0.5 + 0.5) * hgt;
          const scale = Math.max(0.8, Math.min(1.2, 220 / d));
          e.help.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%) scale(${scale})`;
        }
      }
    }
  }
}
