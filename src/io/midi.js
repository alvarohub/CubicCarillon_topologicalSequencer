// io/midi.js
//
// WebMIDI output adapter — the bridge to REAL synths. Same event vocabulary as
// audio.js: noteFromEnter → note(), collision → collision(). Notes are sent as
// noteOn with a scheduled noteOff after `duration`.
//
// Real sequencers usually separate instruments by MIDI CHANNEL and optionally
// send a PROGRAM CHANGE on that channel to pick the patch. Drums are the one
// big exception: in GM they live on channel 10 and different drum sounds are
// chosen by NOTE NUMBER, not by program. We mirror that here:
//   - melodic head instruments -> their own channels + GM-ish programs
//   - drum head instruments    -> drumChannel + drum-specific note numbers
//
// The UI 'Ch' control is the BASE channel for melodic instruments. Triangle on
// base ch, Sine on next ch, etc. This keeps instruments separable in hosts like
// Logic/AUM while still letting the user slide the whole mapping up/down. MIDI
// itself only has 16 channels per PORT, so when the mapping reaches the end it
// wraps around the valid melodic-channel pool (skipping the drum channel).
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
    this._lastProgramByChannel = new Map();
    this.onDeviceChange = null; // optional callback(outputs[]) fired on hot-plug
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
      // Hot-plug: fire onDeviceChange whenever ports are added or removed
      // (e.g. AUM virtual ports appearing after the user enables them).
      this.access.onstatechange = () => {
        if (this.onDeviceChange) this.onDeviceChange(this.outputs());
      };
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
    this._lastProgramByChannel.clear();
  }

  _send(bytes, atMs) {
    if (!this.enabled || !this.output) return;
    try {
      if (atMs != null) this.output.send(bytes, atMs);
      else this.output.send(bytes);
    } catch (_) {
      /* device unplugged mid-note — ignore */
    }
  }

  _nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  }

  _clipChannel(ch) {
    return Math.max(1, Math.min(16, ch | 0));
  }

  _melodicChannel(offset = 0) {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
    const base = this._clipChannel(this.channel);
    let idx = pool.indexOf(base);
    if (idx < 0) idx = pool.findIndex((ch) => ch > base);
    if (idx < 0) idx = 0;
    return pool[(idx + offset) % pool.length];
  }

  _ensureProgram(channel, program) {
    if (program == null) return;
    const ch = (this._clipChannel(channel) - 1) & 0x0f;
    const pgm = Math.max(0, Math.min(127, program | 0));
    if (this._lastProgramByChannel.get(ch) === pgm) return;
    this._send([0xc0 | ch, pgm]);
    this._lastProgramByChannel.set(ch, pgm);
  }

  _routeForInstrument(instrument) {
    // melodic instruments 0..6 = distinct channels + fixed program choices
    switch (instrument) {
      case 0:
        return { channel: this._melodicChannel(0), program: 80 }; // Triangle -> synth lead-ish
      case 1:
        return { channel: this._melodicChannel(1), program: 88 }; // Sine -> warm pad-ish
      case 2:
        return { channel: this._melodicChannel(2), program: 80 }; // Square
      case 3:
        return { channel: this._melodicChannel(3), program: 81 }; // Saw
      case 4:
        return { channel: this._melodicChannel(4), program: 14 }; // Bell -> tubular bells
      case 5:
        return { channel: this._melodicChannel(5), program: 68 }; // Reed -> oboe-like
      case 6:
        return { channel: this._melodicChannel(6), program: 0 }; // Piano
      case 7:
        return { channel: this.drumChannel, drumNote: 36 }; // Kick
      case 8:
        return { channel: this.drumChannel, drumNote: 38 }; // Snare
      case 9:
        return { channel: this.drumChannel, drumNote: 42 }; // HiHat
      case 10:
        return { channel: this.drumChannel, drumNote: 75 }; // Clave
      default:
        return { channel: this._melodicChannel(0), program: 0 };
    }
  }

  // Play a sequencer note event { midi, velocity, duration, instrument }.
  note({ midi, velocity = 78, duration = 0.18, instrument = 0 } = {}) {
    if (midi == null) return;
    const route = this._routeForInstrument(instrument);
    const ch = (this._clipChannel(route.channel) - 1) & 0x0f;
    const n = Math.max(0, Math.min(127, Math.round(route.drumNote != null ? route.drumNote : midi)));
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    const t0 = this._nowMs();
    const t1 = t0 + Math.max(10, duration * 1000);
    this._ensureProgram(route.channel, route.program);
    this._send([0x90 | ch, n, v], t0);
    this._send([0x80 | ch, n, 0], t1);
  }

  // A collision hit → a percussion note on the drum channel.
  collision({ velocity = 118, duration = 0.1 } = {}) {
    const ch = (this.drumChannel - 1) & 0x0f;
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    const t0 = this._nowMs();
    const t1 = t0 + Math.max(10, duration * 1000);
    this._send([0x90 | ch, this.drumNote, v], t0);
    this._send([0x80 | ch, this.drumNote, 0], t1);
  }

  // Silence everything (panic) — sent on both channels.
  allNotesOff() {
    const chans = new Set([this.drumChannel]);
    for (let i = 0; i <= 6; i++) chans.add(this._melodicChannel(i));
    for (const channel of chans) {
      const c = (this._clipChannel(channel) - 1) & 0x0f;
      this._send([0xb0 | (c & 0x0f), 123, 0]);
    }
  }
}
