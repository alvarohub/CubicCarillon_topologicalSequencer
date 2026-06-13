// core/scales.js
//
// Musical scales and per-band tuning. Pure module (no audio, no DOM).
//
// A "band" (the horizontal group or the transversal group of tracks) has its own
// scale + key. Pitch is read from a head's PERPENDICULAR cell index (its "level
// in the stack"), so the same armed cell sounds a different pitch depending on
// which band's head reads it — like reading a score rotated 90°.

// Semitone offsets within one octave for each scale type. All seven diatonic
// MODES (the serious toolkit) plus the pentatonics and blues/chromatic for play.
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], // ionian
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10], // aeolian (natural minor)
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9], // major pentatonic (no semitone clashes)
  minPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES = Object.keys(SCALES);

// Note names for displaying / picking a key (root). C = 0.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// A band's tuning: a scale name + a root MIDI note (the key).
export class Band {
  constructor({ name = 'horizontal', scale = 'pentatonic', root = 60 } = {}) {
    this.name = name;
    this.scale = scale; // key into SCALES
    this.root = root; // MIDI note of degree 0 (the key)
  }

  // Map a non-negative integer "level" (perpendicular cell index) to a MIDI note,
  // wrapping octaves as the level exceeds the scale length.
  midiForLevel(level) {
    const offs = SCALES[this.scale] || SCALES.pentatonic;
    const n = offs.length;
    const oct = Math.floor(level / n);
    const idx = ((level % n) + n) % n;
    return this.root + 12 * oct + offs[idx];
  }
}
