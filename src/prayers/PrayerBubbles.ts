import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Prayer, PrayerListener } from './Prayers';
import { PrayerPanel, DONE_LINGER, FADE, ringOf, setRing, type Card } from './PrayerPanel';
import { DONE_ICON, medallion } from './icons';
import './prayers.css';

/** How long a new prayer hovers over its village before flying to the list, in real seconds. */
const RISE = 2.6;
const FLY = 0.75;
/** World height above a village centre where bubbles start (the name label sits just below). */
const ANCHOR_Y = 18;
/** Pixels between the village label and the first bubble, and between stacked bubbles. */
const LABEL_GAP = 44;
const STACK_GAP = 8;
/** Height of one bubble, for stacking several over one village. */
const BUBBLE_H = 58;
/** A bubble from an off-screen village shows as an edge pill, kept clear of the HUD panels. */
const EDGE = { left: 310, right: 300, top: 90, bottom: 150 };

type Phase = 'rise' | 'fly' | 'docked';

interface Entry {
  prayer: Prayer;
  el: HTMLDivElement;
  ring: SVGCircleElement;
  card: Card | null;
  help: HTMLDivElement | null;
  age: number;
  phase: Phase;
  state: 'active' | 'done' | 'gone';
  /** Real seconds since the state or phase changed. */
  stateAge: number;
  /** Flight start (centre of the bubble) and end (centre of its card), in px. */
  from: { x: number; y: number; s: number };
  to: DOMRect | null;
}

interface Marker {
  el: HTMLDivElement;
  num: HTMLSpanElement;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * A new prayer rises over its village as a parchment bubble, then flies into the Prayers list.
 * Only a small praying marker with a count stays over the land. The bubble holds a picture of
 * what they want, never a sentence (the no-hints rule).
 */
export class PrayerBubbles implements PrayerListener {
  private readonly layer: HTMLDivElement;
  private readonly panel: PrayerPanel;
  private readonly entries: Entry[] = [];
  private readonly markers = new Map<Village, Marker>();
  private readonly v = new THREE.Vector3();

  constructor(private readonly game: Game) {
    this.layer = document.createElement('div');
    this.layer.className = 'prayer-layer';
    game.hud.root.appendChild(this.layer);
    this.panel = new PrayerPanel(game, (p, child) => this.flyTo(p, child));
  }

  added(p: Prayer) {
    const el = document.createElement('div');
    el.className = `pr-bubble k-${p.kind}`;
    el.style.setProperty('--vc', hex(p.village.color));
    el.setAttribute('aria-label', `${p.village.name}: ${p.text}`);
    el.innerHTML = medallion(p.kind, 'pb-medal');
    el.onclick = () => this.flyTo(p);
    this.layer.appendChild(el);
    const ring = el.querySelector<SVGCircleElement>('.pr-ring-fill')!;
    setRing(ring, ringOf(p, this.game.time).ring);
    this.entries.push({ prayer: p, el, ring, card: null, help: this.makeHelp(p), age: 0, phase: 'rise', state: 'active', stateAge: 0, from: { x: 0, y: 0, s: 1 }, to: null });
  }

  /** The little "!" pin over a lost villager. */
  private makeHelp(p: Prayer) {
    if (p.kind !== 'lost' || !p.villager) return null;
    const help = document.createElement('div');
    help.className = 'pr-help';
    help.innerHTML = '<b>!</b>';
    help.setAttribute('aria-label', `${p.childName} is lost`);
    help.onclick = () => this.flyTo(p, true);
    this.layer.appendChild(help);
    return help;
  }

  fulfilled(p: Prayer) {
    const e = this.find(p);
    if (!e) return;
    e.state = 'done';
    e.stateAge = 0;
    e.help?.remove();
    e.help = null;
    if (e.phase === 'rise') {
      // Answered before it left the village: thank them right there.
      e.el.classList.add('done');
      e.el.querySelector('.pr-glyph')!.innerHTML = DONE_ICON;
      setRing(e.ring, 1);
    } else if (e.card) this.panel.fulfilled(e.card);
  }

  gone(p: Prayer) {
    const e = this.find(p);
    if (!e) return;
    e.state = 'gone';
    e.stateAge = 0;
    e.help?.remove();
    e.help = null;
    if (e.phase === 'rise') e.el.classList.add('fading');
    else e.card?.el.classList.add('fading');
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

  /** The bubble has had its moment: make the card and start the flight to it. */
  private launch(e: Entry) {
    const r = e.el.getBoundingClientRect();
    e.from = { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width / e.el.offsetWidth };
    e.card = this.panel.add(e.prayer);
    e.card.el.classList.add('pending');
    e.to = this.panel.target(e.card);
    e.phase = 'fly';
    e.stateAge = 0;
    e.el.classList.remove('edge');
    e.el.classList.add('flying');
  }

  private land(e: Entry) {
    e.phase = 'docked';
    e.stateAge = 0;
    e.el.remove();
    if (e.card) {
      e.card.el.classList.remove('pending');
      if (e.state === 'done') this.panel.fulfilled(e.card);
      if (e.state === 'gone') e.card.el.classList.add('fading');
    }
    if (e.state === 'active') this.game.audio.chime(null);
  }

  private marker(v: Village): Marker {
    let m = this.markers.get(v);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'pr-mark';
      el.innerHTML = '<span class="pm-icon">🙏</span><span class="pm-num"></span>';
      el.onclick = () => {
        this.game.godCam.flyTo(v.center.x, v.center.z);
        this.game.audio.click();
      };
      this.layer.appendChild(el);
      m = { el, num: el.querySelector<HTMLSpanElement>('.pm-num')! };
      this.markers.set(v, m);
    }
    return m;
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
      if (e.phase === 'rise') {
        if (e.state === 'active' && e.age > RISE) this.launch(e);
        else if ((e.state === 'done' && e.stateAge > DONE_LINGER + FADE) || (e.state === 'gone' && e.stateAge > FADE)) {
          e.el.remove();
          this.entries.splice(i, 1);
          continue;
        } else if (e.state === 'done' && e.stateAge > DONE_LINGER) e.el.classList.add('fading');
      } else if (e.phase === 'fly' && e.stateAge >= FLY) this.land(e);
      else if (e.phase === 'docked') {
        if ((e.state === 'done' && e.stateAge > DONE_LINGER + FADE) || (e.state === 'gone' && e.stateAge > FADE)) {
          if (e.card) this.panel.remove(e.card);
          this.entries.splice(i, 1);
          continue;
        }
        if (e.state === 'done' && e.stateAge > DONE_LINGER) e.card?.el.classList.add('fading');
      }
    }

    // Counts for the little markers over each village: prayers that have left the bubble stage.
    const counts = new Map<Village, number>();
    for (const e of this.entries) if (e.phase !== 'rise' && e.state === 'active') counts.set(e.prayer.village, (counts.get(e.prayer.village) ?? 0) + 1);

    for (const e of this.entries) {
      const p = e.prayer;
      const vil = p.village;

      if (e.phase === 'fly' && e.to) {
        const t = ease(Math.min(1, e.stateAge / FLY));
        // The card may have moved (list scrolled, panels opened): chase it.
        if (e.card) e.to = this.panel.target(e.card);
        const x = e.from.x + (e.to.left + e.to.width / 2 - e.from.x) * t;
        const y = e.from.y + (e.to.top + e.to.height / 2 - e.from.y) * t;
        const s = e.from.s + (0.8 - e.from.s) * t;
        e.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
        e.el.style.opacity = String(Math.max(0, 1 - Math.max(0, t - 0.55) / 0.45));
        if (t > 0.6 && e.card) e.card.el.classList.remove('pending');
      } else if (e.phase === 'rise') {
        e.el.classList.toggle('show', e.age > 0.05);
        if (e.state === 'active') setRing(e.ring, ringOf(p, g.time).ring);
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
          for (let k = 0; k < idx; k++) lift += BUBBLE_H + STACK_GAP;
          // A gentle rise into place as it appears.
          lift -= 26 * (1 - ease(Math.min(1, e.age / 0.9)));
          e.el.style.display = '';
          e.el.style.transform = `translate(${sx}px, ${sy - lift * scale}px) translate(-50%, -100%) scale(${scale})`;
        } else if (idx === 0) {
          // A brand-new prayer from an off-screen village: a small pill at the edge, pointing the way, until it flies in.
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

    // One small marker per village that has prayers waiting in the list.
    for (const v of this.game.villages) {
      const n = counts.get(v) ?? 0;
      if (n === 0 && !this.markers.has(v)) continue;
      const m = this.marker(v);
      this.v.set(v.center.x, v.center.y + ANCHOR_Y, v.center.z);
      const dist = cam.position.distanceTo(this.v);
      this.v.project(cam);
      const on = n > 0 && this.v.z < 1 && Math.abs(this.v.x) < 0.97 && this.v.y > -0.95 && this.v.y < 0.9;
      m.el.classList.toggle('show', on);
      if (!on) continue;
      m.num.textContent = n > 1 ? String(n) : '';
      m.el.classList.toggle('single', n <= 1);
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * hgt;
      const scale = Math.max(0.8, Math.min(1.1, 300 / dist));
      m.el.style.transform = `translate(${sx}px, ${sy - LABEL_GAP * scale}px) translate(-50%, -100%) scale(${scale})`;
    }

    const open = this.entries.filter((e) => e.phase !== 'rise' && e.state === 'active').length;
    this.panel.frame(!hidden, open);
  }
}
