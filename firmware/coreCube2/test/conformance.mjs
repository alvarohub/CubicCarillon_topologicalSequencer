import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildCube } from '../../../src/core/surface.js';

const binary = process.argv[2] ?? '/tmp/cubic-sequencer-v2-test';
const actual = execFileSync(binary, ['--gluings'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((line) => line.trim().split(/\s+/).map(Number));
const expected = buildCube(2).faces.flatMap((face) =>
  face.edges.map((edge) => [
    edge.toFaceId,
    edge.M.a,
    edge.M.b,
    edge.M.c,
    edge.M.d,
    4 * (1 - edge.M.a - edge.M.b + edge.t[0]),
    4 * (1 - edge.M.c - edge.M.d + edge.t[1]),
  ]),
);

assert.equal(actual.length, 24);
expected.forEach((edge, index) => {
  assert.equal(actual[index].length, edge.length);
  edge.forEach((value, component) => {
    assert.ok(
      Math.abs(actual[index][component] - value) < 1e-9,
      `face ${Math.floor(index / 4)} edge ${index % 4} component ${component}`,
    );
  });
});
console.log('PASS: all 24 C++ cube gluings match the geometry-derived JavaScript transitions');
