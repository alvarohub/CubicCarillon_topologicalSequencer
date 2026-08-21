#pragma once

#include <stdint.h>

#ifndef CUBE_DISPLAY_FACE_COUNT
#define CUBE_DISPLAY_FACE_COUNT 6
#endif

#ifndef CUBE_DISPLAY_FACE_CELLS
#define CUBE_DISPLAY_FACE_CELLS 8
#endif

#ifndef CUBE_NEOPIXEL_TYPE
// Same LED protocol used by SternWerk and LED_scoreboard.
#define CUBE_NEOPIXEL_TYPE (NEO_GRB + NEO_KHZ800)
#endif

#ifndef CUBE_MATRIX_LAYOUT
// Local rectangular chart wiring for each 8x8 face. This mirrors the
// LED_scoreboard pattern: draw in local orthogonal coordinates, let
// Adafruit_NeoMatrix compensate the physical row/column/zigzag wiring.
//
// Default: first pixel top-left, row-major, row-zigzag/serpentine. The six
// 8x8 charts are treated as one horizontal row in physical chain order.
//
// TODO(manifold-display): promote this from a single global layout into a
// per-Chart property when different faces/surfaces use different matrix modules.
#define CUBE_MATRIX_LAYOUT                                                                            \
  (NEO_MATRIX_TOP + NEO_MATRIX_LEFT + NEO_MATRIX_ROWS + NEO_MATRIX_ZIGZAG + NEO_TILE_TOP +           \
   NEO_TILE_LEFT + NEO_TILE_ROWS + NEO_TILE_PROGRESSIVE)
#endif

namespace cube {

constexpr uint8_t kFaceCount = CUBE_DISPLAY_FACE_COUNT;
constexpr uint8_t kFaceCells = CUBE_DISPLAY_FACE_CELLS;
constexpr uint16_t kLedsPerFace = kFaceCells * kFaceCells;
constexpr uint16_t kTotalLeds = kFaceCount * kLedsPerFace;
constexpr uint8_t kFaceOrder[kFaceCount] = {1, 2, 3, 4, 5, 6};

inline bool validFace(const uint8_t face) { return face >= 1 && face <= kFaceCount; }

inline bool validCoord(const uint8_t x, const uint8_t y) { return x < kFaceCells && y < kFaceCells; }

inline uint16_t faceLinearIndex(const uint8_t face, const uint8_t x, const uint8_t y) {
  return (uint16_t)(face - 1) * kLedsPerFace + (uint16_t)y * kFaceCells + x;
}

}  // namespace cube
