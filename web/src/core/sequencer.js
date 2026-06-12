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
    // armed cells: Set of "faceId:i:j"
    this.armed = new Set();
  }

  // ---- score editing ----
  key(faceId, i, j) {
    return `${faceId}:${i}:${j}`;
  }
  isArmed(faceId, i, j) {
    return this.armed.has(this.key(faceId, i, j));
  }
  arm(faceId, i, j) {
    this.armed.add(this.key(faceId, i, j));
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
    this.armed.add(k);
    return true;
  }
  clear() {
    this.armed.clear();
  }

  // The band a head belongs to.
  bandFor(ball) {
    return ball.kind === 'V' ? this.bandV : this.bandH;
  }

  // Note for a head ENTERING a cell, or null if the cell is not armed.
  // pitch = perpendicular cell index through the head's band scale+key.
  noteForEnter(event) {
    const { ball, faceId, i, j } = event;
    if (!this.isArmed(faceId, i, j)) return null;
    // moving along x -> perpendicular level is the row j; moving along y -> col i.
    const level = ball.movingAxis() === 'x' ? j : i;
    const midi = this.bandFor(ball).midiForLevel(level);
    return { midi, velocity: 78, duration: 0.18, instrument: ball.instrument, faceId, i, j };
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
