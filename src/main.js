// main.js — wires the pure core to the I/O and view adapters and runs the loop.

import { buildCuboid } from './core/surface.js';
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
// THREE entangled step sequencers, one per world axis (X/Y/Z). The playing
// surface is a CUBOID built from unit cubes: each axis K is divided into div[K]
// cells, so the box is a div.X × div.Y × div.Z stack of little cubes. Every
// facet stays a UNIT SQUARE — adding tracks to a band grows the box along that
// axis instead of stretching the cells.
//
// Band K has div[K] parallel reading-heads (its "tracks"), each looping AROUND
// world-axis K. A loop therefore wraps the four faces perpendicular to K, so its
// STEP LENGTH = the perimeter of the perpendicular rectangle = 2·(the other two
// counts): all-4 → 2·(4+4)=16 steps (4/4); set the other two to 3 → 2·(3+3)=12
// (3/4). That is the entanglement — each axis' count is both its own track count
// AND a step-length term for the other two bands.
const CELLS = 4; // default divisions along EACH world axis (1..16, live per-axis)

// One shared object handed to the surface, engine AND view so they stay in
// lock-step; the per-group "Tracks on" dial mutates one entry and re-shapes the
// cuboid (surface.setDims) live.
const divisions = { X: CELLS, Y: CELLS, Z: CELLS };
const surface = buildCuboid(divisions, 2); // longest side normalised to 2

// Spawn faces. Band K loops around axis K, so we start each band on a face whose
// in-plane TRAVEL axis (u) is one of the perpendicular axes and whose ROW axis
// (v) is K itself — giving div[K] rows = div[K] tracks, each reading its pitch
// from its K-level (the scale-loaded stack):
//   X → +Y face (travel Z, rows X)   Y → +Z face (travel X, rows Y)   Z → +X face (travel Y, rows Z)
const HOME_FACE = { X: 2, Y: 4, Z: 0 };

// Spawn configuration for track t of a band, on the live cuboid. The head starts
// at the FIRST cell along its travel axis (the box edge where that axis begins),
// on its own row; rows wrap if a band has more tracks than its axis has slices.
function homeFor(kind, t, surf, speed) {
  const f = surf.faceById(HOME_FACE[kind] ?? 2);
  const nu = surf.div[f.uAxis]; // steps along the travel axis (u)
  const nv = surf.div[f.vAxis]; // rows = this band's track count (v = axis K)
  const cu = f.su / nu;
  const cv = f.sv / nv;
  const row = nv > 0 ? t % nv : 0;
  const x = -f.su / 2 + 0.5 * cu; // first cell along u (the starting edge)
  const y = -f.sv / 2 + (row + 0.5) * cv;
  return { faceId: f.id, x, y, vx: speed, vy: 0, kind };
}

const H_COLORS = ['#ff5d5d', '#ff7a45', '#ff9b3d', '#ffb84d', '#ffd24d', '#ffe97a', '#ff6db0', '#ff9bd0'];
const V_COLORS = ['#4dc8ff', '#5df0e0', '#5dff9b', '#9bff7a', '#6d8bff', '#8b6dff', '#b48bff', '#7adcff'];
const Z_COLORS = ['#a16dff', '#bd7dff', '#d18cff', '#e29cff', '#8f89ff', '#76a8ff', '#86c7ff', '#9be5ff'];

// One track per row (H) / column (V); each gets its own continuous-mode tempo
// so derailing into continuous mode immediately makes polyrhythms.
const MAX_TRACKS_PER_SIDE = 16;
const H_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: 0.4 + t * 0.035 }));
const V_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: 0.45 + t * 0.035 }));
const Z_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: 0.43 + t * 0.033 }));

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
    ...homeFor('X', t, surface, tr.speed),
    color: H_COLORS[t % H_COLORS.length],
    instrument: PIANO,
  });
  b.track = t; // position within its band (for the track-count dial)
  b.speed = tr.speed; // remembered for re-homing when the grid divisions change
  b.band = new Band({ name: `X${t}`, scale: 'pentatonic', root: 60 }); // per-track tuning
  balls.push(b);
}
for (let t = 0; t < V_TRACKS.length; t++) {
  const tr = V_TRACKS[t];
  const b = new Ball({
    index: idx++,
    ...homeFor('Y', t, surface, tr.speed),
    color: V_COLORS[t % V_COLORS.length],
    instrument: DRUM0 + (t % 4),
  });
  b.track = t;
  b.speed = tr.speed;
  b.band = new Band({ name: `Y${t}`, scale: 'pentatonic', root: 57 });
  balls.push(b);
}
for (let t = 0; t < Z_TRACKS.length; t++) {
  const tr = Z_TRACKS[t];
  const b = new Ball({
    index: idx++,
    ...homeFor('Z', t, surface, tr.speed),
    color: Z_COLORS[t % Z_COLORS.length],
    instrument: PIANO,
  });
  b.track = t;
  b.speed = tr.speed;
  b.band = new Band({ name: `Z${t}`, scale: 'pentatonic', root: 64 });
  balls.push(b);
}
// Start with one group per axis; each band shows as many tracks as its axis is
// divided (div.X tracks on X, etc.). Only head 0 runs at first.
for (const b of balls) {
  b.active = (b.track ?? 0) < divisions[b.kind];
  b.muted = b.index !== 0;
}

const engine = new Engine(surface, balls, divisions);
engine.collisionRadius = surface.unit * 0.55; // two heads "meet" within ~one cell
engine.stepMode = true; // START on the clocked grid (no gravity by default);
// heads spawn already lined up as a bar, so the first impression is a clean,
// readable step sequencer — continuous/gravity/derail are the wild modes.
const sequencer = new Sequencer({ cells: divisions.X });
// the score starts EMPTY — a blank instrument, ready to be played

// ---- adapters ----
const audio = new AudioOut();
const midi = new MidiOut();
const view = new View3D(surface, balls, document.getElementById('app'), { divisions });
view.refreshArmedCells(sequencer); // draw the initial score
const statusEl = document.getElementById('status');
const setStatus = (t) => {
  if (statusEl) statusEl.textContent = t;
};
const controls = new Controls({ engine, view, audio, sequencer, startButtonId: 'start', statusFn: setStatus });
// sound routing flags (toggled from the panel)
const flags = { noteSound: true, collisionSound: true };

// Change ONE world axis' track count LIVE (the per-group "Tracks on" dial). The
// cuboid is re-shaped (surface.setDims) so the box grows/shrinks along that axis
// with the cells staying unit squares; the score is per-grid so it clears, and
// every head is re-homed onto the new lattice.
function setDivisions(axis, n) {
  engine.setDiv(axis, n); // mutates the shared `divisions` object
  surface.setDims(divisions); // re-shape the cuboid (unit cells, box resizes)
  engine.collisionRadius = surface.unit * 0.55;
  sequencer.cells = divisions.X;
  sequencer.clear();
  for (const b of balls) {
    b.home = homeFor(b.kind, b.track ?? 0, surface, b.speed || 0.4);
    b.active = (b.track ?? 0) < divisions[b.kind];
    engine.resetHead(b);
  }
  view.applyDivisions();
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
