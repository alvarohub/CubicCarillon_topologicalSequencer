// main.js — wires the pure core to the I/O and view adapters and runs the loop.

import { buildCube } from './core/surface.js';
import { Ball } from './core/ball.js';
import { Engine } from './core/engine.js';
import { Sequencer } from './core/sequencer.js';
import { AudioOut } from './io/audio.js';
import { Controls } from './io/controls.js';
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
    }),
  );
}

const engine = new Engine(surface, balls);
engine.collisionRadius = CELL * 0.55; // two heads "meet" within ~one cell
const sequencer = new Sequencer();

// ---- adapters ----
const audio = new AudioOut();
const view = new View3D(surface, balls, document.getElementById('app'), { cells: CELLS });
const statusEl = document.getElementById('status');
const setStatus = (t) => {
  if (statusEl) statusEl.textContent = t;
};
new Controls({ engine, view, audio, startButtonId: 'start', statusFn: setStatus });

// ---- loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  engine.setRotation(view.rotationArray());

  // edge crossings -> per-track rhythm note.
  // No visual pulse here: crossing a border must NOT recolour/flash the head
  // (its colour is the fixed instrument identity). Only collisions light up.
  const events = engine.update(dt);
  for (const ev of events) {
    if (ev.type !== 'edge') continue;
    const note = sequencer.noteFor(ev);
    if (note) audio.play(note);
  }

  // head intersections -> accent note (the collision-based sequencer)
  for (const ev of engine.collisions()) {
    view.flash(ev.a);
    view.flash(ev.b);
    const note = sequencer.noteForCollision(ev);
    if (note) audio.play(note);
  }

  view.sync(now);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
