const EPS = 1e-8;

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => {
  const n = len3(a);
  return n < EPS ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mat2 = (a, b, c, d) => ({ a, b, c, d });
const apply2 = (M, p) => [M.a * p[0] + M.b * p[1], M.c * p[0] + M.d * p[1]];
const matMul2 = (A, B) =>
  mat2(A.a * B.a + A.b * B.c, A.a * B.b + A.b * B.d, A.c * B.a + A.d * B.c, A.c * B.b + A.d * B.d);
const transpose2 = (M) => mat2(M.a, M.c, M.b, M.d);
const colsToMat2 = (e1, e2) => mat2(e1[0], e2[0], e1[1], e2[1]);
const norm2 = (v) => {
  const n = Math.hypot(v[0], v[1]);
  return n < EPS ? [0, 0] : [v[0] / n, v[1] / n];
};

export class AtlasSurface {
  constructor({ name, kind, faces, embed, sample, description, ...meta }) {
    this.name = name;
    this.kind = kind;
    this.faces = faces;
    this.embed = embed;
    this.sample = sample;
    this.description = description;
    Object.assign(this, meta);
    this._byId = new Map(faces.map((face) => [face.id, face]));
  }

  faceById(id) {
    return this._byId.get(id);
  }

  to3D(face, x, y) {
    return add3(face.C, add3(scl3(face.u, x), scl3(face.v, y)));
  }

  stepHead(head, dt) {
    let remaining = dt;
    let guard = 0;
    const events = [];
    while (remaining > EPS && guard++ < 24) {
      const face = this.faceById(head.faceId);
      const hit = firstExit(face, [head.x, head.y], [head.vx, head.vy], remaining);
      if (!hit) {
        head.x += head.vx * remaining;
        head.y += head.vy * remaining;
        break;
      }
      head.x += head.vx * hit.t;
      head.y += head.vy * hit.t;
      remaining -= hit.t;

      const edge = face.edges[hit.edge];
      if (!edge?.toFaceId) {
        const a = face.verts2[hit.edge];
        const b = face.verts2[(hit.edge + 1) % face.verts2.length];
        const tangent = norm2(sub2(b, a));
        const along = head.vx * tangent[0] + head.vy * tangent[1];
        head.vx = 2 * along * tangent[0] - head.vx;
        head.vy = 2 * along * tangent[1] - head.vy;
        head.x += head.vx * 1e-6;
        head.y += head.vy * 1e-6;
        events.push({ type: 'boundary', head, faceId: face.id, edge: hit.edge });
        continue;
      }

      const mapped = apply2(edge.M, [head.x, head.y]);
      const mappedV = apply2(edge.M, [head.vx, head.vy]);
      head.faceId = edge.toFaceId;
      head.x = mapped[0] + edge.t[0] + mappedV[0] * 1e-6;
      head.y = mapped[1] + edge.t[1] + mappedV[1] * 1e-6;
      head.vx = mappedV[0];
      head.vy = mappedV[1];
      events.push({ type: 'edge', head, faceFrom: face.id, edge: hit.edge, toFace: head.faceId });
    }
    return events;
  }
}

export class Head {
  constructor({ id, faceId = 0, x = 0, y = 0, vx = 1, vy = 0, color = '#fff' }) {
    this.id = id;
    this.faceId = faceId;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.readKey = '';
    this.lastSample = null;
  }
}

export function createFlatTorus() {
  const width = 4.2;
  const height = 2.4;
  const face = rectangleFace(0, width, height, 'flat torus chart');
  glue(face, 1, face, 3, mat2(1, 0, 0, 1), [-width, 0]);
  glue(face, 3, face, 1, mat2(1, 0, 0, 1), [width, 0]);
  glue(face, 2, face, 0, mat2(1, 0, 0, 1), [0, -height]);
  glue(face, 0, face, 2, mat2(1, 0, 0, 1), [0, height]);
  return new AtlasSurface({
    name: 'Flat torus',
    kind: 'torus',
    faces: [face],
    description: 'A rectangle tiled by square cells, with opposite edges glued. Warm heads run around the large circle; cool heads run through the hole.',
    grid: { u: 14, v: 8 },
    trackInfo: '2 track families: around the large circle and through the hole.',
    embed: (head) => torusEmbed(head.x, head.y, width, height),
    sample: (head) => sampleField(head.x, head.y, width, height, head.faceId, 14, 8),
  });
}

export function createSquareTube(twistQuarter = 0) {
  const length = 4.8;
  const side = 1.2;
  const faces = Array.from({ length: 4 }, (_, id) => {
    const face = rectangleFace(id, length, side, `tube side ${id}`);
    face.sideIndex = id;
    return face;
  });
  for (const face of faces) {
    const id = face.sideIndex;
    glue(face, 1, faces[(id + twistQuarter) % 4], 3, mat2(1, 0, 0, 1), [-length, 0]);
    glue(face, 3, faces[(id - twistQuarter + 4) % 4], 1, mat2(1, 0, 0, 1), [length, 0]);
    glue(face, 2, faces[(id + 1) % 4], 0, mat2(1, 0, 0, 1), [0, -side]);
    glue(face, 0, faces[(id + 3) % 4], 2, mat2(1, 0, 0, 1), [0, side]);
  }
  const angle = twistQuarter * 90;
  const label = angle === 0 ? 'Square tube torus' : `Square tube, ${angle} degree end twist`;
  return new AtlasSurface({
    name: label,
    kind: 'squareTube',
    faces,
    length,
    side,
    twistQuarter,
    grid: { u: 16, v: 4 },
    trackInfo: '4 side charts with square cells; warm heads loop lengthwise, cool heads loop around the square cross-section.',
    description:
      angle === 0
        ? 'A cuboid bent into a ring: four rectangular side charts, with the two ends glued without rotation.'
        : `A cuboid bent into a ring, with the end frame rotated ${angle} degrees before gluing. The note grid stays square in the atlas.`,
    embed: (head) => squareTubeEmbed(head.faceId, head.x, head.y, length, side, twistQuarter),
    sample: (head) => squareTubeSample(head.faceId, head.x, head.y, length, side),
  });
}

export function createMobiusStrip(turns = 0.5) {
  const width = 4.6;
  const height = 1.25;
  const face = rectangleFace(
    0,
    width,
    height,
    turns === 0.5 ? 'Mobius chart' : `${Math.round(turns * 360)} degree twist chart`,
  );
  if (turns === 0.5) {
    glue(face, 1, face, 3, mat2(1, 0, 0, -1), [-width, 0]);
    glue(face, 3, face, 1, mat2(1, 0, 0, -1), [width, 0]);
  } else if (turns === 0.25) {
    const s = width;
    face.verts2 = squareVerts(s);
    face.width = s;
    face.height = s;
    glue(face, 1, face, 0, mat2(0, 1, 1, 0), [0, -s]);
    glue(face, 0, face, 1, mat2(0, 1, 1, 0), [s, 0]);
    glue(face, 2, face, 3, mat2(0, 1, 1, 0), [-s, 0]);
    glue(face, 3, face, 2, mat2(0, 1, 1, 0), [0, s]);
  } else if (turns === 0.75) {
    const s = width;
    face.verts2 = squareVerts(s);
    face.width = s;
    face.height = s;
    glue(face, 1, face, 2, mat2(0, 1, -1, 0), [0, s]);
    glue(face, 2, face, 1, mat2(0, -1, 1, 0), [s, 0]);
    glue(face, 3, face, 0, mat2(0, 1, -1, 0), [0, -s]);
    glue(face, 0, face, 3, mat2(0, -1, 1, 0), [-s, 0]);
  }
  const label = turns === 0.5 ? 'Mobius strip, 180 twist' : `${Math.round(turns * 360)} degree twisted quotient`;
  return new AtlasSurface({
    name: label,
    kind: 'twist',
    faces: [face],
    description:
      turns === 0.5
        ? 'A strip with left/right edges glued with a flip. The open strip boundaries reflect heads for this lab.'
        : 'A square fundamental domain whose edge maps rotate coordinates by a quarter turn.',
    embed: (head) => mobiusEmbed(head.x, head.y, face.width, face.height, turns),
    sample: (head) => sampleField(head.x, head.y, face.width, face.height, head.faceId),
  });
}

export function createIcosaSphere() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map((v) => scl3(norm3(v), 1.55));
  const indices = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const faces = indices.map((tri, id) =>
    triangleFace(
      id,
      tri.map((i) => raw[i]),
    ),
  );
  buildComputedTransitions(faces);
  return new AtlasSurface({
    name: 'Icosahedral sphere',
    kind: 'polyhedron',
    faces,
    description: 'A sphere approximation: flat triangular charts, with curvature concentrated at vertices.',
    embed: (head, surface) => surface.to3D(surface.faceById(head.faceId), head.x, head.y),
    sample: (head, surface) => {
      const p = norm3(surface.to3D(surface.faceById(head.faceId), head.x, head.y));
      const hue = (Math.atan2(p[1], p[0]) / (Math.PI * 2) + 1) % 1;
      const light = 0.45 + 0.25 * (p[2] * 0.5 + 0.5);
      return sampleFromHue(hue, light, `f${head.faceId}`);
    },
  });
}

function rectangleFace(id, width, height, name) {
  return {
    id,
    name,
    width,
    height,
    C: [0, 0, 0],
    u: [1, 0, 0],
    v: [0, 1, 0],
    n: [0, 0, 1],
    verts2: [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ],
    edges: [{}, {}, {}, {}],
  };
}

function squareVerts(size) {
  return [
    [-size / 2, -size / 2],
    [size / 2, -size / 2],
    [size / 2, size / 2],
    [-size / 2, size / 2],
  ];
}

function triangleFace(id, verts3) {
  let [a, b, c] = verts3;
  let n = norm3(cross3(sub3(b, a), sub3(c, a)));
  const center = scl3(add3(add3(a, b), c), 1 / 3);
  if (dot3(n, center) < 0) {
    [b, c] = [c, b];
    n = norm3(cross3(sub3(b, a), sub3(c, a)));
  }
  const u = norm3(sub3(b, a));
  const v = norm3(cross3(n, u));
  const C = center;
  const to2 = (p) => [dot3(sub3(p, C), u), dot3(sub3(p, C), v)];
  return {
    id,
    name: `facet ${id}`,
    C,
    u,
    v,
    n,
    verts3: [a, b, c],
    verts2: [to2(a), to2(b), to2(c)],
    edges: [{}, {}, {}],
  };
}

function glue(from, edgeFrom, to, edgeTo, M, t) {
  from.edges[edgeFrom] = { toFaceId: to.id, toEdge: edgeTo, M, t };
}

function firstExit(face, p, velocity, limit) {
  let best = null;
  for (let i = 0; i < face.verts2.length; i++) {
    const a = face.verts2[i];
    const b = face.verts2[(i + 1) % face.verts2.length];
    const edge = sub2(b, a);
    const value = cross2(edge, sub2(p, a));
    const denom = cross2(edge, velocity);
    if (denom >= -EPS) continue;
    const t = -value / denom;
    if (t >= -EPS && t <= limit + EPS && (!best || t < best.t)) best = { t: Math.max(0, t), edge: i };
  }
  return best;
}

function buildComputedTransitions(faces) {
  const same = (a, b) => len3(sub3(a, b)) < 1e-5;
  for (const A of faces) {
    for (let i = 0; i < A.verts3.length; i++) {
      const A0 = A.verts3[i];
      const A1 = A.verts3[(i + 1) % A.verts3.length];
      for (const B of faces) {
        if (A === B) continue;
        for (let j = 0; j < B.verts3.length; j++) {
          const B0 = B.verts3[j];
          const B1 = B.verts3[(j + 1) % B.verts3.length];
          if ((same(A0, B0) && same(A1, B1)) || (same(A0, B1) && same(A1, B0))) {
            A.edges[i] = transition(A, i, B, j);
          }
        }
      }
    }
  }
}

function transition(A, edgeA, B, edgeB) {
  const aA = A.verts2[edgeA];
  const bA = A.verts2[(edgeA + 1) % A.verts2.length];
  const aB = B.verts2[edgeB];
  const bB = B.verts2[(edgeB + 1) % B.verts2.length];
  const e1A = norm2(sub2(bA, aA));
  const e2A = [-e1A[1], e1A[0]];
  const e1B = norm2(sub2(bB, aB));
  const e2B = [-e1B[1], e1B[0]];
  const invA = transpose2(colsToMat2(e1A, e2A));
  const Mpres = matMul2(colsToMat2(e1B, e2B), invA);
  const Mrev = matMul2(colsToMat2(e1B, [-e2B[0], -e2B[1]]), invA);
  const tFor = (M) => [aB[0] - apply2(M, aA)[0], aB[1] - apply2(M, aA)[1]];
  const tPres = tFor(Mpres);
  const tRev = tFor(Mrev);
  const midA = [(aA[0] + bA[0]) / 2, (aA[1] + bA[1]) / 2];
  const midB = [(aB[0] + bB[0]) / 2, (aB[1] + bB[1]) / 2];
  const probe = [midA[0] + 0.001 * midA[0], midA[1] + 0.001 * midA[1]];
  const score = (M, t) => {
    const p = apply2(M, probe);
    return -(p[0] + t[0] - midB[0]) * midB[0] - (p[1] + t[1] - midB[1]) * midB[1];
  };
  const useRev = score(Mrev, tRev) > score(Mpres, tPres);
  return { toFaceId: B.id, toEdge: edgeB, M: useRev ? Mrev : Mpres, t: useRev ? tRev : tPres };
}

function torusEmbed(x, y, width, height) {
  const u = (x / width + 0.5) * Math.PI * 2;
  const v = (y / height + 0.5) * Math.PI * 2;
  const R = 1.38;
  const r = 0.38;
  return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
}

function squareTubeEmbed(faceId, x, y, length, side, twistQuarter) {
  const u = (x / length + 0.5) * Math.PI * 2;
  const R = 1.55;
  const h = side / 2;
  const twist = twistQuarter * (Math.PI / 2) * (u / (Math.PI * 2));
  const [a0, b0] = squareTubeCrossCoord(faceId, y, h);
  const a = a0 * Math.cos(twist) - b0 * Math.sin(twist);
  const b = a0 * Math.sin(twist) + b0 * Math.cos(twist);
  const radial = [Math.cos(u), Math.sin(u), 0];
  const binormal = [0, 0, 1];
  const center = [R * radial[0], R * radial[1], 0];
  return [center[0] + a * radial[0] + b * binormal[0], center[1] + a * radial[1] + b * binormal[1], b];
}

function squareTubeCrossCoord(faceId, y, h) {
  const side = ((faceId % 4) + 4) % 4;
  if (side === 0) return [h, y];
  if (side === 1) return [-y, h];
  if (side === 2) return [-h, -y];
  return [y, -h];
}

function mobiusEmbed(x, y, width, height, turns) {
  const u = (x / width + 0.5) * Math.PI * 2;
  const v = y / (height / 2);
  const R = 1.42;
  const r = 0.42;
  const twist = turns * u;
  const radial = R + v * r * Math.cos(twist);
  return [radial * Math.cos(u), radial * Math.sin(u), v * r * Math.sin(twist)];
}

function sampleField(x, y, width, height, faceId, cellsU = 12, cellsV = 8) {
  const u = x / width + 0.5;
  const v = y / height + 0.5;
  const hue = (u * 0.78 + v * 0.22 + 0.06 * Math.sin(u * Math.PI * 8)) % 1;
  const light = 0.48 + 0.2 * Math.sin((u + v) * Math.PI * 4);
  const i = Math.max(0, Math.min(cellsU - 1, Math.floor(u * cellsU)));
  const j = Math.max(0, Math.min(cellsV - 1, Math.floor(v * cellsV)));
  return sampleFromHue(hue, light, `${faceId}:${i}:${j}`);
}

function squareTubeSample(faceId, x, y, length, side) {
  const u = x / length + 0.5;
  const local = y / side + 0.5;
  const around = (faceId + local) / 4;
  const hue = (u * 0.62 + around * 0.38 + 0.04 * Math.sin(u * Math.PI * 10)) % 1;
  const light = 0.46 + 0.18 * Math.sin((u * 2 + around * 5) * Math.PI * 2);
  return sampleFromHue(hue, light, `${faceId}:${Math.floor(u * 16)}:${Math.floor(local * 4)}`);
}

function sampleFromHue(hue, light, key) {
  const midi = 36 + Math.round(hue * 38);
  return { hue, light, key, midi, color: hslToHex(hue, 0.82, light) };
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
