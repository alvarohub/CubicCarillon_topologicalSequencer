#pragma once

// =============================================================================
// cube_topology.hpp -- edge gluings for a cube (6 faces x 4 edges = 24 edges).
// =============================================================================
//
// PROBLEM THIS FIXES.
//   The naive "walk face 1 -> 2 -> 3 -> ..." wrap used before does not respect
//   the physical adjacency of a cube. A head circumnavigating one axis
//   should visit exactly 4 faces and return to start; naive wrap sends it
//   through all 6.
//
// SOURCE OF TRUTH.
//   These 24 entries are extracted from the working JS simulation
//   (`src/core/surface.js`, `buildCube(2)`). See
//   `experiments/geodesic-surfaces/dump_gluings.mjs` for the extractor. The
//   JS `Surface` computes them geometrically from the 3D embedding (edge-frame
//   isometry + interior test); we don't reinvent that here, we just port the
//   result.
//
// FACE CONVENTION (matches the JS FACE_SPECS, offset by 1 for C++).
//     F1 = +X    u = +Y   v = +Z
//     F2 = -X    u = +Z   v = +Y
//     F3 = +Y    u = +Z   v = +X
//     F4 = -Y    u = +X   v = +Z
//     F5 = +Z    u = +X   v = +Y
//     F6 = -Z    u = +Y   v = +X
//
//   Edges of each face are numbered:
//     0 = +u edge   (right, in local coords)
//     1 = +v edge   (top)
//     2 = -u edge   (left)
//     3 = -v edge   (bottom)
//
// COORDINATE MATH.
//   The JS uses continuous local coords x_cont, y_cont in [-1, +1] (halfU = 1).
//   We use integer cell indices k in {0, ..., N-1} with N = kFaceCells.
//   Bijection: c(k) = 2k + 1 - N       (so c is in {-(N-1), ..., +(N-1)})
//              k(c) = (c + N - 1) / 2
//              x_cont = c / N
//
//   The JS transition is  (x', y') = M (x, y) + t   with M a 2x2 signed
//   permutation and t in {-2, 0, +2} on each coord. In our integer-c units
//   the exit edge sits at c = +/- N and the same M/t apply (with t scaled by N).
//
// NB.  This module concerns the LOGICAL cube topology only. Physical LED
//   strip wiring (which face-id lives where on the chain, and which axis is
//   +X etc.) is a separate mapping owned by LedMapper / cube_display_config.
//   If the wiring turns out to disagree with this labelling, we relabel
//   there, NOT here.
// =============================================================================

#include <stdint.h>

#include "cube_display_config.hpp"

namespace cube {

// One directed edge crossing.
//   toFace is the neighbour we land on (1..6).
//   (m11..m22) is a 2x2 signed permutation applied to velocity, and to the
//   cell-2x position vector.
//   (tX, tY) are the translation, in "halfU = 1" units, i.e. each is
//   -2, 0, or +2. Multiply by N to get the offset in cell-2x units.
struct CubeEdge {
  uint8_t toFace;
  int8_t  m11, m12;
  int8_t  m21, m22;
  int8_t  tX, tY;
};

// [fromFace-1][fromEdge] -> gluing.
// Dumped from src/core/surface.js buildCube(2) -- do not edit by hand.
inline constexpr CubeEdge kCubeGluings[6][4] = {
  // ---- Face 1 (+X) ----
  {{3,  0,  1, -1,  0,   0, +2},  // e0(+u) -> F3 e1
   {5,  0, -1,  1,  0,  +2,  0},  // e1(+v) -> F5 e0
   {4,  1,  0,  0,  1,  +2,  0},  // e2(-u) -> F4 e0
   {6,  1,  0,  0,  1,   0, +2}}, // e3(-v) -> F6 e1
  // ---- Face 2 (-X) ----
  {{5,  1,  0,  0,  1,  -2,  0},  // e0(+u) -> F5 e2
   {3,  1,  0,  0,  1,   0, -2},  // e1(+v) -> F3 e3
   {6,  0,  1, -1,  0,   0, -2},  // e2(-u) -> F6 e3
   {4,  0, -1,  1,  0,  -2,  0}}, // e3(-v) -> F4 e2
  // ---- Face 3 (+Y) ----
  {{5,  0,  1, -1,  0,   0, +2},  // e0(+u) -> F5 e1
   {1,  0, -1,  1,  0,  +2,  0},  // e1(+v) -> F1 e0
   {6,  1,  0,  0,  1,  +2,  0},  // e2(-u) -> F6 e0
   {2,  1,  0,  0,  1,   0, +2}}, // e3(-v) -> F2 e1
  // ---- Face 4 (-Y) ----
  {{1,  1,  0,  0,  1,  -2,  0},  // e0(+u) -> F1 e2
   {5,  1,  0,  0,  1,   0, -2},  // e1(+v) -> F5 e3
   {2,  0,  1, -1,  0,   0, -2},  // e2(-u) -> F2 e3
   {6,  0, -1,  1,  0,  -2,  0}}, // e3(-v) -> F6 e2
  // ---- Face 5 (+Z) ----
  {{1,  0,  1, -1,  0,   0, +2},  // e0(+u) -> F1 e1
   {3,  0, -1,  1,  0,  +2,  0},  // e1(+v) -> F3 e0
   {2,  1,  0,  0,  1,  +2,  0},  // e2(-u) -> F2 e0
   {4,  1,  0,  0,  1,   0, +2}}, // e3(-v) -> F4 e1
  // ---- Face 6 (-Z) ----
  {{3,  1,  0,  0,  1,  -2,  0},  // e0(+u) -> F3 e2
   {1,  1,  0,  0,  1,   0, -2},  // e1(+v) -> F1 e3
   {4,  0,  1, -1,  0,   0, -2},  // e2(-u) -> F4 e3
   {2,  0, -1,  1,  0,  -2,  0}}, // e3(-v) -> F2 e2
};

// Minimal head pose used by crossEdge. HeadState has more members; both
// call sites (HeadEngine::step and Diag::advanceTest) copy the five fields
// they care about into this struct before/after the call.
struct HeadPose {
  uint8_t face;     // 1..6
  uint8_t x, y;     // 0..N-1
  int8_t  dx, dy;   // -1, 0, or +1
};

// Cross the edge that motion just went past. Requires that (x + dx, y + dy)
// exactly overshoots one face edge (which is what axis-aligned integer motion
// produces at every wrap). Mutates `h` to its post-crossing state on the
// neighbour face.
//
// After returning:
//   * h.face is the neighbour face id (1..6).
//   * (h.x, h.y) is the cell just inside the shared edge on that face.
//   * (h.dx, h.dy) is the velocity re-expressed in the neighbour's local frame,
//     so motion continues "straight" in the geodesic (unfolded) sense.
inline void crossEdge(HeadPose& h, uint8_t edge) {
  const CubeEdge& g = kCubeGluings[h.face - 1][edge];
  const int N = kFaceCells;

  // 1. Convert (x, y) into "cell-2x" continuous coords: c(k) = 2k + 1 - N.
  //    These live in [-(N-1), +(N-1)] for cells 0..N-1, and equal +/-N at
  //    the exit edge we just crossed. Snap the crossing coord to the edge.
  int cxA = 2 * static_cast<int>(h.x) + 1 - N;
  int cyA = 2 * static_cast<int>(h.y) + 1 - N;
  switch (edge) {
    case 0: cxA = +N; break;    // exit through +u edge
    case 1: cyA = +N; break;    // exit through +v edge
    case 2: cxA = -N; break;    // exit through -u edge
    case 3: cyA = -N; break;    // exit through -v edge
  }

  // 2. Apply M and t. Because t is in "halfU = 1" units (values -2, 0, +2)
  //    and c is in units of 1/N of halfU, the translation contributes t * N
  //    in c-units.
  int cxB = g.m11 * cxA + g.m12 * cyA + static_cast<int>(g.tX) * N;
  int cyB = g.m21 * cxA + g.m22 * cyA + static_cast<int>(g.tY) * N;

  // 3. Clip the entering coord back into the interior of face B (the row
  //    or column adjacent to the shared edge -- we just crossed into it).
  const int inner = N - 1;
  if (cxB >  inner) cxB =  inner;
  if (cxB < -inner) cxB = -inner;
  if (cyB >  inner) cyB =  inner;
  if (cyB < -inner) cyB = -inner;

  // 4. Convert back to integer cells.
  h.x = static_cast<uint8_t>((cxB + N - 1) / 2);
  h.y = static_cast<uint8_t>((cyB + N - 1) / 2);

  // 5. Apply M to velocity. Signed permutation preserves +/-1.
  const int8_t ndx = static_cast<int8_t>(g.m11 * h.dx + g.m12 * h.dy);
  const int8_t ndy = static_cast<int8_t>(g.m21 * h.dx + g.m22 * h.dy);
  h.dx   = ndx;
  h.dy   = ndy;
  h.face = g.toFace;
}

}  // namespace cube
