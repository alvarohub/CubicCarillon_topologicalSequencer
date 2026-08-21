import { Head, createFlatTorus, createIcosaSphere, createSquareTube } from './src/atlas.js';

const EPS = 1e-6;

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scl2 = (a, s) => [a[0] * s, a[1] * s];
const len2 = (v) => Math.hypot(v[0], v[1]);
const norm2 = (v) => {
  const n = len2(v) || 1;
  return [v[0] / n, v[1] / n];
};
const apply2 = (M, p) => [M.a * p[0] + M.b * p[1], M.c * p[0] + M.d * p[1]];
const len3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const surfaces = [
  createFlatTorus(),
  createSquareTube(0),
  createSquareTube(1),
  createSquareTube(2),
  createSquareTube(3),
  createIcosaSphere(),
];

let failures = 0;

function fail(surface, message) {
  failures += 1;
  console.error(`${surface.name}: ${message}`);
}

function embedded(surface, faceId, p) {
  return surface.embed({ faceId, x: p[0], y: p[1] }, surface);
}

for (const surface of surfaces) {
  for (const face of surface.faces) {
    for (let edgeIndex = 0; edgeIndex < face.edges.length; edgeIndex++) {
      const edge = face.edges[edgeIndex];
      if (!edge || edge.toFaceId == null) continue;

      const a = face.verts2[edgeIndex];
      const b = face.verts2[(edgeIndex + 1) % face.verts2.length];
      const edgeDir = norm2(sub2(b, a));
      const inward = [-edgeDir[1], edgeDir[0]];
      const outward = [edgeDir[1], -edgeDir[0]];
      const mid = scl2(add2(a, b), 0.5);
      const head = new Head({
        id: 0,
        faceId: face.id,
        x: mid[0] + inward[0] * 1e-5,
        y: mid[1] + inward[1] * 1e-5,
        vx: outward[0],
        vy: outward[1],
      });
      const events = surface.stepHead(head, 1e-3);
      if (!events.some((event) => event.type === 'edge') || head.faceId !== edge.toFaceId) {
        fail(surface, `edge ${face.id}:${edgeIndex} did not cross to face ${edge.toFaceId}`);
      }
      if (Math.abs(Math.hypot(head.vx, head.vy) - 1) > EPS) {
        fail(surface, `edge ${face.id}:${edgeIndex} changed speed`);
      }

      const back = surface.faceById(edge.toFaceId).edges[edge.toEdge];
      if (!back || back.toFaceId !== face.id) {
        fail(surface, `edge ${face.id}:${edgeIndex} has no reciprocal map`);
      } else {
        const p = [0.123, -0.234];
        const v = [0.37, -0.41];
        const pBack = add2(apply2(back.M, add2(apply2(edge.M, p), edge.t)), back.t);
        const vBack = apply2(back.M, apply2(edge.M, v));
        if (Math.max(len2(sub2(pBack, p)), len2(sub2(vBack, v))) > EPS) {
          fail(surface, `edge ${face.id}:${edgeIndex} reciprocal map is not identity`);
        }
      }

      for (const s of [0.25, 0.5, 0.75]) {
        const pA = add2(scl2(a, 1 - s), scl2(b, s));
        const pB = add2(apply2(edge.M, pA), edge.t);
        if (len3(embedded(surface, face.id, pA), embedded(surface, edge.toFaceId, pB)) > 1e-5) {
          fail(surface, `edge ${face.id}:${edgeIndex} does not preserve embedded edge point ${s}`);
        }
      }
    }
  }
}

if (failures) {
  console.error(`${failures} atlas self-test failure${failures === 1 ? '' : 's'}`);
  process.exit(1);
}

console.log(`atlas self-test passed (${surfaces.length} surfaces)`);
