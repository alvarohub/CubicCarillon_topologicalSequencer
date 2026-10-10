#pragma once

#include "display_manager.hpp"
#include "head_engine.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"

namespace cube {

class LedRenderer {
 public:
  LedRenderer(uint8_t pin, uint8_t brightness);

  void begin();
  void setBrightness(uint8_t brightness);

  LedMapper& mapper();

  void render(const ScoreGrid& score, const HeadEngine& heads, const TransportState& tr, uint32_t nowMs);
  void scanRaw(uint16_t index, uint8_t r = 255, uint8_t g = 255, uint8_t b = 255);
  void scanMapped(uint8_t face, uint8_t x, uint8_t y, uint8_t r = 255, uint8_t g = 0, uint8_t b = 255);

 private:
  DisplayManager display_;
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Leds:: -- singleton alias for the LED renderer.
// -----------------------------------------------------------------------------
namespace Leds {
  extern cube::LedRenderer renderer;
}
