#pragma once

// =============================================================================
// hud.hpp -- CoreS3 LCD drawing + touchscreen + hardware button input.
// =============================================================================
//
// The CoreS3 screen is our primary local UI while we bring the LED cube up:
//
//   * Top of the screen: a small status HUD (mode, brightness, scan speed,
//     armed cell count, external 5V status, Wi-Fi info).
//   * Grid of on-screen touch buttons:
//         GAME  | RAW    | MAP
//         RUN/S | STEP   | CLEAR
//         DIM   | BRIGHT | SLOW  | FAST
//         RANDOM SCORE
//   * Physical M5 buttons (BtnA / BtnB / BtnC) mirror the most common actions.
//
// Hud only draws and reads input; it delegates the actual semantics to
// Diag, Net, Score, Transport and Store.
// =============================================================================

#include <Arduino.h>

namespace Hud {

// Full HUD redraw (banner + status lines + button grid + footer).
// Called once from setup() and by refreshIfDirty() when something changed.
void draw();

// Redraw the HUD if state has changed (hudDirty) or if the periodic refresh
// interval has elapsed (see CUBE_HUD_REFRESH_MS in config.hpp).
void refreshIfDirty(unsigned long nowMs);

// Poll the touchscreen for a click and dispatch to the matching button.
void handleTouch();

// Poll the physical M5 buttons (BtnA/B/C) and dispatch.
void handleButtons();

// Request a HUD redraw at the next refreshIfDirty() call. Other modules
// call this after they mutate visible state.
void markDirty();

}  // namespace Hud
