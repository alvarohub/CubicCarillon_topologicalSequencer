#pragma once

// ===========================================================================
// demo.hpp — the default composition loaded at every boot
// ===========================================================================
//
// Three bands of eight parallel readers plus one independent oblique reader
// (25 total), then a deterministic random score. Nothing here is required by
// the core — it just gives the instrument something meaningful to show.
//
// Layout on the 8x8 cube:
//   * band readers start at x = 0.5 (just inside the left edge) on the home
//     faces { +Y, +Z, +X }, one per row (y = row + 0.5), all heading +x —
//     eight parallel geodesics per band, wrapping around the cube;
//   * each row uses its row number as the scale degree, so a band climbs its
//     scale as you look down the faces;
//   * the last reader is deliberately oblique: heading (1, 0.37) instead of
//     an axis. It belongs to no band and plays its own note at double speed —
//     the reminder that paths here need not be axis-aligned or closed.

#include "core/sequencer.hpp"

namespace Demo {

inline void load(topo::Sequencer& instrument) {
  instrument.reset(topo::cubeSurface());

  constexpr uint8_t homes[] = {2, 4, 0};     // start faces: +Y, +Z, +X
  constexpr uint8_t tonics[] = {60, 48, 72}; // C4, C3, C5 — one tonic per band

  for (unsigned group = 0; group < 3; ++group) {
    topo::Band band;
    band.tonic = tonics[group];
    const int bandId = instrument.addBand(band);

    for (unsigned row = 0; row < 8; ++row) {
      topo::Sequence reader;
      reader.pose = {homes[group], 0.5, row + 0.5, 1, 0};
      reader.band = static_cast<int8_t>(bandId);
      reader.degree = row;   // 0..7 climbs one octave up the pentatonic scale
      instrument.addSequence(reader);
    }
  }

  // The oblique specimen: non-axis heading, independent note, double speed.
  topo::Sequence oblique;
  oblique.pose = {4, 2.1, 3.2, 1, 0.37};
  oblique.note = 81;           // A5
  oblique.rate = 2;
  instrument.addSequence(oblique);

  instrument.randomize(20261010);   // fixed seed: every boot sounds the same
}

}