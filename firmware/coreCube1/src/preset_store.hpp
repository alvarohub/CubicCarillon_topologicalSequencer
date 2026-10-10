#pragma once

#include <Preferences.h>

#include "config.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"

namespace cube {

class PresetStore {
 public:
  void begin() { prefs_.begin("cubecarillon", false); }

  void load(TransportState& tr, ScoreGrid& score) {
    tr.bpm = prefs_.getFloat("bpm", tr.bpm);
    tr.paused = prefs_.getBool("paused", tr.paused);
    tr.stepMode = prefs_.getBool("step", tr.stepMode);
    tr.railed = prefs_.getBool("railed", tr.railed);
    tr.gravity = prefs_.getFloat("gravity", tr.gravity);

    uint8_t buf[kTotalLeds];
    const size_t n = prefs_.getBytes("score", buf, kTotalLeds);
    if (n == kTotalLeds) score.fromRaw(buf, n);
  }

  void markDirty() { dirty_ = true; }

  void autosaveIfDue(const unsigned long nowMs, const TransportState& tr, const ScoreGrid& score) {
    if (!dirty_) return;
    if (nowMs - lastSaveMs_ < 1500) return;
    save(tr, score);
    dirty_ = false;
    lastSaveMs_ = nowMs;
  }

 private:
  void save(const TransportState& tr, const ScoreGrid& score) {
    prefs_.putFloat("bpm", tr.bpm);
    prefs_.putBool("paused", tr.paused);
    prefs_.putBool("step", tr.stepMode);
    prefs_.putBool("railed", tr.railed);
    prefs_.putFloat("gravity", tr.gravity);
    prefs_.putBytes("score", score.raw().data(), kTotalLeds);
  }

  Preferences prefs_;
  bool dirty_ = false;
  unsigned long lastSaveMs_ = 0;
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Store:: -- singleton alias for the NVS-backed preset store.
// -----------------------------------------------------------------------------
namespace Store {
  extern cube::PresetStore instance;
}
