#pragma once

#include <math.h>

#include <M5Unified.h>

namespace cube {

class ToneSynth {
 public:
  void begin() {
    M5.Speaker.begin();
    M5.Speaker.setVolume(96);
  }

  void triggerCell(const uint8_t face, const uint8_t x, const uint8_t y, const float velocity01) {
    // Pentatonic base so even random patterns sound musical.
    static const int8_t scale[5] = {0, 3, 5, 7, 10};
    const int level = y;
    const int midi = 48 + scale[level % 5] + 12 * (level / 5) + ((face - 1) % 3) * 2 + (x % 2);
    const float freq = 440.0f * powf(2.0f, (float)(midi - 69) / 12.0f);
    const uint32_t durMs = (uint32_t)(40 + velocity01 * 70.0f);
    M5.Speaker.tone((uint16_t)freq, durMs);
  }
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Audio:: -- singleton alias for the tone synth.
// -----------------------------------------------------------------------------
namespace Audio {
  extern cube::ToneSynth synth;
}
