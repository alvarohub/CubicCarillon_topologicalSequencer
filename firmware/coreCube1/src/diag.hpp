#pragma once

// =============================================================================
// diag.hpp -- LED diagnostic scans + per-frame render dispatch.
// =============================================================================
//
// This module owns the "what do I draw on the strip right now?" question.
//
//   1. Boot scan (runBootScan)     -- one-shot startup walk.
//   2. Per-frame render (render)   -- dispatch by Diag::mode.
//   3. Mode control (setMode)      -- called by Hud when the user taps a mode
//                                     button.
//
// Two scans exist because they answer two different questions:
//   RAW_SCAN    -> is the wiring / power / data line correct?  (hardware)
//   MAPPED_SCAN -> is the chart placement + matrix layout correct? (software)
//
// The state lives at namespace scope (extern) -- exactly one strip, one mode.
// =============================================================================

#include <Arduino.h>

namespace Diag {

// The four things the LED loop can be doing.
enum Mode : uint8_t {
  GAME        = 0,   // normal sequencer render (armed cells + heads + cursor)
  RAW_SCAN    = 1,   // walk one physical LED along the strip
  MAPPED_SCAN = 2,   // walk one logical (face,x,y) cell through LedMapper
  TEST        = 3,   // ONE single head moving in a user-controlled direction
                     // (best mode for verifying face wrapping / mapping)
};

// -----------------------------------------------------------------------------
// Shared state (defined in diag.cpp).
// -----------------------------------------------------------------------------
extern Mode     mode;               // current render mode
extern uint8_t  ledBrightness;      // last brightness set via UI
extern uint16_t scanDelayMs;        // ms between scan pixels
extern uint16_t rawScanIndex;       // walking index in RAW_SCAN
extern uint16_t mappedScanIndex;    // walking index in MAPPED_SCAN
extern bool     scanPaused;         // scan-mode pause (independent of transport)
extern bool     forceScanStep;      // one-shot STEP flag

// TEST-mode single moving head (drives all mapping diagnostics).
extern uint8_t testFace;    // 1..6
extern uint8_t testX;       // 0..kFaceCells-1
extern uint8_t testY;       // 0..kFaceCells-1
extern int8_t  testDx;      // -1, 0, or +1
extern int8_t  testDy;      // -1, 0, or +1

// -----------------------------------------------------------------------------
// Verbs
// -----------------------------------------------------------------------------

// One-shot boot pixel scan (raw walk, and optionally mapped walk).
void runBootScan();

// Render one LED frame appropriate to the current mode. Non-blocking; each
// scan step is gated by scanDelayMs so the loop stays responsive.
void render(unsigned long nowMs);

// Switch mode. Also unpauses the scan and resets its indices so tapping
// GAME/RAW/MAP/TEST always gives a fresh, obvious result.
void setMode(Mode m);

// Reset scan indices + blank the strip.
void resetScan();

// TEST-mode helpers (called by Hud buttons).
void testSetDir(int8_t dx, int8_t dy);   // set direction (exactly one of dx/dy nonzero)
void testNextFace();                     // cycle testFace to next face; reset to (0,0)
void testReset();                        // face 1, (0,0), moving right

// Human-readable label used by the HUD.
const char* modeName(Mode m);

}  // namespace Diag
