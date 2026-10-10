#pragma once

// ===========================================================================
// presentation.hpp — paint instrument / diagnostic state into a color frame
// ===========================================================================
//
// WHAT IS A FRAME?
//   A frame is one complete picture of the whole surface at one instant: a
//   flat array of RGB colors addressed by topo::Surface::index(cell). The
//   display adapter (adapters/cores3.cpp) reads a frame and pushes it to the
//   LEDs — optionally translating every logical cell through the physical
//   panel mapping first.
//
// WHY IS THE FRAME SO BIG?
//   SurfaceFrame is sized for the LARGEST surface the core supports:
//   maxFaces * maxSide * maxSide = 8 * 16 * 16 = 2048 cells, i.e. 2048 * 3
//   bytes = 6 KB. The cube only fills the first 6 * 8 * 8 = 384 entries
//   (1.15 KB); entries beyond cellCount() are never touched. One fixed-size
//   buffer therefore serves every geometry, with no heap allocation. The
//   single instance is declared in main.cpp (Presentation::frame) so it lives
//   in static storage instead of on the ESP32's small task stacks.
//
// WHAT THIS FILE MAY DO
//   Reading only. Every function takes const references and never moves a
//   reader, picks a pitch or edits the score. Motion, bands and mute decisions
//   live in core/sequencer.hpp; this file just paints what they report.
//
// HOW THE PICTURE IS BUILT
//   draw() clears the frame, then paints exactly one of:
//     * axes + face numbers      (SurfaceAxes / PanelAxes calibration views)
//     * one moving scan dot      (SurfaceScan / PanelScan)
//     * the white walk-test dot  (TopologyWalk)
//     * score + reader heads     (Performance)
//   PanelAxes/PanelScan draw the SAME logical picture as their Surface
//   counterparts; they differ only in the display step, where the physical
//   panel mapping is bypassed (see Display::present's `nativePanels` argument
//   in devices.hpp / cores3.cpp).

#include "modes.hpp"

namespace Presentation {

// One RGB pixel, 0..255 per channel — exactly what the LED hardware stores.
struct Color {
  uint8_t red = 0, green = 0, blue = 0;
};

// Complete surface picture; see the explanation at the top of this file.
using SurfaceFrame = std::array<Color, topo::maxCells>;

// Color for reader number `index`, cycling through a 5-color palette. The
// palette exists so several readers are tellable apart at a glance; it does
// not encode anything musical.
inline Color readerColor(unsigned index) {
  constexpr Color palette[] = {
    {255, 70, 45},    // red-orange
    {30, 210, 120},   // green
    {40, 110, 255},   // blue
    {245, 190, 30},   // amber
    {230, 70, 160},   // pink
  };
  return palette[index % 5];
}

// ---------------------------------------------------------------------------
// axes()
//   Draw the calibration pattern on every face:
//     green  — the +x axis, i.e. the row y = 0
//     red    — the +y axis, i.e. the column x = 0
//     white  — the origin cell (0,0), where the two axes meet
//     grey   — the face number as a 3x5 pixel glyph
//
//   Face numbers are 1-based in the picture (face index 0 shows "1") to match
//   the photos of the assembled cube. Each glyph row is a 3-bit mask (bit 0 =
//   leftmost column). Glyph rows are drawn with the TOP row at HIGHER y,
//   because chart coordinates grow y-up while the matrix raster grows y-down.
//   Needs side >= 7 cells of room; smaller surfaces skip the digit and show
//   only the axes.
// ---------------------------------------------------------------------------
inline void axes(const topo::Surface& surface, SurfaceFrame& frame) {
  constexpr uint8_t digitGlyphs[8][5] = {
    {2,3,2,2,7}, {7,4,7,1,7}, {7,4,6,4,7}, {5,5,7,4,4},
    {7,1,7,4,7}, {7,1,7,5,7}, {7,4,4,4,4}, {7,5,7,5,7}
  };

  for (uint8_t face = 0; face < surface.faceCount; ++face) {
    for (uint8_t position = 0; position < surface.side; ++position) {
      frame[surface.index({face, position, 0})] = {0, 255, 0};
      frame[surface.index({face, 0, position})] = {255, 0, 0};
    }
    frame[surface.index({face, 0, 0})] = {255, 255, 255};

    // Digit occupies cells x = 3..5, y = 2..6 — only fits on side >= 7.
    if (surface.side < 7) continue;
    for (uint8_t row = 0; row < 5; ++row) {
      for (uint8_t column = 0; column < 3; ++column) {
        if (digitGlyphs[face][row] & (1u << column)) {
          const uint8_t x = static_cast<uint8_t>(column + 3);
          const uint8_t y = static_cast<uint8_t>(6 - row);   // top row at high y
          frame[surface.index({face, x, y})] = {85, 85, 85};
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// draw()
//   Paint one complete frame for the current mode. The frame is cleared first,
//   so every branch below is a complete description of the picture and no
//   stale pixels can survive a mode change. Called from the main loop, so it
//   must stay cheap (runs at ~40 Hz).
// ---------------------------------------------------------------------------
inline void draw(const topo::Sequencer& instrument, const Modes::State& mode, SurfaceFrame& frame) {
  frame.fill({});
  const topo::Surface& surface = instrument.surface();

  if (mode.active == Modes::Kind::SurfaceAxes || mode.active == Modes::Kind::PanelAxes) {
    // Calibration view — the same axes picture for both modes; the difference
    // is whether the display step maps cells through the panel table.
    axes(surface, frame);
  } else if (mode.active == Modes::Kind::SurfaceScan || mode.active == Modes::Kind::PanelScan) {
    // One grey pixel travelling through the cells in index order.
    frame[mode.diagnostic.scanIndex % surface.cellCount()] = {160, 160, 160};
  } else if (mode.active == Modes::Kind::TopologyWalk) {
    // The independent walk-test reader, shown as a white dot.
    const auto& walker = mode.diagnostic.walker;
    if (walker.sequenceCount()) {
      frame[surface.index(surface.cellAt(walker.sequence(0).pose))] = {255, 255, 255};
    }
  } else if (mode.active == Modes::Kind::Performance) {
    // Score first: grey at half velocity (0..127 -> 0..63, clearly dimmer than
    // any reader), one value per cell of the current surface.
    for (uint8_t face = 0; face < surface.faceCount; ++face) {
      for (uint8_t row = 0; row < surface.side; ++row) {
        for (uint8_t column = 0; column < surface.side; ++column) {
          const topo::Cell cell{face, column, row};
          const uint8_t velocity = instrument.velocity(cell);
          const uint8_t grey = static_cast<uint8_t>(velocity / 2);
          frame[surface.index(cell)] = {grey, grey, grey};
        }
      }
    }
    // Reader heads on top. Muted or stopped readers are dimmed, not hidden:
    // their position stays visible so a paused track can be found again.
    for (unsigned index = 0; index < instrument.sequenceCount(); ++index) {
      const topo::Sequence& reader = instrument.sequence(index);
      Color color = readerColor(index);
      if (reader.muted || !reader.running) {
        color.red /= 8;
        color.green /= 8;
        color.blue /= 8;
      }
      frame[surface.index(surface.cellAt(reader.pose))] = color;
    }
  }
}

}