// io/audio.js
//
// Sound output adapter. A tiny WebAudio synth so the instrument makes sound in
// any browser with no MIDI setup. It is deliberately behind a small interface
// (resume / play / playCollision) so it could be swapped for a WebMIDI output
// or a richer synth without touching the core.

// ---------------------------------------------------------------------------
// Instrument palette. Two families: MELODIC voices (pitched, follow the score)
// and DRUM voices (a head carrying a drum ignores pitch — every armed cell it
// crosses is a hit). The combined INSTRUMENTS list is what heads index into;
// each entry carries a `type` so callers can tell them apart.
// ---------------------------------------------------------------------------
export const MELODIC = [
  { name: 'Triangle', type: 'melodic', wave: 'triangle', detune: 0 },
  { name: 'Sine', type: 'melodic', wave: 'sine', detune: 0 },
  { name: 'Square', type: 'melodic', wave: 'square', detune: 0 },
  { name: 'Saw', type: 'melodic', wave: 'sawtooth', detune: 0 },
  { name: 'Bell', type: 'melodic', wave: 'sine', detune: 7 },
  { name: 'Reed', type: 'melodic', wave: 'sawtooth', detune: -5 },
];

export const DRUMS = [
  { name: 'Kick', type: 'drum', drum: 'kick' },
  { name: 'Snare', type: 'drum', drum: 'snare' },
  { name: 'HiHat', type: 'drum', drum: 'hihat' },
  { name: 'Clave', type: 'drum', drum: 'clave' },
];

export const INSTRUMENTS = [...MELODIC, ...DRUMS];

// Collision voices (head-on-head). One is active at a time, picked in the UI.
// (Future: a material×material matrix — see IDEAS.md §13.)
export const COLLISION_SOUNDS = ['Thud', 'Wood', 'Metal', 'Clap'];

export class AudioOut {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.collisionSound = 0; // index into COLLISION_SOUNDS
  }

  // Must be called from a user gesture (browsers block audio otherwise).
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play({ midi, duration = 0.18, instrument = 0, velocity = 78 } = {}) {
    if (!this.ctx) return;
    const ins = INSTRUMENTS[instrument] || INSTRUMENTS[0];
    if (ins.type === 'drum') {
      this._drum(ins.drum, velocity);
      return;
    }
    const t = this.ctx.currentTime;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = ins.wave;
    osc.frequency.value = f;
    osc.detune.value = ins.detune || 0;
    const peak = 0.25 + (velocity / 127) * 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // -- little synthesized drum kit ------------------------------------------
  _drum(kind, velocity = 100) {
    const v = 0.4 + (velocity / 127) * 0.6;
    switch (kind) {
      case 'kick':
        this._sweep(120, 40, 0.22, v); // pitched-down sine thump
        break;
      case 'snare':
        this._noise({ type: 'bandpass', freq: 1800, q: 0.8 }, 0.14, v * 0.8);
        this._sweep(220, 160, 0.08, v * 0.5);
        break;
      case 'hihat':
        this._noise({ type: 'highpass', freq: 7000, q: 0.7 }, 0.06, v * 0.6);
        break;
      case 'clave':
        this._ping(1800, 0.06, v * 0.8);
        break;
      default:
        this._noise({ type: 'bandpass', freq: 220, q: 0.7 }, 0.18, v);
    }
  }

  _sweep(f0, f1, duration, peak) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  _ping(freq, duration, peak) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  _noise(filter, duration, peak) {
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filter.type;
    flt.frequency.value = filter.freq;
    flt.Q.value = filter.q || 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // Head-on-head collision voice, selectable from COLLISION_SOUNDS.
  playCollision({ duration = 0.25, velocity = 118 } = {}) {
    if (!this.ctx) return;
    const v = 0.4 + (velocity / 127) * 0.6;
    switch (COLLISION_SOUNDS[this.collisionSound]) {
      case 'Wood':
        this._ping(900, 0.07, v * 0.7);
        this._noise({ type: 'bandpass', freq: 1200, q: 2.5 }, 0.06, v * 0.5);
        break;
      case 'Metal':
        this._ping(2600, 0.4, v * 0.45);
        this._ping(3877, 0.32, v * 0.3); // inharmonic partial = metallic
        break;
      case 'Clap':
        this._noise({ type: 'bandpass', freq: 1500, q: 1.2 }, 0.05, v * 0.7);
        this._noise({ type: 'bandpass', freq: 1100, q: 1.0 }, 0.16, v * 0.5);
        break;
      case 'Thud':
      default:
        this._noise({ type: 'bandpass', freq: 220, q: 0.7 }, duration, v);
    }
  }

  // Back-compat alias (older callers used playDrum for collisions).
  playDrum(opts) {
    this.playCollision(opts);
  }
}
