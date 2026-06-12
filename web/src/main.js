// main.js — wires the pure core to the I/O and view adapters and runs the loop.

import { buildCube } from './core/surface.js';
import { Ball } from './core/ball.js';
import { Engine } from './core/engine.js';
import { Sequencer } from './core/sequencer.js';
import { AudioOut } from './io/audio.js';
import { Controls } from './io/controls.js';
import { MidiOut } from './io/midi.js';
import { UIPanel } from './io/ui.js';
import { View3D } from './view/view3d.js';

// ---- model ----
const surface = buildCube(2);

// Sequencer layout. Each face is an N x N grid of cells (monome-style buttons).
// A "track" is a band that runs straight around the cube; its single square
// reading-head sweeps along it at its own tempo. There are two perpendicular
// GROUPS of parallel tracks:
//   - H (horizontal): heads move along +x, sitting on different rows (y)
//   - V (vertical):   heads move along +y, sitting on different columns (x)
// Heads from perpendicular groups meet at grid intersections -> a collision
// event -> an accent note. Because each track has a different tempo, the
// intersections recur at the least-common-multiple of the periods: polyrhythms.
const CELLS = 8;
const HALF = 1; // cube half-size (faces span [-1, 1])
const CELL = (2 * HALF) / CELLS;
const center = (i) => -HALF + (i + 0.5) * CELL; // cell-centre coordinate

// All tracks start visible on the +Z face (id 4) so it reads like a sequencer.
const FACE = 4;
const H_COLORS = ['#ff5d5d', '#ff8b3d', '#ffd24d', '#ff6db0'];
const V_COLORS = ['#5dd4ff', '#5dff9b', '#6d8bff', '#b48bff'];

// (row index, tempo) for horizontal tracks; (col index, tempo) for vertical.
const H_TRACKS = [
  { cell: 1, speed: 0.4 },
  { cell: 3, speed: 0.55 },
  { cell: 5, speed: 0.7 },
  { cell: 7, speed: 0.85 },
];
const V_TRACKS = [
  { cell: 0, speed: 0.45 },
  { cell: 2, speed: 0.6 },
  { cell: 4, speed: 0.75 },
  { cell: 6, speed: 0.9 },
];

const balls = [];
let idx = 0;
for (let t = 0; t < H_TRACKS.length; t++) {
  const tr = H_TRACKS[t];
  balls.push(
    new Ball({
      index: idx++,
      faceId: FACE,
      x: -HALF + CELL * 0.5,
      y: center(tr.cell), // start at left edge of its row
      vx: tr.speed,
      vy: 0,
      color: H_COLORS[t % H_COLORS.length],
      kind: 'H', // horizontal band: pitch comes from its ROW
      instrument: t % 6,
    }),
  );
}
for (let t = 0; t < V_TRACKS.length; t++) {
  const tr = V_TRACKS[t];
  balls.push(
    new Ball({
      index: idx++,
      faceId: FACE,
      x: center(tr.cell),
      y: -HALF + CELL * 0.5, // start at bottom of its column
      vx: 0,
      vy: tr.speed,
      color: V_COLORS[t % V_COLORS.length],
      kind: 'V', // transversal band: pitch comes from its COLUMN
      instrument: t % 6,
    }),
  );
}

const engine = new Engine(surface, balls, CELLS);
engine.collisionRadius = CELL * 0.55; // two heads "meet" within ~one cell
const sequencer = new Sequencer({ cells: CELLS });
sequencer.seedDefaultPattern(); // so the cube sings on first run

// ---- adapters ----
const audio = new AudioOut();
const midi = new MidiOut();
const view = new View3D(surface, balls, document.getElementById('app'), { cells: CELLS });
view.refreshArmedCells(sequencer); // draw the initial score
const statusEl = document.getElementById('status');
const setStatus = (t) => {
  if (statusEl) statusEl.textContent = t;
};
const controls = new Controls({ engine, view, audio, sequencer, startButtonId: 'start', statusFn: setStatus });
// sound routing flags (toggled from the panel)
const flags = { noteSound: true, collisionSound: true };
const ui = new UIPanel({ engine, view, audio, sequencer, midi, controls, flags });

// Optional debug hook (only when ?debug is in the URL): exposes the live objects
// on window for inspection/automated UI tests. Never active in normal use.
if (location.search.includes('debug')) {
  window.__cube = { engine, view, sequencer, balls, controls, midi, ui, flags };
}

// ---- loop ----
// A head SOUNDS when it ENTERS an armed cell (engine 'enter' events) — this
// unifies continuous and step motion. In step mode a global clock ticks at BPM;
// in continuous mode heads glide and cross cells at their own tempi (polyrhythm).
let last = performance.now();
let stepAcc = 0; // step-mode beat accumulator (seconds)

function handleEnter(ev) {
  const note = sequencer.noteForEnter(ev);
  if (!note) return;
  if (flags.noteSound) audio.play(note);
  if (midi.enabled) midi.note(note); // mirror to real synths
  view.flash(ev.ball); // the reading head pulses brighter (brightness only, not hue)
  view.strikeCell(ev.faceId, ev.i, ev.j); // flash the armed pad
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  engine.setRotation(view.rotationArray());

  if (engine.stepMode) {
    // advance on the clock: one cell per beat
    const interval = 60 / engine.bpm;
    stepAcc += dt;
    let guard = 0;
    while (stepAcc >= interval && guard++ < 8) {
      stepAcc -= interval;
      for (const ev of engine.tick()) handleEnter(ev);
    }
  } else {
    stepAcc = 0;
    for (const ev of engine.update(dt)) handleEnter(ev);
  }

  // head intersections -> a percussive hit (the non-Euclidean "collision" voice)
  for (const ev of engine.collisions()) {
    view.flash(ev.a);
    view.flash(ev.b);
    const note = sequencer.noteForCollision(ev);
    if (note) {
      if (flags.collisionSound) audio.playCollision(note);
      if (midi.enabled) midi.collision(note);
    }
  }

  view.sync(now);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
