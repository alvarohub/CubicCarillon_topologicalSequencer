# LED Cube Mapper (6 x 8x8 NeoPixel Faces)

This project now includes a dedicated mapping adapter that converts virtual
face coordinates into physical daisy-chain indices.

Module:

- `src/io/ledCubeMapper.js`

Self-test:

- `node experiments/led-cube/mapper-selftest.mjs`

## What It Solves

All render code can stay in a clean virtual space:

- face id in `[1..6]`
- local pixel `(x, y)` in `[0..7] x [0..7]`

The mapper resolves that to one physical LED index in `[0..383]`.

## Current Defaults

- face order in chain: `1 -> 2 -> 3 -> 4 -> 5 -> 6`
- face size: `8`
- scan mode: `progressiveRows`
- per-face transform: all `R1` (identity)

This default validates to full coverage (`384` unique indices).

## Typical Usage

```js
import { createDefaultLedCubeMapper, LedCubeVirtualBuffer } from './src/io/ledCubeMapper.js';

const mapper = createDefaultLedCubeMapper();
const buffer = new LedCubeVirtualBuffer(mapper);

buffer.clear();
buffer.set(1, 0, 0, 255, 0, 0); // face 1 local origin marker
buffer.add(4, 3, 5, 0, 120, 255);

const bytes = buffer.toUint8({ brightness: 0.4, gamma: 1.8 });
// `bytes` is in physical chain order: [r0,g0,b0, r1,g1,b1, ...]
```

## Calibration Workflow

If a face appears rotated or mirrored, do not change render logic.
Only change that face transform in mapper config.

Each face transform supports:

- `rotateCW`: `0 | 1 | 2 | 3`
- `flipX`: `true | false`
- `flipY`: `true | false`

Example:

```js
const mapper = createLedCubeMapper({
  faceOrder: [1, 2, 3, 4, 5, 6],
  faceTransforms: {
    1: { rotateCW: 0, flipX: false, flipY: false },
    2: { rotateCW: 1, flipX: false, flipY: false },
    3: { rotateCW: 0, flipX: true, flipY: false },
    4: { rotateCW: 0, flipX: false, flipY: false },
    5: { rotateCW: 2, flipX: false, flipY: false },
    6: { rotateCW: 3, flipX: false, flipY: true },
  },
});
```

After editing transforms, run:

- `node experiments/led-cube/mapper-selftest.mjs`

The test verifies:

- no duplicate hardware indices
- no unmapped hardware indices
- map/unmap round-trip consistency
