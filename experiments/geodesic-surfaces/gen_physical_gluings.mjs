// Generate the firmware cube edge-gluing table from the PHYSICAL cube's frames
// (measured by Alvaro from the real object, Oct 2026). Reuses the proven
// Surface gluing math in src/core/surface.js — nothing is hand-typed.
//
//   firmware index  your face #  normal   local +x   local +y
//        0              1          +Z        +X         +Y
//        1              2          +Y        +X         -Z
//        2              3          -Z        +X         -Y
//        3              4          -Y        +X         +Z
//        4              5          +X        +Y         +Z
//        5              6          -X        -Y         +Z
//
// Run:  node experiments/geodesic-surfaces/gen_physical_gluings.mjs
import { Surface } from '../../src/core/surface.js';

// Physical frames, firmware index 0..5 (= your faces 1..6). dir = outward
// normal; u = local +x; v = local +y (all in world X/Y/Z). n = u x v == dir.
export const PHYSICAL_SPECS = [
  { id: 0, name: '+Z', dir: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0]  },
  { id: 1, name: '+Y', dir: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1] },
  { id: 2, name: '-Z', dir: [0, 0, -1], u: [1, 0, 0],  v: [0, -1, 0] },
  { id: 3, name: '-Y', dir: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1]  },
  { id: 4, name: '+X', dir: [1, 0, 0],  u: [0, 1, 0],  v: [0, 0, 1]  },
  { id: 5, name: '-X', dir: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1]  },
];

// Build faces for a side-2 cube (half-extent 1), matching buildCube(2)'s chart
// convention so the C++ rescale (side*0.5*(1 - xx - xy + tx)) stays valid.
export function buildPhysicalCube() {
  const faces = PHYSICAL_SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    u: s.u.slice(),
    v: s.v.slice(),
    C: [s.dir[0], s.dir[1], s.dir[2]], // centre at distance 1 along the normal
    su: 2,
    sv: 2,
    size: 2,
  }));
  return new Surface(faces);
}

const surf = buildPhysicalCube();
const r = (n) => Math.round(n);
const edgeName = (e) => ['+x', '+y', '-x', '-y'][e];

// Emit the C++ gluings[6][4][7] table rows.
const rows = surf.faces.map((A) => {
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const g = A.edges[i];
    if (!g) {
      cells.push('/*BOUNDARY*/');
      continue;
    }
    cells.push(`{${g.toFaceId},${r(g.M.a)},${r(g.M.b)},${r(g.M.c)},${r(g.M.d)},${r(g.t[0])},${r(g.t[1])}}`);
  }
  return `    {${cells.join(', ')}},   // face ${A.id} (${A.name})`;
});

console.log('  const int8_t gluings[6][4][7] = {');
console.log(rows.join('\n'));
console.log('  };');

// --- sanity checks to stderr (not part of the pasteable output) ---
console.error('\n// neighbour map + reciprocity check:');
let reciprocalOk = true;
for (const A of surf.faces) {
  const nb = A.edges
    .map((g, i) => (g ? `${edgeName(i)}->F${g.toFaceId}e${g.toEdge}` : `${edgeName(i)}:BND`))
    .join('   ');
  console.error(`//  F${A.id} (${A.name}): ${nb}`);
  // reciprocity: crossing back from the neighbour must return to A
  A.edges.forEach((g) => {
    if (!g) return;
    const back = surf.faceById(g.toFaceId).edges[g.toEdge];
    if (!back || back.toFaceId !== A.id) reciprocalOk = false;
  });
}
console.error(`// reciprocity: ${reciprocalOk ? 'OK (every edge glues back)' : 'FAILED'}`);
