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

void begin() {
  matrix.begin();
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

struct Button {
  int x, y, width, height;   // screen rectangle, in pixels
  const char* label;         // static label (button 3 swaps label in diagnostics)
};

// The strip, top to bottom: mode arrows / transport+random / tempo /
// brightness / score. See draw() for the on-screen layout.
static constexpr Button buttons[] = {
  {8,52,42,34,"<"}, {270,52,42,34,">"},
  {8,94,148,34,"Run / Pause"}, {164,94,148,34,"Random"},
  {8,136,70,34,"BPM-"}, {86,136,70,34,"BPM+"},
  {164,136,70,34,"Dim"}, {242,136,70,34,"Bright"},
  {8,178,148,34,"Clear score"}, {164,178,148,34,"Reset heads"}
};

// Returns true when a command was produced. Sources are checked side buttons
// first, then the touch screen; the first hit wins.
bool poll(const topo::Sequencer& instrument, const Modes::State& modes, Commands::Command& command) {
  command = {};
  int selected = -1;   // index into `buttons`; -1 = nothing pressed

  if (M5.BtnA.wasClicked()) selected = 2;   // side buttons: run/pause...
  if (M5.BtnB.wasClicked()) selected = 1;   // ...next mode...
  if (M5.BtnC.wasClicked()) selected = 3;   // ...random / step

  if (M5.Touch.isEnabled() && M5.Touch.getCount()) {
    const auto touch = M5.Touch.getDetail();
    if (touch.wasClicked()) {
      for (unsigned index = 0; index < sizeof(buttons) / sizeof(buttons[0]); ++index) {
        const auto& button = buttons[index];
        if (touch.x >= button.x && touch.x < button.x + button.width &&
            touch.y >= button.y && touch.y < button.y + button.height) {
          selected = index;
        }
      }
    }
  }

  using Commands::Kind;
  switch (selected) {
    case 0: case 1:   // mode, wrapped in both directions
      command.kind = Kind::Mode;
      command.index = (unsigned(modes.active) + unsigned(Modes::Kind::Count) + (selected ? 1 : -1)) %
                      unsigned(Modes::Kind::Count);
      break;
    case 2:   // transport in Performance, diagnostic pause elsewhere (see Commands::Toggle)
      command.kind = Kind::Toggle;
      break;
    case 3:   // "Random" in Performance, "Step" in every diagnostic
      command.kind = modes.active == Modes::Kind::Performance ? Kind::Randomize : Kind::DiagnosticStep;
      command.index = millis();   // random seed: differs with every press
      break;
    case 4: case 5:   // tempo -10 / +10, clamped to the range the core accepts
      command.kind = Kind::Tempo;
      command.value = std::max(20.0, std::min(400.0, instrument.tempo() + (selected == 4 ? -10 : 10)));
      break;
    case 6: case 7:   // brightness -4 / +4, capped at 64 (electrical safety)
      command.kind = Kind::Brightness;
      command.value = std::max(1, std::min(64, int(modes.brightness) + (selected == 6 ? -4 : 4)));
      break;
    case 8: command.kind = Kind::Clear; break;
    case 9: command.kind = Kind::Reset; break;
    default: return false;   // nothing was pressed
  }
  return true;
}

// Repaint the status screen: header, live counters, mode name, the button
// strip, and a footer with mapping state / brightness / overruns. Called
// sparingly (controlsIntervalMs in main.cpp) — the LCD is slow.
void draw(const topo::Sequencer& instrument, const Modes::State& modes) {
  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);

  // Header: title + live transport counters.
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(8,5);
  M5.Display.print("Topological Sequencer v2");
  M5.Display.setTextSize(1);
  M5.Display.setCursor(8,31);
  M5.Display.printf("%.0f BPM | %u readers | %u bands | %s", instrument.tempo(),
                    instrument.sequenceCount(), instrument.bandCount(),
                    instrument.paused() ? "paused" : "running");

  // Current mode name, centred over the button strip.
  M5.Display.setCursor(64,65);
  M5.Display.print(Modes::name(modes.active));

  // Button strip. One label is dynamic: button 3 turns "Random" into "Step"
  // when a diagnostic is active, because that is what it does there.
  for (unsigned index = 0; index < sizeof(buttons) / sizeof(buttons[0]); ++index) {
    const auto& button = buttons[index];
    const uint16_t background = M5.Display.color565(35,45,40);
    M5.Display.fillRoundRect(button.x, button.y, button.width, button.height, 3, background);
    M5.Display.setTextColor(TFT_WHITE, background);
    M5.Display.setCursor(button.x + 8, button.y + 12);
    const char* label = index == 3 && modes.active != Modes::Kind::Performance ? "Step" : button.label;
    M5.Display.print(label);
  }

  // Footer: mapping status (yellow = not yet calibrated), brightness, and the
  // overrun counter (kept at 0 during normal use).
  M5.Display.setTextColor(TFT_YELLOW, TFT_BLACK);
  M5.Display.setCursor(8,223);
  M5.Display.printf("%s | brightness %u | overruns %lu",
                    PanelMapping::calibrated ? "Calibrated" : "Map unverified",
                    modes.brightness, static_cast<unsigned long>(instrument.overruns()));
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