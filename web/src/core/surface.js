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

  to3D(face, x, y) {
    return add3(add3(face.C, scl3(face.u, x)), scl3(face.v, y));
  }
  to2D(face, P) {
    const d = sub3(P, face.C);
    return [dot3(d, face.u), dot3(d, face.v)];
  }

  // Local 2D corner coordinates of edge `e` of a square face (CCW winding).
  // Edge convention: 0=+x (right), 1=+y (top), 2=-x (left), 3=-y (bottom).
  static edgeCornersLocal(half) {
    return [
      [
        [half, -half],
        [half, half],
      ], // 0 +x
      [
        [half, half],
        [-half, half],
      ], // 1 +y
      [
        [-half, half],
        [-half, -half],
      ], // 2 -x
      [
        [-half, -half],
        [half, -half],
      ], // 3 -y
    ];
  }

  _buildGluings() {
    // Precompute, for every (face, edge), the two shared corners in 3D.
    const edge3D = []; // edge3D[faceIndex][edgeIndex] = [P0, P1]
    this.faces.forEach((f, fi) => {
      const half = f.size / 2;
      const cl = Surface.edgeCornersLocal(half);
      edge3D[fi] = cl.map(([a, b]) => [this.to3D(f, a[0], a[1]), this.to3D(f, b[0], b[1])]);
    });

    const same = (P, Q) => len3(sub3(P, Q)) < MATCH_EPS;
    const edgesMatch = (e1, e2) =>
      (same(e1[0], e2[0]) && same(e1[1], e2[1])) || (same(e1[0], e2[1]) && same(e1[1], e2[0]));

    this.faces.forEach((A, ai) => {
      const half = A.size / 2;
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
// Factory: the unit cube (side 2, faces at coordinate ±1). Frames are chosen
// with consistent OUTWARD normals.
// ---------------------------------------------------------------------------
export function buildCube(size = 2) {
  const faces = [
    { id: 0, name: '+X', size, C: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { id: 1, name: '-X', size, C: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { id: 2, name: '+Y', size, C: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { id: 3, name: '-Y', size, C: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { id: 4, name: '+Z', size, C: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { id: 5, name: '-Z', size, C: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  // scale centres to match `size` (centres sit at ±size/2 along their axis)
  const h = size / 2;
  for (const f of faces) f.C = f.C.map((c) => c * h);
  return new Surface(faces);
}
