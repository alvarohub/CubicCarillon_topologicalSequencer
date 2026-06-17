// core/sequencer.js
//
// The "score" + the mapping from geometric events to musical notes. This is the
// instrument layer: separate from the physics (engine) and the sound output
// (io/audio), so the same events could drive WebAudio, WebMIDI, or hardware.
//
// Model (piano-roll on a folded surface):
//   - The SCORE is a set of armed cells, keyed by "faceId:i:j".
//   - A head SOUNDS when it ENTERS an armed cell (engine emits 'enter' events).
//   - PITCH is read from the head's PERPENDICULAR cell index — its "level in the
//     stack". A horizontal ('H') head's pitch comes from its row (y); a
//     transversal ('V') head's from its column (x). So the SAME armed cell sounds
//     a different pitch depending on which band reads it — a score rotated 90°.
//   - Each band ('H' / 'V') has its own scale + key (see scales.js Band).
//   - INSTRUMENT (the timbre) is carried by the head, not the cell.
//
// Pure module: returns note descriptors; it does not make sound itself.

import { Band } from './scales.js';

export class Sequencer {
  constructor({ cells = 8, bandX = null, bandY = null, bandZ = null } = {}) {
    this.cells = cells;
    // two bands with independent scale + key
    this.bandX = bandX || new Band({ name: 'x-axis', scale: 'pentatonic', root: 60 }); // C
    this.bandY = bandY || new Band({ name: 'y-axis', scale: 'pentatonic', root: 57 }); // A
    this.bandZ = bandZ || new Band({ name: 'vertical-z', scale: 'pentatonic', root: 64 }); // E
    // armed cells: Map of "faceId:i:j" -> velocity (0..1, how hard the note is
    // struck). Arming defaults to a healthy mezzo-forte; the velocity is shaped
    // by the press-and-drag gesture (io/controls) and read by noteForEnter.
    this.armed = new Map();
    this.defaultVelocity = 0.7;
    // cells silenced because they sit on a MUTED track's slice. Muting a
    // horizontal track also silences those cells for vertical heads (and vice
    // versa) — the whole slice is off, regardless of reading direction.
    this.mutedCells = new Set();

    // ---- collision behaviour (a head-on-head meeting is its own event) -------
    // ONE global "source" decides what a collision SOUNDS like (see the unified
    // trigger pipeline below). The three sources mirror the three kinds of value
    // a trigger can draw on:
    //   'fixed' — a chosen, independent collision sound (audio.playCollision).
    //   'cell'  — the armed note UNDER the meeting point (gated by the score).
    //   'heads' — each head IS an instrument: launch both heads' voices together
    //             (a dyad born from the geometry). An "instrumentless" head
    //             (instrument < 0) is a silent carrier — only the other sounds.
    this.collisionSource = 'heads';
    this.collisionVelocity = 0.92; // default loudness for the 'heads' source (0..1)
  }

  // ---------------------------------------------------------------------------
  // THE NOTE RECORD (reserved shape — see machintropology of this device).
  // Today an armed cell stores ONLY a velocity (a bare number): the cell is a
  // pure TRIGGER ("a hole the head falls through") and inherits everything else
  // from the head — instrument from ball.instrument, PITCH from the head's
  // position (the perpendicular coordinate). That is the piano-roll-rotated-90°
  // soul of the instrument: pitch = WHERE you are on the body.
  //
  // The future, non-breaking growth is to let the value become an object with
  // OPTIONAL overrides, `null` meaning "inherit":
  //     { velocity, gate:null, prob:null, pitch:null }
  // velocity/gate/prob shape the TRIGGER (they apply to whatever pitch sounds);
  // `pitch` is the one orthogonal axis — null = positional (head) pitch, a number
  // = an engraved absolute pitch. A global `pitchMode` then selects positional /
  // engraved / both. `cellData()` already normalises number → object so the
  // resolver below is ready for that day with no rewrite; storage stays a number
  // for now (everything resolves to today's behaviour byte-for-byte).
  // ---------------------------------------------------------------------------
  cellData(key) {
    const raw = this.armed.get(key);
    if (raw == null) return null;
    if (typeof raw === 'number') return { velocity: raw, gate: null, prob: null, pitch: null };
    return {
      velocity: raw.velocity ?? this.defaultVelocity,
      gate: raw.gate ?? null,
      prob: raw.prob ?? null,
      pitch: raw.pitch ?? null,
    };
  }

  // ---- score editing ----
  key(faceId, i, j) {
    return `${faceId}:${i}:${j}`;
  }
  isArmed(faceId, i, j) {
    return this.armed.has(this.key(faceId, i, j));
  }
  arm(faceId, i, j, velocity = this.defaultVelocity) {
    this.armed.set(this.key(faceId, i, j), velocity);
  }
  disarm(faceId, i, j) {
    this.armed.delete(this.key(faceId, i, j));
  }
  toggleCell(faceId, i, j) {
    const k = this.key(faceId, i, j);
    if (this.armed.has(k)) {
      this.armed.delete(k);
      return false;
    }
    this.armed.set(k, this.defaultVelocity);
    return true;
  }
  velocityAt(faceId, i, j) {
    return this.armed.get(this.key(faceId, i, j)) ?? 0;
  }
  setVelocity(faceId, i, j, v) {
    const k = this.key(faceId, i, j);
    if (!this.armed.has(k)) return 0;
    const clamped = Math.max(0.05, Math.min(1, v));
    this.armed.set(k, clamped);
    return clamped;
  }
  clear() {
    this.armed.clear();
  }

  // Rebuild the muted-cell set from the slices of the currently muted tracks
  // (engine.traceTrack provides each slice's ring of cells).
  setMutedSlices(slices) {
    this.mutedCells.clear();
    for (const cells of slices) {
      for (const c of cells) this.mutedCells.add(this.key(c.faceId, c.i, c.j));
    }
  }
  isMutedCell(faceId, i, j) {
    return this.mutedCells.has(this.key(faceId, i, j));
  }

  // The tuning a head reads pitch through: its OWN per-track band when it has
  // one (full per-track control), otherwise the shared band of its group.
  bandFor(ball) {
    if (ball.band) return ball.band;
    if (ball.kind === 'Y') return this.bandY;
    if (ball.kind === 'Z') return this.bandZ;
    return this.bandX;
  }

  // The POSITIONAL pitch a head reads from where it sits: the perpendicular cell
  // index ("its level in the stack") through the head's band scale+key. Moving
  // along x → pitch from the row; moving along y → pitch from the column.
  positionalPitch(ball, i = ball.cellI, j = ball.cellJ) {
    const level = ball.movingAxis() === 'x' ? Math.max(0, j) : Math.max(0, i);
    return this.bandFor(ball).midiForLevel(level);
  }

  // Note for a head ENTERING a cell, or null if the cell is not armed / silent.
  // ONE voice: instrument from the head, pitch from the head's coordinate. (An
  // "instrumentless" head — instrument < 0 — is a silent carrier and never
  // sounds an enter note; it still collides.)
  noteForEnter(event) {
    const { ball, faceId, i, j } = event;
    if (ball.instrument == null || ball.instrument < 0) return null; // silent carrier
    const k = this.key(faceId, i, j);
    const cell = this.cellData(k);
    if (!cell) return null;
    if (this.mutedCells.has(k)) return null; // slice is off
    const midi = cell.pitch ?? this.positionalPitch(ball, i, j); // null = positional
    const velocity = Math.max(1, Math.min(127, Math.round(cell.velocity * 127)));
    return { midi, velocity, duration: 0.18, instrument: ball.instrument, faceId, i, j };
  }

  // The VOICES a collision produces, under the global collisionSource. Returns
  // { fixed?:true, voices:[...] }: `fixed` asks the caller to play the chosen
  // independent collision sound; otherwise `voices` is a list of note descriptors
  // (same shape as noteForEnter) to launch TOGETHER. This is the same "trigger →
  // list of voices" pipeline as a normal step, just with arity 2.
  voicesForCollision(event) {
    const { a, b } = event;
    if (this.collisionSource === 'fixed') return { fixed: true, voices: [] };
    if (this.collisionSource === 'cell') {
      // gated by the score: only sounds if the meeting cell is armed + live
      const k = this.key(a.faceId, a.cellI, a.cellJ);
      const cell = this.cellData(k);
      if (!cell || this.mutedCells.has(k)) return { voices: [] };
      return { voices: this._headVoices(a, b, cell.velocity) };
    }
    // 'heads' (default): each head IS an instrument, always fires on contact
    return { voices: this._headVoices(a, b, this.collisionVelocity) };
  }

  // Build the per-head voice list for a meeting: one voice per head that carries
  // an instrument (instrumentless heads are skipped). Each voice keeps its own
  // positional pitch, so two heads can sound a real dyad from the geometry.
  _headVoices(a, b, vel01) {
    const velocity = Math.max(1, Math.min(127, Math.round((vel01 ?? this.collisionVelocity) * 127)));
    const out = [];
    for (const h of [a, b]) {
      if (h.instrument == null || h.instrument < 0) continue; // silent carrier
      out.push({ midi: this.positionalPitch(h), velocity, duration: 0.3, instrument: h.instrument });
    }
    return out;
  }

  // Back-compat: a single descriptor (kept for any old caller). Prefer
  // voicesForCollision, which carries head identity.
  noteForCollision(event) {
    const { a, b } = event;
    return { drum: true, velocity: 118, duration: 0.32, a, b };
  }

  // A pleasant sparse default pattern so the cube sings immediately. Arms a few
  // cells on every face: a gentle diagonal staircase plus a couple of accents.
  seedDefaultPattern() {
    const n = this.cells;
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < n; i++) {
        const j = (i * 3) % n; // diagonal-ish staircase
        this.arm(f, i, j);
      }
      this.arm(f, 0, Math.floor(n / 2));
      this.arm(f, Math.floor(n / 2), 0);
    }
  }
}
