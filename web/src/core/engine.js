// core/engine.js
//
// Holds the surface + balls, advances them, and collects events. Gravity is
// optional and handled physically: a world "down" vector is projected onto each
// face's tangent plane using the current orientation of the surface (R = the
// local->world rotation, supplied by whatever is "holding" the cube — a mouse
// drag, a phone's accelerometer, etc.). With gravity off, balls move at constant
// speed along geodesics (perpetual motion, like the original sketch).
//
// Pure module: no rendering, no audio, no DOM.

export class Engine {
  constructor(surface, balls) {
    this.surface = surface;
    this.balls = balls;
    this.paused = false;

    this.gravityStrength = 0; // 0 = constant-velocity geodesics
    this.gravityWorld = [0, -1, 0]; // world "down"
    this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // local->world rotation (row-major 3x3)
    this.damping = 0;
    this.maxSpeed = 3.0;

    // head-to-head collisions (the sequencer's intersection events)
    this.collisionRadius = 0.12;
    this._colliding = new Set(); // pair keys currently overlapping (debounce)
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
      for (let j = i + 1; j < n; j++) {
        const b = this.balls[j];
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

  update(dt) {
    if (this.paused) return [];
    const all = [];
    for (const b of this.balls) {
      const face = this.surface.faceById(b.faceId);
      const acc = this._accel(face);
      const evs = b.step(this.surface, dt, acc, this.damping, this.maxSpeed);
      for (const e of evs) all.push(e);
    }
    return all;
  }
}
