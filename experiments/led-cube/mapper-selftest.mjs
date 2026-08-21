import { createDefaultLedCubeMapper, LedCubeVirtualBuffer, TOTAL_LEDS } from '../../src/io/ledCubeMapper.js';

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

const mapper = createDefaultLedCubeMapper();
const check = mapper.validate();
assert(check.ok, `Mapper invalid: ${check.reason}`);
assert(check.total === TOTAL_LEDS, `Expected ${TOTAL_LEDS} leds, got ${check.total}`);

// Round-trip check for all indices.
for (let i = 0; i < TOTAL_LEDS; i++) {
  const p = mapper.unmap(i);
  const back = mapper.map(p.faceId, p.x, p.y);
  assert(back === i, `Round-trip mismatch at index ${i}: got ${back}`);
}

// Light one marker per face in virtual space and ensure each resolves to
// a unique hardware index.
const buf = new LedCubeVirtualBuffer(mapper);
for (const faceId of mapper.faceOrder) {
  buf.set(faceId, 0, 0, 255, 0, 0);
}

const bytes = buf.toUint8();
let lit = 0;
for (let i = 0; i < bytes.length; i += 3) {
  if (bytes[i] || bytes[i + 1] || bytes[i + 2]) lit++;
}
assert(lit === mapper.faceOrder.length, `Expected ${mapper.faceOrder.length} lit markers, got ${lit}`);

console.log('LED cube mapper self-test PASS');
console.log('coverage:', check.total, 'leds');
for (const faceId of mapper.faceOrder) {
  const d = mapper.describeFace(faceId);
  console.log(`face ${faceId}: chainPos=${d.chainPosition}, hwStart=${d.hwStart}, hwEnd=${d.hwEnd}`);
}
