// io/audio.js
//
// Sound output adapter. A tiny WebAudio synth so the instrument makes sound in
// any browser with no MIDI setup. It is deliberately behind a small interface
// (resume / play) so it could be swapped for a WebMIDI output or a richer synth
// without touching the core.

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

  play({ midi, duration = 0.18 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}
