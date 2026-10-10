#pragma once

namespace cube {

struct TransportState {
  float bpm = 120.0f;
  bool paused = true;
  bool stepMode = true;
  bool railed = true;
  float gravity = 0.0f;
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Transport:: -- singleton alias for the one transport state in the program.
// Defined in singletons.cpp. Read/written directly by any module that needs it.
// -----------------------------------------------------------------------------
namespace Transport {
  extern cube::TransportState state;
}
