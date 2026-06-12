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
  constructor({ cells = 8, bandH = null, bandV = null } = {}) {
    this.cells = cells;
    // two bands with independent scale + key
    this.bandH = bandH || new Band({ name: 'horizontal', scale: 'pentatonic', root: 60 }); // C
    this.bandV = bandV || new Band({ name: 'transversal', scale: 'pentatonic', root: 57 }); // A
    // armed cells: Map of "faceId:i:j" -> velocity (0..1, how hard the note is
    // struck). Arming defaults to a healthy mezzo-forte; the velocity is shaped
    // by the press-and-drag gesture (io/controls) and read by noteForEnter.
    this.armed = new Map();
    this.defaultVelocity = 0.7;
    // cells silenced because they sit on a MUTED track's slice. Muting a
    // horizontal track also silences those cells for vertical heads (and vice
    // versa) — the whole slice is off, regardless of reading direction.
    this.mutedCells = new Set();
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

  // The band a head belongs to.
  bandFor(ball) {
    return ball.kind === 'V' ? this.bandV : this.bandH;
  }

  // Note for a head ENTERING a cell, or null if the cell is not armed.
  // pitch = perpendicular cell index through the head's band scale+key.
  noteForEnter(event) {
    const { ball, faceId, i, j } = event;
    const k = this.key(faceId, i, j);
    if (!this.armed.has(k)) return null;
    if (this.mutedCells.has(k)) return null; // slice is off
    // moving along x -> perpendicular level is the row j; moving along y -> col i.
    const level = ball.movingAxis() === 'x' ? j : i;
    const midi = this.bandFor(ball).midiForLevel(level);
    const vel = this.armed.get(k); // 0..1 -> MIDI 1..127
    const velocity = Math.max(1, Math.min(127, Math.round(vel * 127)));
    return { midi, velocity, duration: 0.18, instrument: ball.instrument, faceId, i, j };
  }

  // A drum hit when two heads meet (the non-Euclidean "collision" voice).
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
