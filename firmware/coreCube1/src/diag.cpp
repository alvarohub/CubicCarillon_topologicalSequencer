// =============================================================================
// diag.cpp -- LED diagnostic scans + per-frame render dispatch.
// See diag.hpp for the module rationale.
// =============================================================================

#include "diag.hpp"

#include <M5Unified.h>

#include "config.hpp"
#include "cube_display_config.hpp"
#include "cube_topology.hpp"
#include "head_engine.hpp"
#include "led_renderer.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"

namespace Diag {

// -----------------------------------------------------------------------------
// Shared state (definitions)
// -----------------------------------------------------------------------------
Mode     mode            = static_cast<Mode>(cube::kRenderMode);
uint8_t  ledBrightness   = cube::kLedBrightness;
uint16_t scanDelayMs     = cube::kScanDelayMs;
uint16_t rawScanIndex    = 0;
uint16_t mappedScanIndex = 0;
bool     scanPaused      = false;
bool     forceScanStep   = false;

// TEST-mode single head. Starts on face 1, cell (0,0), heading +x.
uint8_t  testFace        = 1;
uint8_t  testX           = 0;
uint8_t  testY           = 0;
int8_t   testDx          = 1;
int8_t   testDy          = 0;

// -----------------------------------------------------------------------------
// File-private helpers (invisible to the rest of the firmware)
// -----------------------------------------------------------------------------
namespace {

// Timestamp of the last LED frame (used to pace scans).
unsigned long lastLedMs = 0;

// A distinct hue per face so the mapped scan is trivially readable at a
// glance. Values chosen for eye contrast, not physical accuracy.
struct Rgb { uint8_t r, g, b; };
Rgb faceScanColor(uint8_t face) {
  switch (face) {
    case 1:  return {255,   0,   0};   // red
    case 2:  return {255, 160,   0};   // amber
    case 3:  return {255, 255,   0};   // yellow
    case 4:  return {  0, 255,   0};   // green
    case 5:  return {  0, 120, 255};   // blue
    case 6:  return {180,   0, 255};   // violet
    default: return {255, 255, 255};
  }
}

// Small progress screen drawn while the boot scan walks the strip.
void drawBootScanHud(const char* label, uint16_t index, uint16_t total) {
  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(8, 8);
  M5.Display.printf("LED boot scan");
  M5.Display.setTextSize(1);
  M5.Display.setCursor(8, 42);
  M5.Display.printf("%s", label);
  M5.Display.setCursor(8, 58);
  M5.Display.printf("%u / %u", (unsigned)index, (unsigned)total);
  M5.Display.setCursor(8, 74);
  M5.Display.printf("pin:%d leds:%u ext5v:%s",
                    (int)cube::kLedPin, (unsigned)cube::kTotalLeds,
                    cube::kExternalPowerOutput ? "on" : "off");
  M5.Display.endWrite();
}

// Step one physical pixel forward in RAW_SCAN.
void advanceRawScan() {
  Leds::renderer.scanRaw(rawScanIndex, 255, 255, 255);
  rawScanIndex = static_cast<uint16_t>((rawScanIndex + 1) % cube::kTotalLeds);
}

// Step one logical cell forward in MAPPED_SCAN.
void advanceMappedScan() {
  const uint16_t n     = mappedScanIndex++;
  const uint8_t  face  = static_cast<uint8_t>(1 + (n / (cube::kFaceCells * cube::kFaceCells)) % cube::kFaceCount);
  const uint8_t  inF   = static_cast<uint8_t>(n % (cube::kFaceCells * cube::kFaceCells));
  const uint8_t  x     = static_cast<uint8_t>(inF % cube::kFaceCells);
  const uint8_t  y     = static_cast<uint8_t>(inF / cube::kFaceCells);
  const Rgb      c     = faceScanColor(face);
  Leds::renderer.scanMapped(face, x, y, c.r, c.g, c.b);
  if (mappedScanIndex >= cube::kTotalLeds) mappedScanIndex = 0;
}

// ---------------------------------------------------------------------------
// TEST-mode helpers.
// ---------------------------------------------------------------------------

// Draw the test head. Colour comes from the face palette (same one used by
// MAPPED scan) so you can see AT A GLANCE which logical face the head is on.
//
// This is a diagnostic aid for the physical-vs-logical face labelling task:
//   - F1 red, F2 amber, F3 yellow, F4 green, F5 blue, F6 violet.
//   - Tap FACE to cycle. Whichever physical face lights amber IS F2 in
//     firmware terms, whichever lights yellow IS F3, and so on.
//
// scanMapped clears the whole strip and lights this one cell atomically, so
// there is no flicker.
void drawTestPixel() {
  const Rgb c = faceScanColor(testFace);
  Leds::renderer.scanMapped(testFace, testX, testY, c.r, c.g, c.b);
}

// Advance the test head by (testDx, testDy). Uses the SAME cube_topology
// crossEdge() as HeadEngine, so any mapping bug shows up identically in
// both modes -- this is the whole point of TEST mode.
void advanceTest() {
  const int nx = static_cast<int>(testX) + testDx;
  const int ny = static_cast<int>(testY) + testDy;

  int edge = -1;
  if      (testDx > 0 && nx >= cube::kFaceCells) edge = 0;   // +u
  else if (testDx < 0 && nx <  0)                edge = 2;   // -u
  else if (testDy > 0 && ny >= cube::kFaceCells) edge = 1;   // +v
  else if (testDy < 0 && ny <  0)                edge = 3;   // -v

  if (edge < 0) {
    testX = static_cast<uint8_t>(nx);
    testY = static_cast<uint8_t>(ny);
    return;
  }

  cube::HeadPose p{testFace, testX, testY, testDx, testDy};
  cube::crossEdge(p, static_cast<uint8_t>(edge));
  testFace = p.face;
  testX    = p.x;
  testY    = p.y;
  testDx   = p.dx;
  testDy   = p.dy;
}

}  // namespace (file-private)

// -----------------------------------------------------------------------------
// ============================== BOOT SCAN ===================================
// -----------------------------------------------------------------------------

void runBootScan() {
  if (!cube::kBootScanEnabled) return;

  drawBootScanHud("quiet raw chain", 0, cube::kTotalLeds);

  // Raw walk: light one physical LED at a time. If this looks wrong,
  // the problem is HARDWARE (data, power, LED order).
  if (cube::kBootScanRaw) {
    for (uint16_t i = 0; i < cube::kTotalLeds; ++i) {
      Leds::renderer.scanRaw(i, 255, 255, 255);
      delay(cube::kBootScanDelayMs);
    }
  }

  // Mapped walk: colour-coded per face. If raw was clean but this is
  // scrambled, the problem is CHART MAPPING (LedMapper + NeoMatrix flags).
  if (cube::kBootScanMapped) {
    for (uint16_t n = 0; n < cube::kTotalLeds; ++n) {
      const uint8_t face = static_cast<uint8_t>(1 + (n / (cube::kFaceCells * cube::kFaceCells)) % cube::kFaceCount);
      const uint8_t inF  = static_cast<uint8_t>(n % (cube::kFaceCells * cube::kFaceCells));
      const uint8_t x    = static_cast<uint8_t>(inF % cube::kFaceCells);
      const uint8_t y    = static_cast<uint8_t>(inF / cube::kFaceCells);
      const Rgb     c    = faceScanColor(face);
      Leds::renderer.scanMapped(face, x, y, c.r, c.g, c.b);
      delay(cube::kBootScanDelayMs);
    }
  }

  // Blank the strip so we boot into the configured mode with a clean slate.
  Leds::renderer.scanRaw(cube::kTotalLeds, 0, 0, 0);
}

// -----------------------------------------------------------------------------
// =========================== PER-FRAME RENDER ===============================
// -----------------------------------------------------------------------------

void render(unsigned long nowMs) {
  switch (mode) {
    case GAME:
      // Cap game frames to ~50 fps so we don't saturate the RMT peripheral.
      if (nowMs - lastLedMs > 20) {
        lastLedMs = nowMs;
        Leds::renderer.render(Score::grid, Heads::engine, Transport::state, nowMs);
      }
      break;

    case RAW_SCAN:
      if (forceScanStep ||
          (!scanPaused && nowMs - lastLedMs > scanDelayMs)) {
        lastLedMs      = nowMs;
        forceScanStep  = false;
        advanceRawScan();
      }
      break;

    case MAPPED_SCAN:
      if (forceScanStep ||
          (!scanPaused && nowMs - lastLedMs > scanDelayMs)) {
        lastLedMs      = nowMs;
        forceScanStep  = false;
        advanceMappedScan();
      }
      break;

    case TEST:
      // Same pacing as scan modes; STEP forces a single advance while paused.
      if (forceScanStep ||
          (!scanPaused && nowMs - lastLedMs > scanDelayMs)) {
        lastLedMs     = nowMs;
        forceScanStep = false;
        advanceTest();
        drawTestPixel();
      }
      break;
  }
}

// -----------------------------------------------------------------------------
// ============================ MODE CONTROL ==================================
// -----------------------------------------------------------------------------

void setMode(Mode m) {
  mode       = m;
  scanPaused = false;
  resetScan();
  if (m == TEST) {
    // Show the test head immediately so the user has instant feedback that
    // TEST mode is active and knows where the head currently is.
    drawTestPixel();
  }
}

void resetScan() {
  rawScanIndex    = 0;
  mappedScanIndex = 0;
  forceScanStep   = false;
  lastLedMs       = 0;
  Leds::renderer.scanRaw(cube::kTotalLeds, 0, 0, 0);   // blank the strip
}

// ---------------------------------------------------------------------------
// TEST-mode public verbs.
// ---------------------------------------------------------------------------

void testSetDir(int8_t dx, int8_t dy) {
  testDx = dx;
  testDy = dy;
  // Redraw so the user sees confirmation even when scan is paused.
  if (mode == TEST) drawTestPixel();
}

void testNextFace() {
  // Numeric cycle 1 -> 2 -> ... -> 6 -> 1. This is a UI convenience for the
  // FACE button (visit each face in order to eyeball its mapping); it does
  // NOT walk the cube topology -- that job is crossEdge()'s.
  testFace = static_cast<uint8_t>((testFace % cube::kFaceCount) + 1);
  testX    = 0;
  testY    = 0;
  if (mode == TEST) drawTestPixel();
}

void testReset() {
  testFace = 1;
  testX    = 0;
  testY    = 0;
  testDx   = 1;
  testDy   = 0;
  if (mode == TEST) drawTestPixel();
}

// -----------------------------------------------------------------------------
// =============================== HELPERS ====================================
// -----------------------------------------------------------------------------

const char* modeName(Mode m) {
  switch (m) {
    case GAME:        return "GAME";
    case RAW_SCAN:    return "RAW CHAIN";
    case MAPPED_SCAN: return "MAPPED";
    case TEST:        return "TEST HEAD";
  }
  return "UNKNOWN";
}

}  // namespace Diag
