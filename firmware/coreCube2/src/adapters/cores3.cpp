// ===========================================================================
// cores3.cpp — every board-specific detail, in one place (M5Stack CoreS3)
// ===========================================================================
//
// Implements the namespaces declared in devices.hpp:
//   Hardware — power-up sequence, real-time clock, M5 service calls
//   Display  — the 6 x 8x8 LED cube output (Adafruit NeoMatrix)
//   Audio    — the onboard speaker, driven by Note events
//   Controls — touch screen + side buttons -> Commands
//   Com      — USB serial text protocol (`status` lives here)
//
// No other file in the firmware includes M5 or Adafruit headers; porting to
// another board means writing a new file with the same namespace functions.

#include "devices.hpp"
#include "panel_mapping.hpp"
#include "serial_protocol.hpp"
#include <cmath>           // std::pow (note frequency)
#include <M5Unified.h>
#include <Adafruit_NeoMatrix.h>

// GPIO feeding the cube's data line. Override per board revision with a build
// flag (-D CUBE_DATA_PIN=...) if the wiring changes.
#ifndef CUBE_DATA_PIN
#define CUBE_DATA_PIN 1
#endif

// ---------------------------------------------------------------------------
// Hardware — board bring-up and the clock. tick() is the ONLY time source:
// real seconds since the previous call, computed wrap-safely (unsigned
// subtraction), so the main loop can hand it straight to the sequencer.
// ---------------------------------------------------------------------------
namespace Hardware {
static uint32_t previousMicros = 0;

void begin() {
  auto config = M5.config();
  config.output_power = true;     // power the Grove/Ext port at boot...
  M5.begin(config);
  M5.Power.setExtOutput(true);    // ...BEFORE any LED init: the cube needs 5V
  M5.Display.setRotation(1);      // landscape: 320 x 240
  M5.Display.setBrightness(90);
  Serial.begin(115200);           // USB command console
  previousMicros = micros();
}

double tick() {
  M5.update();                    // refresh buttons/touch state machine
  const uint32_t current = micros();
  const double elapsed = static_cast<uint32_t>(current - previousMicros) * 1e-6;
  previousMicros = current;
  return elapsed;
}

uint32_t nowMs() { return millis(); }
}

// ---------------------------------------------------------------------------
// Display — the LED cube as one 48x8 output matrix: six 8x8 panels in a row,
// each panel wired row-serpentine, panels chained progressively (all of that
// is what the constructor flags below express). Call begin() only AFTER
// Hardware::begin() — the cube's 5V must be on first.
// ---------------------------------------------------------------------------
namespace Display {
static Adafruit_NeoMatrix matrix(8, 8,           // one panel: 8x8 pixels
    6, 1,                                         // 6 panels across, 1 down
    CUBE_DATA_PIN,
    NEO_MATRIX_TOP + NEO_MATRIX_LEFT +            // panel origin: top-left
    NEO_MATRIX_ROWS + NEO_MATRIX_ZIGZAG +         // serpentine rows
    NEO_TILE_TOP + NEO_TILE_LEFT + NEO_TILE_ROWS + NEO_TILE_PROGRESSIVE,
    NEO_GRB + NEO_KHZ800);                        // WS2812B colour order + speed

// Maps the GFX canvas (x,y) to the physical LED chain index using the
// serpentine wiring confirmed on the hardware. Installed with
// setRemapFunction() so EVERY GFX primitive (the scan dot now, but also lines,
// circles and text later) routes through it. This REPLACES NeoMatrix's built-in
// tile/zigzag math, which on these panels landed one LED further along the
// strip (the measured "+1" / "pushed by one" artifact).
static uint16_t remapToStrip(uint16_t x, uint16_t y) {
  const uint16_t panel = x / 8;            // 8 panels laid along X in the canvas
  const uint16_t col   = x % 8;
  return panel * 64 + y * 8 + ((y & 1) ? (7 - col) : col);   // row-serpentine
}

void begin() {
  matrix.begin();
  matrix.setRemapFunction(remapToStrip);   // our wiring, not NeoMatrix's flags
  matrix.setBrightness(12);       // quiet default; the UI changes this (cap 64)
  matrix.fillScreen(0);
  matrix.show();
}

void setBrightness(uint8_t value) { matrix.setBrightness(value); }

// Paint one complete frame. The frame is a LOGICAL surface picture; this is
// where (and the only place where) it meets the physical cube:
//   nativePanels=false — every cell goes through PanelMapping::map()
//                        (the assembled-cube transform; see panel_mapping.hpp)
//   nativePanels=true  — face N goes to panel slot N unrotated; the
//                        PanelAxes/PanelScan diagnostics use this to study
//                        the hardware without the mapping in the way
// drawPixel does the drawing (so every GFX primitive stays available); the
// (x,y) -> physical chain index step is handled by remapToStrip (see begin()).
void present(const Presentation::SurfaceFrame& frame, const topo::Surface& surface, bool nativePanels) {
  matrix.fillScreen(0);
  // This adapter supports exactly the 8x8x6 cube; any other surface leaves
  // the cube dark rather than showing something wrong.
  if (surface.side == 8 && surface.faceCount == 6) {
    for (uint8_t face = 0; face < 6; ++face) {
      for (uint8_t row = 0; row < 8; ++row) {
        for (uint8_t column = 0; column < 8; ++column) {
          uint16_t outputX = face * 8 + column;   // default: same-numbered slot
          uint16_t outputY = row;
          if (!nativePanels && !PanelMapping::map(face, column, row, outputX, outputY)) continue;
          const auto color = frame[surface.index({face, column, row})];
          matrix.drawPixel(outputX, outputY, matrix.Color(color.red, color.green, color.blue));
        }
      }
    }
  }
  matrix.show();
}

// RawChainScan diagnostic: light exactly ONE emitter by its index in the
// physical chain, ignoring every mapping. Out-of-range indices leave the
// cube dark. Grey keeps the single pixel readable at any brightness.
void showRaw(unsigned index) {
  matrix.fillScreen(0);
  if (index < PanelMapping::emitterCount) matrix.setPixelColor(index, 140, 140, 140);
  matrix.show();
}
}

// ---------------------------------------------------------------------------
// Audio — the onboard speaker. Deliberately minimal: monophonic (a new note
// replaces the current tone) and the instrument index is ignored for now.
// It is a placeholder that makes the sequence audible, not a synth;
// instrument-dependent voices are future work.
// ---------------------------------------------------------------------------
namespace Audio {
void begin() {
  M5.Speaker.begin();
  M5.Speaker.setVolume(64);       // 0..255 scale; deliberately mid-quiet
}

void play(const topo::Event& event) {
  if (event.kind != topo::EventKind::Note) return;   // only notes make sound

  // MIDI -> Hz: note 69 is A4 = 440 Hz and every octave doubles.
  const double frequency = 440 * std::pow(2.0, (int(event.note) - 69) / 12.0);
  M5.Speaker.setVolume(event.velocity / 2);          // velocity 1..127 -> 0..63
  M5.Speaker.tone(static_cast<unsigned>(frequency), event.durationMs);
}

void silence() { M5.Speaker.stop(); }
}

// ---------------------------------------------------------------------------
// Controls — the physical UI: ten on-screen buttons plus the three side
// buttons. poll() produces at most ONE command per call (the caller applies
// it right away); draw() paints the status screen. Button coordinates are
// for the landscape 320x240 display.
// ---------------------------------------------------------------------------
namespace Controls {

// A tappable rectangle tied to a semantic Action (layout is decoupled from
// meaning, so the same STEP/PAUSE logic serves every page).
enum Action : uint8_t {
  ACT_NONE,
  ACT_MODE_PREV, ACT_MODE_NEXT,
  ACT_PAUSE, ACT_STEP_BACK, ACT_STEP_FWD, ACT_RESET,
  ACT_RANDOM, ACT_CLEAR, ACT_BPM_DOWN, ACT_BPM_UP,
  ACT_DIM, ACT_BRIGHT,
};

struct Button { int16_t x, y, w, h; const char* label; Action action; };

// Mode selector: big "<  name  >" row, always visible at the top.
static constexpr Button kModeRow[] = {
  {  4, 30, 52, 44, "<", ACT_MODE_PREV},
  {264, 30, 52, 44, ">", ACT_MODE_NEXT},
};

// Page shown for the SCAN diagnostics (Surface/Panel/Raw): pause + step + reset.
static constexpr Button kScanButtons[] = {
  {  8,  84, 150, 44, "RUN/STOP", ACT_PAUSE},
  {162,  84, 150, 44, "RESET",    ACT_RESET},
  {  8, 134, 150, 44, "< STEP",   ACT_STEP_BACK},
  {162, 134, 150, 44, "STEP >",   ACT_STEP_FWD},
  {  8, 184, 150, 44, "DIM",      ACT_DIM},
  {162, 184, 150, 44, "BRIGHT",   ACT_BRIGHT},
};

// Page shown for Performance.
static constexpr Button kPlayButtons[] = {
  {  8,  84, 150, 44, "RUN/STOP", ACT_PAUSE},
  {162,  84, 150, 44, "RANDOM",   ACT_RANDOM},
  {  8, 134, 150, 44, "BPM -",    ACT_BPM_DOWN},
  {162, 134, 150, 44, "BPM +",    ACT_BPM_UP},
  {  8, 184, 150, 44, "CLEAR",    ACT_CLEAR},
  {162, 184, 150, 44, "RESET",    ACT_RESET},
};

// Page shown for the static AXES views (Surface/Panel axes): brightness only.
static constexpr Button kAxesButtons[] = {
  {  8,  84, 150, 44, "DIM",    ACT_DIM},
  {162,  84, 150, 44, "BRIGHT", ACT_BRIGHT},
};

// Page shown for the Topology walk (runs continuously): pause/step/reset.
static constexpr Button kWalkButtons[] = {
  {  8,  84, 150, 44, "RUN/STOP", ACT_PAUSE},
  {162,  84, 150, 44, "STEP >",   ACT_STEP_FWD},
  {  8, 134, 150, 44, "RESET",    ACT_RESET},
  {162, 134, 150, 44, "DIM",      ACT_DIM},
  {  8, 184, 150, 44, "BRIGHT",   ACT_BRIGHT},
};

// Which page (button set) the active mode shows.
enum Group : uint8_t { G_PLAY, G_SCAN, G_AXES, G_WALK };
static Group groupFor(Modes::Kind mode) {
  switch (mode) {
    case Modes::Kind::Performance:  return G_PLAY;
    case Modes::Kind::SurfaceScan:
    case Modes::Kind::PanelScan:
    case Modes::Kind::RawChainScan: return G_SCAN;
    case Modes::Kind::TopologyWalk: return G_WALK;
    default:                        return G_AXES;   // Surface/Panel axes
  }
}

static const Button* groupButtons(Group group, unsigned& count) {
  switch (group) {
    case G_PLAY: count = sizeof(kPlayButtons) / sizeof(Button); return kPlayButtons;
    case G_SCAN: count = sizeof(kScanButtons) / sizeof(Button); return kScanButtons;
    case G_WALK: count = sizeof(kWalkButtons) / sizeof(Button); return kWalkButtons;
    default:     count = sizeof(kAxesButtons) / sizeof(Button); return kAxesButtons;
  }
}

// Turn a semantic Action into a Command (validated later by Commands::apply).
// Returns false for ACT_NONE.
static bool actionToCommand(Action action, const topo::Sequencer& instrument,
                            const Modes::State& modes, Commands::Command& command) {
  using Commands::Kind;
  command = {};
  switch (action) {
    case ACT_MODE_PREV:
    case ACT_MODE_NEXT:
      command.kind = Kind::Mode;
      command.index = (unsigned(modes.active) + unsigned(Modes::Kind::Count) +
                       (action == ACT_MODE_NEXT ? 1 : -1)) % unsigned(Modes::Kind::Count);
      return true;
    case ACT_PAUSE:     command.kind = Kind::Toggle;             return true;
    case ACT_STEP_FWD:  command.kind = Kind::DiagnosticStep;     return true;
    case ACT_STEP_BACK: command.kind = Kind::DiagnosticStepBack; return true;
    case ACT_RESET:     command.kind = Kind::Reset;              return true;
    case ACT_RANDOM:    command.kind = Kind::Randomize; command.index = millis(); return true;
    case ACT_CLEAR:     command.kind = Kind::Clear;              return true;
    case ACT_BPM_DOWN:
    case ACT_BPM_UP:
      command.kind = Kind::Tempo;
      command.value = std::max(20.0, std::min(400.0, instrument.tempo() + (action == ACT_BPM_UP ? 10 : -10)));
      return true;
    case ACT_DIM:
    case ACT_BRIGHT:
      command.kind = Kind::Brightness;
      command.value = std::max(1, std::min(64, int(modes.brightness) + (action == ACT_BRIGHT ? 4 : -4)));
      return true;
    default: return false;
  }
}

// Produce at most one Command: hardware side buttons first, then a touch on
// the mode row or the active page's buttons. The first hit wins.
bool poll(const topo::Sequencer& instrument, const Modes::State& modes, Commands::Command& command) {
  Action action = ACT_NONE;

  if (M5.BtnA.wasClicked()) action = ACT_PAUSE;      // A = run/pause
  if (M5.BtnB.wasClicked()) action = ACT_MODE_NEXT;  // B = next mode
  if (M5.BtnC.wasClicked()) action = ACT_STEP_FWD;   // C = step forward

  if (M5.Touch.isEnabled() && M5.Touch.getCount()) {
    const auto touch = M5.Touch.getDetail();
    if (touch.wasClicked()) {
      auto hit = [&](const Button& b) {
        return touch.x >= b.x && touch.x < b.x + b.w && touch.y >= b.y && touch.y < b.y + b.h;
      };
      for (const auto& b : kModeRow) if (hit(b)) action = b.action;
      unsigned count = 0;
      const Button* set = groupButtons(groupFor(modes.active), count);
      for (unsigned i = 0; i < count; ++i) if (hit(set[i])) action = set[i].action;
    }
  }

  return actionToCommand(action, instrument, modes, command);
}

// Draw one big page button; `on` highlights it (used for the active PAUSE).
static void drawButton(const Button& b, bool on) {
  const uint16_t fill    = on ? M5.Display.color565(32, 96, 120) : M5.Display.color565(34, 38, 44);
  const uint16_t outline = on ? TFT_CYAN : M5.Display.color565(95, 105, 120);
  M5.Display.fillRoundRect(b.x, b.y, b.w, b.h, 5, fill);
  M5.Display.drawRoundRect(b.x, b.y, b.w, b.h, 5, outline);
  M5.Display.setTextColor(TFT_WHITE, fill);
  M5.Display.setTextSize(2);
  const int16_t half = int16_t(std::strlen(b.label)) * 6;   // ~12 px/char at size 2
  int16_t tx = b.x + b.w / 2 - half;
  if (tx < b.x + 4) tx = b.x + 4;
  M5.Display.setCursor(tx, b.y + b.h / 2 - 8);
  M5.Display.print(b.label);
}

// Repaint the status screen. ANTI-FLICKER: a signature of everything shown is
// compared first and the function returns early when nothing changed — the
// periodic full clear is what made the screen "flash". Layout is big paged
// buttons, one page per mode group (see groupFor); scan pages show the live
// scan index so a cell can be read straight off the panel.
void draw(const topo::Sequencer& instrument, const Modes::State& modes) {
  static uint32_t lastSig = 0xFFFFFFFFu;
  const uint32_t sig = uint32_t(modes.active) * 2654435761u
                     ^ (modes.diagnostic.scanIndex * 40503u)
                     ^ (uint32_t(modes.brightness) << 3)
                     ^ (uint32_t(instrument.tempo()) << 11)
                     ^ (uint32_t(instrument.sequenceCount()) << 17)
                     ^ (instrument.paused() ? 0x55000000u : 0u)
                     ^ (modes.diagnostic.paused ? 0x00AA0000u : 0u);
  if (sig == lastSig) return;
  lastSig = sig;

  const Group group = groupFor(modes.active);

  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);

  // Status line (compact). Scan pages show the live index + pause state.
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(6, 6);
  if (group == G_SCAN) {
    M5.Display.printf("idx:%lu   %s   br:%u",
                      (unsigned long)modes.diagnostic.scanIndex,
                      modes.diagnostic.paused ? "PAUSED" : "running",
                      (unsigned)modes.brightness);
  } else {
    M5.Display.printf("%.0f BPM   %u readers   br:%u   %s", instrument.tempo(),
                      (unsigned)instrument.sequenceCount(), (unsigned)modes.brightness,
                      instrument.paused() ? "paused" : "running");
  }

  // Mode selector row: big < name >.
  for (const auto& b : kModeRow) drawButton(b, false);
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  {
    const char* name = Modes::name(modes.active);
    const int16_t half = int16_t(std::strlen(name)) * 6;
    int16_t tx = 160 - half;
    if (tx < 62) tx = 62;
    M5.Display.setCursor(tx, 44);
    M5.Display.print(name);
  }

  // Active page's big buttons (PAUSE highlights when paused/stopped).
  unsigned count = 0;
  const Button* set = groupButtons(group, count);
  for (unsigned i = 0; i < count; ++i) {
    const bool on = set[i].action == ACT_PAUSE &&
                    (modes.active == Modes::Kind::Performance ? instrument.paused()
                                                              : modes.diagnostic.paused);
    drawButton(set[i], on);
  }

  // Footer: calibration + overrun counter.
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_YELLOW, TFT_BLACK);
  M5.Display.setCursor(6, 230);
  M5.Display.printf("%s | overruns %lu",
                    PanelMapping::calibrated ? "Calibrated" : "Map unverified",
                    static_cast<unsigned long>(instrument.overruns()));
  M5.Display.endWrite();
}
}

// ---------------------------------------------------------------------------
// Com — USB serial text protocol. Assembles characters into a line (CR is
// ignored, LF ends it), answers `status` here, and hands everything else to
// SerialProtocol::parse(). The per-call byte budget and the line-length cap
// keep a chatty host from stalling the main loop.
// ---------------------------------------------------------------------------
namespace Com {
static char line[160];          // one command line (NUL kept inside the buffer)
static unsigned used = 0;       // characters currently in `line`
static bool overflow = false;   // a line exceeded the buffer; discard it

// Reads a bounded chunk of available input. Returns true when `command`
// holds a parsed command; syntax errors and `status` reply on the spot and
// return false.
bool poll(Commands::Command& command, const topo::Sequencer& instrument) {
  for (unsigned budget = 0; budget < 64 && Serial.available(); ++budget) {
    const char input = static_cast<char>(Serial.read());
    if (input == '\r') continue;              // accept CRLF line endings
    if (input != '\n') {
      if (used + 1 < sizeof(line)) line[used++] = input;
      else overflow = true;                   // remember it and skip to LF
      continue;
    }

    line[used] = '\0';
    used = 0;
    if (overflow) {
      overflow = false;
      Serial.println("ERR line too long");
      return false;
    }
    if (std::strcmp(line, "status") == 0) {
      Serial.printf("tempo=%.1f paused=%u sequences=%u bands=%u time=%.3f overruns=%lu\n",
                    instrument.tempo(), instrument.paused(), instrument.sequenceCount(),
                    instrument.bandCount(), instrument.time(),
                    static_cast<unsigned long>(instrument.overruns()));
      return false;
    }
    if (SerialProtocol::parse(line, command)) return true;
    Serial.println("ERR syntax");
    return false;
  }
  return false;
}

void reply(bool accepted) { Serial.println(accepted ? "OK" : "ERR rejected"); }
}