# Renderer Class Map (Reference -> CoreS3 Firmware)

This file answers one question: how the CoreS3 renderer classes map to the
existing LED_scoreboard architecture so we can build reusable libraries.

## 1) Class-level mapping

- Reference `VirtualDisplay` -> Firmware `VirtualDisplay`
  - Same role: local logical drawing surface based on Adafruit_GFX canvas.
  - Difference after cleanup: firmware constructor accepts width/height, so it is not cube-only.
  - Firmware file: `lib/cube_display/src/virtual_display.hpp` + `lib/cube_display/src/virtual_display.cpp`.

- Reference `DisplayManager` -> Firmware `DisplayManager`
  - Same role: owns physical strip, owns display layers, composites canvas to LEDs.
  - Difference after cleanup: layers are managed through an array; named layer accessors are app convenience only.
  - Current physical output follows LED_scoreboard: `Adafruit_NeoMatrix` owns the rectangular chart-to-strip mapping.
  - Firmware file: `lib/cube_display/src/display_manager.hpp` + `lib/cube_display/src/display_manager.cpp`.

- Reference mapping utilities inside manager/pipeline -> Firmware `LedMapper`
  - Explicit standalone mapper utility for face-local `(face,x,y)` -> logical chart coordinates.
  - It applies cube face order plus per-face transforms; `Adafruit_NeoMatrix` then applies the local matrix wiring layout.
  - Firmware file: `lib/cube_display/src/led_mapper.hpp`.

- App-specific scene logic -> Firmware `LedRenderer`
  - Thin adapter that writes scene layers (armed cells, heads, cursor) and calls compositor.
  - Firmware file: `src/led_renderer.hpp` + `src/led_renderer.cpp`.

- Arduino entrypoint / application flow -> `src/main.cpp`
  - `main.cpp` shows the whole boot and per-tick sequence as numbered steps.
  - Shared runtime state lives in `AppState` (`src/app_state.hpp`); each concern is a focused module: `LedDiagnostics`, `TouchHud`, `NetBridge`.
  - There is no umbrella "app controller" class: the app shell IS `main.cpp`, which is intentional for a prototype of this size.

## 2) Responsibility split

- `VirtualDisplay`
  - Pixel canvas operations in generic width/height space.
  - API: `setPixelRgb`, `addPixelRgb`, `getPixelRgb`, `clear`.
  - Legacy cube helpers (`set`, `add`, `get`, `color565`) remain while the cube renderer is still being migrated.

- `DisplayManager`
  - Hardware lifecycle: `begin`, `setBrightness`.
  - Layer access: `layer(index)` plus convenience accessors `layerArmed`, `layerHeads`, `layerCursor`.
  - Composition path: `clearLayers` -> draw to layers -> `composeAndShow`.
  - Physical mapping: `Adafruit_NeoMatrix::drawPixel()` with `CUBE_MATRIX_LAYOUT`.
  - Diagnostics: `scanRaw` bypasses NeoMatrix layout by raw strip index; `scanMapped` uses logical `(face,x,y)` through `LedMapper` plus NeoMatrix layout.

- `OSCHandler`
  - Same architectural role as the scoreboard project: owns Wi-Fi/AP setup, UDP OSC listener, and shared command execution.
  - Web UI uses `executeCommand()` instead of duplicating control logic.

- `WebInterface`
  - Same architectural role as the scoreboard project: HTTP routes only; command semantics remain in `OSCHandler`.

- `LedMapper`
  - Face transform and chart placement only (rotation + flips + face order).
  - It does not reimplement row/column/zigzag matrix wiring; that belongs to `Adafruit_NeoMatrix`.

- `LedRenderer`
  - No hardware math; only scene construction and timing visuals.

- `AppState` / `LedDiagnostics` / `TouchHud` / `NetBridge`
  - `AppState` (data only) owns the domain and I/O objects.
  - `LedDiagnostics` owns boot scan + per-frame LED render dispatch.
  - `TouchHud` owns everything on the LCD and every input from touch or M5 buttons.
  - `NetBridge` owns Wi-Fi, OSC, Web, WebSocket, and the JSON protocol.
  - `main.cpp` wires them together and shows the run-time flow in numbered steps.

## 3) What is intentionally different from LED_scoreboard

- The scoreboard supports many text/particle modes per display tile.
- The cube firmware currently uses 3 fixed semantic layers for instrument rendering:
  - armed notes
  - moving heads
  - beat cursor
- This narrower app adapter is deliberate, but the underlying canvas/layer manager is now moving toward reusable library form.

## 4) Reuse path

To make this a reusable library package later, these classes are already isolated:

1. Keep `VirtualDisplay`, `DisplayManager`, `LedMapper` free of app behavior.
2. Keep musical/sequencer visuals inside `LedRenderer` (or another app adapter).
3. Keep command semantics in `OSCHandler`, while OSC, Web, and later Serial are transports.
4. The reusable modules now live in `lib/cube_display/`; the next cleanup is removing cube-specific compatibility helpers from `VirtualDisplay` once app code writes via generic layer coordinates.
5. See `docs/MANIFOLD_DISPLAY_IDEA.md` for the long-term direction: mapped manifold displays rather than flat rectangular framebuffers.

## 5) Open TODOs / Caveats

- Remove cube-specific compatibility helpers from `VirtualDisplay`.
  - Current issue: `VirtualDisplay` still has `set(face,x,y)`, `add(face,x,y)`, `get(face,x,y)`, and `color565(face,x,y)` as temporary helpers.
  - Desired direction: `VirtualDisplay` should only know generic canvas/layer coordinates. Face/chart logic belongs in a map/topology layer.

- Introduce an explicit map/topology abstraction before adding more display types.
  - Current issue: `LedMapper` handles cube face-to-chart placement, while `Adafruit_NeoMatrix` handles rectangular chart-to-strip mapping. The boundary is useful, but still cube-specific.
  - Desired direction: split concepts such as `Chart`, `Transition`, `DisplayMap`, and `EmitterMap` as described in `MANIFOLD_DISPLAY_IDEA.md`.

- Avoid growing `LedRenderer` into a second framework.
  - Current issue: it is correctly app-specific today, but future features could tempt us to put reusable display behavior there.
  - Rule: musical/sequencer interpretation can live in `LedRenderer`; reusable display/topology/composition behavior goes in `cube_display` or a future manifold-display library.

- Keep OSC/Web/Serial command semantics centralized.
  - Current state: `OSCHandler::executeCommand()` is the shared command surface for OSC and the hosted web UI.
  - Rule: do not duplicate command behavior in `WebInterface`; web routes should remain transport/UI only.

- Keep `main.cpp` focused on flow, not helpers.
  - Current state: `main.cpp` is `setup()` + `loop()` with numbered comments, and nothing else.
  - Rule: new firmware behaviour should land in an existing focused module, or in a new module with a single responsibility and a file-header comment. Do not add free helpers to `main.cpp`.

- Decide when `cube_display` becomes `manifold_display`.
  - Current state: the extracted library is practical and cube-first.
  - Future criterion: rename or split only after a second topology (torus/polyhedron/mesh) proves the abstraction.
