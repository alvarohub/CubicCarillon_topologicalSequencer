// io/ledCubeMapper.js
//
// Hardware adapter for the physical 6-face (8x8 each) NeoPixel cube.
//
// Design goal:
//   Keep rendering in a clean virtual coordinate space (face, x, y), then map
//   to one linear hardware LED index only at the output boundary.
//
// The defaults below match Alvaro's current wiring notes:
//   - faces are numbered 1..6
//   - daisy chain order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
//   - LED 0 marker is the local origin for each face
//
// Face orientation can vary physically. Instead of hardcoding assumptions, each
// face can have a small transform (rotate/flip) so local map coordinates still
// land on the intended physical pixel.

export const FACE_SIZE = 8;
export const FACE_IDS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const LEDS_PER_FACE = FACE_SIZE * FACE_SIZE;
export const TOTAL_LEDS = FACE_IDS.length * LEDS_PER_FACE;

export const SCAN_MODE = Object.freeze({
  PROGRESSIVE_ROWS: 'progressiveRows',
  ZIGZAG_ROWS: 'zigzagRows',
  PROGRESSIVE_COLUMNS: 'progressiveColumns',
  ZIGZAG_COLUMNS: 'zigzagColumns',
});

// Two named frames to mirror the sketch notation. They are aliases around the
// same low-level rotate/flip transform model.
export const FACE_FRAME = Object.freeze({
  R1: { rotateCW: 0, flipX: false, flipY: false },
  R2: { rotateCW: 1, flipX: false, flipY: false },
});

export const DEFAULT_MAPPER_CONFIG = Object.freeze({
  faceSize: FACE_SIZE,
  faceOrder: FACE_IDS,
  // With LED0 at local (0,0) and LED63 at (7,7), progressive rows is the most
  // direct default. If a panel turns out to be serpentine, switch mode here.
  scanMode: SCAN_MODE.PROGRESSIVE_ROWS,
  faceTransforms: {
    1: FACE_FRAME.R1,
    2: FACE_FRAME.R1,
    3: FACE_FRAME.R1,
    4: FACE_FRAME.R1,
    5: FACE_FRAME.R1,
    6: FACE_FRAME.R1,
  },
});

function assertInt(name, value) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

function assertInRange(name, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${name} out of range (${value}), expected ${min}..${max}`);
  }
}

function cloneTransform(t) {
  const src = t || FACE_FRAME.R1;
  return {
    rotateCW: (((src.rotateCW || 0) % 4) + 4) % 4,
    flipX: !!src.flipX,
    flipY: !!src.flipY,
  };
}

function applyTransform(x, y, size, t) {
  let xx = x;
  let yy = y;

  if (t.flipX) xx = size - 1 - xx;
  if (t.flipY) yy = size - 1 - yy;

  for (let k = 0; k < t.rotateCW; k++) {
    const oldX = xx;
    xx = size - 1 - yy;
    yy = oldX;
  }
  return { x: xx, y: yy };
}

function invertTransform(x, y, size, t) {
  let xx = x;
  let yy = y;

  for (let k = 0; k < (4 - t.rotateCW) % 4; k++) {
    const oldX = xx;
    xx = yy;
    yy = size - 1 - oldX;
  }

  if (t.flipY) yy = size - 1 - yy;
  if (t.flipX) xx = size - 1 - xx;

  return { x: xx, y: yy };
}

function localIndexFromCoord(x, y, size, scanMode) {
  switch (scanMode) {
    case SCAN_MODE.PROGRESSIVE_ROWS:
      return y * size + x;
    case SCAN_MODE.ZIGZAG_ROWS:
      return y * size + (y % 2 === 0 ? x : size - 1 - x);
    case SCAN_MODE.PROGRESSIVE_COLUMNS:
      return x * size + y;
    case SCAN_MODE.ZIGZAG_COLUMNS:
      return x * size + (x % 2 === 0 ? y : size - 1 - y);
    default:
      throw new Error(`Unknown scanMode: ${scanMode}`);
  }
}

function coordFromLocalIndex(index, size, scanMode) {
  assertInt('index', index);
  assertInRange('index', index, 0, size * size - 1);

  switch (scanMode) {
    case SCAN_MODE.PROGRESSIVE_ROWS: {
      const y = Math.floor(index / size);
      const x = index - y * size;
      return { x, y };
    }
    case SCAN_MODE.ZIGZAG_ROWS: {
      const y = Math.floor(index / size);
      const rawX = index - y * size;
      const x = y % 2 === 0 ? rawX : size - 1 - rawX;
      return { x, y };
    }
    case SCAN_MODE.PROGRESSIVE_COLUMNS: {
      const x = Math.floor(index / size);
      const y = index - x * size;
      return { x, y };
    }
    case SCAN_MODE.ZIGZAG_COLUMNS: {
      const x = Math.floor(index / size);
      const rawY = index - x * size;
      const y = x % 2 === 0 ? rawY : size - 1 - rawY;
      return { x, y };
    }
    default:
      throw new Error(`Unknown scanMode: ${scanMode}`);
  }
}

export function createLedCubeMapper(config = {}) {
  const faceSize = config.faceSize || DEFAULT_MAPPER_CONFIG.faceSize;
  const faceOrder = [...(config.faceOrder || DEFAULT_MAPPER_CONFIG.faceOrder)];
  const scanMode = config.scanMode || DEFAULT_MAPPER_CONFIG.scanMode;
  const faceTransforms = {
    ...DEFAULT_MAPPER_CONFIG.faceTransforms,
    ...(config.faceTransforms || {}),
  };

  assertInt('faceSize', faceSize);
  assertInRange('faceSize', faceSize, 1, 64);
  if (!faceOrder.length) throw new Error('faceOrder cannot be empty');

  const seen = new Set();
  for (const faceId of faceOrder) {
    assertInt('faceId', faceId);
    if (seen.has(faceId)) throw new Error(`Duplicate faceId in faceOrder: ${faceId}`);
    seen.add(faceId);
  }

  const orderIndex = new Map(faceOrder.map((faceId, i) => [faceId, i]));
  const transforms = new Map(faceOrder.map((faceId) => [faceId, cloneTransform(faceTransforms[faceId])]));

  function assertFace(faceId) {
    if (!orderIndex.has(faceId)) {
      throw new Error(`Unknown faceId ${faceId}. Known faces: ${faceOrder.join(', ')}`);
    }
  }

  function assertCoord(x, y) {
    assertInt('x', x);
    assertInt('y', y);
    assertInRange('x', x, 0, faceSize - 1);
    assertInRange('y', y, 0, faceSize - 1);
  }

  function map(faceId, x, y) {
    assertFace(faceId);
    assertCoord(x, y);

    const t = transforms.get(faceId);
    const c = applyTransform(x, y, faceSize, t);
    const local = localIndexFromCoord(c.x, c.y, faceSize, scanMode);
    const faceOffset = orderIndex.get(faceId) * faceSize * faceSize;
    return faceOffset + local;
  }

  function unmap(index) {
    assertInt('index', index);
    const max = faceOrder.length * faceSize * faceSize - 1;
    assertInRange('index', index, 0, max);

    const perFace = faceSize * faceSize;
    const faceChainPos = Math.floor(index / perFace);
    const localIndex = index - faceChainPos * perFace;
    const faceId = faceOrder[faceChainPos];
    const c = coordFromLocalIndex(localIndex, faceSize, scanMode);
    const t = transforms.get(faceId);
    const p = invertTransform(c.x, c.y, faceSize, t);
    return { faceId, x: p.x, y: p.y };
  }

  function setFaceTransform(faceId, transform) {
    assertFace(faceId);
    transforms.set(faceId, cloneTransform(transform));
  }

  function getFaceTransform(faceId) {
    assertFace(faceId);
    return { ...transforms.get(faceId) };
  }

  function validate() {
    const total = faceOrder.length * faceSize * faceSize;
    const used = new Uint8Array(total);

    for (const faceId of faceOrder) {
      for (let y = 0; y < faceSize; y++) {
        for (let x = 0; x < faceSize; x++) {
          const idx = map(faceId, x, y);
          if (idx < 0 || idx >= total) {
            return { ok: false, reason: `Index out of bounds: ${idx}` };
          }
          if (used[idx]) {
            return { ok: false, reason: `Duplicate mapped index: ${idx}` };
          }
          used[idx] = 1;
        }
      }
    }

    for (let i = 0; i < total; i++) {
      if (!used[i]) return { ok: false, reason: `Unmapped hardware index: ${i}` };
    }
    return { ok: true, total };
  }

  function describeFace(faceId) {
    assertFace(faceId);
    const t = transforms.get(faceId);
    return {
      faceId,
      chainPosition: orderIndex.get(faceId),
      hwStart: map(faceId, 0, 0),
      hwEnd: map(faceId, faceSize - 1, faceSize - 1),
      transform: { ...t },
    };
  }

  return {
    faceSize,
    faceOrder: [...faceOrder],
    scanMode,
    map,
    unmap,
    validate,
    setFaceTransform,
    getFaceTransform,
    describeFace,
  };
}

export class LedCubeVirtualBuffer {
  constructor(mapper) {
    if (!mapper || typeof mapper.map !== 'function') {
      throw new Error('LedCubeVirtualBuffer requires a mapper from createLedCubeMapper()');
    }
    this.mapper = mapper;
    this.faceSize = mapper.faceSize;
    this.faceOrder = [...mapper.faceOrder];
    this.ledsPerFace = this.faceSize * this.faceSize;
    this.totalLeds = this.faceOrder.length * this.ledsPerFace;

    // Float space is convenient for additive blending and later tone mapping.
    this.rgb = new Float32Array(this.totalLeds * 3);
  }

  clear() {
    this.rgb.fill(0);
  }

  _offset(faceId, x, y) {
    const hw = this.mapper.map(faceId, x, y);
    return hw * 3;
  }

  set(faceId, x, y, r, g, b) {
    const off = this._offset(faceId, x, y);
    this.rgb[off + 0] = r;
    this.rgb[off + 1] = g;
    this.rgb[off + 2] = b;
  }

  add(faceId, x, y, r, g, b) {
    const off = this._offset(faceId, x, y);
    this.rgb[off + 0] += r;
    this.rgb[off + 1] += g;
    this.rgb[off + 2] += b;
  }

  get(faceId, x, y) {
    const off = this._offset(faceId, x, y);
    return {
      r: this.rgb[off + 0],
      g: this.rgb[off + 1],
      b: this.rgb[off + 2],
    };
  }

  // Convert the blended float buffer to hardware bytes in chain order.
  // Values are expected in 0..255 range before brightness/gamma.
  toUint8({ brightness = 1, gamma = 1 } = {}) {
    const out = new Uint8Array(this.totalLeds * 3);
    const inv255 = 1 / 255;

    for (let i = 0; i < out.length; i++) {
      let v = this.rgb[i] * brightness;
      if (v <= 0) {
        out[i] = 0;
        continue;
      }
      if (gamma !== 1) {
        const n = Math.min(1, v * inv255);
        v = Math.pow(n, gamma) * 255;
      }
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
    return out;
  }
}

export function createDefaultLedCubeMapper() {
  return createLedCubeMapper(DEFAULT_MAPPER_CONFIG);
}
