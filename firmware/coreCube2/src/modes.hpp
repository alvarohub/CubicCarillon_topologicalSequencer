#pragma once

// ===========================================================================
// modes.hpp — what the instrument is doing right now (performance/testing)
// ===========================================================================
//
// A "mode" is the top-level activity selected from the screen or over USB:
// either Performance (the real instrument) or one of six diagnostic views
// used to test the hardware and calibrate the cube (table in the README).
//
// Diagnostics own a SECOND, independent Sequencer instance for the test
// walker, so a diagnostic can never disturb the composition: switching modes
// preserves every real reader, the score and the tuning.
//
// Modes::update() advances only the diagnostic side. In Performance the main
// loop calls Sequencer::update() directly.

#include "core/sequencer.hpp"

namespace Diagnostics {

// State for the testing/calibration tools. One instance lives inside
// Modes::State; reset() rebuilds the walker for the current surface.
struct State {
  topo::Sequencer walker;     // independent instrument used only for tests
  uint32_t scanIndex = 0;     // position of the travelling scan pixel
  double accumulator = 0;     // fractional time; keeps scan cadence independent of loop rate
  bool paused = false;        // true = the diagnostic is frozen ("Step" advances it manually)

  // Build a fresh diagnostic walker: one slow reader (1 cell length per beat)
  // starting on face 0, vertically centred, heading +x. Disposable state —
  // never shared with the real instrument.
  void reset(const topo::Surface& surface) {
    walker.reset(surface);
    topo::Sequence reader;
    reader.pose = {0, 0.5, surface.side * 0.5 - 0.5, 1, 0};
    reader.rate = 1;
    walker.addSequence(reader);
    walker.setTempo(120);
    walker.setPaused(false);
    scanIndex = 0;
    accumulator = 0;
    paused = false;
  }
};

}

namespace Modes {

// The available top-level activities. `Count` is a sentinel for range checks,
// not a mode.
//
//   Performance  — the instrument itself (main loop runs the sequencer)
//   SurfaceAxes  — static axes + face numbers drawn in LOGICAL coordinates,
//                  sent through the physical panel mapping
//   SurfaceScan  — one pixel walking the logical cells
//   TopologyWalk — the independent test reader, crossing edges
//   PanelAxes    — same picture as SurfaceAxes, but the display step skips
//                  the panel mapping: shows the panels in slot order
//   PanelScan    — one pixel walking the 384 physical emitters
//   RawChainScan — one LED lit at a time in raw strip order (wiring test)
enum class Kind : uint8_t { Performance, SurfaceAxes, SurfaceScan, TopologyWalk, PanelAxes, PanelScan, RawChainScan, Count };

struct State {
  Kind active = Kind::PanelAxes;   // boot into the panel view: silent, and no mapping assumed
  Diagnostics::State diagnostic;   // test state (walker + scan position)
  uint8_t brightness = 12;         // LED brightness, kept within 1..64 (electrical safety)
};

// Human-readable mode name, shown on the LCD.
inline const char* name(Kind mode) {
  switch (mode) {
    case Kind::Performance: return "Performance";
    case Kind::SurfaceAxes: return "Surface axes";
    case Kind::SurfaceScan: return "Surface scan";
    case Kind::TopologyWalk: return "Topology walk";
    case Kind::PanelAxes: return "Panel axes";
    case Kind::PanelScan: return "Panel scan";
    case Kind::RawChainScan: return "Raw chain";
    default: return "Unknown";
  }
}

// Switch modes. Selecting always refreshes the diagnostic state (fresh
// walker, scan restarts) and never touches the instrument — that separation
// is the whole point of Diagnostics owning its own instance.
inline bool select(State& state, Kind kind, const topo::Surface& surface) {
  if (kind >= Kind::Count) return false;
  state.active = kind;
  state.diagnostic.reset(surface);
  // Scans start PAUSED so a human can step through them without racing the
  // 80 ms auto-advance; the walker and the static axes views don't need it.
  if (kind == Kind::SurfaceScan || kind == Kind::PanelScan || kind == Kind::RawChainScan)
    state.diagnostic.paused = true;
  return true;
}

// Advance the ACTIVE diagnostic by exactly one step (screen "Step" button,
// USB `step`): the topology walker moves a quarter second, every other
// diagnostic advances one cell/emitter. `surfaceCells` = logical cells,
// `physicalEmitters` = 384 on the CoreS3 cube.
inline void step(State& state, unsigned surfaceCells, unsigned physicalEmitters, int direction = +1) {
  if (state.active == Kind::TopologyWalk) {
    state.diagnostic.walker.update(0.25);   // the walk has no index; it only goes forward
  } else {
    const unsigned limit = state.active == Kind::RawChainScan || state.active == Kind::PanelScan ?
                           physicalEmitters : surfaceCells;
    if (limit) {
      const unsigned delta = direction < 0 ? limit - 1 : 1;   // -1 step == +(limit-1) mod limit
      state.diagnostic.scanIndex = (state.diagnostic.scanIndex + delta) % limit;
    }
  }
}

// Advance whichever diagnostic is active, given real elapsed time.
// Cadence: scanning moves every 80 ms (watchable yet readable); the topology
// walker runs continuously; the axes views are static. Performance is not
// handled here at all.
inline void update(State& state, double seconds, unsigned surfaceCells, unsigned physicalEmitters) {
  if (state.active == Kind::Performance || state.diagnostic.paused) return;
  if (!std::isfinite(seconds) || seconds <= 0) return;
  if (state.active == Kind::TopologyWalk) {
    state.diagnostic.walker.update(seconds);
    return;
  }
  if (state.active == Kind::SurfaceAxes || state.active == Kind::PanelAxes) return;
  state.diagnostic.accumulator += std::min(seconds, 0.25);   // same catch-up clip as the sequencer
  while (state.diagnostic.accumulator >= 0.08) {
    state.diagnostic.accumulator -= 0.08;
    step(state, surfaceCells, physicalEmitters);
  }
}

}