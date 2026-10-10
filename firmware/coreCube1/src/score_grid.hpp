#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include <array>

#include "config.hpp"

namespace cube {

class ScoreGrid {
 public:
  ScoreGrid() { clear(); }

  void clear() { cells_.fill(0); }

  void set(const uint8_t face, const uint8_t x, const uint8_t y, const float velocity01) {
    if (!validFace(face) || !validCoord(x, y)) return;
    const float v = velocity01 < 0.05f ? 0.0f : (velocity01 > 1.0f ? 1.0f : velocity01);
    cells_[faceLinearIndex(face, x, y)] = v <= 0.0f ? 0 : (uint8_t)roundf(v * 255.0f);
  }

  float velocity01(const uint8_t face, const uint8_t x, const uint8_t y) const {
    if (!validFace(face) || !validCoord(x, y)) return 0.0f;
    return (float)cells_[faceLinearIndex(face, x, y)] / 255.0f;
  }

  bool armed(const uint8_t face, const uint8_t x, const uint8_t y, float* outVel = nullptr) const {
    const float v = velocity01(face, x, y);
    if (outVel) *outVel = v;
    return v > 0.0f;
  }

  uint16_t armedCount() const {
    uint16_t c = 0;
    for (const uint8_t v : cells_)
      if (v) c++;
    return c;
  }

  void randomize(float density, float vMin, float vMax) {
    density = density < 0.0f ? 0.0f : (density > 1.0f ? 1.0f : density);
    vMin = vMin < 0.05f ? 0.05f : (vMin > 1.0f ? 1.0f : vMin);
    vMax = vMax < vMin ? vMin : (vMax > 1.0f ? 1.0f : vMax);

    clear();
    for (uint8_t face = 1; face <= kFaceCount; ++face) {
      for (uint8_t y = 0; y < kFaceCells; ++y) {
        for (uint8_t x = 0; x < kFaceCells; ++x) {
          const float r = (float)random(0, 10000) / 10000.0f;
          if (r < density) {
            const float vel = vMin + ((float)random(0, 10000) / 10000.0f) * (vMax - vMin);
            set(face, x, y, vel);
          }
        }
      }
    }
  }

  void toJson(JsonObject obj) const {
    for (uint8_t face = 1; face <= kFaceCount; ++face) {
      for (uint8_t y = 0; y < kFaceCells; ++y) {
        for (uint8_t x = 0; x < kFaceCells; ++x) {
          const uint8_t raw = cells_[faceLinearIndex(face, x, y)];
          if (!raw) continue;
          const String key = String(face) + ":" + String(x) + ":" + String(y);
          obj[key] = (float)raw / 255.0f;
        }
      }
    }
  }

  void fromJson(JsonObjectConst scoreObj) {
    clear();
    for (JsonPairConst kv : scoreObj) {
      uint8_t face = 0, x = 0, y = 0;
      if (!parseKey(kv.key().c_str(), face, x, y)) continue;
      set(face, x, y, kv.value().as<float>());
    }
  }

  const std::array<uint8_t, kTotalLeds>& raw() const { return cells_; }

  void fromRaw(const uint8_t* bytes, const size_t len) {
    if (!bytes || len != kTotalLeds) return;
    for (size_t i = 0; i < kTotalLeds; i++) cells_[i] = bytes[i];
  }

 private:
  static bool parseKey(const String& key, uint8_t& face, uint8_t& x, uint8_t& y) {
    const int p0 = key.indexOf(':');
    if (p0 < 0) return false;
    const int p1 = key.indexOf(':', p0 + 1);
    if (p1 < 0) return false;
    const int f = key.substring(0, p0).toInt();
    const int i = key.substring(p0 + 1, p1).toInt();
    const int j = key.substring(p1 + 1).toInt();
    if (f < 1 || f > kFaceCount || i < 0 || i >= kFaceCells || j < 0 || j >= kFaceCells) return false;
    face = (uint8_t)f;
    x = (uint8_t)i;
    y = (uint8_t)j;
    return true;
  }

  std::array<uint8_t, kTotalLeds> cells_{};
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Score:: -- singleton alias for the one score grid.
// -----------------------------------------------------------------------------
namespace Score {
  extern cube::ScoreGrid grid;
}
