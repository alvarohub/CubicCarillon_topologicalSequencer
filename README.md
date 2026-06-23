# Cube Carillon — web (JavaScript)

A topological MIDI/audio sequencer: balls roll along **geodesics** on a flat
surface with conical singularities (a cube, for now) and trigger notes when they
cross an edge onto a new face. This is a 2026 rewrite of the 2007 Processing
prototype (in the parent folder), restructured for portability to phones and,
later, to a physical LED cube driven by a microcontroller.

## Run

ES modules need to be served over HTTP (not opened as a `file://`):

```sh
python3 -m http.server 8001
# open http://localhost:8001
```

For phone tilt/sensor control, serve over **HTTPS** (e.g. `ngrok http 8000`)
and open it on the phone; iOS asks for motion permission via the Start button.

Controls: **drag** = rotate cube · **space** = pause · **g** = toggle gravity ·
**m** = snap/unsnap step display · phone = **tilt to roll**.

## Architecture (engine + adapters)

The point of the rewrite is a clean split, so the simulation can run unchanged
on a screen, a phone, or a microcontroller:

```
src/
  core/        PURE, dependency-free — ports almost directly to C++
    surface.js   flat surface as an atlas: faces + edge gluings COMPUTED
                 from the 3D embedding (no hand-tuned transition tables);
                 works for any polyhedron / torus / unfolding
    ball.js      geodesic stepping + edge crossing (handles arbitrary
                 directions, not just edge-parallel) -> emits events
    engine.js    advances balls; projects gravity onto each face's tangent
                 plane (tilt -> rolling); collects events
    sequencer.js maps edge-crossing events -> notes (the "instrument")
  io/          sensing & sound adapters
    audio.js     WebAudio synth (swappable for WebMIDI / hardware)
    controls.js  keyboard + phone deviceorientation
  view/        display adapters
    view3d.js    three.js cube; balls drawn DIRECTLY on faces via
                 P = C + x*u + y*v (no framebuffer-crop texture hack)
  main.js      wires core + adapters and runs the loop
```

### Why this structure

- **Topology as an atlas of charts.** Each face is a chart with a local 2D
  frame; each shared edge carries the isometry (transition map) that unfolds the
  two faces flat. These maps are _computed from geometry_, so swapping the cube
  for another polyhedron, a flat torus, or an arbitrary unfolding only means
  changing the face list. Curvature lives only at the vertices (cube corners =
  90° angle deficit each; total 4π).

- **Arbitrary geodesics.** Balls may move in any direction. A geodesic is
  uniquely continuable everywhere except at a cone point (a corner), where the
  trajectory is genuinely ambiguous — a natural hook for special "accent" events
  later.

- **Display decoupled from model.** The core only produces face-local `(x,y)`.
  The 3D view maps that to a point on the face; a future LED-matrix backend would
  rasterize the same `(x,y)` into small per-face integer grids (low memory).
