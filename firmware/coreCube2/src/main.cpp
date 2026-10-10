// ===========================================================================
// main.cpp — the whole program flow, top to bottom
// ===========================================================================
//
// Read this file first: it is the table of contents of the firmware. setup()
// brings up the hardware and loads the saved session; loop() polls controls,
// applies commands, advances the instrument, and redraws the LED cube (~40 Hz)
// and the LCD (~4 Hz).
//
// The three globals below are the entire shared state of the program. They
// must live in static storage (NOT on the stack) because the instrument and
// the LED frame are several KB each:
//   Sequencer::instrument — the composition (readers, bands, score, clock)
//   Modes::state          — active mode, diagnostic state, brightness
//   Presentation::frame   — the picture built at every refresh
//
// Timing model: Hardware::tick() returns the REAL seconds since the previous
// call, and that value is handed to the update functions. There is no
// scheduler and no RTOS — one pass of loop() is one step of the program.

#include "adapters/devices.hpp"
#include "adapters/panel_mapping.hpp"
#include "demo.hpp"

// The single instances of everything (see the file header).
namespace Sequencer { topo::Sequencer instrument; }
namespace Modes { State state; }
namespace Presentation { SurfaceFrame frame; }

void setup() {
  Hardware::begin();                    // board power, clock, serial (5V before LEDs!)
  Demo::load(Sequencer::instrument);    // default composition...
  Store::begin();                       // ...open the NVS namespace...
  Store::load(Sequencer::instrument);   // ...overwritten by a saved session, if any
  Display::begin();
  Audio::begin();

  // Boot into a quiet diagnostic: PanelAxes shows the axes pattern with the
  // logical panel mapping BYPASSED, so nothing starts playing (or assumes a
  // calibration) until a human chooses to.
  Modes::select(Modes::state, Modes::Kind::PanelAxes, Sequencer::instrument.surface());
  Presentation::draw(Sequencer::instrument, Modes::state, Presentation::frame);
  Display::present(Presentation::frame, Sequencer::instrument.surface(), true);
  Controls::draw(Sequencer::instrument, Modes::state);

  Hardware::tick();                     // discard the time spent in setup()
}

// Idle refresh rates. A command always forces an immediate redraw; these are
// the fall-back rates when nothing changes. The LED cube redraws at ~40 Hz
// (also the frame rate of the scan/walk diagnostics); the LCD at ~4 Hz
// (writing it takes tens of ms — far too slow for 40 Hz).
constexpr uint32_t imageIntervalMs = 25;
constexpr uint32_t controlsIntervalMs = 250;

void loop() {
  double elapsed = Hardware::tick();   // real seconds since the previous pass
  const uint32_t now = Hardware::nowMs();
  bool changed = false;

  // --- 1. take at most ONE command from each input source ------------------
  // (screen touch first, then USB serial). One per source keeps a command
  // burst from stalling the display; the rest arrive on the following passes.
  Commands::Command command;
  for (unsigned source = 0; source < 2; ++source) {
    const bool available = source == 0 ? Controls::poll(Sequencer::instrument, Modes::state, command) :
                                        Com::poll(command, Sequencer::instrument);
    if (!available) continue;
    const auto result = Commands::apply(Sequencer::instrument, Modes::state, command);
    if (source == 1) Com::reply(result.accepted);   // answer only serial callers
    if (!result.accepted) continue;
    changed = true;
    if (result.silence) Audio::silence();
    if (result.save) Store::markDirty(now);

    // Commands that change WHAT the clock means (mode switch, reset,
    // transport) must not inherit the elapsed time of this pass, or the
    // instrument would "catch up" over the transition. Zero it and the next
    // pass starts fresh.
    if (command.kind == Commands::Kind::Mode || command.kind == Commands::Kind::Reset ||
        command.kind == Commands::Kind::Play || command.kind == Commands::Kind::Toggle) {
      elapsed = 0;
    }
  }

  // --- 2. advance the instrument (or the active diagnostic) ----------------
  if (Modes::state.active == Modes::Kind::Performance) {
    // The event sink is called synchronously while the readers move.
    Sequencer::instrument.update(elapsed, [](void*, const topo::Event& event) { Audio::play(event); });
  } else {
    Modes::update(Modes::state, elapsed, Sequencer::instrument.surface().cellCount(),
                  PanelMapping::emitterCount);
  }

  // --- 3. refresh the outputs when needed ----------------------------------
  // LED picture: after any command, or on the idle interval.
  static uint32_t lastImage = 0;
  static uint32_t lastControls = 0;
  if (changed || uint32_t(now - lastImage) >= imageIntervalMs) {
    lastImage = now;
    Display::setBrightness(Modes::state.brightness);
    if (Modes::state.active == Modes::Kind::RawChainScan) {
      Display::showRaw(Modes::state.diagnostic.scanIndex);
    } else {
      Presentation::draw(Sequencer::instrument, Modes::state, Presentation::frame);
      // PanelAxes / PanelScan are the two views that BYPASS the logical
      // panel mapping — they are about the hardware, not the composition.
      const bool nativePanels = Modes::state.active == Modes::Kind::PanelAxes ||
                                Modes::state.active == Modes::Kind::PanelScan;
      Display::present(Presentation::frame, Sequencer::instrument.surface(), nativePanels);
    }
  }
  // LCD: slow, so only after commands or on the idle interval.
  if (changed || uint32_t(now - lastControls) >= controlsIntervalMs) {
    lastControls = now;
    Controls::draw(Sequencer::instrument, Modes::state);
  }

  // --- 4. persist when the session is dirty and safe to save ---------------
  // "Safe" = outside Performance, or paused: flash writes may briefly stall
  // the loop, so they only happen when nothing is sounding.
  Store::service(Sequencer::instrument, now,
                 Modes::state.active != Modes::Kind::Performance || Sequencer::instrument.paused());
}