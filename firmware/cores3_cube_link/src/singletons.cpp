// =============================================================================
// singletons.cpp -- one-and-only instances of every subsystem's shared class.
// =============================================================================
//
// Every header in the project declares an `extern` singleton inside its own
// namespace (Transport::state, Score::grid, Heads::engine, ...). Those are
// promises. This file is where the promises are kept: each instance is
// defined here, exactly once, in this translation unit.
//
// IMPORTANT: within one .cpp file, C++ guarantees initialization order
// follows declaration order. That is why we define them here in one file --
// so subsystems that reference each other in their constructors (Osc needs
// Transport/Score/Store; Web needs Osc) are guaranteed to be built in the
// right order. This is a well-known trick to avoid the "static initialization
// order fiasco" that can happen when singletons live in separate .cpps.
// =============================================================================

#include "config.hpp"
#include "head_engine.hpp"
#include "led_renderer.hpp"
#include "osc_handler.hpp"
#include "preset_store.hpp"
#include "score_grid.hpp"
#include "tone_synth.hpp"
#include "transport_state.hpp"
#include "web_interface.hpp"

// ----- Domain state (no dependencies) ----------------------------------------
namespace Transport { cube::TransportState state;   }
namespace Score     { cube::ScoreGrid      grid;    }
namespace Heads     { cube::HeadEngine     engine;  }
namespace Audio     { cube::ToneSynth      synth;   }
namespace Store     { cube::PresetStore    instance; }

// ----- Output devices (need config constants) --------------------------------
namespace Leds { cube::LedRenderer renderer(cube::kLedPin, cube::kLedBrightness); }

// ----- Network stack (Osc depends on Transport+Score+Store, Web on Osc) ------
// Declared LAST in the file so their constructors see fully-initialised deps.
namespace Osc { cube::OSCHandler   handler(Transport::state, Score::grid, Store::instance); }
namespace Web { cube::WebInterface server(Osc::handler); }
