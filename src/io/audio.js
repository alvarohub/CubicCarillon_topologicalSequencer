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
  // A real SAMPLED instrument: the Salamander grand (loaded lazily from the
  // tone.js CDN on first audio unlock; nearest sample is pitch-shifted by
  // playbackRate). Falls back to the triangle synth until the samples land.
  { name: 'Piano', type: 'sample', sample: 'piano' },
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
    this._samples = new Map(); // midi note -> AudioBuffer (sampled piano)
    this._samplesLoading = false;
  }

  // Must be called from a user gesture (browsers block audio otherwise).
  // Returns a Promise that resolves once the AudioContext is running, so
  // callers can await it before scheduling notes (critical on iOS Safari).
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this._loadPiano(); // start fetching the sampled piano in the background
    }
    if (this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  // The sample-accurate audio clock. The scheduler computes note onset TIMES on
  // this clock (not on the jittery animation frame), so events land exactly on
  // the beat and co-incident heads sound together instead of flamming. Returns 0
  // before the context exists (nothing is audible yet anyway).
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // Clamp a requested start time into the playable future: never schedule in the
  // past (WebAudio would fire it immediately and unevenly).
  _at(when) {
    const now = this.ctx.currentTime;
    return when != null && when > now ? when : now;
  }

  // Fetch + decode a sparse ladder of Salamander grand samples (one every
  // tritone, C2..C6); intermediate pitches are reached by playbackRate.
  async _loadPiano() {
    if (this._samplesLoading || this._samples.size) return;
    this._samplesLoading = true;
    const base = 'https://tonejs.github.io/audio/salamander/';
    const ladder = { 36: 'C2', 42: 'Fs2', 48: 'C3', 54: 'Fs3', 60: 'C4', 66: 'Fs4', 72: 'C5', 78: 'Fs5', 84: 'C6' };
    await Promise.all(
      Object.entries(ladder).map(async ([midi, name]) => {
        try {
          const res = await fetch(`${base}${name}.mp3`);
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this._samples.set(+midi, buf);
        } catch {
          /* offline / blocked: the triangle fallback keeps playing */
        }
      }),
    );
    this._samplesLoading = false;
  }

  // Play a melodic/drum voice. `when` (optional) is an absolute audio-clock time
  // from the scheduler; omit it to play right now. A negative instrument index
  // means an "instrumentless" (silent carrier) head — it makes no sound.
  play({ midi, duration = 0.18, instrument = 0, velocity = 78 } = {}, when) {
    if (!this.ctx) return;
    if (instrument == null || instrument < 0) return; // silent carrier head
    const ins = INSTRUMENTS[instrument] || INSTRUMENTS[0];
    const t = this._at(when);
    if (ins.type === 'drum') {
      this._drum(ins.drum, velocity, t);
      return;
    }
    if (ins.type === 'sample') {
      if (this._samples.size) {
        this._playSample(midi, velocity, t);
        return;
      }
      this._tone('triangle', 0, midi, duration, velocity, t); // not loaded yet
      return;
    }
    this._tone(ins.wave, ins.detune || 0, midi, duration, velocity, t);
  }

  _tone(wave, detune, midi, duration, velocity, when) {
    const t = this._at(when);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = f;
    osc.detune.value = detune;
    const peak = 0.25 + (velocity / 127) * 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Play the nearest piano sample, pitch-shifted, with a natural ring-out.
  _playSample(midi, velocity = 78, when) {
    let best = null,
      bd = Infinity;
    for (const m of this._samples.keys()) {
      const d = Math.abs(m - midi);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best == null) return;
    const t = this._at(when);
    const src = this.ctx.createBufferSource();
    src.buffer = this._samples.get(best);
    src.playbackRate.value = Math.pow(2, (midi - best) / 12);
    const g = this.ctx.createGain();
    const peak = 0.35 + (velocity / 127) * 0.85;
    g.gain.setValueAtTime(peak, t);
    g.gain.setValueAtTime(peak, t + 0.6); // let it ring, then fade the tail
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.85);
  }

  // -- little synthesized drum kit ------------------------------------------
  _drum(kind, velocity = 100, when) {
    const v = 0.4 + (velocity / 127) * 0.6;
    const t = this._at(when);
    switch (kind) {
      case 'kick':
        this._sweep(120, 40, 0.22, v, t); // pitched-down sine thump
        break;
      case 'snare':
        this._noise({ type: 'bandpass', freq: 1800, q: 0.8 }, 0.14, v * 0.8, t);
        this._sweep(220, 160, 0.08, v * 0.5, t);
        break;
      case 'hihat':
        this._noise({ type: 'highpass', freq: 7000, q: 0.7 }, 0.06, v * 0.6, t);
        break;
      case 'clave':
        this._ping(1800, 0.06, v * 0.8, t);
        break;
      default:
        this._noise({ type: 'bandpass', freq: 220, q: 0.7 }, 0.18, v, t);
    }
  }

  _sweep(f0, f1, duration, peak, when) {
    const t = this._at(when);
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

  _ping(freq, duration, peak, when) {
    const t = this._at(when);
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

  _noise(filter, duration, peak, when) {
    const t = this._at(when);
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
  playCollision({ duration = 0.25, velocity = 118 } = {}, when) {
    if (!this.ctx) return;
    const v = 0.4 + (velocity / 127) * 0.6;
    const t = this._at(when);
    switch (COLLISION_SOUNDS[this.collisionSound]) {
      case 'Wood':
        this._ping(900, 0.07, v * 0.7, t);
        this._noise({ type: 'bandpass', freq: 1200, q: 2.5 }, 0.06, v * 0.5, t);
        break;
      case 'Metal':
        this._ping(2600, 0.4, v * 0.45, t);
        this._ping(3877, 0.32, v * 0.3, t); // inharmonic partial = metallic
        break;
      case 'Clap':
        this._noise({ type: 'bandpass', freq: 1500, q: 1.2 }, 0.05, v * 0.7, t);
        this._noise({ type: 'bandpass', freq: 1100, q: 1.0 }, 0.16, v * 0.5, t);
        break;
      case 'Thud':
      default:
        this._noise({ type: 'bandpass', freq: 220, q: 0.7 }, duration, v, t);
    }
  }

  // Back-compat alias (older callers used playDrum for collisions).
  playDrum(opts, when) {
    this.playCollision(opts, when);
  }
}
