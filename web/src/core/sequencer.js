// core/sequencer.js
//
// Maps geometric events (edge crossings) to musical notes. This is the
// "instrument" layer: deliberately separate from both the physics (engine) and
// the sound output (io/audio), so the same events could drive WebAudio, WebMIDI,
// or hardware synths without touching the simulation.
//
// Pure module: returns note descriptors; it does not make sound itself.

export class Sequencer {
  // Default scale = the pentatonic set from the original 2007 sketch (MIDI notes).
  constructor(scale = [61, 63, 66, 68, 70]) {
    this.scale = scale;
  }

  // Returns { midi, velocity, duration } for an edge crossing (per-track rhythm),
  // or null if it shouldn't sound.
  noteFor(event) {
    if (event.type !== 'edge') return null;
    const b = event.ball;
    const degree = (b.index + event.edge) % this.scale.length;
    // mild octave variation per source face for melodic interest
    const octave = (event.faceFrom % 3) - 1; // -1, 0, +1
    const midi = this.scale[degree] + 12 * octave;
    return { midi, velocity: 70, duration: 0.14 };
  }

  // Accent note for an intersection of two reading-heads. This is the core
  // "collision-based" sequencer event: the pitch is picked from the cell where
  // the two heads meet, so the same intersection always sounds the same note.
  noteForCollision(event) {
    const { a, b } = event;
    const cellX = Math.round((a.x + b.x) * 2); // quantise meeting point
    const cellY = Math.round((a.y + b.y) * 2);
    const degree = (((cellX + cellY) % this.scale.length) + this.scale.length) % this.scale.length;
    const midi = this.scale[degree] + 12; // one octave up = an accent
    return { midi, velocity: 118, duration: 0.3 };
  }
}
