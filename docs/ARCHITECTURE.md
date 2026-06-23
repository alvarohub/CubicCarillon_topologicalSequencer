# Cube Carillon Architecture

This document describes the current JavaScript version of Cube Carillon and the boundaries that should stay intact for the future embedded version.

## Design Goal

Cube Carillon is a topological sequencer. Reading heads move on the faces of a cuboid. A face cell can be armed as a trigger. When a head enters an armed cell, the sequencer resolves that geometric event into one or more musical voices.

The important separation is:

```text
geometry and musical logic -> pure core modules
browser input/output       -> adapters
3D rendering               -> view adapter
application wiring         -> main.js
```

The core should remain portable to C++ or another embedded runtime. It must not depend on the DOM, WebAudio, WebMIDI, or Three.js.

## Runtime Flow

```text
main.js
  builds Surface, Balls, Engine, Sequencer
  builds adapters: AudioOut, MidiOut, Controls, View3D, UIPanel
  loads presets/default.json through UIPanel.applyParams()
  starts requestAnimationFrame loop

frame loop
  View3D.rotationArray() -> Engine.setRotation()
  AudioOut.now() -> audio clock reference
  Engine.update(dt, audioNow) -> enter events
  Sequencer.noteForEnter(event) -> note or null
  AudioOut.play(note, when) / MidiOut.note(note)
  View3D.flash(head) and View3D.strikeCell(...)
  Engine.collisions(audioNow) -> collision events
  Sequencer.voicesForCollision(event) -> fixed collision or voice list
  View3D.sync(now) -> copy model state to meshes
  View3D.render()
```

Step mode is not a separate physics integrator. The engine always advances heads continuously. Step mode only asks the view to render heads snapped to cell centres.

## Modules

### `src/core/surface.js`

Owns the surface atlas.

Classes and functions:

- `Surface`: a set of rectangular face charts with 3D frames and computed edge gluings.
- `buildCuboid(div, fit)`: creates the current cuboid surface from per-axis divisions `{ X, Y, Z }`.
- `buildCube(size)`: compatibility helper for a simple cube.

Key data:

- `face.su`, `face.sv`: face extents along local `u` and `v`.
- `face.uAxis`, `face.vAxis`, `face.faceAxis`: which world axis each local direction represents.
- `face.edges[edge]`: transition map `{ toFaceId, toEdge, M, t }` for crossing an edge.
- `surface.unit`: physical size of one cell after the cuboid is normalized to fit the view.
- `surface.div`: shared `{ X, Y, Z }` division object.

Important invariant: face math must use `su` and `sv`, not the legacy `size`, because cuboid faces are rectangular.

### `src/core/ball.js`

Owns one moving reading head.

Class:

- `Ball`: face-local position, velocity, band identity, track state, instrument, tuning, and home spawn.

Important fields:

- `kind`: axis band, one of `X`, `Y`, `Z`.
- `track`: index within its axis band.
- `instrument`: index into `AudioOut`/`MidiOut` instrument tables, or `-1` for a silent carrier.
- `band`: per-track `Band` tuning.
- `home`: spawn position used by reset/align and rebuilt when kind/track changes.
- `active`: whether the track exists under the current axis division.
- `running`: motion pause for this head.
- `muted`: note-output mute for this head.

Method:

- `step(surface, dt, acc, damping, maxSpeed)`: advances along a geodesic and applies edge transition maps.

### `src/core/engine.js`

Owns physics, grid indexing, resizing, and geometric events.

Class:

- `Engine(surface, balls, div)`: advances balls and emits events.

Key methods:

- `update(dt, audioNow)`: advances active/running heads and emits `enter` events.
- `collisions(audioNow)`: emits debounced head-head collision events.
- `cellOf(ball)`: returns `{ faceId, i, j }` for the ball's current logical cell.
- `placeAtCell(ball, cell)`: places a ball at the centre of a logical cell after a resize.
- `setDiv(axis, n)`: changes one axis division count.
- `resetHead(ball)`, `resetHeads()`, `alignGroup(kind)`, `shiftHead(index, dir)`, `reverseHead(index)`.

Important invariants:

- In gravity-off mode, speed is tempo-locked: cells per second = `rate * bpm / 60`.
- Rail state changes heading, not tempo.
- Dimension changes must preserve surviving heads by logical cell index, not by old coordinates.

### `src/core/scales.js`

Owns musical scales and tonic-to-MIDI mapping.

Exports:

- `SCALES`: scale-name to semitone offsets.
- `SCALE_NAMES`, `NOTE_NAMES`.
- `Band`: `{ scale, root }` plus `midiForLevel(level)`.

Terminology note: code still uses `root` for the MIDI tonic because that name is already serialized in sessions.

### `src/core/sequencer.js`

Owns the score and voice resolution.

Class:

- `Sequencer`: armed cells plus event-to-note mapping.

Key methods:

- `key(faceId, i, j)`: stable cell key.
- `arm`, `disarm`, `toggleCell`, `setVelocity`.
- `cellData(key)`: normalizes stored note data. Current storage is usually a number velocity; future storage can be an object.
- `bandFor(ball)`: returns the ball's per-track band if present.
- `positionalPitch(ball, i, j)`: pitch from perpendicular cell level.
- `noteForEnter(event)`: one enter event -> one note or null.
- `voicesForCollision(event)`: one collision -> fixed collision or a list of head voices.

Important rule: the instrument comes from the head, not from the cell. The pitch usually comes from the head's position and band tuning. A cell is currently a trigger with velocity.

### `src/io/audio.js`

WebAudio output adapter.

Exports:

- `MELODIC`, `DRUMS`, `INSTRUMENTS`, `COLLISION_SOUNDS`.
- `AudioOut`: browser audio context, sampled piano loading, synth voices, drum voices, collision sounds.

The adapter accepts note descriptors from the sequencer. It should not know about surfaces, balls, faces, or UI controls.

### `src/io/midi.js`

WebMIDI output adapter.

Class:

- `MidiOut`: device discovery, channel/program routing, note on/off, collision percussion, panic.

MIDI routing is instrument-based. Melodic instruments map to melodic channels; drum instruments map to the GM drum channel with drum-note selection.

### `src/io/controls.js`

Browser input adapter.

Class:

- `Controls`: keyboard, pointer picking, velocity gesture, audio unlock, optional device orientation.

This module translates browser events into engine/view/sequencer calls. The core does not know how input was produced.

### `src/io/ui.js`

Browser panel and session serializer.

Class:

- `UIPanel`: transport, sound, track rows, visual controls, save/load JSON.

Important responsibilities:

- `collectParams()`: serializes the current session.
- `applyParams(p)`: migrates and applies saved sessions.
- `_syncTrackRows()`: keeps DOM rows grouped by the live `ball.kind`.
- `_applyGroupScale(axis, scale)`, `_applyGroupKey(axis, keyClass)`: set band-level tuning.

Session-loader invariants:

- Old `H/V` kinds are migrated to `X/Y`.
- `kind` and `track` restore the head identity and rebuild `home` through `main.js`.
- `active` is derived from `track < div[kind]`; stale saved active flags cannot create heads outside the current cuboid dimensions.
- Partial legacy sessions deactivate heads not mentioned in the file so old runtime state cannot leak in.

### `src/view/view3d.js`

Three.js view adapter.

Class:

- `View3D`: cube/cuboid mesh, facets, grids, head meshes/lights, picking, camera controls, visual parameter setters.

The view reads model state but does not decide musical behavior. It maps face-local coordinates to 3D positions and reports picks back as `{ type, faceId, i, j }` or `{ type:'head', index }`.

### `src/main.js`

Application composition root.

Responsibilities:

- Build the model and adapters.
- Define `homeFor(kind, track, surface, speed)`.
- Own live cuboid resizing through `setDivisions(axis, n)`.
- Own band rotation through `rotateBands()`.
- Provide `updateTrackHome(ball)` to the UI loader, because spawn geometry belongs in main, not in the UI.
- Route engine events to sequencer, audio, MIDI, and view.

## Session and Preset Files

`presets/default.json` has the same shape as a saved session. It is loaded at boot through `UIPanel.applyParams()`.

The clean current shape is:

```text
version
divisions: { X, Y, Z }
groups: { X, Y, Z }          optional group-level UI summary
transport
runtime                         optional live pause state
sound
view
tracks[48]                      serialized heads
score                           armed cell map
```

Avoid using saved session fields as a second source of truth when they are derived from another field:

- Track count is derived from `divisions[axis]`.
- A head is active only when `track < divisions[kind]`.
- Home position is derived from `kind`, `track`, and current surface geometry.
- UI row grouping is derived from live `ball.kind`.

## Embedded-Port Boundary

The embedded version should start from these portable pieces:

- `surface.js`: atlas, face geometry, edge transition maps.
- `ball.js`: geodesic stepping.
- `engine.js`: clock, rail/gravity state, cell events, collisions.
- `sequencer.js` and `scales.js`: score and event-to-voice resolution.

Browser-only modules to replace:

- `audio.js`: replace with MIDI, DAC, synth chip, or host messages.
- `midi.js`: replace or keep only if the embedded target has MIDI output.
- `controls.js`: replace with buttons, sensors, encoders, or touch facets.
- `ui.js`: replace with a hardware editor, companion app, or saved config loader.
- `view3d.js`: replace with LED/facet rendering.

The embedded API can be small:

```text
loadConfig(config)
setDivisions(axis, n)
setTransport({ bpm, paused, railed, gravity })
setTrack(trackId, params)
armCell(faceId, i, j, velocity)
tick(dt) -> voices/events
```

## Review Checklist

Use these checks after structural changes:

- `node --check` on edited JS modules.
- Boot `/?debug` and verify `window.__cube` exists.
- Load `presets/default.json`: active counts should equal `{ X:4, Y:4, Z:4 }` for the current preset.
- Load a rotated 48-track session: no bad kinds, no row-parent mismatches.
- Load a legacy 16-track H/V session: kinds migrate to X/Y and unspecified heads are inactive.
- Grow and shrink one axis: surviving heads keep their logical cell index.
- Change a band's scale/key: `ui._trackNote(ball)` and `sequencer.noteForEnter(...)` agree.
- For an enter event, the returned note instrument equals `ball.instrument`.
