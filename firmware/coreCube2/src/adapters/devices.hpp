#pragma once

// ===========================================================================
// devices.hpp — the device adapter interfaces (what the board must provide)
// ===========================================================================
//
// The core (src/core/, presentation, commands, modes) is pure C++ and knows
// nothing about hardware. Everything hardware-shaped is declared here as
// plain free functions in namespaces, and implemented per board in one file:
//
//     src/adapters/cores3.cpp — the M5Stack CoreS3 implementation
//
// Why free functions instead of classes/interfaces? There is exactly one
// board per build, so virtual dispatch would only add indirection and vtable
// cost. To port the firmware, provide another .cpp defining the same names —
// main.cpp does not change.

#include "commands.hpp"
#include "presentation.hpp"

// Board lifecycle and clock. tick() returns REAL seconds since the previous
// call, computed wrap-safely from two 32-bit microsecond readings.
namespace Hardware { void begin(); double tick(); uint32_t nowMs(); }

// LED cube output. present() paints one complete frame; `nativePanels` skips
// the physical panel mapping (the PanelAxes / PanelScan diagnostics).
// showRaw() lights ONE emitter by raw chain index (RawChainScan wiring test).
namespace Display {
void begin();
void setBrightness(uint8_t value);
void present(const Presentation::SurfaceFrame& frame, const topo::Surface& surface, bool nativePanels);
void showRaw(unsigned index);
}

// Sound. play() is called once per Note event while running; silence() cuts
// any sounding output immediately (pause, clear, mute commands).
namespace Audio { void begin(); void play(const topo::Event& event); void silence(); }

// Physical UI: touch screen plus the three side buttons. poll() produces at
// most one command per call; draw() refreshes the status screen — call it
// rarely, the LCD is slow.
namespace Controls {
bool poll(const topo::Sequencer& instrument, const Modes::State& modes, Commands::Command& command);
void draw(const topo::Sequencer& instrument, const Modes::State& modes);
}

// Text protocol over USB serial. poll() reads a bounded chunk per call and
// returns at most one parsed command; reply() prints the OK/ERR line.
namespace Com {
bool poll(Commands::Command& command, const topo::Sequencer& instrument);
void reply(bool accepted);
}

// Session persistence (NVS flash). begin() opens the namespace; load() reads
// a stored session (false when none/invalid); markDirty() notes that the
// session changed; service() decides when a save is due — policy lives in
// store.cpp, not here.
namespace Store {
void begin();
bool load(topo::Sequencer& instrument);
void markDirty(uint32_t now);
void service(const topo::Sequencer& instrument, uint32_t now, bool suspended);
}