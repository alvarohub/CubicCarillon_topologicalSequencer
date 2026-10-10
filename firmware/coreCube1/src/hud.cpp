// =============================================================================
// hud.cpp -- CoreS3 LCD drawing + touchscreen + hardware button input.
// See hud.hpp for the module rationale.
// =============================================================================
//
// UI ARCHITECTURE: three TABS instead of one crammed screen.
//
//   +----------------------------------------------+
//   |  [ PLAY ]   [ SCAN ]   [ TEST ]              |  tab bar (always visible)
//   +----------------------------------------------+
//   |  status: MODE  bpm:120  scan:80ms  running   |  one-line status
//   +----------------------------------------------+
//   |                                              |
//   |   ...large buttons appropriate to the tab... |  content area
//   |                                              |
//   +----------------------------------------------+
//   |  wifi footer                                 |
//   +----------------------------------------------+
//
// Tabs are ALSO the mode selector: switching tabs auto-switches Diag::mode:
//     PLAY -> Diag::GAME
//     SCAN -> Diag::RAW_SCAN (or leaves MAPPED_SCAN if already there)
//     TEST -> Diag::TEST
//
// Each tab has 6-8 buttons at 150 x 34 (or larger for the TEST direction
// pad). Much easier to hit on the CoreS3 touchscreen than the earlier
// 11-buttons-in-one-screen layout.
// =============================================================================

#include "hud.hpp"

#include <M5Unified.h>
#include <string.h>

#include "config.hpp"
#include "cube_display_config.hpp"
#include "diag.hpp"
#include "led_renderer.hpp"
#include "net.hpp"
#include "osc_handler.hpp"
#include "preset_store.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"

namespace Hud {

// -----------------------------------------------------------------------------
// File-private state
// -----------------------------------------------------------------------------
namespace {

// Dirty flag + last-refresh timestamp (see refreshIfDirty).
bool          dirty     = true;
unsigned long lastHudMs = 0;

// ---------------------------------------------------------------------------
// Semantic actions -- what a button DOES, decoupled from where it is drawn.
// ---------------------------------------------------------------------------
enum Action : uint8_t {
  // Tabs
  ACT_TAB_PLAY, ACT_TAB_SCAN, ACT_TAB_TEST,
  // Scan sub-modes
  ACT_SCAN_RAW, ACT_SCAN_MAPPED,
  // Common controls
  ACT_PAUSE, ACT_STEP,
  ACT_DIM, ACT_BRIGHT,
  ACT_SLOW, ACT_FAST,
  // Play controls
  ACT_RANDOM, ACT_CLEAR,
  // Test controls
  ACT_DIR_L, ACT_DIR_R, ACT_DIR_U, ACT_DIR_D,
  ACT_FACE, ACT_RESET,
};

// A single tappable rectangle.
struct Button {
  int16_t     x, y, w, h;
  const char* label;
  Action      action;
};

// ---------------------------------------------------------------------------
// Layout constants -- one place to tune the whole screen.
// ---------------------------------------------------------------------------
constexpr int16_t kTabY      = 4;
constexpr int16_t kTabH      = 40;
constexpr int16_t kStatusY   = 52;
constexpr int16_t kFooterY   = 232;

// ---------------------------------------------------------------------------
// Tab bar (always visible)
// ---------------------------------------------------------------------------
const Button kTabs[3] = {
    {  8, kTabY, 96, kTabH, "PLAY", ACT_TAB_PLAY},
    {112, kTabY, 96, kTabH, "SCAN", ACT_TAB_SCAN},
    {216, kTabY, 96, kTabH, "TEST", ACT_TAB_TEST},
};

// ---------------------------------------------------------------------------
// PLAY tab -- big 2-column layout, 3 rows plus a full-width CLEAR.
// ---------------------------------------------------------------------------
const Button kPlayButtons[7] = {
    {  8,  80, 150, 34, "RUN/STOP",    ACT_PAUSE},
    {162,  80, 150, 34, "RANDOM",      ACT_RANDOM},
    {  8, 118, 150, 34, "SLOWER",      ACT_SLOW},
    {162, 118, 150, 34, "FASTER",      ACT_FAST},
    {  8, 156, 150, 34, "DIM",         ACT_DIM},
    {162, 156, 150, 34, "BRIGHT",      ACT_BRIGHT},
    {  8, 194, 304, 34, "CLEAR SCORE", ACT_CLEAR},
};

// ---------------------------------------------------------------------------
// SCAN tab -- RAW/MAP sub-mode picker on top, then generic controls.
// ---------------------------------------------------------------------------
const Button kScanButtons[8] = {
    {  8,  80, 150, 34, "RAW",      ACT_SCAN_RAW},
    {162,  80, 150, 34, "MAP",      ACT_SCAN_MAPPED},
    {  8, 118, 150, 34, "RUN/STOP", ACT_PAUSE},
    {162, 118, 150, 34, "STEP",     ACT_STEP},
    {  8, 156, 150, 34, "SLOWER",   ACT_SLOW},
    {162, 156, 150, 34, "FASTER",   ACT_FAST},
    {  8, 194, 150, 34, "DIM",      ACT_DIM},
    {162, 194, 150, 34, "BRIGHT",   ACT_BRIGHT},
};

// ---------------------------------------------------------------------------
// TEST tab -- small control row on top, then a big direction pad below.
// The direction pad buttons are 100 x 34 -- much easier to hit than before.
// ---------------------------------------------------------------------------
const Button kTestButtons[8] = {
    // Row 1: controls (74 wide each)
    {  8,  80,  74, 34, "FACE",  ACT_FACE},
    { 86,  80,  74, 34, "PAUSE", ACT_PAUSE},
    {164,  80,  74, 34, "STEP",  ACT_STEP},
    {242,  80,  74, 34, "RESET", ACT_RESET},
    // Direction pad (100 wide each; UP + DOWN centred, LEFT + RIGHT on the sides).
    {110, 118, 100, 34, "UP",    ACT_DIR_U},
    {  8, 156, 100, 34, "LEFT",  ACT_DIR_L},
    {212, 156, 100, 34, "RIGHT", ACT_DIR_R},
    {110, 194, 100, 34, "DOWN",  ACT_DIR_D},
};

// ---------------------------------------------------------------------------
// Which tab we are currently on. This is DERIVED from Diag::mode; there is
// no separate tab-selection state (that would just be a second source of
// truth).
// ---------------------------------------------------------------------------
enum Tab : uint8_t { TAB_PLAY, TAB_SCAN, TAB_TEST };

Tab currentTab() {
  switch (Diag::mode) {
    case Diag::GAME:        return TAB_PLAY;
    case Diag::TEST:        return TAB_TEST;
    default:                return TAB_SCAN;   // RAW_SCAN or MAPPED_SCAN
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

bool contains(const Button& b, int16_t px, int16_t py) {
  return px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h;
}

// Which buttons should render highlighted right now.
bool isActive(const Button& b) {
  const Tab tab = currentTab();
  switch (b.action) {
    // Tabs -- highlighted when their own screen is active.
    case ACT_TAB_PLAY: return tab == TAB_PLAY;
    case ACT_TAB_SCAN: return tab == TAB_SCAN;
    case ACT_TAB_TEST: return tab == TAB_TEST;

    // Scan sub-modes -- highlighted when their sub-mode is active.
    case ACT_SCAN_RAW:    return Diag::mode == Diag::RAW_SCAN;
    case ACT_SCAN_MAPPED: return Diag::mode == Diag::MAPPED_SCAN;

    // Pause -- meaning depends on tab.
    case ACT_PAUSE:
      return tab == TAB_PLAY ? Transport::state.paused : Diag::scanPaused;

    // Direction pad -- highlight the currently-active direction.
    case ACT_DIR_L: return Diag::testDx == -1 && Diag::testDy ==  0;
    case ACT_DIR_R: return Diag::testDx == +1 && Diag::testDy ==  0;
    case ACT_DIR_U: return Diag::testDx ==  0 && Diag::testDy == -1;
    case ACT_DIR_D: return Diag::testDx ==  0 && Diag::testDy == +1;

    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void drawButton(const Button& b, uint8_t textSize) {
  const bool active = isActive(b);
  const uint16_t fill    = active ? M5.Display.color565(32, 96, 120)
                                  : M5.Display.color565(34, 38, 44);
  const uint16_t outline = active ? TFT_CYAN
                                  : M5.Display.color565(95, 105, 120);

  M5.Display.fillRoundRect(b.x, b.y, b.w, b.h, 5, fill);
  M5.Display.drawRoundRect(b.x, b.y, b.w, b.h, 5, outline);
  M5.Display.setTextColor(TFT_WHITE, fill);
  M5.Display.setTextSize(textSize);

  // Rough centring. Default font glyph is ~6 x 8 pixels at size 1, so
  // half-width per char is 3 * textSize.
  const int16_t half = static_cast<int16_t>(strlen(b.label)) * 3 * textSize;
  int16_t tx = b.x + (b.w / 2) - half;
  const int16_t ty = b.y + (b.h / 2) - 4 * textSize;
  if (tx < b.x + 4) tx = b.x + 4;
  M5.Display.setCursor(tx, ty);
  M5.Display.print(b.label);
}

// One-line status bar shown between the tab bar and the content area.
void drawStatus() {
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(8, kStatusY);

  switch (currentTab()) {
    case TAB_PLAY:
      M5.Display.printf("PLAY  bpm:%.0f  br:%u  %s",
                        Transport::state.bpm,
                        (unsigned)Diag::ledBrightness,
                        Transport::state.paused ? "paused" : "running");
      break;

    case TAB_SCAN:
      M5.Display.printf("SCAN %s  scan:%ums  br:%u  %s",
                        Diag::mode == Diag::RAW_SCAN ? "RAW" : "MAP",
                        (unsigned)Diag::scanDelayMs,
                        (unsigned)Diag::ledBrightness,
                        Diag::scanPaused ? "paused" : "running");
      break;

    case TAB_TEST:
      // The most useful diagnostic view: current head face + cell + direction.
      M5.Display.printf("TEST F%u (%u,%u) dir:(%+d,%+d)  scan:%ums  %s",
                        (unsigned)Diag::testFace,
                        (unsigned)Diag::testX,
                        (unsigned)Diag::testY,
                        (int)Diag::testDx,
                        (int)Diag::testDy,
                        (unsigned)Diag::scanDelayMs,
                        Diag::scanPaused ? "paused" : "running");
      break;
  }
}

// Footer with Wi-Fi / quiet-mode label.
void drawFooter() {
  M5.Display.setTextColor(M5.Display.color565(180, 190, 205), TFT_BLACK);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(8, kFooterY);
  if (Net::started) {
    M5.Display.printf("WiFi %s %s",
                      Osc::handler.wifiModeName(),
                      Osc::handler.localIP().toString().c_str());
  } else {
    M5.Display.printf("quiet mode: WiFi/Web/WS off");
  }
}

// Draw the whole screen for the currently active tab.
void drawScreen() {
  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);

  // Tab bar (always).
  for (const Button& b : kTabs) drawButton(b, 2);

  // Status line.
  drawStatus();

  // Content -- depends on active tab.
  switch (currentTab()) {
    case TAB_PLAY:
      for (const Button& b : kPlayButtons) drawButton(b, 2);
      break;
    case TAB_SCAN:
      for (const Button& b : kScanButtons) drawButton(b, 2);
      break;
    case TAB_TEST:
      for (const Button& b : kTestButtons) drawButton(b, 2);
      break;
  }

  drawFooter();
  M5.Display.endWrite();

  dirty = false;
}

// ---------------------------------------------------------------------------
// Semantic actions
// ---------------------------------------------------------------------------

void applyAction(Action a) {
  switch (a) {
    // ---- Tab switching (each tab is also a mode switch) --------------------
    case ACT_TAB_PLAY:
      Diag::setMode(Diag::GAME);
      break;
    case ACT_TAB_SCAN:
      // Preserve MAPPED_SCAN if we were already there; otherwise fall to RAW.
      if (Diag::mode != Diag::RAW_SCAN && Diag::mode != Diag::MAPPED_SCAN) {
        Diag::setMode(Diag::RAW_SCAN);
      }
      break;
    case ACT_TAB_TEST:
      Diag::setMode(Diag::TEST);
      break;

    // ---- Scan sub-mode -----------------------------------------------------
    case ACT_SCAN_RAW:    Diag::setMode(Diag::RAW_SCAN);    break;
    case ACT_SCAN_MAPPED: Diag::setMode(Diag::MAPPED_SCAN); break;

    // ---- Run / pause (semantics depend on tab) -----------------------------
    case ACT_PAUSE:
      if (currentTab() == TAB_PLAY) {
        Transport::state.paused = !Transport::state.paused;
        Store::instance.markDirty();
        if (Net::started) Net::broadcastState();
      } else {
        Diag::scanPaused = !Diag::scanPaused;
      }
      break;

    // ---- One-shot STEP (scan or test, while paused) ------------------------
    case ACT_STEP:
      if (Diag::mode != Diag::GAME) {
        Diag::scanPaused    = true;
        Diag::forceScanStep = true;
      }
      break;

    // ---- Brightness --------------------------------------------------------
    case ACT_DIM:
      Diag::ledBrightness = Diag::ledBrightness > 8
                              ? static_cast<uint8_t>(Diag::ledBrightness - 8) : 1;
      Leds::renderer.setBrightness(Diag::ledBrightness);
      break;
    case ACT_BRIGHT:
      Diag::ledBrightness = Diag::ledBrightness < 247
                              ? static_cast<uint8_t>(Diag::ledBrightness + 8) : 255;
      Leds::renderer.setBrightness(Diag::ledBrightness);
      break;

    // ---- Speed -------------------------------------------------------------
    // In PLAY that means transport BPM; in SCAN/TEST it means the scan delay.
    case ACT_SLOW:
      if (currentTab() == TAB_PLAY) {
        const float b = Transport::state.bpm - 10.0f;
        Transport::state.bpm = b < 20.0f ? 20.0f : b;
        Store::instance.markDirty();
        if (Net::started) Net::broadcastState();
      } else {
        Diag::scanDelayMs = Diag::scanDelayMs < 500
                              ? static_cast<uint16_t>(Diag::scanDelayMs + 10) : 500;
      }
      break;
    case ACT_FAST:
      if (currentTab() == TAB_PLAY) {
        const float b = Transport::state.bpm + 10.0f;
        Transport::state.bpm = b > 400.0f ? 400.0f : b;
        Store::instance.markDirty();
        if (Net::started) Net::broadcastState();
      } else {
        Diag::scanDelayMs = Diag::scanDelayMs > 11
                              ? static_cast<uint16_t>(Diag::scanDelayMs - 10) : 1;
      }
      break;

    // ---- Score utilities (PLAY tab) ---------------------------------------
    case ACT_RANDOM:
      Score::grid.randomize(0.16f, 0.55f, 0.9f);
      Store::instance.markDirty();
      if (Net::started) Net::broadcastState();
      break;
    case ACT_CLEAR:
      Score::grid.clear();
      Store::instance.markDirty();
      if (Net::started) Net::broadcastState();
      break;

    // ---- TEST direction pad + face cycle + reset --------------------------
    case ACT_DIR_L: Diag::testSetDir(-1,  0); break;
    case ACT_DIR_R: Diag::testSetDir(+1,  0); break;
    case ACT_DIR_U: Diag::testSetDir( 0, -1); break;
    case ACT_DIR_D: Diag::testSetDir( 0, +1); break;
    case ACT_FACE:  Diag::testNextFace();     break;
    case ACT_RESET: Diag::testReset();        break;
  }
  dirty = true;
}

}  // namespace (file-private)

// -----------------------------------------------------------------------------
// ============================== PUBLIC API ==================================
// -----------------------------------------------------------------------------

void markDirty() { dirty = true; }

void draw() { drawScreen(); }

void refreshIfDirty(unsigned long nowMs) {
  const bool timed = cube::kHudRefreshMs > 0 && nowMs - lastHudMs > cube::kHudRefreshMs;
  if (dirty || timed) {
    lastHudMs = nowMs;
    drawScreen();
  }
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

void handleTouch() {
  if (!M5.Touch.isEnabled() || M5.Touch.getCount() == 0) return;
  const auto td = M5.Touch.getDetail();
  if (!td.wasClicked()) return;

  // Tab bar is always active.
  for (const Button& b : kTabs) {
    if (contains(b, td.x, td.y)) { applyAction(b.action); return; }
  }
  // Then the content area of the active tab.
  switch (currentTab()) {
    case TAB_PLAY:
      for (const Button& b : kPlayButtons) if (contains(b, td.x, td.y)) { applyAction(b.action); return; }
      break;
    case TAB_SCAN:
      for (const Button& b : kScanButtons) if (contains(b, td.x, td.y)) { applyAction(b.action); return; }
      break;
    case TAB_TEST:
      for (const Button& b : kTestButtons) if (contains(b, td.x, td.y)) { applyAction(b.action); return; }
      break;
  }
}

void handleButtons() {
  // Hardware buttons keep the most-common play actions independent of tab.
  if (M5.BtnA.wasClicked()) {
    Transport::state.paused = !Transport::state.paused;
    Store::instance.markDirty();
    if (Net::started) Net::broadcastState();
    dirty = true;
  }
  if (M5.BtnB.wasClicked()) {
    Score::grid.randomize(0.16f, 0.55f, 0.9f);
    Store::instance.markDirty();
    if (Net::started) Net::broadcastState();
    dirty = true;
  }
  if (M5.BtnC.wasClicked()) {
    Score::grid.clear();
    Store::instance.markDirty();
    if (Net::started) Net::broadcastState();
    dirty = true;
  }
}

}  // namespace Hud
