// =============================================================================
// main.cpp -- Cube Link firmware entrypoint (Arduino setup/loop only).
// =============================================================================
//
// Every line below is a namespace call: it tells you WHICH module owns the
// action. If you want to understand what the firmware does, read this file
// top to bottom. If you want to change a subsystem, open the matching header.
//
//   Hw::         hardware.hpp        -- M5 boot, external 5V rail, display
//   Store::      preset_store.hpp    -- NVS-backed transport + score storage
//   Audio::      tone_synth.hpp      -- speaker tone synth
//   Leds::       led_renderer.hpp    -- WS2812 strip + LedMapper compositor
//   Diag::       diag.hpp            -- boot scan + per-frame LED render
//   Net::        net.hpp             -- Wi-Fi / OSC / Web / WebSocket sync
//   Hud::        hud.hpp             -- LCD drawing + touch + M5 buttons
//   Transport::  transport_state.hpp -- BPM, pause, gravity, step-mode flag
//   Score::      score_grid.hpp      -- armed notes across 6x8x8
//   Heads::      head_engine.hpp     -- moving read-heads scanning the score
//   Osc::        osc_handler.hpp     -- OSC/UDP + Wi-Fi bring-up (used by Net)
//   Web::        web_interface.hpp   -- HTTP UI (used by Net)
// =============================================================================

#include <Arduino.h>
#include <M5Unified.h>

#include "config.hpp"
#include "diag.hpp"
#include "hardware.hpp"
#include "head_engine.hpp"
#include "hud.hpp"
#include "led_renderer.hpp"
#include "net.hpp"
#include "preset_store.hpp"
#include "score_grid.hpp"
#include "tone_synth.hpp"
#include "transport_state.hpp"

// =============================================================================
// ============================== SETUP =======================================
// =============================================================================

void setup() {
  // 1. Boot the M5 stack (display, touch, external 5V rail).
  Hw::init();

  // 2. Seed randomness (used by "random score") for later.
  randomSeed((uint32_t)esp_random());

  // 3. Restore persisted transport + score from NVS. A reboot is invisible.
  Store::instance.begin();
  Store::instance.load(Transport::state, Score::grid);

  // 4. Bring up audio + LEDs.
  Audio::synth.begin();
  Leds::renderer.begin();

  // 5. Diagnostic boot pixel scan (raw + optional mapped walk).
  Diag::runBootScan();

  // 6. Optionally start Wi-Fi / OSC / Web / WebSocket.
  //    Skipped in quiet-diagnostics mode so the LED timing loop is untouched
  //    while we are still debugging the hardware.
  if (!cube::kLedDiagQuietMode) Net::begin();

  // 7. Paint the initial HUD.
  Hud::draw();
}

// =============================================================================
// =============================== LOOP =======================================
// =============================================================================

void loop() {
  // Timekeeping used by every step below.
  static unsigned long lastFrameMs = millis();

  // 1. Poll physical input.
  M5.update();
  Hud::handleTouch();
  Hud::handleButtons();

  // 2. Service network transports (safe no-op if Net::begin() was skipped).
  Net::update();

  // 3. Advance sequencer heads (Game mode only).
  const unsigned long now   = millis();
  const float         dtSec = static_cast<float>(now - lastFrameMs) * 0.001f;
  lastFrameMs = now;
  if (Diag::mode == Diag::GAME) {
    Heads::engine.update(dtSec, Transport::state, Score::grid, Audio::synth);
  }

  // 4. Render one LED frame in whichever mode is selected.
  Diag::render(now);

  // 5. Redraw HUD if something changed (or a scheduled refresh is due).
  Hud::refreshIfDirty(now);

  // 6. Periodic state broadcast to any WebSocket clients (~1 Hz).
  Net::broadcastIfDue(now);

  // 7. Autosave transport + score to NVS (Game mode only).
  if (Diag::mode == Diag::GAME) {
    Store::instance.autosaveIfDue(now, Transport::state, Score::grid);
  }
}
