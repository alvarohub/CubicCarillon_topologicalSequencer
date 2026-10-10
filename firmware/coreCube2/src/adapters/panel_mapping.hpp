#pragma once

// ===========================================================================
// panel_mapping.hpp — logical cube face + cell -> physical LED matrix pixel
// ===========================================================================
//
// WHAT IT MAPS
//   The display works in "output matrix" coordinates: six 8x8 Neopixel panels
//   chained into one 48x8 matrix (see cores3.cpp). Each LOGICAL face of the
//   cube (0..5) sits on some physical panel, possibly rotated or mirrored,
//   depending on how the cube was assembled. This table is the ONLY place
//   that knows about that assembly; map() is the single translation step.
//
// THE TRANSFORM ORDER
//   For a given face, map() applies, in order:
//     1. flipX / flipY — mirror the cell inside the panel
//     2. `rotations`   — quarter turns; each maps (column,row) ->
//                        (side-1-row, column)
//     3. panel offset  — the face's panel slot in the chain
//
// STATUS: UNVERIFIED
//   `legacyUnverified` below is a straight copy of the values the original
//   firmware used; those were themselves never confirmed on the physical
//   cube. `calibrated` stays false so the LCD can say "Map unverified".
//   The PanelAxes / PanelScan diagnostics bypass this file entirely — they
//   are the intended way to MEASURE the real transforms (record which
//   physical panel shows which logical face/axes, then rewrite the table).

#include <array>
#include <cstdint>

namespace PanelMapping {

constexpr bool calibrated = false;  // see STATUS above
constexpr uint8_t side = 8;         // cells per panel edge
constexpr uint8_t panelCount = 6;   // panels in the chain
constexpr unsigned emitterCount = panelCount * side * side;   // 384 LEDs total

// One face's placement: which panel it lives on, how many quarter turns and
// which mirrors turn the logical axes into the panel's raster directions.
struct Transform {
  uint8_t panel;        // panel slot in the chain (0..5)
  uint8_t rotations;    // quarter turns, applied after the flips
  bool flipX, flipY;    // mirrors, applied first
};

// Copied from the original firmware — NOT a measurement (see STATUS above).
constexpr std::array<Transform, panelCount> legacyUnverified{{
  {0,1,false,true}, {1,0,false,true}, {2,0,false,true},
  {3,1,false,true}, {4,0,true,true}, {5,1,true,false}
}};

// Translate one logical cell (face, column, row) into output-matrix pixel
// coordinates. Returns false — and writes nothing — for out-of-range input.
inline bool map(uint8_t face, uint8_t column, uint8_t row, uint16_t& outputX, uint16_t& outputY) {
  if (face >= panelCount || column >= side || row >= side) return false;
  const auto transform = legacyUnverified[face];

  if (transform.flipX) column = side - 1 - column;
  if (transform.flipY) row = side - 1 - row;
  for (unsigned rotation = 0; rotation < transform.rotations; ++rotation) {
    const uint8_t previous = column;
    column = side - 1 - row;
    row = previous;
  }

  outputX = transform.panel * side + column;
  outputY = row;
  return true;
}

}