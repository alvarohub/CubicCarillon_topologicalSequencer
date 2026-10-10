#pragma once

#include <array>

#include "config.hpp"
#include "cube_topology.hpp"
#include "score_grid.hpp"
#include "tone_synth.hpp"
#include "transport_state.hpp"

namespace cube {

struct HeadState {
  uint8_t face = 1;
  uint8_t x = 0;
  uint8_t y = 0;
  int8_t dx = 1;
  int8_t dy = 0;
  float rate = 1.0f;  // cells per beat multiplier
  float accumSec = 0.0f;
  uint8_t r = 40;
  uint8_t g = 210;
  uint8_t b = 255;
};

class HeadEngine {
 public:
  static constexpr size_t kHeadCount = 8;

  HeadEngine() { initDefaults(); }

  void initDefaults() {
    auto mk = [](uint8_t face, uint8_t x, uint8_t y, int8_t dx, int8_t dy, float rate, uint8_t r, uint8_t g,
                 uint8_t b) {
      HeadState h;
      h.face = face;
      h.x = x;
      h.y = y;
      h.dx = dx;
      h.dy = dy;
      h.rate = rate;
      h.accumSec = 0.0f;
      h.r = r;
      h.g = g;
      h.b = b;
      return h;
    };

    // 4 horizontal heads
    heads_[0] = mk(1, 0, 0, 1, 0, 1.00f, 255, 80, 80);
    heads_[1] = mk(1, 0, 2, 1, 0, 0.75f, 255, 130, 70);
    heads_[2] = mk(1, 0, 4, 1, 0, 1.25f, 255, 170, 70);
    heads_[3] = mk(1, 0, 6, 1, 0, 0.50f, 255, 220, 70);

    // 4 vertical heads
    heads_[4] = mk(4, 0, 0, 0, 1, 1.00f, 70, 180, 255);
    heads_[5] = mk(4, 2, 0, 0, 1, 0.66f, 70, 210, 255);
    heads_[6] = mk(4, 4, 0, 0, 1, 1.33f, 90, 230, 255);
    heads_[7] = mk(4, 6, 0, 0, 1, 0.80f, 120, 245, 255);
  }

  void update(const float dtSec, const TransportState& tr, const ScoreGrid& score, ToneSynth& synth) {
    if (tr.paused) return;

    const float bpm = tr.bpm < 20.0f ? 20.0f : (tr.bpm > 400.0f ? 400.0f : tr.bpm);
    for (auto& h : heads_) {
      const float periodSec = 60.0f / (bpm * (h.rate <= 0.01f ? 0.01f : h.rate));
      h.accumSec += dtSec;

      uint8_t guard = 0;
      while (h.accumSec >= periodSec && guard++ < 12) {
        h.accumSec -= periodSec;
        step(h);
        float vel = 0.0f;
        if (score.armed(h.face, h.x, h.y, &vel)) {
          synth.triggerCell(h.face, h.x, h.y, vel);
        }
      }
    }
  }

  const std::array<HeadState, kHeadCount>& heads() const { return heads_; }

 private:
  // One integer step, using the proper cube topology (see cube_topology.hpp).
  // Motion is axis-aligned (dx*dy == 0), so at most ONE edge can be crossed
  // per step. If we crossed one, apply the gluing; otherwise just advance.
  static void step(HeadState& h) {
    const int nx = static_cast<int>(h.x) + h.dx;
    const int ny = static_cast<int>(h.y) + h.dy;

    int edge = -1;
    if      (h.dx > 0 && nx >= kFaceCells) edge = 0;   // +u
    else if (h.dx < 0 && nx <  0)          edge = 2;   // -u
    else if (h.dy > 0 && ny >= kFaceCells) edge = 1;   // +v
    else if (h.dy < 0 && ny <  0)          edge = 3;   // -v

    if (edge < 0) {
      // Interior step -- nothing to do topologically.
      h.x = static_cast<uint8_t>(nx);
      h.y = static_cast<uint8_t>(ny);
      return;
    }

    // Cross the shared edge into the neighbour face; copy state in/out.
    HeadPose p{h.face, h.x, h.y, h.dx, h.dy};
    crossEdge(p, static_cast<uint8_t>(edge));
    h.face = p.face;
    h.x    = p.x;
    h.y    = p.y;
    h.dx   = p.dx;
    h.dy   = p.dy;
  }

  std::array<HeadState, kHeadCount> heads_{};
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Heads:: -- singleton alias for the moving read-heads.
// -----------------------------------------------------------------------------
namespace Heads {
  extern cube::HeadEngine engine;
}
