// main.js — wires the pure core to the I/O and view adapters and runs the loop.

import { buildCube } from './core/surface.js';
import { Ball } from './core/ball.js';
import { Engine } from './core/engine.js';
import { Sequencer } from './core/sequencer.js';
import { Band } from './core/scales.js';
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
const CELLS = 4; // divisions per face side (1..16, changeable live from the panel)
const HALF = 1; // cube half-size (faces span [-1, 1])

// All tracks start visible on the +Z face (id 4) so it reads like a sequencer.
// EVERY row has an H head and EVERY column a V head (8 + 8 = the full machine;
// pause buttons are the mixing desk). Spawn layout (also the "reset heads"
// target): the H heads line up along the face's VERTICAL axis (the centre
// column), the V heads along the BOTTOM EDGE row (parallel to x). The crossing
// cell would stack two heads, so that V head starts one cell up.
const FACE = 4;

// Spawn configuration for track t of a band, for an n-division grid. With more
// tracks than rows the extras share a rail (t % n).
function homeFor(kind, t, n, speed) {
  const cellSz = (2 * HALF) / n;
  const c = (i) => -HALF + (i + 0.5) * cellSz;
  const mid = Math.floor(n / 2) % n;
  if (kind === 'H') return { faceId: FACE, x: c(mid), y: c(t % n), vx: speed, vy: 0, kind };
  const col = t % n;
  return { faceId: FACE, x: c(col), y: c(col === mid ? Math.min(1, n - 1) : 0), vx: 0, vy: speed, kind };
}

const H_COLORS = ['#ff5d5d', '#ff7a45', '#ff9b3d', '#ffb84d', '#ffd24d', '#ffe97a', '#ff6db0', '#ff9bd0'];
const V_COLORS = ['#4dc8ff', '#5df0e0', '#5dff9b', '#9bff7a', '#6d8bff', '#8b6dff', '#b48bff', '#7adcff'];

// One track per row (H) / column (V); each gets its own continuous-mode tempo
// so derailing into continuous mode immediately makes polyrhythms.
const H_TRACKS = Array.from({ length: 8 }, (_, t) => ({ cell: t, speed: 0.4 + t * 0.07 }));
const V_TRACKS = Array.from({ length: 8 }, (_, t) => ({ cell: t, speed: 0.45 + t * 0.07 }));

// First impression = a real little band: the whole H band plays the sampled
// PIANO; the V band is the rhythm section (drums cycling). Only head 0 starts
// running — press run and it just works; wake the others one by one.
const PIANO = 6; // MELODIC index of the sampled piano (io/audio.js)
const DRUM0 = 7; // first drum index (MELODIC.length)

const balls = [];
let idx = 0;
for (let t = 0; t < H_TRACKS.length; t++) {
  const tr = H_TRACKS[t];
  const b = new Ball({
    index: idx++,
    ...homeFor('H', t, CELLS, tr.speed),
    color: H_COLORS[t % H_COLORS.length],
    instrument: PIANO,
  });
  b.track = t; // position within its band (for the track-count dial)
  b.speed = tr.speed; // remembered for re-homing when the grid divisions change
  b.band = new Band({ name: `H${t}`, scale: 'pentatonic', root: 60 }); // per-track tuning
  balls.push(b);
}
for (let t = 0; t < V_TRACKS.length; t++) {
  const tr = V_TRACKS[t];
  const b = new Ball({
    index: idx++,
    ...homeFor('V', t, CELLS, tr.speed),
    color: V_COLORS[t % V_COLORS.length],
    instrument: DRUM0 + (t % 4),
  });
  b.track = t;
  b.speed = tr.speed;
  b.band = new Band({ name: `V${t}`, scale: 'pentatonic', root: 57 });
  balls.push(b);
}
// Start modestly: 4 tracks per band awake-able (the dial in the panel opens up
// to the full 8+8); only head 0 actually runs.
for (const b of balls) {
  b.active = b.track < 4;
  b.muted = b.index !== 0;
}

const engine = new Engine(surface, balls, CELLS);
engine.collisionRadius = ((2 * HALF) / CELLS) * 0.55; // two heads "meet" within ~one cell
engine.stepMode = true; // START on the clocked grid (no gravity by default);
// heads spawn already lined up as a bar, so the first impression is a clean,
// readable step sequencer — continuous/gravity/derail are the wild modes.
const sequencer = new Sequencer({ cells: CELLS });
// the score starts EMPTY — a blank instrument, ready to be played

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

// Change the grid resolution LIVE (1..16 divisions per face side). The score is
// per-grid so it clears; every head is re-homed onto the new lattice.
function setDivisions(n) {
  n = Math.max(1, Math.min(16, Math.round(n)));
  engine.cells = n;
  engine.collisionRadius = ((2 * HALF) / n) * 0.55;
  sequencer.cells = n;
  sequencer.clear();
  for (const b of balls) {
    b.home = homeFor(b.kind, b.track ?? 0, n, b.speed || 0.4);
    engine.resetHead(b);
  }
  view.setCells(n);
  view.refreshArmedCells(sequencer);
}

const ui = new UIPanel({ engine, view, audio, sequencer, midi, controls, flags, setDivisions });

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
  view.strikeCell(ev.faceId, ev.i, ev.j, ev.ball.color); // flash the pad/facet (instrument colour)
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
