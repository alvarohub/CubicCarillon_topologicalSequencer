// core/surface.js
//
// A Euclidean (flat) surface with conical singularities, represented as an
// ATLAS: a set of flat polygonal faces (charts), each with a local 2D frame,
// glued along shared edges by isometries (the transition maps of the atlas).
//
// Geodesics on this surface are straight lines inside a face; crossing an edge
// applies the precomputed transition isometry to BOTH position and velocity, so
// the trajectory continues straight in the "unfolded" picture.
//
// All gluings are COMPUTED from the 3D embedding of the faces — nothing is
// hand-tuned. This means the same code works for any polyhedron, a flat torus,
// or arbitrary polygon unfoldings: only the face list changes.
//
// This module is pure: no DOM, no rendering, no audio. It is intended to port
// almost directly to C++ for a microcontroller.

// ---- tiny 3D helpers (plain arrays [x,y,z]) ----
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);

// ---- 2x2 matrix as {a,b,c,d} meaning [[a,b],[c,d]]; v' = M v ----
const mat2 = (a, b, c, d) => ({ a, b, c, d });
const matMul2 = (M, N) =>
  mat2(M.a * N.a + M.b * N.c, M.a * N.b + M.b * N.d, M.c * N.a + M.d * N.c, M.c * N.b + M.d * N.d);
// orthonormal columns [e1 | e2] -> matrix; its transpose is its inverse
const colsToMat2 = (e1, e2) => mat2(e1[0], e2[0], e1[1], e2[1]);
const transpose2 = (M) => mat2(M.a, M.c, M.b, M.d);
const apply2 = (M, v) => [M.a * v[0] + M.b * v[1], M.c * v[0] + M.d * v[1]];

const norm2 = (v) => {
  const n = Math.hypot(v[0], v[1]);
  return n < 1e-12 ? [0, 0] : [v[0] / n, v[1] / n];
};

const MATCH_EPS = 1e-6;

export class Surface {
  /**
   * @param {Array} faces  each: { id, name, size, C:[x,y,z], u:[x,y,z], v:[x,y,z] }
   *   - C is the face centre in 3D, u/v are orthonormal in-plane axes (unit).
   *   - local coords (x,y) range over [-size/2, size/2]; 3D point = C + x*u + y*v.
   */
  constructor(faces) {
    this.faces = faces;
    this._byId = new Map();
    for (const f of faces) {
      // outward normal (only needed by renderers / gravity projection)
      f.n = [f.u[1] * f.v[2] - f.u[2] * f.v[1], f.u[2] * f.v[0] - f.u[0] * f.v[2], f.u[0] * f.v[1] - f.u[1] * f.v[0]];
      f.edges = []; // filled by _buildGluings
      this._byId.set(f.id, f);
    }
    this._buildGluings();
  }

  faceById(id) {
    return this._byId.get(id);
  }

  // Re-shape the cuboid LIVE: each world axis has a division count (div.X/Y/Z);
  // every cell stays a UNIT SQUARE, so the box's extent along an axis grows with
  // that axis' count. The whole thing is normalised so the LONGEST side spans
  // `fit` (keeping it framed). Face objects are kept (so renderers' references
  // stay valid); only their sizes/centres and the gluings are recomputed.
  setDims(div = this.div, fit = this.fit ?? 2) {
    this.div = div; // shared reference (engine + UI mutate this)
    this.fit = fit;
    const r = applyCuboidDims(this.faces, div, fit);
    this.unit = r.unit; // physical size of one unit cell (square)
    this.dims = r.L; // { X, Y, Z } physical extents of the cuboid
    this._buildGluings();
    return this;
  }

  to3D(face, x, y) {
    return add3(add3(face.C, scl3(face.u, x)), scl3(face.v, y));
  }
  to2D(face, P) {
    const d = sub3(P, face.C);
    return [dot3(d, face.u), dot3(d, face.v)];
  }

  // Local 2D corner coordinates of edge `e` of a RECTANGULAR face (CCW winding),
  // given the face's half-extents along u (halfU) and v (halfV). Square faces are
  // just the halfU === halfV case.
  // Edge convention: 0=+u (right), 1=+v (top), 2=-u (left), 3=-v (bottom).
  static edgeCornersLocal(halfU, halfV) {
    return [
      [
        [halfU, -halfV],
        [halfU, halfV],
      ], // 0 +u
      [
        [halfU, halfV],
        [-halfU, halfV],
      ], // 1 +v
      [
        [-halfU, halfV],
        [-halfU, -halfV],
      ], // 2 -u
      [
        [-halfU, -halfV],
        [halfU, -halfV],
      ], // 3 -v
    ];
  }

  _buildGluings() {
    // Precompute, for every (face, edge), the two shared corners in 3D.
    const edge3D = []; // edge3D[faceIndex][edgeIndex] = [P0, P1]
    this.faces.forEach((f, fi) => {
      const cl = Surface.edgeCornersLocal(f.su / 2, f.sv / 2);
      edge3D[fi] = cl.map(([a, b]) => [this.to3D(f, a[0], a[1]), this.to3D(f, b[0], b[1])]);
    });

    const same = (P, Q) => len3(sub3(P, Q)) < MATCH_EPS;
    const edgesMatch = (e1, e2) =>
      (same(e1[0], e2[0]) && same(e1[1], e2[1])) || (same(e1[0], e2[1]) && same(e1[1], e2[0]));

    this.faces.forEach((A, ai) => {
      const half = Math.min(A.su, A.sv) / 2;
      for (let i = 0; i < 4; i++) {
        // find the adjacent face/edge sharing this 3D segment
        let B = null,
          bj = -1;
        outer: for (let bi = 0; bi < this.faces.length; bi++) {
          if (bi === ai) continue;
          for (let j = 0; j < 4; j++) {
            if (edgesMatch(edge3D[ai][i], edge3D[bi][j])) {
              B = this.faces[bi];
              bj = j;
              break outer;
            }
          }
        }
        if (!B) {
          A.edges[i] = null;
          continue;
        } // boundary edge (open surface)

        A.edges[i] = this._transition(A, i, B, bj, edge3D[ai][i], half);
      }
    });
  }

  // Build the transition map (M, t) that re-expresses face A's local coords as
  // face B's local coords across their shared edge, choosing the orientation
  // that carries "just outside A" to "just inside B".
  _transition(A, i, B, bj, sharedPts, half) {
    const [P0, P1] = sharedPts;
    const aA = this.to2D(A, P0),
      bA = this.to2D(A, P1);
    const aB = this.to2D(B, P0),
      bB = this.to2D(B, P1);

    // orthonormal edge frames in each face's local plane
    const e1A = norm2([bA[0] - aA[0], bA[1] - aA[1]]);
    const e2A = [-e1A[1], e1A[0]];
    const e1B = norm2([bB[0] - aB[0], bB[1] - aB[1]]);
    const e2B = [-e1B[1], e1B[0]];

    const Tinv = transpose2(colsToMat2(e1A, e2A)); // inverse of A edge frame
    const Mpres = matMul2(colsToMat2(e1B, e2B), Tinv); // orientation-preserving
    const Mrev = matMul2(colsToMat2(e1B, [-e2B[0], -e2B[1]]), Tinv); // reflected

    const tFor = (M) => [aB[0] - apply2(M, aA)[0], aB[1] - apply2(M, aA)[1]];
    const tPres = tFor(Mpres),
      tRev = tFor(Mrev);

    // interior test: a point just OUTSIDE A beyond the edge midpoint should map
    // to just INSIDE B beyond the same edge.
    const midA = [(aA[0] + bA[0]) / 2, (aA[1] + bA[1]) / 2];
    const midB = [(aB[0] + bB[0]) / 2, (aB[1] + bB[1]) / 2];
    const outA = norm2(midA); // away from A centre (origin)
    const inB = norm2([-midB[0], -midB[1]]); // toward B centre
    const eps = 0.05 * half;
    const probe = [midA[0] + eps * outA[0], midA[1] + eps * outA[1]];
    const score = (M, t) => {
      const p = [apply2(M, probe)[0] + t[0], apply2(M, probe)[1] + t[1]];
      return (p[0] - midB[0]) * inB[0] + (p[1] - midB[1]) * inB[1];
    };

    const useRev = score(Mrev, tRev) > score(Mpres, tPres);
    const M = useRev ? Mrev : Mpres;
    const t = useRev ? tRev : tPres;
    return { toFaceId: B.id, toEdge: bj, M, t };
  }
}

// ---------------------------------------------------------------------------
// Factory: a CUBOID built from unit cubes. Each world axis X/Y/Z is divided
// into div.X / div.Y / div.Z cells; every cell is a unit square, so the box is
// a div.X × div.Y × div.Z stack of little cubes. A face spanned by two axes is
// therefore a non-square RECTANGLE of square tiles:
//   ±Z = NX×NY,  ±X = NY×NZ,  ±Y = NZ×NX.
// Setting all three counts equal yields a plain cube. Frames keep consistent
// OUTWARD normals (same orientation as the original unit cube).
// ---------------------------------------------------------------------------
const FACE_SPECS = [
  { id: 0, name: '+X', dir: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { id: 1, name: '-X', dir: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { id: 2, name: '+Y', dir: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { id: 3, name: '-Y', dir: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { id: 4, name: '+Z', dir: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { id: 5, name: '-Z', dir: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

// which world axis ('X'|'Y'|'Z') a unit vector points along
function axisOf(vec) {
  const ax = Math.abs(vec[0]),
    ay = Math.abs(vec[1]),
    az = Math.abs(vec[2]);
  if (ax >= ay && ax >= az) return 'X';
  if (ay >= az) return 'Y';
  return 'Z';
}

// (Re)compute each face's rectangular size (su along u, sv along v) and centre
// from the per-axis division counts, normalising so the longest side spans
// `fit`. Returns the clamped counts, the unit cell size, and the box extents.
function applyCuboidDims(faces, div, fit) {
  const N = {
    X: Math.max(1, Math.min(16, Math.round(div.X))),
    Y: Math.max(1, Math.min(16, Math.round(div.Y))),
    Z: Math.max(1, Math.min(16, Math.round(div.Z))),
  };
  const maxN = Math.max(N.X, N.Y, N.Z);
  const unit = fit / maxN; // square cell size, same on every face
  const L = { X: N.X * unit, Y: N.Y * unit, Z: N.Z * unit };
  for (const f of faces) {
    f.su = L[f.uAxis];
    f.sv = L[f.vAxis];
    f.size = Math.max(f.su, f.sv); // legacy alias (prefer su/sv everywhere)
    const hf = L[f.faceAxis] / 2;
    f.C = [f.dir[0] * hf, f.dir[1] * hf, f.dir[2] * hf];
  }
  return { N, unit, L };
}

export function buildCuboid(div = { X: 4, Y: 4, Z: 4 }, fit = 2) {
  const faces = FACE_SPECS.map((s) => {
    const f = { id: s.id, name: s.name, dir: s.dir.slice(), u: s.u.slice(), v: s.v.slice() };
    f.uAxis = axisOf(f.u);
    f.vAxis = axisOf(f.v);
    f.faceAxis = axisOf(f.dir);
    return f;
  });
  applyCuboidDims(faces, div, fit);
  const surf = new Surface(faces);
  surf.div = div; // shared reference
  surf.fit = fit;
  surf.unit = fit / Math.max(div.X, div.Y, div.Z);
  surf.dims = { X: div.X * surf.unit, Y: div.Y * surf.unit, Z: div.Z * surf.unit };
  return surf;
}

// Back-compat: a plain cube of side `size` (all axes divided equally elsewhere).
export function buildCube(size = 2) {
  return buildCuboid({ X: 1, Y: 1, Z: 1 }, size);
}
