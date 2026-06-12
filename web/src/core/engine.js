// core/engine.js
//
// Holds the surface + balls, advances them, and collects events.
//
// Two motion MODES:
//   - continuous (default): heads glide along geodesics; each track keeps its own
//     speed, so intersections recur at the LCM of the periods (polyrhythm).
//   - step: a global clock ticks at `bpm`; on each tick every head advances by
//     exactly ONE cell along its rail (a "real" step sequencer / piano-roll grid).
//
// Two rail STATES (independent of gravity and of the motion mode):
//   - railed (default): one coordinate is held fixed, the head stays on its
//     row/column track. Gravity, if on, acts only ALONG the rail.
//   - derailed: free geodesic motion; gravity (if on) can pull the head off-axis.
//
// Gravity is handled physically: a world "down" vector is projected onto each
// face's tangent plane using the current orientation R (local->world rotation).
//
// Events emitted (for the sequencer + renderers):
//   - { type:'enter', ball, faceId, i, j }  head entered a new grid cell
//   - { type:'collision', a, b }            two heads share a cell (debounced)
//
// Pure module: no rendering, no audio, no DOM.

export class Engine {
  constructor(surface, balls, cells = 8) {
    this.surface = surface;
    this.balls = balls;
    this.cells = cells; // grid resolution per face side (for cell indexing)
    this.paused = false;

    this.gravityStrength = 0; // 0 = constant-velocity geodesics
    this.gravityWorld = [0, -1, 0]; // world "down"
    this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // local->world rotation (row-major 3x3)
    this.damping = 0;
    this.maxSpeed = 3.0;

    // motion mode + rail state
    this.railed = true;
    this.stepMode = false;
    this.bpm = 120; // step-mode tempo: one cell per beat

    // head-to-head collisions (the sequencer's intersection events)
    this.collisionRadius = 0.12;
    this._colliding = new Set(); // pair keys currently overlapping (debounce)
  }

  // ---- grid helpers ----
  _cellSize(face) {
    return face.size / this.cells;
  }
  _cellIndex(coord, face) {
    const half = face.size / 2;
    const i = Math.floor((coord + half) / this._cellSize(face));
    return i < 0 ? 0 : i >= this.cells ? this.cells - 1 : i;
  }

  // R: row-major 3x3 mapping face-local (cube) vectors to world space.
  setRotation(R) {
    this.R = R;
  }

  // Face-local acceleration from gravity: project world "down" onto (u,v).
  _accel(face) {
    if (this.gravityStrength === 0) return null;
    const R = this.R,
      g = this.gravityWorld;
    // world image of local axis u:  Ru = R * u
    const Ru = [
      R[0] * face.u[0] + R[1] * face.u[1] + R[2] * face.u[2],
      R[3] * face.u[0] + R[4] * face.u[1] + R[5] * face.u[2],
      R[6] * face.u[0] + R[7] * face.u[1] + R[8] * face.u[2],
    ];
    const Rv = [
      R[0] * face.v[0] + R[1] * face.v[1] + R[2] * face.v[2],
      R[3] * face.v[0] + R[4] * face.v[1] + R[5] * face.v[2],
      R[6] * face.v[0] + R[7] * face.v[1] + R[8] * face.v[2],
    ];
    const s = this.gravityStrength;
    const au = (g[0] * Ru[0] + g[1] * Ru[1] + g[2] * Ru[2]) * s;
    const av = (g[0] * Rv[0] + g[1] * Rv[1] + g[2] * Rv[2]) * s;
    return [au, av];
  }

  // Keep a head on its rail: zero the off-axis velocity (snap to the track) and,
  // if an acceleration is supplied, project it onto the rail so gravity only
  // speeds/slows the head ALONG the track instead of pushing it off.
  _railProject(b, acc) {
    if (b.movingAxis() === 'x') {
      b.vy = 0;
      return acc ? [acc[0], 0] : null;
    }
    b.vx = 0;
    return acc ? [0, acc[1]] : null;
  }

  // Detect a newly-entered grid cell for a single ball; push an 'enter' event
  // when the (face,i,j) changes. The first observation just records the cell.
  _cellEvents(b, out) {
    const face = this.surface.faceById(b.faceId);
    const i = this._cellIndex(b.x, face);
    const j = this._cellIndex(b.y, face);
    if (b.faceId !== b.cellFace || i !== b.cellI || j !== b.cellJ) {
      const first = b.cellFace === -1;
      b.cellFace = b.faceId;
      b.cellI = i;
      b.cellJ = j;
      if (!first) out.push({ type: 'enter', ball: b, faceId: b.faceId, i, j });
    }
  }

  // Continuous-time advance. Each head experiences time scaled by its own
  // `rate` (a musical multiplier of the global tempo: ×½, ×1, ×2, ×3 …).
  update(dt) {
    if (this.paused) return [];
    if (this.stepMode) return []; // step mode advances via tick(), not here
    const all = [];
    for (const b of this.balls) {
      if (b.muted) continue; // a paused head freezes (its notes stay live for the other band)
      const face = this.surface.faceById(b.faceId);
      let acc = this._accel(face);
      if (this.railed) acc = this._railProject(b, acc);
      b.step(this.surface, dt * (b.rate || 1), acc, this.damping, this.maxSpeed);
      this._cellEvents(b, all);
    }
    return all;
  }

  // Discrete advance, called by the clock at `bpm`. Each head accumulates its
  // own `rate` per beat and hops one cell per whole accumulated step — so a ×2
  // track moves two cells per beat and a ×½ track every other beat, all locked
  // to the same grid (the per-track polyrhythm, quantised).
  tick() {
    if (this.paused) return [];
    const all = [];
    for (const b of this.balls) {
      if (b.muted) continue; // a paused head freezes (its notes stay live for the other band)
      b._stepAcc = (b._stepAcc || 0) + (b.rate || 1);
      let guard = 0;
      while (b._stepAcc >= 1 - 1e-9 && guard++ < 16) {
        b._stepAcc -= 1;
        this._hopOneCell(b, all);
      }
    }
    return all;
  }

  // Move ONE head exactly one cell along its rail (dir = +1 forward, -1 back).
  // Preserves the head's speed magnitude (so switching back to continuous keeps
  // the polyrhythm); pass out=null for a silent editing hop (shift).
  _hopOneCell(b, out, dir = 1) {
    const face = this.surface.faceById(b.faceId);
    const cell = this._cellSize(face);

    // direction only (normalize); remember speed to restore afterwards
    let sp = Math.hypot(b.vx, b.vy);
    if (sp < 1e-9) {
      // give a stalled head a default direction along its band
      b.vx = b.kind === 'V' ? 0 : 1;
      b.vy = b.kind === 'V' ? 1 : 0;
      sp = 1;
    }
    b.vx /= sp;
    b.vy /= sp;
    if (this.railed) this._railProject(b, null);
    if (dir < 0) {
      b.vx = -b.vx;
      b.vy = -b.vy;
    }

    // move exactly one cell (no gravity/damping during the discrete hop)
    b.step(this.surface, cell, null, 0, Infinity);

    // snap to the nearest cell centre to kill float drift, then restore the
    // forward-facing direction and speed
    this._snapToCell(b);
    if (dir < 0) {
      b.vx = -b.vx;
      b.vy = -b.vy;
    }
    const u = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / u) * sp;
    b.vy = (b.vy / u) * sp;

    if (out) this._cellEvents(b, out);
  }

  // Nudge one head a cell forward (+1) or back (-1) along its rail — a silent
  // PHASE shift (the editing gesture). The shifted-into cell does not sound;
  // the next clock tick reads from the new position.
  shiftHead(index, dir = 1) {
    const b = this.balls[index];
    if (!b) return;
    this._hopOneCell(b, null, dir >= 0 ? 1 : -1);
  }

  // Send one head back to its spawn configuration (face, cell, direction, band).
  resetHead(b) {
    if (b.home) {
      b.faceId = b.home.faceId;
      b.x = b.home.x;
      b.y = b.home.y;
      b.vx = b.home.vx;
      b.vy = b.home.vy;
      b.kind = b.home.kind;
    }
    b._stepAcc = 0;
    b.cellFace = -1;
    b.cellI = -1;
    b.cellJ = -1;
  }

  // Send EVERY head home (the global "reset heads").
  resetHeads() {
    for (const b of this.balls) this.resetHead(b);
  }

  _snapToCell(b) {
    const face = this.surface.faceById(b.faceId);
    const half = face.size / 2;
    const cell = this._cellSize(face);
    const center = (k) => -half + (k + 0.5) * cell;
    b.x = center(this._cellIndex(b.x, face));
    b.y = center(this._cellIndex(b.y, face));
  }

  // Gather the heads into a "bar": bring every head onto one face and line the
  // bands up so they sweep as solid bars (the H heads become a vertical bar that
  // reads a whole column at once; the V heads a horizontal bar). Each head keeps
  // its perpendicular level (its pitch row/column).
  alignHeads(faceId = 4) {
    const face = this.surface.faceById(faceId);
    const half = face.size / 2;
    const cell = this._cellSize(face);
    const center = (k) => -half + (k + 0.5) * cell;
    for (const b of this.balls) {
      b.faceId = faceId;
      const speed = Math.hypot(b.vx, b.vy) || 0.5;
      if (b.kind === 'V') {
        b.x = center(this._cellIndex(b.x, face)); // keep its column (pitch)
        b.y = center(0); // line up at the start row
        b.vx = 0;
        b.vy = speed;
      } else {
        b.y = center(this._cellIndex(b.y, face)); // keep its row (pitch)
        b.x = center(0); // line up at the start column
        b.vx = speed;
        b.vy = 0;
      }
      b.cellFace = -1; // re-arm cell tracking so the next entry fires cleanly
      b.cellI = -1;
      b.cellJ = -1;
    }
  }

  // Swap EVERY head's band: horizontal ↔ transversal. Positions stay put but the
  // velocity flips to the perpendicular axis, so the whole cube is suddenly read
  // the other way — same score, rotated reading. (Pitch now comes from the other
  // coordinate too, since pitch = the perpendicular level.)
  swapBands() {
    for (const b of this.balls) {
      b.kind = b.kind === 'V' ? 'H' : 'V';
      const t = b.vx;
      b.vx = b.vy;
      b.vy = t;
      b.cellFace = -1; // re-arm cell tracking
      b.cellI = -1;
      b.cellJ = -1;
    }
  }

  // Trace the ring of cells a head's RAIL passes through (its "slice" of the
  // cube): walk a probe one cell at a time from the head's current cell until it
  // loops (4 faces × cells steps on a cube). Used for muting a whole slice and
  // for drawing it. Returns an array of { faceId, i, j }.
  traceTrack(ball) {
    const probe = {
      faceId: ball.faceId,
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      kind: ball.kind,
    };
    // normalise direction; default along band if stalled
    let sp = Math.hypot(probe.vx, probe.vy);
    if (sp < 1e-9) {
      probe.vx = probe.kind === 'V' ? 0 : 1;
      probe.vy = probe.kind === 'V' ? 1 : 0;
      sp = 1;
    }
    const cells = [];
    const seen = new Set();
    const maxSteps = 4 * this.cells + 2;
    const b = Object.assign(Object.create(Object.getPrototypeOf(ball)), ball); // shallow Ball clone
    b.vx = probe.vx / sp;
    b.vy = probe.vy / sp;
    if (this.railed) this._railProject(b, null);
    for (let s = 0; s < maxSteps; s++) {
      const face = this.surface.faceById(b.faceId);
      const i = this._cellIndex(b.x, face);
      const j = this._cellIndex(b.y, face);
      const key = `${b.faceId}:${i}:${j}`;
      if (seen.has(key)) break; // looped — the ring is closed
      seen.add(key);
      cells.push({ faceId: b.faceId, i, j });
      b.step(this.surface, this._cellSize(face), null, 0, Infinity);
      this._snapToCell(b);
      const u = Math.hypot(b.vx, b.vy) || 1;
      b.vx /= u;
      b.vy /= u;
    }
    return cells;
  }

  // Detect heads sharing a cell. Fires ONCE per encounter (when a pair first
  // overlaps), so a single crossing of two reading-heads is one musical event.
  // Returns a list of { type:'collision', a, b } for newly-formed overlaps.
  collisions() {
    const events = [];
    const r = this.collisionRadius;
    const active = new Set();
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const a = this.balls[i];
      if (a.muted) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.balls[j];
        if (b.muted) continue;
        if (a.faceId !== b.faceId) continue;
        if (Math.abs(a.x - b.x) > r || Math.abs(a.y - b.y) > r) continue;
        const key = i * n + j;
        active.add(key);
        if (!this._colliding.has(key)) events.push({ type: 'collision', a, b });
      }
    }
    this._colliding = active;
    return events;
  }
}
