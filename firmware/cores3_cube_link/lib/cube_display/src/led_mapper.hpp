#pragma once

#include <array>

#include "cube_display_config.hpp"

namespace cube {

struct FaceTransform {
  uint8_t rotateCW = 0;
  bool flipX = false;
  bool flipY = false;
};

class LedMapper {
 public:
  LedMapper() {
    for (uint8_t face = 1; face <= kFaceCount; ++face) transforms_[face] = FaceTransform{};
  }

  void setTransform(const uint8_t face, const FaceTransform& t) {
    if (!validFace(face)) return;
    transforms_[face] = t;
  }

  int map(uint8_t face, uint8_t x, uint8_t y) const {
    uint16_t logicalX = 0;
    uint16_t logicalY = 0;
    if (!mapLogical(face, x, y, logicalX, logicalY)) return -1;
    return (int)((uint16_t)logicalY * (kFaceCells * kFaceCount) + logicalX);
  }

  bool mapLogical(uint8_t face, uint8_t x, uint8_t y, uint16_t& logicalX, uint16_t& logicalY) const {
    if (!validFace(face) || !validCoord(x, y)) return -1;

    applyTransform(x, y, transforms_[face]);
    const int chainPos = faceChainPos(face);
    if (chainPos < 0) return false;

    logicalX = (uint16_t)chainPos * kFaceCells + x;
    logicalY = y;
    return true;
  }

 private:
  static int faceChainPos(const uint8_t face) {
    for (int i = 0; i < kFaceCount; ++i)
      if (kFaceOrder[i] == face) return i;
    return -1;
  }

  static void applyTransform(uint8_t& x, uint8_t& y, const FaceTransform& t) {
    if (t.flipX) x = (uint8_t)(kFaceCells - 1 - x);
    if (t.flipY) y = (uint8_t)(kFaceCells - 1 - y);
    for (uint8_t k = 0; k < (t.rotateCW & 0x03); ++k) {
      const uint8_t oldX = x;
      x = (uint8_t)(kFaceCells - 1 - y);
      y = oldX;
    }
  }

  std::array<FaceTransform, kFaceCount + 1> transforms_{};
};

}  // namespace cube
