// io/midi.js
//
// WebMIDI output adapter — the bridge to REAL synths. Same event vocabulary as
// audio.js: noteFromEnter → note(), collision → collision(). Notes are sent as
// noteOn with a scheduled noteOff after `duration`. Melodic tracks go to
// `channel`, drum/collision hits to channel 10 (GM percussion convention).
//
// Requires a secure context (https or localhost). Devices are listed after
// init(); the UI offers them in a dropdown.

export class MidiOut {
  constructor() {
    this.access = null;
    this.output = null; // selected MIDIOutput
    this.enabled = false;
    this.channel = 1; // 1-16, melodic notes
    this.drumChannel = 10; // GM drums
    this.drumNote = 38; // GM snare for collisions, overridable
    this._error = null;
  }

  get available() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }

  // Ask the browser for MIDI access. Returns the list of output devices.
  async init() {
    if (!this.available) {
      this._error = 'WebMIDI not supported in this browser';
      return [];
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      return this.outputs();
    } catch (e) {
      this._error = String(e);
      return [];
    }
  }

  outputs() {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name }));
  }

  selectOutput(id) {
    this.output = this.access ? this.access.outputs.get(id) || null : null;
  }

  _send(bytes) {
    if (!this.enabled || !this.output) return;
    try {
      this.output.send(bytes);
    } catch (_) {
      /* device unplugged mid-note — ignore */
    }
  }

  // Play a sequencer note event { midi, velocity, duration } on `channel`.
  note({ midi, velocity = 78, duration = 0.18 } = {}) {
    if (midi == null) return;
    const ch = (this.channel - 1) & 0x0f;
    const n = Math.max(0, Math.min(127, Math.round(midi)));
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    this._send([0x90 | ch, n, v]);
    setTimeout(() => this._send([0x80 | ch, n, 0]), Math.max(10, duration * 1000));
  }

  // A collision hit → a percussion note on the drum channel.
  collision({ velocity = 118, duration = 0.1 } = {}) {
    const ch = (this.drumChannel - 1) & 0x0f;
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    this._send([0x90 | ch, this.drumNote, v]);
    setTimeout(() => this._send([0x80 | ch, this.drumNote, 0]), Math.max(10, duration * 1000));
  }

  // Silence everything (panic) — sent on both channels.
  allNotesOff() {
    for (const c of [this.channel - 1, this.drumChannel - 1]) {
      this._send([0xb0 | (c & 0x0f), 123, 0]);
    }
  }
}
