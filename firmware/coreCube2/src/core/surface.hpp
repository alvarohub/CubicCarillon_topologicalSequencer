#pragma once

// ===========================================================================
// surface.hpp — flat surfaces with glued edges (the "world" readers live in)
// ===========================================================================
//
// WHAT THIS FILE IS
//   A surface is modelled as an ATLAS: a set of flat square charts ("faces")
//   glued along their edges. A reader travels in a straight line inside a
//   chart; when it reaches an edge, the stored edge transition rewrites both
//   its position and its heading onto the neighbouring chart. A walk that
//   appears to bend or wrap around the cube is simply a straight line in this
//   glued coordinate picture.
//
// COORDINATES
//   * One chart is `side` x `side` CELLS (8 x 8 for the cube).
//   * x and y run 0..side, in cell units: cell (i,j) covers [i, i+1] x
//     [j, j+1] and its centre sits at (i+0.5, j+0.5). A coordinate exactly on
//     a grid line counts as the cell AHEAD in the direction of travel (see
//     forwardIndex below) — the convention that keeps event times and score
//     hits exactly aligned with edge crossings.
//   * Face numbering matches the web app: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z.
//
// WHY THE C++ STANDARD LIBRARY?
//   Everything under src/core/ also compiles on a normal PC (the native unit
//   tests), so no Arduino types may appear here. This file uses only:
//     <cstdint> — fixed-width integers (uint8_t ...), same size on both
//                 toolchains;
//     <array>   — fixed-size containers that never allocate — exactly what an
//                 MCU wants, no heap fragmentation;
//     <cmath>   — isfinite / hypot / round / floor used below.
//   All three are plain C++ and fully available in the Arduino toolchain.
//
// MEMORY
//   A Surface describes itself in a few hundred bytes. The large fixed arrays
//   (score, presentation frame) are sized elsewhere by `maxCells`.
// ===========================================================================

#include <array>
#include <cmath>
#include <cstdint>

namespace topo {

// Compile-time limits. The fixed per-cell arrays are sized for the LARGEST
// supported surface (maxCells), so every geometry fits without any heap use.
// The cube occupies 6 * 8 * 8 = 384 of the 2048 possible cells.
constexpr unsigned maxFaces = 8;                              // charts per surface
constexpr unsigned maxSide = 16;                              // cells per chart edge
constexpr unsigned maxCells = maxFaces * maxSide * maxSide;   // worst-case cell count

// Geometric tolerance: distances below this count as "on the point". Far above
// double rounding noise, far below any real cell dimension (which is 1.0).
constexpr double tolerance = 1e-9;

// Pi spelled out (so its digits are visible) for degree -> radian conversions
// in the sequencer and the USB parser.
constexpr double pi = 3.14159265358979323846;

// One edge of a chart: the affine map that continues a geodesic across this
// boundary onto the neighbouring face. Cube gluings are rigid motions of the
// plane — a signed permutation of the axes plus a translation — so four
// matrix entries and two offsets are enough:
//
//   position: x' = xx*x + xy*y + tx       y' = yx*x + yy*y + ty
//   heading:  dx' = xx*dx + xy*dy         dy' = yx*dx + yy*dy   (no offset)
//
// The same matrix acting on positions and directions is what keeps the
// unfolded path straight. Edge order within a face is
//   0 = +x side, 1 = +y side, 2 = -x side, 3 = -y side.
struct Edge {
  uint8_t face = 0;              // neighbour face reached across this boundary
  int8_t xx = 1, xy = 0;         // first row of the matrix (entries -1, 0, +1)
  int8_t yx = 0, yy = 1;         // second row of the matrix
  double tx = 0, ty = 0;         // translation, in cell units (0..side space)
};

// Where a reader is and where it is going, with full (double) precision:
// x, y are cell units inside `face` (0..side); dx, dy are the unit heading.
// addSequence() snapshots a copy of this as the reader's 'home'.
struct Pose {
  uint8_t face = 0;
  double x = 0.5, y = 0.5;       // position inside the face, in cell units
  double dx = 1, dy = 0;         // unit direction (normalized in addSequence)
};

// An integer tile address: which cell a pose belongs to. Used for the score,
// for events, and for display. A Cell says nothing about where inside the
// tile the reader really is — that is what Pose is for.
struct Cell {
  uint8_t face = 0, x = 0, y = 0;
  bool operator==(const Cell& other) const {
    return face == other.face && x == other.x && y == other.y;
  }
};

// The complete description of a surface. Consumed by the sequencer (motion,
// events) and by the display layer (cell addressing). Construct one with
// cubeSurface() or torusSurface() rather than filling it by hand.
struct Surface {
  uint8_t faceCount = 0;         // 0 = uninitialized/invalid; callers check
  uint8_t side = 8;              // cells per chart edge (all charts square)
  bool periodicCorners = false;  // true on the torus: corners are smooth;
                                 // false on the cube: a corner is a cone
                                 // point where continuation is ambiguous
  std::array<std::array<Edge, 4>, maxFaces> edges{};   // [face][edgeIndex]

  // Is this a cell of this surface? (Bounds check for score/display access.)
  bool valid(Cell cell) const {
    return cell.face < faceCount && cell.x < side && cell.y < side;
  }

  // Flat index of a cell in per-cell arrays (score, frames). Layout is
  // face -> row(y) -> column(x): (face*side + y)*side + x. The saved-session
  // format stores its score in exactly this order (see session_codec.hpp).
  unsigned index(Cell cell) const {
    return (cell.face * side + cell.y) * side + cell.x;
  }

  unsigned cellCount() const { return faceCount * side * side; }

  // Full check for a reader START pose (used by Sequencer::addSequence):
  // the surface itself must be sane, the face valid, x/y finite and strictly
  // inside the chart (never on an edge — the crossing logic assumes interior),
  // and the heading finite with non-zero length.
  bool validStart(const Pose& pose) const {
    return faceCount > 0 && faceCount <= maxFaces && side > 0 && side <= maxSide &&
           pose.face < faceCount && std::isfinite(pose.x) && std::isfinite(pose.y) &&
           pose.x > 0 && pose.x < side && pose.y > 0 && pose.y < side &&
           std::isfinite(pose.dx) && std::isfinite(pose.dy) &&
           std::hypot(pose.dx, pose.dy) > tolerance;
  }

  // Which cell does `coordinate` belong to, given the direction of travel?
  // On an exact grid line the answer depends on where the reader is heading:
  // a point at x=3.0 moving +x counts as cell 3 (it has just entered it),
  // while moving -x it counts as cell 2. This single convention aligns event
  // times and score hits exactly with the moment of an edge crossing.
  static int forwardIndex(double coordinate, double direction) {
    const double nearest = std::round(coordinate);
    if (std::abs(coordinate - nearest) < tolerance) {
      return static_cast<int>(nearest) - (direction < 0 ? 1 : 0);
    }
    return static_cast<int>(std::floor(coordinate));
  }

  // The cell a pose currently belongs to (events, display). Clamped into the
  // chart: a pose sitting exactly on the outer boundary (transiently true
  // during a crossing) must report the last cell, not one past the edge.
  Cell cellAt(const Pose& pose) const {
    int column = forwardIndex(pose.x, pose.dx);
    int row = forwardIndex(pose.y, pose.dy);
    column = column < 0 ? 0 : (column >= side ? side - 1 : column);
    row = row < 0 ? 0 : (row >= side ? side - 1 : row);
    return {pose.face, static_cast<uint8_t>(column), static_cast<uint8_t>(row)};
  }

  // Continue a pose across boundary `edgeIndex` (0=+x 1=+y 2=-x 3=-y) of its
  // current face, applying the stored transition. Position and direction are
  // read into locals first: the writes below would otherwise clobber values
  // that are still needed.
  void cross(Pose& pose, unsigned edgeIndex) const {
    const Edge edge = edges[pose.face][edgeIndex];
    const double oldX = pose.x, oldDx = pose.dx;
    pose.x = edge.xx * oldX + edge.xy * pose.y + edge.tx;
    pose.y = edge.yx * oldX + edge.yy * pose.y + edge.ty;
    pose.dx = edge.xx * oldDx + edge.xy * pose.dy;
    pose.dy = edge.yx * oldDx + edge.yy * pose.dy;
    pose.face = edge.face;
  }
};

// ---------------------------------------------------------------------------
// cubeSurface()
//   The 8x8 cube: 6 faces, 4 transitions each. The numbers below were
//   extracted once from the geometry-derived JavaScript implementation
//   (repo src/core/surface.js, buildCube) and are verified against it on every
//   test run by test/conformance.mjs — they are data, not derived here.
//
//   Table entry: { toFace, xx, xy, yx, yy, tx, ty }
//   where tx/ty use the JavaScript convention (its chart spans -1..+1, so one
//   chart edge is 2 units). The expression below converts them into our cell
//   coordinates (chart spans 0..side): substituting u = side/2 * (x_js + 1)
//   into x' = M*x + t gives u' = M*u + side/2 * (t + 1 - rowSum(M)).
//
//   An invalid `side` returns a default-constructed Surface (faceCount 0);
//   callers must check faceCount before using it.
// ---------------------------------------------------------------------------
inline Surface cubeSurface(uint8_t side = 8) {
  const int8_t gluings[6][4][7] = {
    {{2,0,1,-1,0,0,2}, {4,0,-1,1,0,2,0}, {3,1,0,0,1,2,0}, {5,1,0,0,1,0,2}},
    {{4,1,0,0,1,-2,0}, {2,1,0,0,1,0,-2}, {5,0,1,-1,0,0,-2}, {3,0,-1,1,0,-2,0}},
    {{4,0,1,-1,0,0,2}, {0,0,-1,1,0,2,0}, {5,1,0,0,1,2,0}, {1,1,0,0,1,0,2}},
    {{0,1,0,0,1,-2,0}, {4,1,0,0,1,0,-2}, {1,0,1,-1,0,0,-2}, {5,0,-1,1,0,-2,0}},
    {{0,0,1,-1,0,0,2}, {2,0,-1,1,0,2,0}, {1,1,0,0,1,2,0}, {3,1,0,0,1,0,2}},
    {{2,1,0,0,1,-2,0}, {0,1,0,0,1,0,-2}, {3,0,1,-1,0,0,-2}, {1,0,-1,1,0,-2,0}}
  };
  Surface surface;
  if (side == 0 || side > maxSide) return surface;
  surface.faceCount = 6;
  surface.side = side;
  for (unsigned face = 0; face < 6; ++face) {
    for (unsigned edgeIndex = 0; edgeIndex < 4; ++edgeIndex) {
      const auto& source = gluings[face][edgeIndex];
      surface.edges[face][edgeIndex] = {
        static_cast<uint8_t>(source[0]), source[1], source[2], source[3], source[4],
        side * 0.5 * (1 - source[1] - source[2] + source[5]),
        side * 0.5 * (1 - source[3] - source[4] + source[6])
      };
    }
  }
  return surface;
}

// ---------------------------------------------------------------------------
// torusSurface()
//   A flat torus: one chart whose four sides wrap around to itself. Used by
//   the tests to prove the core is not cube-specific — the same Pose math and
//   crossing machinery run unchanged. Its identified corners are smooth
//   (periodicCorners = true), unlike the cube's conical corners.
// ---------------------------------------------------------------------------
inline Surface torusSurface(uint8_t side = 8) {
  Surface surface;
  if (side == 0 || side > maxSide) return surface;
  surface.faceCount = 1;
  surface.side = side;
  surface.periodicCorners = true;
  surface.edges[0] = {{{0,1,0,0,1,-double(side),0}, {0,1,0,0,1,0,-double(side)},
                       {0,1,0,0,1,double(side),0}, {0,1,0,0,1,0,double(side)}}};
  return surface;
}

}