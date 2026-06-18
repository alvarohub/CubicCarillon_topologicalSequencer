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

// One track per row (H) / column (V). Every track shares the SAME base speed so
// that, once aligned, heads move together in continuous mode — divergence comes
// ONLY from a deliberately different per-track `rate` (an honest polyrhythm),
// never from a hidden speed spread. In the clean regime the engine re-derives
// the actual speed from the tempo anyway; this just fixes the direction/sign.
const BASE_SPEED = 0.5;
const MAX_TRACKS_PER_SIDE = 16;
const H_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: BASE_SPEED }));
const V_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: BASE_SPEED }));
const Z_TRACKS = Array.from({ length: MAX_TRACKS_PER_SIDE }, (_, t) => ({ cell: t, speed: BASE_SPEED }));

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
// divided (div.X tracks on X, etc.). Every head starts MUTED — a quiet cube,
// ready to be woken track by track.
for (const b of balls) {
  b.active = (b.track ?? 0) < divisions[b.kind];
  b.muted = true;
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
// sound routing flags (toggled from the panel)
const flags = { builtInSound: true, noteSound: true, collisionSound: true };
const controls = new Controls({
  engine,
  view,
  audio,
  sequencer,
  midi,
  flags,
  startButtonId: 'start',
  statusFn: setStatus,
});

// Drop only the armed/muted cells that fall OUTSIDE the reshaped grid, so a
// division change conserves every note that still has a cell to live on (the
// score survives growing AND shrinking the box where it can).
function pruneNotesToGrid() {
  const fits = (key) => {
    const [f, i, j] = key.split(':').map(Number);
    const face = surface.faceById(f);
    return i < divisions[face.uAxis] && j < divisions[face.vAxis];
  };
  for (const k of [...sequencer.armed.keys()]) if (!fits(k)) sequencer.armed.delete(k);
  for (const k of [...sequencer.mutedCells.keys()]) if (!fits(k)) sequencer.mutedCells.delete(k);
}

// Change ONE world axis' track count LIVE (the per-group "Tracks on" dial). The
// cuboid is re-shaped (surface.setDims) so the box grows/shrinks along that axis
// with the cells staying unit squares. This is INCREMENTAL and non-destructive:
//   • a track that APPEARS (count grew) spawns its head at home;
//   • a track that DISAPPEARS (count shrank) just hides — its head is gone;
//   • a SURVIVING head keeps its musical cell (re-fitted onto the reshaped
//     face), so existing heads neither jump home nor pile up as "duplicates";
//   • notes are conserved wherever a cell still exists.
function setDivisions(axis, n) {
  // Capture each surviving head's logical cell (face, travel-phase, row) BEFORE
  // the box reshapes: the cell INDEX is the stable identity. The absolute (x,y)
  // is not — changing a division rescales `unit`, so re-deriving the index from
  // a preserved coordinate would land the head on a different cell (a head would
  // appear to jump into the middle of the resized row).
  const keep = new Map();
  for (const b of balls) if (b.active !== false) keep.set(b, engine.cellOf(b));

  engine.setDiv(axis, n); // mutates the shared `divisions` object
  surface.setDims(divisions); // re-shape the cuboid (unit cells, box resizes)
  engine.collisionRadius = surface.unit * 0.55;
  sequencer.cells = divisions.X;
  pruneNotesToGrid(); // keep the score where it still fits
  for (const b of balls) {
    const wasActive = b.active !== false;
    const nowActive = (b.track ?? 0) < divisions[b.kind];
    b.active = nowActive;
    if (!nowActive) continue; // removed track → its head simply disappears
    b.home = homeFor(b.kind, b.track ?? 0, surface, b.speed || 0.4);
    if (wasActive)
      engine.placeAtCell(b, keep.get(b)); // surviving head: keep its cell index
    else engine.resetHead(b); // newly-created track: spawn its head at home
  }
  view.applyDivisions();
  view.refreshArmedCells(sequencer);
}

// Rotate every head through the axes (X→Y→Z→X) — the "Rotate" button. Each head
// moves to the corresponding face of the next band and is re-homed there; the
// notes stay on their cells (a cell simply gets read by a different band now).
function rotateBands() {
  const cycle = { X: 'Y', Y: 'Z', Z: 'X' };
  for (const b of balls) b.kind = cycle[b.kind] || 'X';
  for (const b of balls) {
    b.active = (b.track ?? 0) < divisions[b.kind];
    b.home = homeFor(b.kind, b.track ?? 0, surface, b.speed || 0.4);
    engine.resetHead(b);
  }
  view.refreshArmedCells(sequencer);
}

const ui = new UIPanel({ engine, view, audio, sequencer, midi, controls, flags, setDivisions, rotateBands });

// Boot look & feel — load the starting parameters from presets/default.json
// (the "both" surface, a darker acrylic, a brighter ambient, the firefly heads,
// the 16+16+16 track stack). Loading a file means the defaults can be tweaked
// without touching code: just edit presets/default.json (it has the exact same
// shape that Save JSON writes / Load JSON reads). Applied through the same
// applyParams path so the panel and the scene agree from frame one. Falls back
// to a built-in preset if the file can't be fetched (e.g. opened via file://).
const BOOT_FALLBACK = {
  transport: { bpm: 120, stepMode: true, railed: true, gravity: 0 },
  view: {
    surfaceStyle: 'both',
    facetGap: 0.12,
    popAmount: 0.6,
    ambientIntensity: 5.15,
    cubeOpacity: 1,
    cubeColor: '#231f1f',
    armedColor: '#c7c4c4',
    gridColor: '#3a4f70',
    flashMode: 'instrument',
    headStyle: 'inner',
    headDepth: -0.02,
    headCoreSize: 0.8,
    mirrorFirefly: true,
    fireflyBright: 4.8,
    fireflyDim: 3,
    fireflyDesat: 0.3,
  },
};

fetch(new URL('../presets/default.json', import.meta.url))
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((preset) => ui.applyParams(preset))
  .catch((err) => {
    console.warn('Could not load presets/default.json — using built-in defaults.', err);
    ui.applyParams(BOOT_FALLBACK);
  });

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

function handleEnter(ev) {
  const note = sequencer.noteForEnter(ev);
  if (!note) return;
  if (flags.builtInSound && flags.noteSound) audio.play(note, ev.when); // scheduled on the audio clock
  if (midi.enabled) midi.note(note); // mirror to real synths
  view.flash(ev.ball); // the reading head pulses brighter (brightness only, not hue)
  view.strikeCell(ev.faceId, ev.i, ev.j, ev.ball.color); // flash the pad/facet (instrument colour)
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  engine.setRotation(view.rotationArray());

  // The audio clock drives all note ONSETS, so timing is sample-accurate and
  // free of animation-frame jitter; the visuals still ride this rAF loop.
  const audioNow = audio.now();

  // ONE dynamics drives both "modes": every head GLIDES continuously (geodesic
  // on the surface, so subtly-rotated trajectories keep reading the score). Step
  // mode is purely a VIEW choice — the head is RENDERED snapped to cell centres
  // ("don't show the ball between the cells"), but it advances and fires notes
  // exactly like continuous. Each emitted event carries `when` — the exact
  // audio-clock instant it sounds.
  view.setSnap(engine.stepMode);
  for (const ev of engine.update(dt, audioNow)) handleEnter(ev);

  // Head intersections -> ONE event that draws on the two heads. The global
  // collision SOURCE (sequencer.collisionSource) decides the sound: a fixed
  // chosen voice, the armed note under the meeting, or both heads' instruments
  // launched together (a dyad from the geometry). Scheduled on the audio clock,
  // aligned to the heads' own notes so there is no flam.
  for (const ev of engine.collisions(audioNow)) {
    view.flash(ev.a);
    view.flash(ev.b);
    if (!flags.collisionSound) continue;
    const res = sequencer.voicesForCollision(ev);
    if (res.fixed) {
      if (flags.builtInSound) audio.playCollision({}, ev.when);
      if (midi.enabled) midi.collision({});
    } else {
      for (const voice of res.voices) {
        if (flags.builtInSound) audio.play(voice, ev.when);
        if (midi.enabled) midi.note(voice);
      }
    }
  }

  view.sync(now);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
