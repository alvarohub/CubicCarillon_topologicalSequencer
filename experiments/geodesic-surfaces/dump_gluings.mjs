// Extract cube edge gluings from surface.js and print them in a form we can
// paste into the C++ firmware. Faces are numbered 1..6 in the firmware; here
// we use the JS IDs 0..5 and offset when printing.
import { buildCube } from '../../src/core/surface.js';

const surf = buildCube(2);

const edgeName = e => ['+u','+v','-u','-v'][e];

// Convert the JS 2x2 orientation matrix M into signed-permutation entries.
// M acts on the local displacement vector: v' = M v + t. For cube gluings it
// is always a signed permutation (axis-aligned edges), so applying M to the
// unit test vectors gives us the direction remap.
function velRemap(M) {
  const applyM = (vx, vy) => [Math.round(M.a*vx + M.b*vy),
                              Math.round(M.c*vx + M.d*vy)];
  const [aX, aY] = applyM(1, 0);   // where +x on A ends up on B
  const [bX, bY] = applyM(0, 1);   // where +y on A ends up on B
  return { aX, aY, bX, bY };
}

// Verify a full circumnavigation returns to start (sanity check).
function walkTest() {
  let f = surf.faces[0]; // face 1 = +X
  let x = 0.0, y = 0.0;     // local (u,v) coord in [-1..1]
  let vx = 0.05, vy = 0;    // moving +u
  let steps = 0, crossings = 0;
  while (steps++ < 500) {
    x += vx; y += vy;
    // Check if we exited any edge
    let edge = -1;
    if (x > 1)  edge = 0;
    else if (y > 1)  edge = 1;
    else if (x < -1) edge = 2;
    else if (y < -1) edge = 3;
    if (edge >= 0) {
      const g = f.edges[edge];
      if (!g) break;
      // Apply M and t to (x,y)
      const nx = g.M.a*x + g.M.b*y + g.t[0];
      const ny = g.M.c*x + g.M.d*y + g.t[1];
      const nvx = g.M.a*vx + g.M.b*vy;
      const nvy = g.M.c*vx + g.M.d*vy;
      f = surf.faceById(g.toFaceId);
      x = nx; y = ny; vx = nvx; vy = nvy;
      crossings++;
      if (crossings > 20) break;
    }
  }
  return { finalFace: f.id + 1, x, y, vx, vy, crossings };
}

console.log('// ==== Cube edge gluings (from src/core/surface.js buildCube(2)) ====');
console.log('// Face id conventions:');
for (const f of surf.faces) {
  console.log(`//   F${f.id+1} = ${f.name}   u=${JSON.stringify(f.u)} v=${JSON.stringify(f.v)}`);
}
console.log('');
console.log('// (fromFace, fromEdge)  ->  (toFace, toEdge)  M  t  velRemap');
for (const A of surf.faces) {
  for (let i = 0; i < 4; i++) {
    const g = A.edges[i];
    if (!g) { console.log(`  F${A.id+1} e${i}(${edgeName(i)}): BOUNDARY`); continue; }
    const r = velRemap(g.M);
    console.log(
      `  F${A.id+1} e${i}(${edgeName(i)}) -> F${g.toFaceId+1} e${g.toEdge}(${edgeName(g.toEdge)})  ` +
      `M=[[${g.M.a.toFixed(0)},${g.M.b.toFixed(0)}],[${g.M.c.toFixed(0)},${g.M.d.toFixed(0)}]] ` +
      `t=[${g.t[0].toFixed(2)},${g.t[1].toFixed(2)}]  ` +
      `+x_A->(${r.aX},${r.aY})  +y_A->(${r.bX},${r.bY})`
    );
  }
}

console.log('\n// ==== Circumnavigation test ====');
console.log(JSON.stringify(walkTest(), null, 2));
