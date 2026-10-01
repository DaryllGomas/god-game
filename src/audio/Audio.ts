import * as THREE from 'three';
import { clamp, smoothstep } from '../util/math';

/**
 * The soundscape. Everything is synthesised live with Web Audio (no audio files), and
 * everything is *musical*: one key (D major pentatonic), one slow chord progression and
 * one beat clock drive the music, and every tonal effect (chimes, miracles, bells, the
 * golem's hums, the worship drums) takes its notes and timing from them, so sounds
 * harmonise instead of clashing. A shared reverb puts it all in one calm space.
 *
 * Buses: sfx (positional one-shots), ambience (sea, wind, rain, fire, birds, crickets,
 * owls, village murmur), music (pads + kalimba melody + worship drums). Music and
 * ambience duck gently under loud moments.
 */

// --------------------------------------------------------------------- harmony

const BPM = 60;
const BEAT = 60 / BPM;
const BEATS_PER_CHORD = 8;
/** D major pentatonic (D E F# A B): consonant over every chord below. */
const PENTA_CLASSES = new Set([2, 4, 6, 9, 11]);
/** Dmaj9 - Bm7 - Gmaj7 - Asus4: slow, warm and unresolved, so it never "ends". */
const CHORDS: number[][] = [
  [50, 54, 57, 64], // D3 F#3 A3 E4
  [47, 50, 54, 57], // B2 D3 F#3 A3
  [43, 47, 50, 54], // G2 B2 D3 F#3
  [45, 50, 52, 57], // A2 D3 E3 A3
];
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const PENTA: number[] = [];
for (let m = 50; m <= 93; m++) if (PENTA_CLASSES.has(m % 12)) PENTA.push(m);

export interface SoundscapeInput {
  daylight: number;
  /** 0..1 within the day: dawn chorus peaks around 0.25. */
  dayTime: number;
  /** 0..1 how much sea surrounds the view. */
  water: number;
  /** 0..1 how much land/forest surrounds the view. */
  land: number;
  fire: number;
  rain: number;
  /** 0..1 how close the view is to a lively village. */
  village: number;
  /** Nearest worship circle with dancers, and how strongly it should be heard (0..1). */
  worship: { pos: THREE.Vector3; level: number } | null;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private duckGain!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;

  muted = false;
  musicOn = true;
  /** Number of one-shot sounds started (debugging/tests). */
  played = 0;

  // Listener (the camera)
  private readonly focus = new THREE.Vector3();
  private readonly right = new THREE.Vector3(1, 0, 0);
  private camDist = 130;

  // Ambience beds
  private seaL!: GainNode;
  private seaR!: GainNode;
  private wind!: GainNode;
  private rustle!: GainNode;
  private fireBed!: GainNode;
  private rainBed!: GainNode;
  private murmur!: GainNode;
  private murmurFilter!: BiquadFilterNode;
  private fireLevel = 0;
  private rainLevel = 0;
  private gust = 0;
  private gustT = 6;

  // Music clock
  private nextBeat = 0;
  private beat = 0;
  private chord = 0;
  private melodyIdx = 7;
  private input: SoundscapeInput | null = null;
  private readonly last = new Map<string, number>();

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The chord currently sounding (MIDI notes). */
  private get chordNotes(): number[] {
    return CHORDS[this.chord];
  }

  // ------------------------------------------------------------------ setup

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);

    // One soft hall for everything.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.8, 2.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    this.reverb.connect(verbOut).connect(this.master);

    // Music and ambience sit behind a ducking stage; sfx stays on top.
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    // Soften every effect: no harsh highs.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 6500;
    soften.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(soften);
    this.send(this.sfx, 0.32);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.62;
    this.amb.connect(this.duckGain);
    this.send(this.amb, 0.12);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.3 : 0;
    this.music.connect(this.duckGain);
    this.send(this.music, 0.6);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Waves arrive from both sides at different rates, so the sea gently moves.
    this.seaL = this.noiseBed('lowpass', 480, 0.6, 0.1, -0.6);
    this.seaR = this.noiseBed('lowpass', 560, 0.6, 0.1, 0.6);
    this.lfo(this.seaL.gain, 0.09, 0.05);
    this.lfo(this.seaR.gain, 0.13, 0.05);
    this.wind = this.noiseBed('bandpass', 380, 0.5, 0.05, 0);
    this.rustle = this.noiseBed('highpass', 3800, 0.4, 0, 0.2);
    this.fireBed = this.noiseBed('lowpass', 360, 0.5, 0, 0);
    this.rainBed = this.noiseBed('bandpass', 3000, 0.4, 0, 0);
    // Village murmur: a band of noise whose "vowel" drifts like distant chatter.
    this.murmur = this.noiseBed('bandpass', 700, 2.2, 0, -0.1);
    this.murmurFilter = this.lastFilter!;
    this.nextBeat = ctx.currentTime + 0.5;
  }

  private lastFilter: BiquadFilterNode | null = null;

  /** Decaying stereo noise as a reverb impulse response. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private send(from: AudioNode, amount: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = amount;
    from.connect(g).connect(this.reverb);
    return g;
  }

  private lfo(param: AudioParam, rate: number, depth: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
  }

  private noiseBed(type: BiquadFilterType, freq: number, q: number, level: number, pan: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.amb);
    src.start();
    this.lastFilter = f;
    return g;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.4);
  }

  /** Briefly lower music and ambience under a big moment, then let them breathe back. */
  private duck(amount: number, hold: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - amount, t, 0.05);
    g.setTargetAtTime(1, t + hold, 0.8);
  }

  // -------------------------------------------------------------- listener

  setListener(focus: THREE.Vector3, yaw: number, distance: number) {
    this.focus.copy(focus);
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.camDist = distance;
  }

  /** Gain for a world position: fades with distance from the view and zoom. */
  private reach(pos: THREE.Vector3): { gain: number; pan: number } {
    const dx = pos.x - this.focus.x;
    const dz = pos.z - this.focus.z;
    const d = Math.hypot(dx, dz);
    const hear = this.camDist * 1.6 + 60;
    const gain = Math.pow(clamp(1 - d / hear, 0, 1), 1.6) * clamp(160 / (this.camDist + 60), 0.25, 1.3);
    const pan = clamp((dx * this.right.x + dz * this.right.z) / (this.camDist * 0.7 + 20), -0.85, 0.85);
    return { gain, pan };
  }

  /**
   * Output chain for a one-shot: gain -> pan -> sfx bus (which feeds the reverb).
   * Null when inaudible, so callers skip the work. (Busy sounds are rate-limited by name.)
   */
  private out(pos: THREE.Vector3 | null, level: number): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return null;
    let gain = level;
    let pan = 0;
    if (pos) {
      const r = this.reach(pos);
      gain *= r.gain;
      pan = r.pan;
    }
    if (gain < 0.008) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    this.played++;
    return g;
  }

  private ok(name: string, gap: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < gap * 1000) return false;
    this.last.set(name, now);
    return true;
  }

  // ------------------------------------------------------------ primitives

  private tone(
    dest: AudioNode,
    freq: number,
    dur: number,
    peak: number,
    opts: { type?: OscillatorType; to?: number; attack?: number; at?: number; detune?: number } = {},
  ) {
    const ctx = this.ctx!;
    const t = opts.at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.012;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.02, dur));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dest: AudioNode,
    dur: number,
    peak: number,
    filter: { type: BiquadFilterType; freq: number; to?: number; q?: number },
    opts: { attack?: number; at?: number } = {},
  ) {
    const ctx = this.ctx!;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t);
    if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
    f.Q.value = filter.q ?? 0.8;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.02, dur));
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** A soft mallet/bell note: fundamental plus a quiet octave shimmer. */
  private bell(dest: AudioNode, m: number, dur: number, peak: number, at?: number) {
    const f = midi(m);
    this.tone(dest, f, dur, peak, { at, attack: 0.008 });
    this.tone(dest, f * 2, dur * 0.4, peak * 0.22, { at, attack: 0.005 });
    this.tone(dest, f * 3.01, dur * 0.18, peak * 0.08, { at, attack: 0.004 });
  }

  /** A note from the pentatonic scale near `around` (MIDI). */
  private pentaNear(around: number): number {
    let best = PENTA[0];
    for (const m of PENTA) if (Math.abs(m - around) < Math.abs(best - around)) best = m;
    return best;
  }

  /** The current chord's tones, raised into a register starting at `low` (MIDI). */
  private chordUp(low: number): number[] {
    return this.chordNotes.map((m) => {
      let n = m;
      while (n < low) n += 12;
      return n;
    }).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------- sound effects

  click() {
    const o = this.out(null, 0.18);
    if (o) this.bell(o, this.pentaNear(86), 0.15, 0.4);
  }

  /** The Hand picks something up: a soft upward pluck in key. */
  grab(pos: THREE.Vector3) {
    const o = this.out(pos, 0.38);
    if (!o) return;
    const [a, b] = this.chordUp(72);
    this.bell(o, a, 0.3, 0.45);
    this.bell(o, b, 0.35, 0.3, this.ctx!.currentTime + 0.05);
  }

  whoosh(pos: THREE.Vector3, speed: number) {
    const k = clamp(speed / 80, 0.2, 1.2);
    const o = this.out(pos, 0.38 * k);
    if (!o) return;
    const dur = 0.3 + 0.25 * k;
    this.noise(o, dur, 0.8, { type: 'bandpass', freq: 280, to: 900 + 600 * k, q: 1.2 }, { attack: dur * 0.45 });
  }

  /** Something lands: a soft, earthy thump. `heft` ~0..3. */
  thud(pos: THREE.Vector3, heft: number) {
    if (!this.ok('thud', 0.05)) return;
    const k = clamp(heft, 0.1, 3);
    const o = this.out(pos, 0.24 + 0.16 * k);
    if (!o) return;
    this.tone(o, 80 + 30 / k, 0.2 + 0.12 * k, 0.8, { to: 38, attack: 0.006 });
    this.noise(o, 0.12 + 0.08 * k, 0.35, { type: 'lowpass', freq: 500 + 200 * k, to: 110 });
  }

  splash(pos: THREE.Vector3, size: number) {
    if (!this.ok('splash', 0.06)) return;
    const k = clamp(size, 0.3, 2);
    const o = this.out(pos, 0.4 * k);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.noise(o, 0.7 + 0.3 * k, 0.6, { type: 'bandpass', freq: 2400, to: 600, q: 0.6 }, { attack: 0.015 });
    for (let i = 0; i < 3; i++) this.bell(o, this.pentaNear(80 + Math.random() * 10), 0.12, 0.12, t + 0.12 + Math.random() * 0.35);
  }

  /** A villager's little "ooh!": a soft rounded vowel, not a scream. */
  yelp(pos: THREE.Vector3, pitch = 1) {
    if (!this.ok('yelp', 0.35)) return;
    const o = this.out(pos, 0.2);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = (300 + Math.random() * 140) * pitch;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.5, t + 0.1);
    osc.frequency.linearRampToValueAtTime(base * 1.15, t + 0.4);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 800;
    formant.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(formant).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  /** A miracle appears in the hand: the current chord, arpeggiated up like a harp. */
  miracleSelect(kind: 'water' | 'food' | 'fire') {
    const o = this.out(null, 0.32);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const low = kind === 'fire' ? 62 : kind === 'food' ? 69 : 74;
    const notes = this.chordUp(low);
    notes.forEach((m, i) => this.bell(o, m, 1.4, 0.35, t + i * 0.07));
    this.bell(o, notes[0] + 12, 1.6, 0.25, t + notes.length * 0.07);
  }

  /** A miracle lands. */
  miracle(kind: 'water' | 'food' | 'fire', pos: THREE.Vector3) {
    if (kind === 'fire') return this.explosion(pos);
    const o = this.out(pos, 0.5);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const notes = this.chordUp(kind === 'water' ? 76 : 69);
    notes.forEach((m, i) => this.bell(o, m, 2.0, 0.28, t + i * 0.11));
    if (kind === 'water') this.noise(o, 1.4, 0.18, { type: 'bandpass', freq: 2200, q: 0.5 }, { attack: 0.4 });
    this.duck(0.25, 1.2);
  }

  explosion(pos: THREE.Vector3) {
    const o = this.out(pos, 0.85);
    if (!o) return;
    this.tone(o, 62, 1.4, 1.0, { to: 26, attack: 0.01 });
    this.noise(o, 1.8, 0.85, { type: 'lowpass', freq: 1600, to: 120, q: 0.3 }, { attack: 0.015 });
    this.duck(0.45, 1.6);
  }

  /** Gifts, deposits and rising belief: a bell from the current chord. */
  chime(pos: THREE.Vector3 | null, bright = 1) {
    if (!this.ok('chime', 0.15)) return;
    const o = this.out(pos, 0.36);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const notes = this.chordUp(bright > 1 ? 79 : 74);
    this.bell(o, notes[0], 1.6, 0.35, t);
    this.bell(o, notes[2] ?? notes[1], 1.4, 0.2, t + 0.12);
  }

  /** A village converts: the current chord swells as a choir, with bells. */
  fanfare() {
    const o = this.out(null, 0.55);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.connect(o);
    for (const m of this.chordUp(57)) {
      for (const det of [-8, 0, 8]) this.tone(lp, midi(m), 4.2, 0.12, { type: 'sawtooth', attack: 1.2, detune: det, at: t });
    }
    this.chordUp(81).forEach((m, i) => this.bell(o, m, 2.4, 0.3, t + 0.8 + i * 0.15));
    this.duck(0.5, 3);
  }

  crumble(pos: THREE.Vector3) {
    const o = this.out(pos, 0.6);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.noise(o, 1.4, 0.6, { type: 'lowpass', freq: 900, to: 180, q: 0.4 });
    for (let i = 0; i < 5; i++) this.tone(o, 70 + Math.random() * 50, 0.25, 0.4, { to: 34, at: t + Math.random() * 0.9 });
  }

  // ------------------------------------------------------------------ golem

  golemStep(pos: THREE.Vector3, size: number) {
    const o = this.out(pos, 0.22 + size * 0.08);
    if (!o) return;
    this.tone(o, 58 / Math.sqrt(size), 0.3, 0.9, { to: 30, attack: 0.008 });
    this.noise(o, 0.16, 0.25, { type: 'lowpass', freq: 320, to: 90 });
  }

  /** Contented rumble while stroked: the chord's root, deep and warm. */
  purr(pos: THREE.Vector3) {
    if (!this.ok('purr', 0.5)) return;
    const o = this.out(pos, 0.5);
    if (!o) return;
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.connect(o);
    const root = this.chordNotes[0] - 12;
    this.tone(lp, midi(root), 0.8, 0.8, { type: 'sawtooth', attack: 0.15 });
    this.tone(lp, midi(root + 7), 0.7, 0.35, { type: 'triangle', attack: 0.2 });
  }

  /** A happy rising hum (pat / cheer): root to fifth to octave. */
  happyHum(pos: THREE.Vector3) {
    const o = this.out(pos, 0.42);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const root = this.chordNotes[0];
    [0, 7, 12].forEach((iv, i) => this.tone(o, midi(root + iv - 12), 0.45, 0.45, { type: 'triangle', attack: 0.04, at: t + i * 0.12 }));
  }

  /** A slap: a soft wooden "bonk", then a small sad groan. */
  slap(pos: THREE.Vector3) {
    const o = this.out(pos, 0.7);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.tone(o, 520, 0.09, 0.7, { type: 'triangle', to: 260, attack: 0.002 });
    this.noise(o, 0.05, 0.4, { type: 'bandpass', freq: 1800, q: 1.2 });
    this.tone(o, 150, 0.7, 0.35, { type: 'triangle', to: 95, attack: 0.06, at: t + 0.12 });
  }

  crunch(pos: THREE.Vector3) {
    const o = this.out(pos, 0.5);
    if (!o) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 6; i++) {
      this.noise(o, 0.07, 0.6, { type: 'bandpass', freq: 700 + Math.random() * 1000, q: 1.1 }, { at: t + i * 0.12 + Math.random() * 0.05 });
    }
  }

  snore(pos: THREE.Vector3) {
    if (!this.ok('snore', 1.5)) return;
    const o = this.out(pos, 0.35);
    if (!o) return;
    this.noise(o, 1.4, 0.5, { type: 'lowpass', freq: 200, q: 2 }, { attack: 0.8 });
    this.tone(o, 48, 1.3, 0.3, { type: 'triangle', attack: 0.7 });
  }

  // ---------------------------------------------------------------- ambience

  /** Per-frame: steer the beds, schedule nature sounds and run the music clock. */
  update(dt: number, s: SoundscapeInput) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.input = s;
    const now = ctx.currentTime;
    const high = smoothstep(140, 600, this.camDist);
    const near = 1 - high;
    const night = 1 - s.daylight;

    // Sea: fuller near the shore, and a touch louder at night when all else is quiet.
    const sea = 0.025 + 0.17 * s.water * (0.45 + 0.55 * near) * (1 + 0.25 * night);
    this.seaL.gain.setTargetAtTime(sea, now, 1);
    this.seaR.gain.setTargetAtTime(sea, now, 1);

    // Wind with slow gusts; gusts rustle the trees when you're near the land.
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 7 + Math.random() * 14;
      this.gust = 0.6 + Math.random() * 0.4;
    }
    this.gust = Math.max(0, this.gust - dt * 0.18);
    const g = Math.sin(this.gust * Math.PI * 0.5);
    this.wind.gain.setTargetAtTime(0.025 + 0.16 * high + 0.05 * g, now, 0.9);
    this.rustle.gain.setTargetAtTime(0.05 * g * s.land * near * (0.5 + 0.5 * s.daylight), now, 0.6);

    this.fireLevel += (s.fire - this.fireLevel) * Math.min(1, dt * 3);
    this.rainLevel += (s.rain - this.rainLevel) * Math.min(1, dt * 2);
    this.fireBed.gain.setTargetAtTime(0.25 * this.fireLevel, now, 0.3);
    this.rainBed.gain.setTargetAtTime(0.3 * this.rainLevel, now, 0.6);
    if (this.fireLevel > 0.02 && Math.random() < dt * 22 * this.fireLevel) {
      const o = this.out(null, 0.16 * this.fireLevel);
      if (o) this.noise(o, 0.025, 0.7, { type: 'highpass', freq: 1500 + Math.random() * 2000 });
    }

    // Village murmur by day when you're close; its "vowel" drifts.
    this.murmur.gain.setTargetAtTime(0.09 * s.village * s.daylight * near, now, 1.2);
    this.murmurFilter.frequency.setTargetAtTime(550 + Math.sin(now * 0.7) * 180 + Math.sin(now * 1.9) * 90, now, 0.3);

    // Creatures: a dawn chorus, daytime birds, crickets and owls at night.
    const dawn = Math.exp(-Math.pow((s.dayTime - 0.27) / 0.04, 2));
    const birdRate = (0.35 + 2.2 * dawn) * s.daylight * near * s.land;
    if (Math.random() < dt * birdRate) this.bird();
    if (s.daylight < 0.25 && Math.random() < dt * 0.8 * (0.4 + near)) this.cricket();
    if (s.daylight < 0.15 && Math.random() < dt * 0.06 * s.land) this.owl();

    this.runClock(now);
  }

  private bird() {
    const o = this.out(null, 0.09 + Math.random() * 0.08);
    if (!o) return;
    const t = this.ctx!.currentTime;
    // Birds sing (roughly) in key too.
    const start = this.pentaNear(86 + Math.random() * 10);
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const f = midi(start + (Math.random() < 0.5 ? 0 : 2));
      this.tone(o, f, 0.07, 0.35, { to: f * (1.15 + Math.random() * 0.2), at: t + i * (0.09 + Math.random() * 0.06) });
    }
  }

  private cricket() {
    const o = this.out(null, 0.045);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 6; i++) this.tone(o, f, 0.025, 0.5, { at: t + i * 0.045, attack: 0.004 });
  }

  private owl() {
    if (!this.ok('owl', 9)) return;
    const o = this.out(null, 0.12);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const f = midi(this.pentaNear(66));
    this.tone(o, f, 0.35, 0.5, { to: f * 0.94, attack: 0.06, at: t });
    this.tone(o, f * 0.94, 0.5, 0.45, { to: f * 0.88, attack: 0.06, at: t + 0.5 });
  }

  // ------------------------------------------------------------------- music

  /** Schedule beats a little ahead of time so music, drums and chords stay in step. */
  private runClock(now: number) {
    // After the tab was in the background, skip the missed beats rather than replaying them.
    if (this.nextBeat < now - BEAT) {
      this.nextBeat = now + 0.05;
      this.beat = Math.ceil(this.beat / BEATS_PER_CHORD) * BEATS_PER_CHORD;
    }
    while (this.nextBeat < now + 0.25) {
      this.onBeat(this.nextBeat);
      this.nextBeat += BEAT;
      this.beat++;
    }
  }

  private onBeat(t: number) {
    const s = this.input;
    const daylight = s?.daylight ?? 1;
    const beatInChord = this.beat % BEATS_PER_CHORD;
    if (beatInChord === 0) {
      this.chord = Math.floor(this.beat / BEATS_PER_CHORD) % CHORDS.length;
      if (this.musicOn) this.pad(t, daylight);
    }
    if (this.musicOn) this.melody(t, daylight);
    if (s?.worship && s.worship.level > 0.02) this.drum(t, s.worship.pos, s.worship.level, this.beat % 4);
  }

  /** Warm, slow-blooming chord under everything. */
  private pad(t: number, daylight: number) {
    const ctx = this.ctx!;
    const dur = BEAT * BEATS_PER_CHORD;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520 + 380 * daylight;
    lp.connect(this.music);
    const level = 0.045 * (0.6 + 0.4 * daylight);
    for (const m of this.chordNotes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midi(m);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level, t + 2.5);
        g.gain.setValueAtTime(level, t + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 3);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + dur + 3.1);
      }
    }
    // A soft sub on the root.
    this.tone(lp, midi(this.chordNotes[0] - 12), dur + 2, level * 0.9, { at: t, attack: 2 });
  }

  /** A kalimba line that wanders stepwise through the pentatonic scale. */
  private melody(t: number, daylight: number) {
    const chance = 0.18 + 0.22 * daylight;
    for (const off of [0, BEAT / 2]) {
      if (Math.random() > (off === 0 ? chance : chance * 0.4)) continue;
      const step = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
      const lo = daylight > 0.35 ? 5 : 2;
      const hi = daylight > 0.35 ? 14 : 9;
      this.melodyIdx = clamp(this.melodyIdx + step, lo, hi);
      const m = PENTA[this.melodyIdx];
      this.bell(this.music, m, 2.4, 0.3, t + off);
      // Now and then, a third below for warmth.
      if (Math.random() < 0.2) this.bell(this.music, PENTA[Math.max(0, this.melodyIdx - 2)], 2.2, 0.16, t + off + 0.02);
    }
  }

  /** Soft frame drum at a worship circle, on the music's beat, with a shaker between. */
  private drum(t: number, pos: THREE.Vector3, level: number, beatInBar: number) {
    const r = this.reach(pos);
    const gain = level * r.gain * 0.5;
    if (gain < 0.01) return;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = r.pan;
    g.connect(p).connect(this.music);
    const strong = beatInBar === 0 || beatInBar === 2;
    this.tone(g, strong ? 92 : 120, 0.35, strong ? 0.9 : 0.45, { to: 58, at: t, attack: 0.004 });
    this.noise(g, 0.06, strong ? 0.25 : 0.12, { type: 'lowpass', freq: 700 }, { at: t });
    this.noise(g, 0.05, 0.18, { type: 'highpass', freq: 5000 }, { at: t + BEAT / 2 });
  }

  // ----------------------------------------------------- prayers & advisors

  /** A village is asking for something: two soft rising bells, in key. */
  prayerArrive() {
    if (!this.ok('prayerArrive', 1.5)) return;
    const o = this.out(null, 0.3);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const a = this.pentaNear(76 + Math.floor(Math.random() * 3));
    this.bell(o, a, 1.5, 0.22, t);
    this.bell(o, this.pentaNear(a + 4), 1.7, 0.18, t + 0.16);
  }

  /** A prayer is answered: a warm little arpeggio up the current chord. */
  prayerFulfilled() {
    if (!this.ok('prayerDone', 0.5)) return;
    const o = this.out(null, 0.4);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.chordUp(67).forEach((m, i) => this.bell(o, m + (i === 3 ? 12 : 0), 2.0, 0.26 - i * 0.03, t + i * 0.11));
    this.bell(o, this.chordUp(86)[0], 2.4, 0.14, t + 0.5);
  }

  /** An advisor "speaks": a tiny pentatonic blip. The spirit is a soft sine, the imp a cheeky triangle. */
  advisorVoice(who: 'spirit' | 'imp') {
    if (!this.ok('advisorVoice', 0.4)) return;
    const o = this.out(null, 0.18);
    if (!o) return;
    const t = this.ctx!.currentTime;
    if (who === 'spirit') {
      for (let i = 0; i < 3; i++) {
        const f = midi(this.pentaNear(81 + (i % 2) * 4 + Math.floor(Math.random() * 3)));
        this.tone(o, f, 0.16, 0.5, { at: t + i * 0.09, attack: 0.02 });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const f = midi(this.pentaNear(66 + Math.floor(Math.random() * 7)));
        this.tone(o, f, 0.11, 0.45, { type: 'triangle', to: f * (i === 2 ? 0.7 : 1.15), at: t + i * 0.07, attack: 0.006 });
      }
    }
  }

  // ---------------------------------------------------- projects & the Wonder

  /** A boulder (or timber) is set into a project: a soft stone knock, then two bells from the chord. */
  stoneSet(pos: THREE.Vector3, size = 1.5) {
    if (!this.ok('stoneSet', 0.2)) return;
    const o = this.out(pos, 0.5);
    if (!o) return;
    const k = clamp(size / 2, 0.5, 1.4);
    const t = this.ctx!.currentTime;
    this.tone(o, 118, 0.26, 0.7 * k, { to: 64, attack: 0.004, at: t });
    this.noise(o, 0.12, 0.3 * k, { type: 'lowpass', freq: 900, to: 300 }, { at: t });
    const [a, b] = this.chordUp(72);
    this.bell(o, a, 1.4, 0.24, t + 0.08);
    this.bell(o, b, 1.6, 0.16, t + 0.2);
  }

  /** A Wonder rune wakes: one high, clear bell in key. */
  runeLit(pos: THREE.Vector3) {
    if (!this.ok('runeLit', 0.4)) return;
    const o = this.out(pos, 0.42);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const m = this.pentaNear(86 + Math.floor(Math.random() * 7));
    this.bell(o, m, 2.4, 0.3, t);
    this.bell(o, this.pentaNear(m + 7), 2.2, 0.14, t + 0.14);
  }

  /** A village project is finished: a warm swell and a rising run of bells (calmer than the conversion fanfare). */
  projectDone() {
    const o = this.out(null, 0.5);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    lp.connect(o);
    for (const m of this.chordUp(55)) {
      for (const det of [-6, 6]) this.tone(lp, midi(m), 3.6, 0.1, { type: 'triangle', attack: 0.9, detune: det, at: t });
    }
    this.chordUp(76).forEach((m, i) => this.bell(o, m, 2.2, 0.28 - i * 0.03, t + 0.3 + i * 0.17));
    this.bell(o, this.chordUp(88)[1], 2.6, 0.2, t + 1.2);
    this.duck(0.35, 2.4);
  }

  /** The festival's dance: a gentle looping-ready pentatonic arpeggio, placed at the green. */
  festivalChimes(pos: THREE.Vector3) {
    if (!this.ok('festival', 2.5)) return;
    const o = this.out(pos, 0.4);
    if (!o) return;
    const t = this.ctx!.currentTime;
    const base = 74 + Math.floor(Math.random() * 3);
    [0, 2, 4, 7, 4, 9, 7, 12].forEach((st, i) => this.bell(o, this.pentaNear(base + st), 1.8, 0.2, t + i * 0.22));
  }

  /** All three villages are yours: the Wonder calls. Low swell, three slow bells rising. */
  wonderCalls() {
    const o = this.out(null, 0.5);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(o);
    for (const m of this.chordUp(43)) this.tone(lp, midi(m), 5, 0.12, { type: 'triangle', attack: 2, at: t });
    this.chordUp(69).forEach((m, i) => this.bell(o, m, 3, 0.26, t + 1 + i * 0.7));
    this.duck(0.3, 4);
  }

  /** The Wonder is complete: a long, glowing choir, then a shower of bells climbing the chord. */
  wonderAwakens() {
    const o = this.out(null, 0.6);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(2200, t + 4);
    lp.connect(o);
    for (const m of [...this.chordUp(45), ...this.chordUp(57)]) {
      for (const det of [-9, 0, 9]) this.tone(lp, midi(m), 8, 0.09, { type: 'sawtooth', attack: 2.6, detune: det, at: t });
    }
    const notes = [...this.chordUp(69), ...this.chordUp(81), ...this.chordUp(93).slice(0, 2)];
    notes.forEach((m, i) => this.bell(o, m, 3, 0.26, t + 1.4 + i * 0.28));
    this.bell(o, this.chordUp(93)[0], 5, 0.22, t + 5);
    this.duck(0.55, 7);
  }

  // ------------------------------------------------------------ seasons & weather

  /**
   * Called every frame by the seasons plugin: lets the wind swell and the rain bed fill in storms,
   * and hushes the ambience a little under winter snow. Values are all 0..1.
   */
  weatherAmbience(w: { storm: number; rain: number; hush: number }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const high = smoothstep(140, 600, this.camDist);
    const g = Math.sin(this.gust * Math.PI * 0.5);
    const swell = 0.7 + 0.3 * Math.sin(now * 0.45) * Math.sin(now * 0.17 + 1);
    this.wind.gain.setTargetAtTime(0.025 + 0.16 * high + 0.05 * g + 0.2 * w.storm * swell, now, 0.9);
    this.rustle.gain.setTargetAtTime(Math.max(0.05 * g * (this.input?.land ?? 0.5) * (1 - high), 0.06 * w.storm * (1 - high)), now, 0.6);
    this.rainBed.gain.setTargetAtTime(0.3 * Math.max(this.rainLevel, w.rain * 0.85), now, 0.6);
    this.amb.gain.setTargetAtTime(0.62 * (1 - 0.3 * w.hush), now, 1.5);
  }

  /** A low, soft rolling thunder. `far` 0 (overhead) .. 1 (distant): farther rolls are quieter and longer. Never a crack. */
  thunder(far: number) {
    if (!this.ok('thunder', 1.5)) return;
    const o = this.out(null, 0.5 * (1 - 0.55 * far));
    if (!o) return;
    const t = this.ctx!.currentTime;
    const len = 3.2 + far * 2.5;
    this.noise(o, len, 0.9, { type: 'lowpass', freq: 260, to: 55, q: 0.7 }, { attack: 0.35, at: t });
    this.noise(o, len * 0.8, 0.5, { type: 'lowpass', freq: 180, to: 50, q: 0.7 }, { attack: 0.6, at: t + 0.9 });
    this.noise(o, len * 0.6, 0.35, { type: 'lowpass', freq: 140, to: 45, q: 0.7 }, { attack: 0.5, at: t + 2.0 });
    this.tone(o, midi(38), len * 0.8, 0.55, { type: 'triangle', to: midi(33), attack: 0.5, at: t });
  }

  /** A gentle low swell as dark clouds gather (D and A, an open fifth, with a breath of wind). */
  stormWarning() {
    if (!this.ok('stormWarning', 20)) return;
    const o = this.out(null, 0.3);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.tone(o, midi(38), 5, 0.5, { type: 'sine', attack: 2.2, at: t });
    this.tone(o, midi(45), 5, 0.35, { type: 'sine', attack: 2.6, at: t + 0.4 });
    this.noise(o, 5, 0.35, { type: 'bandpass', freq: 300, to: 700, q: 0.6 }, { attack: 2.4, at: t });
  }

  /** `n` little birdsongs in a row, spread over a few seconds (spring bloom, dawn of spring). */
  birdsong(n: number) {
    for (let i = 0; i < n; i++) setTimeout(() => this.bird(), i * (350 + Math.random() * 500));
  }

  /** A bright, hopeful ripple up the pentatonic scale for happy moments (the spring bloom). */
  bloomChime() {
    if (!this.ok('bloomChime', 3)) return;
    const o = this.out(null, 0.35);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.chordUp(72).forEach((m, i) => this.bell(o, this.pentaNear(m + (i % 2) * 5), 2.2, 0.22 - i * 0.02, t + i * 0.13));
  }

  // ------------------------------------------------------------ the rival god

  /**
   * A soft low "voice" for the rival: a short descending figure in B minor-ish voicing, which still
   * sits inside D major (B, A, F#, D are all in the key and in the chords). Lower and rounder than the advisors.
   */
  rivalVoice() {
    if (!this.ok('rivalVoice', 0.5)) return;
    const o = this.out(null, 0.2);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(o);
    [59, 57, 54].forEach((m, i) => {
      const f = midi(this.pentaNear(m - (i === 2 ? 2 : 0)));
      this.tone(lp, f, 0.26, 0.5, { type: 'triangle', to: f * (i === 2 ? 0.94 : 1), at: t + i * 0.12, attack: 0.04 });
      this.tone(lp, f * 0.5, 0.3, 0.3, { type: 'sine', at: t + i * 0.12, attack: 0.05 });
    });
  }

  /** He arrives: a long dark swell on B, F# and D, distant rolling thunder, then a slow falling motif of bells. */
  rivalArrives() {
    const o = this.out(null, 0.55);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(900, t + 4);
    lp.connect(o);
    for (const m of [35, 42, 47, 50]) {
      for (const det of [-7, 7]) this.tone(lp, midi(m), 7, 0.1, { type: 'sawtooth', attack: 3, detune: det, at: t });
    }
    this.thunder(0.9);
    [66, 62, 59, 57, 54].forEach((m, i) => this.bell(o, m, 3.2, 0.2, t + 2.6 + i * 0.7));
    this.duck(0.4, 6);
  }

  /** A soft, ominous swell as a scheme is announced: low B and F# (a fifth), a breath of dark wind, a single tolling bell. */
  schemeWarning() {
    if (!this.ok('schemeWarning', 4)) return;
    const o = this.out(null, 0.32);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.tone(o, midi(35), 4.5, 0.5, { type: 'sine', attack: 2, at: t });
    this.tone(o, midi(42), 4.5, 0.36, { type: 'sine', attack: 2.4, at: t + 0.3 });
    this.tone(o, midi(47), 4, 0.2, { type: 'triangle', attack: 2.2, at: t + 0.6 });
    this.noise(o, 4.5, 0.25, { type: 'bandpass', freq: 220, to: 520, q: 0.7 }, { attack: 2.2, at: t });
    this.bell(o, 54, 3.2, 0.16, t + 1.8);
  }

  /** A scheme lands: three low falling bells and a soft thud. Gentle: it is a pout, not a catastrophe. */
  schemeStrikes(pos: THREE.Vector3 | null = null) {
    if (!this.ok('schemeStrikes', 2)) return;
    const o = this.out(pos, 0.45);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.tone(o, 96, 0.5, 0.6, { to: 52, attack: 0.01, at: t });
    [59, 54, 50].forEach((m, i) => this.bell(o, m, 2.4, 0.2, t + 0.1 + i * 0.28));
  }

  /** You foiled him: a bright little turn up the current chord, then his huffy low blip. */
  schemeFoiled() {
    if (!this.ok('schemeFoiled', 1)) return;
    const o = this.out(null, 0.42);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.chordUp(72).forEach((m, i) => this.bell(o, m + (i === 3 ? 12 : 0), 2.2, 0.26 - i * 0.03, t + i * 0.1));
    this.bell(o, this.chordUp(88)[0], 2.6, 0.16, t + 0.5);
    const f = midi(47);
    this.tone(o, f, 0.4, 0.4, { type: 'triangle', to: f * 0.8, at: t + 0.7, attack: 0.03 });
  }

  /** A village turns to him: one deep toll and a falling minor-ish line. */
  villageTurns() {
    if (!this.ok('villageTurns', 2)) return;
    const o = this.out(null, 0.5);
    if (!o) return;
    const t = this.ctx!.currentTime;
    this.bell(o, 38, 4, 0.36, t);
    [62, 59, 57, 54].forEach((m, i) => this.bell(o, m, 2.8, 0.18, t + 0.5 + i * 0.45));
    this.duck(0.3, 3);
  }

  /** He retreats: the dark chord thins and falls away, then the warm D-major chord rises in its place. */
  rivalRetreats() {
    const o = this.out(null, 0.55);
    if (!o) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [66, 62, 59, 57, 54, 50].forEach((m, i) => this.bell(o, m, 2.6, 0.2 - i * 0.015, t + i * 0.4));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t + 2.4);
    lp.frequency.linearRampToValueAtTime(2400, t + 6);
    lp.connect(o);
    for (const m of [...this.chordUp(45), ...this.chordUp(57)]) {
      for (const det of [-8, 0, 8]) this.tone(lp, midi(m), 7, 0.08, { type: 'sawtooth', attack: 2.4, detune: det, at: t + 2.4 });
    }
    this.chordUp(74).forEach((m, i) => this.bell(o, m, 3, 0.24, t + 3.6 + i * 0.3));
    this.duck(0.5, 8);
  }
}
