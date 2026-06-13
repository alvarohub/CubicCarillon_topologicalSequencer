// core/ball.js
//
// A ball (a "track" in sequencer terms) moving along a geodesic on the surface.
// State is purely face-local: which face it is on, its position (x,y) in that
// face's centred local frame, and its velocity (vx,vy) in the same frame.
//
// step() advances the ball by dt, handling any number of edge crossings within
// the step (it sub-steps to each edge, applies the transition isometry, and
// continues). It returns a list of events (edge crossings / vertex hits) for the
// sequencer and renderers to react to.
//
// Pure module: no rendering, no audio.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const EPS = 1e-9;

export class Ball {
  constructor({ index = 0, faceId = 0, x = 0, y = 0, vx = 0, vy = 0, color = '#fff', kind = 'H', instrument = 0 }) {
    this.index = index;
    this.faceId = faceId;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    // kind = which BAND this head belongs to: 'H' (horizontal) or 'V'
    // (transversal). This is the invariant tag — note that across an edge the
    // *local* axis the head travels along can swap (the transition maps are
    // signed permutations), but the band membership does not. Used for grouping,
    // alignment, and which coordinate gives the pitch.
    this.kind = kind;
    this.instrument = instrument; // index into the instrument list (the sound)
    this.muted = false; // a paused head freezes; its notes stay live for other heads
    this.solo = false; // when ANY head is soloed, only soloed heads run (Logic's S)
    this.rate = 1; // per-track speed as a multiple of the global tempo (×½, ×1, ×2 …)
    this._stepAcc = 0; // fractional-beat accumulator for step mode (rate ≠ 1)
    // "home" = the spawn configuration, so a head can be reset after wandering
    // (derail, swap, shift …) without rebuilding the whole scene.
    this.home = { faceId, x, y, vx, vy, kind };
    this.flash = 0; // timestamp of last event, for renderers (not used by core math)
    // last grid cell the head occupied, for emitting "entered a new cell" events
    // (this unifies "edge tick" and "cell tick": a head sounds when it enters an
    // armed cell, regardless of continuous vs discrete motion).
    this.cellFace = -1;
    this.cellI = -1;
    this.cellJ = -1;
  }

  // Which local axis the head is currently travelling along ('x' or 'y'), and the
  // perpendicular one (whose cell index gives the pitch — the "level in the stack").
  movingAxis() {
    return Math.abs(this.vx) >= Math.abs(this.vy) ? 'x' : 'y';
  }

  /**
   * Advance the ball by dt seconds.
   * @param {Surface} surface
   * @param {?[number,number]} acc  face-local acceleration [ax,ay] (e.g. gravity), or null
   * @param {number} damping        velocity decay per second (0 = none)
   * @param {number} maxSpeed       speed clamp
   * @returns {Array} events
   */
  step(surface, dt, acc = null, damping = 0, maxSpeed = Infinity) {
    const events = [];

    if (acc) {
      this.vx += acc[0] * dt;
      this.vy += acc[1] * dt;
    }
    if (damping > 0) {
      const f = Math.max(0, 1 - damping * dt);
      this.vx *= f;
      this.vy *= f;
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSpeed) {
      const k = maxSpeed / sp;
      this.vx *= k;
      this.vy *= k;
    }

    let remaining = dt;
    let guard = 0;
    while (remaining > EPS && guard++ < 32) {
      const face = surface.faceById(this.faceId);
      const half = face.size / 2;

      // earliest exit through one of the 4 edges
      let tHit = Infinity,
        hitEdge = -1;
      if (this.vx > EPS) {
        const t = (half - this.x) / this.vx;
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitEdge = 0;
        }
      }
      if (this.vy > EPS) {
        const t = (half - this.y) / this.vy;
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitEdge = 1;
        }
      }
      if (this.vx < -EPS) {
        const t = (-half - this.x) / this.vx;
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitEdge = 2;
        }
      }
      if (this.vy < -EPS) {
        const t = (-half - this.y) / this.vy;
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitEdge = 3;
        }
      }

      if (hitEdge < 0 || tHit > remaining) {
        this.x += this.vx * remaining;
        this.y += this.vy * remaining;
        remaining = 0;
        break;
      }

      // advance exactly to the edge
      this.x += this.vx * tHit;
      this.y += this.vy * tHit;
      remaining -= tHit;

      const e = face.edges[hitEdge];
      if (!e) {
        // open boundary: bounce so the ball stays on the surface
        if (hitEdge === 0 || hitEdge === 2) this.vx = -this.vx;
        else this.vy = -this.vy;
        events.push({ type: 'boundary', faceFrom: face.id, edge: hitEdge, ball: this });
        continue;
      }

      events.push({ type: 'edge', faceFrom: face.id, edge: hitEdge, toFace: e.toFaceId, ball: this });

      // apply transition isometry to position and velocity
      const nx = e.M.a * this.x + e.M.b * this.y + e.t[0];
      const ny = e.M.c * this.x + e.M.d * this.y + e.t[1];
      const nvx = e.M.a * this.vx + e.M.b * this.vy;
      const nvy = e.M.c * this.vx + e.M.d * this.vy;
      this.x = clamp(nx, -half, half);
      this.y = clamp(ny, -half, half);
      this.vx = nvx;
      this.vy = nvy;
      this.faceId = e.toFaceId;
    }

    return events;
  }
}
