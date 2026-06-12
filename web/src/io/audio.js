// io/audio.js
//
// Sound output adapter. A tiny WebAudio synth so the instrument makes sound in
// any browser with no MIDI setup. It is deliberately behind a small interface
// (resume / play / playDrum) so it could be swapped for a WebMIDI output or a
// richer synth without touching the core.

// The instrument palette (the "sound" a head carries). Timbre is just the
// oscillator waveform + a touch of detune for now — real sampled/MIDI voices can
// drop in later behind the same indices.
export const INSTRUMENTS = [
  { name: 'Triangle', wave: 'triangle', detune: 0 },
  { name: 'Sine', wave: 'sine', detune: 0 },
  { name: 'Square', wave: 'square', detune: 0 },
  { name: 'Saw', wave: 'sawtooth', detune: 0 },
  { name: 'Bell', wave: 'sine', detune: 7 },
  { name: 'Reed', wave: 'sawtooth', detune: -5 },
];

export class AudioOut {
  constructor() {
    this.ctx = null;
    this.master = null;
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

  // A short filtered noise burst for head-on-head collisions (the "drum" voice).
  playDrum({ duration = 0.18, velocity = 118 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    const peak = 0.4 + (velocity / 127) * 0.6;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }
}
