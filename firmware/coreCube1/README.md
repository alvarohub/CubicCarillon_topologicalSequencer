# CoreS3 Cube Link Firmware (PlatformIO + M5Unified)

Standalone-first firmware for CoreS3. The primary local control path is now the
CoreS3-hosted web UI plus OSC-over-UDP commands. The Cube Link WebSocket path is
kept as a secondary compatibility/sync layer.

## Architecture (class-based)

The firmware is now split into dedicated modules instead of a monolithic main:

- `src/score_grid.hpp`
  - persistent note memory over the 6x8x8 face grid
  - JSON import/export for WebSocket sync
  - random score generation
- `src/head_engine.hpp`
  - local transport-driven head motion
  - beat stepping and cell-hit detection
- `src/tone_synth.hpp`
  - standalone audio beeps from head/cell events
- `lib/cube_display/`
  - reusable PlatformIO library for logical display layers, cube LED mapping, and strip composition
  - owns `VirtualDisplay`, `DisplayManager`, `LedMapper`, and cube display geometry constants
- `src/led_renderer.hpp`
  - thin scene adapter only (`score + heads + cursor` into layers)
- `src/osc_handler.hpp` + `src/osc_handler.cpp`
  - Wi-Fi/AP startup, OSC-over-UDP listener, shared command executor
- `src/web_interface.hpp` + `src/web_interface.cpp`
  - on-device HTTP control page; routes call the same command executor as OSC
- `src/preset_store.hpp`
  - autosave/load of score + transport to NVS (`Preferences`)
- `src/app_state.hpp` + `src/app_state.cpp`
  - shared runtime data (transport, score, heads, synth, LEDs, OSC/Web/WS, timing). No behaviour, just ownership.
- `src/led_diagnostics.hpp` + `src/led_diagnostics.cpp`
  - boot pixel scan and per-frame LED render dispatch for Game / RawScan / MappedScan modes.
- `src/touch_hud.hpp` + `src/touch_hud.cpp`
  - CoreS3 LCD drawing plus touchscreen and hardware-button input.
- `src/net_bridge.hpp` + `src/net_bridge.cpp`
  - Wi-Fi / OSC / Web / WebSocket bring-up and the JSON protocol.
- `src/main.cpp`
  - Arduino `setup()` + `loop()` only. Numbered steps that read like the firmware's table of contents; nothing else lives here.

## Features

- Uses M5Unified for device init, display, and buttons
- Direct NeoPixel output for the 6x8x8 cube chain (standalone render loop)
- Wi-Fi AP by default (`CubeCarillon`, password `cube1234`)
- Web control UI on `CUBE_WEB_PORT` (default `80`)
- OSC-over-UDP on `CUBE_OSC_PORT` (default `9000`)
- Secondary WebSocket server on `CUBE_WS_PORT` (default `8787`)
- WebSocket protocol support:
  - `hello`
  - `ping` / `pong`
  - `transport.set`
  - `score.replace`
  - `score.clear`
  - `score.random`
  - `snapshot.request`
- Periodic state broadcast (`transport.state`, `score.state`)

## Setup

1. Optional: copy `src/secrets.h.example` to `src/secrets.h` and set Wi-Fi credentials.
2. Build and upload with PlatformIO.

If `src/secrets.h` is not provided, firmware still builds and starts directly in AP fallback mode.

## Build / Upload

From this folder:

```sh
pio run -e cores3
pio run -e cores3 -t upload
pio device monitor -b 115200
```

## On-Device Web UI

Boot the CoreS3 and connect to its AP:

```text
SSID: CubeCarillon
Password: cube1234
URL: http://192.168.4.1/
```

The web UI calls the same text command surface as OSC/Serial-style control.

## OSC / Text Commands

Supported command shapes:

```text
/bpm 120
/pause 0
/pause 1
/toggle
/random 0.16
/clear
/score/set 1 0 0 0.75
/score/toggle 1 0 0 0.75
/status
```

OSC uses the same addresses with typed arguments over UDP port `9000`.

## Connect From Browser App (Secondary)

Run web app and open:

```text
http://localhost:8001/?cubeWs=ws://<core-ip>:8787
```

The web app remains fully local if `cubeWs` is omitted.

## On-device CoreS3 Touch UI

The CoreS3 screen is the primary local test interface during LED debugging:

- `GAME`: normal sequencer render
- `RAW`: raw physical chain scan, no mapper
- `MAP`: mapped `face,x,y` scan through `LedMapper`
- `RUN/STOP`: pause/resume current mode
- `STEP`: advance one LED while paused in `RAW` or `MAP`
- `DIM` / `BRIGHT`: adjust LED brightness
- `SLOW` / `FAST`: adjust scan delay
- `CLEAR` / `RANDOM SCORE`: score utilities for later game testing

Physical button fallback is still present, but it is not the main CoreS3 UI:

- BtnA: toggle run/pause
- BtnB: randomize score
- BtnC: clear score

## LED Output Notes

- Default chain: 6 faces x 8x8 = 384 LEDs
- Default pin: `CUBE_LED_PIN` (fallback `1`, CoreS3 header label G1)
- Default brightness: `CUBE_LED_BRIGHTNESS` (fallback `12` while debugging)
- LED matrix type/protocol matches the SternWerk project: `NEO_GRB + NEO_KHZ800`
- Physical rectangular chart mapping uses `Adafruit_NeoMatrix`, as in LED_scoreboard.
- `CUBE_MATRIX_LAYOUT` defines the low-level 8x8 matrix wiring. The default is top-left, row-major, row-zigzag, with the six 8x8 faces treated as a horizontal row of local matrix charts.
- Override the pixel type at compile time with `CUBE_NEOPIXEL_TYPE` if a module turns out to be RGB, RGBW, or a different NeoPixel-compatible order.

`RAW` scan writes physical strip indices directly with `setPixelColor()`, so it shows the true electrical order. `MAP` scan writes logical face coordinates through `LedMapper` and `Adafruit_NeoMatrix::drawPixel()`, so the matrix wiring flags should straighten the local 8x8 chart.

The firmware always renders LEDs in standalone mode. WebSocket is optional and
only updates transport/score state.

## Design Notes

- `docs/RENDERER_CLASS_MAP.md` maps this firmware structure to the earlier LED_scoreboard architecture.
- `docs/MANIFOLD_DISPLAY_IDEA.md` captures the longer-term idea: displays as mapped manifolds, not just rectangular framebuffers.
- The architecture is deliberately flat for a prototype: `main.cpp` shows the whole flow, and each concern (LED diagnostics, touch/HUD, network bridge) lives in one focused module with a file-header comment explaining what it is and why. Do not add free helper functions to `main.cpp`; extend an existing module or create a new one.

## Pixel Scan Tests

If you see strange flashes, first isolate hardware vs mapping with scan modes.

On every boot, the firmware now runs a short startup pixel scan before network
or sequencer rendering starts:

1. Raw white chain scan: LED `0..383`, no mapper.
2. Optional mapped face scan: `face,x,y` through the cube mapper, with one color per face.

Startup scan options in `src/config.hpp`:

- `CUBE_BOOT_SCAN_ENABLED` (default `1`)
- `CUBE_BOOT_SCAN_DELAY_MS` (default `25`)
- `CUBE_BOOT_SCAN_RAW` (default `1`)
- `CUBE_BOOT_SCAN_MAPPED` (default `0` while raw chain stability is unknown)

Quiet diagnostic options:

- `CUBE_LED_DIAG_QUIET_MODE` (default `1`)
  - Skips Wi-Fi, OSC, Web UI, and WebSocket startup.
  - Keeps the firmware focused on LED timing and touch diagnostics.
- `CUBE_HUD_REFRESH_MS` (default `0`)
  - `0` means the LCD does not redraw periodically.
  - The LCD redraws only after touch/state changes.

Leave this enabled while debugging the cube wiring. Disable it once the hardware
mapping is trusted and you want faster boot.

In `src/config.hpp`:

- `CUBE_RENDER_MODE = 1` -> raw chain scan (`0..383`, no mapper)
- `CUBE_RENDER_MODE = 2` -> mapped scan (`face,x,y` through mapper)
- `CUBE_RENDER_MODE = 0` -> normal sequencer render

While the hardware mapping is being debugged, the default is `1`, so the device
stays in raw scan after boot instead of starting the game. Tap `GAME` on the
CoreS3 screen when you want to try normal rendering.

Optional speed:

- `CUBE_SCAN_DELAY_MS` (default `80` while debugging)

Workflow:

1. Boot in mode `1`, verify LEDs walk physically in strict chain order.
2. Tap `MAP`, verify per-face logical traversal matches your drawing.
3. Tap `GAME` only after raw and mapped scans are believable.
