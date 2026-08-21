import * as THREE from 'three';
import { Head, createFlatTorus, createIcosaSphere, createSquareTube } from './atlas.js';

const SURFACES = [
  { id: 'torus', label: 'Flat torus', build: createFlatTorus },
  { id: 'tube0', label: 'Square tube torus', build: () => createSquareTube(0) },
  { id: 'tube90', label: 'Square tube, 90 twist', build: () => createSquareTube(1) },
  { id: 'tube180', label: 'Square tube, 180 twist', build: () => createSquareTube(2) },
  { id: 'tube270', label: 'Square tube, 270 twist', build: () => createSquareTube(3) },
  { id: 'sphere', label: 'Icosahedral sphere', build: createIcosaSphere },
];

const container = document.getElementById('app');
const panel = document.getElementById('panel');
const collapseBtn = document.getElementById('collapse');
const surfaceSel = document.getElementById('surface');
const runBtn = document.getElementById('run');
const resetBtn = document.getElementById('reset');
const soundBtn = document.getElementById('sound');
const collideBtn = document.getElementById('collide');
const structureBtn = document.getElementById('structure');
const surfaceAlphaInput = document.getElementById('surfaceAlpha');
const armedColorInput = document.getElementById('armedColor');
const unarmedColorInput = document.getElementById('unarmedColor');
const readout = document.getElementById('readout');
const swatches = document.getElementById('swatches');
const tracksEl = document.getElementById('tracks');

for (const s of SURFACES) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.label;
  surfaceSel.appendChild(opt);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#071013');
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, -5.8, 3.0);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const rig = new THREE.Group();
rig.rotation.x = 0.95;
scene.add(rig);
buildLights();

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const DRUMS = [
  { name: 'Kick', type: 'kick' },
  { name: 'Snare', type: 'snare' },
  { name: 'Hat', type: 'hat' },
  { name: 'Tom', type: 'tom' },
  { name: 'Clap', type: 'clap' },
  { name: 'Rim', type: 'rim' },
];
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

let surface = null;
let surfaceMesh = null;
let wireMesh = null;
let gridMesh = null;
let cellGroup = null;
let cellMeshes = [];
let cellByKey = new Map();
let heads = [];
let headMeshes = [];
let running = true;
let soundOn = false;
let collisionsOn = true;
let structureVisible = true;
let cellAlpha = Number(surfaceAlphaInput?.value ?? 0.08);
let armedColor = armedColorInput?.value ?? '#fff3a8';
let unarmedColor = unarmedColorInput?.value ?? '#ffffff';
let lastTime = performance.now();
let audio = null;
let currentSurfaceId = null;
const score = new Set();
let noteHits = 0;
let notePlays = 0;
const hitLog = [];
const target = new THREE.Vector3(0, 0, 0);
let cameraDistance = 6.5;

class TinySynth {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(midi, color, gain = 0.55) {
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = midi < 48 ? 'triangle' : 'sine';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playDrum(type, gain = 0.85) {
    this.resume();
    if (type === 'kick') return this.kick(gain);
    if (type === 'snare') return this.snare(gain);
    if (type === 'hat') return this.hat(gain);
    if (type === 'tom') return this.tom(gain);
    if (type === 'clap') return this.clap(gain);
    return this.rim(gain);
  }

  kick(gain) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.13);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  snare(gain) {
    const now = this.ctx.currentTime;
    this.noiseBurst(now, 0.18, 900, 1.0, gain * 0.75);
    this.toneBurst(now, 185, 0.11, 'triangle', gain * 0.28);
  }

  hat(gain) {
    const now = this.ctx.currentTime;
    this.noiseBurst(now, 0.055, 6500, 0.65, gain * 0.42, 'highpass');
  }

  tom(gain) {
    const now = this.ctx.currentTime;
    this.toneBurst(now, 128, 0.24, 'sine', gain * 0.72, 82);
  }

  clap(gain) {
    const now = this.ctx.currentTime;
    for (const offset of [0, 0.018, 0.034]) this.noiseBurst(now + offset, 0.045, 1800, 0.85, gain * 0.34);
    this.noiseBurst(now + 0.055, 0.16, 1400, 0.75, gain * 0.22);
  }

  rim(gain) {
    const now = this.ctx.currentTime;
    this.toneBurst(now, 720, 0.055, 'square', gain * 0.34);
    this.toneBurst(now, 1120, 0.04, 'sine', gain * 0.18);
  }

  toneBurst(when, freq, dur, wave, gain, endFreq = null) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, when);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, when + dur * 0.8);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  noiseBurst(when, dur, cutoff, q, gain, filterType = 'bandpass') {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(cutoff, when);
    filter.Q.setValueAtTime(q, when);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  tick() {
    this.playDrum('rim', 0.45);
  }
}

function buildScene({ clearScore = false } = {}) {
  const spec = SURFACES.find((s) => s.id === surfaceSel.value) || SURFACES[0];
  if (clearScore || currentSurfaceId !== spec.id) score.clear();
  currentSurfaceId = spec.id;
  surface = spec.build();
  orientRig(surface);
  if (surfaceMesh) rig.remove(surfaceMesh);
  if (wireMesh) rig.remove(wireMesh);
  if (gridMesh) rig.remove(gridMesh);
  if (cellGroup) rig.remove(cellGroup);
  for (const m of headMeshes) rig.remove(m);
  surfaceMesh = buildSurfaceMesh(surface);
  wireMesh = buildWire(surfaceMesh.geometry);
  gridMesh = buildGrid(surface);
  cellGroup = buildCellLayer(surface);
  rig.add(surfaceMesh, wireMesh, gridMesh, cellGroup);
  applyStructureVisibility();
  heads = spawnHeads(surface);
  for (const head of heads) {
    head.baseSpeed = Math.hypot(head.vx, head.vy) || 1;
    head.speed = head.speed ?? 1;
    head.muted = head.muted ?? false;
    head.instrument = head.instrument ?? head.id % DRUMS.length;
  }
  headMeshes = heads.map((head) => {
    const mat = new THREE.MeshStandardMaterial({
      color: head.color,
      emissive: head.color,
      emissiveIntensity: 1.6,
      roughness: 0.25,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), mat);
    rig.add(mesh);
    return mesh;
  });
  sampleAndPlaceHeads();
  buildTrackControls();
  updateReadout();
}

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xf2fbff, 0x24303a, 3.4));
  scene.add(new THREE.AmbientLight(0x9aa6ba, 1.25));

  const key = new THREE.DirectionalLight(0xffffff, 3.8);
  key.position.set(3.8, -4.2, 5.2);
  scene.add(key);

  const top = new THREE.DirectionalLight(0xffffff, 2.3);
  top.position.set(0, 6.5, 4.2);
  scene.add(top);

  const sideLights = [
    [0x76d7ff, 2.45, [-3.6, 2.3, 2.3]],
    [0xffcf88, 2.05, [3.1, 3.0, -2.8]],
    [0x9cffb8, 1.55, [-2.5, -3.2, 1.4]],
    [0xff7ab6, 1.35, [2.6, -2.8, 2.2]],
  ];
  for (const [color, intensity, position] of sideLights) {
    const light = new THREE.PointLight(color, intensity, 7.5);
    light.position.set(...position);
    scene.add(light);
  }
}

function spawnHeads(surf) {
  if (surf.kind === 'polyhedron') {
    return [
      new Head({ id: 0, faceId: 0, x: -0.15, y: -0.1, vx: 0.46, vy: 0.23, color: '#ff6b6b' }),
      new Head({ id: 1, faceId: 6, x: 0.05, y: 0.12, vx: -0.34, vy: 0.31, color: '#59d7ff' }),
      new Head({ id: 2, faceId: 13, x: 0.08, y: -0.08, vx: 0.28, vy: -0.36, color: '#ffe66d' }),
    ];
  }
  if (surf.kind === 'squareTube') {
    const heads = [];
    const uDiv = surf.grid?.u ?? 16;
    const vDiv = surf.grid?.v ?? 4;
    const lengthwiseTracks = 4 * vDiv;
    const crossTracks = uDiv;
    for (let lane = 0; lane < lengthwiseTracks; lane++) {
      const crossCell = lane;
      const faceId = Math.min(3, Math.floor(crossCell / vDiv));
      const row = crossCell % vDiv;
      const y = cellCenter(-surf.side / 2, surf.side / 2, vDiv, row);
      heads.push(
        new Head({
          id: heads.length,
          faceId,
          x: -surf.length * 0.32,
          y,
          vx: 0.58,
          vy: 0,
          color: trackColor(0.0, 0.15, lane, lengthwiseTracks),
        }),
      );
    }
    for (let i = 0; i < crossTracks; i++) {
      const col = i;
      const x = cellCenter(-surf.length / 2, surf.length / 2, uDiv, col);
      const y = cellCenter(-surf.side / 2, surf.side / 2, vDiv, 0);
      heads.push(
        new Head({ id: heads.length, faceId: 0, x, y, vx: 0, vy: 0.42, color: trackColor(0.42, 0.72, i, crossTracks) }),
      );
    }
    return heads;
  }
  if (surf.kind === 'torus') {
    const face = surf.faces[0];
    const heads = [];
    const uDiv = surf.grid?.u ?? 16;
    const vDiv = surf.grid?.v ?? 12;
    for (let row = 0; row < vDiv; row++) {
      const y = cellCenter(-face.height / 2, face.height / 2, vDiv, row);
      heads.push(
        new Head({
          id: heads.length,
          x: -face.width * 0.38,
          y,
          vx: 0.64,
          vy: 0,
          color: trackColor(0.0, 0.15, row, vDiv),
        }),
      );
    }
    for (let col = 0; col < uDiv; col++) {
      const x = cellCenter(-face.width / 2, face.width / 2, uDiv, col);
      const y = cellCenter(-face.height / 2, face.height / 2, vDiv, 0);
      heads.push(new Head({ id: heads.length, x, y, vx: 0, vy: 0.45, color: trackColor(0.42, 0.72, col, uDiv) }));
    }
    return heads;
  }
  return [
    new Head({ id: 0, x: -1.6, y: -0.33, vx: 0.72, vy: 0.29, color: '#ff6b6b' }),
    new Head({ id: 1, x: 0.6, y: 0.18, vx: -0.52, vy: 0.37, color: '#59d7ff' }),
    new Head({ id: 2, x: -0.2, y: 0.42, vx: 0.31, vy: -0.64, color: '#ffe66d' }),
  ];
}

function cellCenter(min, max, divisions, index) {
  return min + ((index + 0.5) / divisions) * (max - min);
}

function trackColor(h0, h1, index, count) {
  const t = count <= 1 ? 0 : index / (count - 1);
  return `#${new THREE.Color().setHSL(h0 + (h1 - h0) * t, 0.86, 0.58).getHexString()}`;
}

function buildSurfaceMesh(surf) {
  if (surf.kind === 'torus') {
    const geo = new THREE.TorusGeometry(1.38, 0.38, 42, 160);
    paintByPosition(geo);
    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02 }),
    );
  }
  if (surf.kind === 'twist') {
    const geo = twistedStripGeometry(surf);
    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5 }),
    );
  }
  if (surf.kind === 'squareTube') {
    const geo = squareTubeGeometry(surf);
    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.66,
        metalness: 0.02,
        flatShading: true,
      }),
    );
  }
  const positions = [];
  const colors = [];
  for (const face of surf.faces) {
    const c = new THREE.Color(surf.sample({ faceId: face.id, x: 0, y: 0 }, surf).color);
    for (const p of face.verts3) {
      positions.push(...p);
      colors.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.02 }));
}

function buildWire(geo) {
  return new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xb7e6ff, transparent: true, opacity: 0.16 }),
  );
}

function orientRig(surf) {
  if (surf.kind === 'squareTube') {
    rig.rotation.set(1.12, 0.38, -0.48);
  } else if (surf.kind === 'torus') {
    rig.rotation.set(1.02, 0.18, -0.18);
  } else {
    rig.rotation.set(0.95, 0, 0);
  }
}

function buildGrid(surf) {
  const positions = [];
  if (surf.kind === 'torus') {
    const face = surf.faces[0];
    const uDiv = surf.grid?.u ?? 12;
    const vDiv = surf.grid?.v ?? 8;
    for (let j = 0; j <= vDiv; j++) {
      const y = -face.height / 2 + (j / vDiv) * face.height;
      addGridLine(positions, 160, (t) => embedOffset(surf, 0, -face.width / 2 + t * face.width, y, 0.01));
    }
    for (let i = 0; i <= uDiv; i++) {
      const x = -face.width / 2 + (i / uDiv) * face.width;
      addGridLine(positions, 96, (t) => embedOffset(surf, 0, x, -face.height / 2 + t * face.height, 0.01));
    }
  } else if (surf.kind === 'squareTube') {
    const uDiv = surf.grid?.u ?? 16;
    const vDiv = surf.grid?.v ?? 4;
    for (const face of surf.faces) {
      for (let j = 0; j <= vDiv; j++) {
        const y = -surf.side / 2 + (j / vDiv) * surf.side;
        addGridLine(positions, 160, (t) => embedOffset(surf, face.id, -surf.length / 2 + t * surf.length, y, 0.01));
      }
    }
    for (let i = 0; i <= uDiv; i++) {
      const x = -surf.length / 2 + (i / uDiv) * surf.length;
      for (const face of surf.faces) {
        addGridLine(positions, 12, (t) => embedOffset(surf, face.id, x, -surf.side / 2 + t * surf.side, 0.01));
      }
    }
  } else if (surf.kind === 'polyhedron') {
    for (const face of surf.faces) {
      for (let i = 0; i < face.verts2.length; i++) {
        const a = face.verts2[i];
        const b = face.verts2[(i + 1) % face.verts2.length];
        positions.push(
          ...embedOffset(surf, face.id, a[0], a[1], 0.012),
          ...embedOffset(surf, face.id, b[0], b[1], 0.012),
        );
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const group = new THREE.Group();
  group.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xf5feff,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
      }),
    ),
  );
  group.renderOrder = 8;
  if (surf.kind === 'squareTube') addSquareTubeCornerRails(group, surf);
  return group;
}

function buildCellLayer(surf) {
  const group = new THREE.Group();
  cellMeshes = [];
  cellByKey = new Map();
  for (const cell of cellsForSurface(surf)) {
    const mesh = new THREE.Mesh(cellGeometry(surf, cell), cellMaterial(cell.key));
    mesh.userData.cell = cell;
    mesh.userData.flash = 0;
    mesh.userData.pop = 0;
    mesh.userData.normal = mesh.geometry.userData.normal ?? [0, 0, 1];
    mesh.renderOrder = 4;
    group.add(mesh);
    cellMeshes.push(mesh);
    cellByKey.set(cell.key, mesh);
  }
  return group;
}

function cellsForSurface(surf) {
  const cells = [];
  for (const face of surf.faces) {
    const grid = gridForFace(surf, face);
    if (grid.kind === 'triangle') {
      cells.push({ key: cellKey(face.id, 0, 0), faceId: face.id, i: 0, j: 0, grid, kind: 'triangle' });
      continue;
    }
    for (let j = 0; j < grid.v; j++) {
      for (let i = 0; i < grid.u; i++) {
        cells.push({ key: cellKey(face.id, i, j), faceId: face.id, i, j, grid, kind: 'rect' });
      }
    }
  }
  return cells;
}

function gridForFace(surf, face) {
  if (face.verts2.length === 3) return { kind: 'triangle', u: 1, v: 1 };
  const xs = face.verts2.map((p) => p[0]);
  const ys = face.verts2.map((p) => p[1]);
  return {
    kind: 'rect',
    u: surf.grid?.u ?? 12,
    v: surf.grid?.v ?? 8,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function cellGeometry(surf, cell) {
  if (cell.kind === 'triangle') {
    const face = surf.faceById(cell.faceId);
    const positions = [];
    for (const p of face.verts2) positions.push(...embedOnSurface(surf, face.id, p[0], p[1]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    geo.userData.normal = face.n ?? [0, 0, 1];
    return geo;
  }

  const g = cell.grid;
  const x0 = g.minX + (cell.i / g.u) * (g.maxX - g.minX);
  const x1 = g.minX + ((cell.i + 1) / g.u) * (g.maxX - g.minX);
  const y0 = g.minY + (cell.j / g.v) * (g.maxY - g.minY);
  const y1 = g.minY + ((cell.j + 1) / g.v) * (g.maxY - g.minY);
  const cols = surf.kind === 'torus' ? 8 : 6;
  const rows = surf.kind === 'torus' ? 4 : 2;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const positions = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    const y = y0 + (row / rows) * (y1 - y0);
    for (let col = 0; col <= cols; col++) {
      const x = x0 + (col / cols) * (x1 - x0);
      positions.push(...embedOnSurface(surf, cell.faceId, x, y));
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * (cols + 1) + col;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.normal = surfaceNormal(surf, cell.faceId, centerX, centerY);
  return geo;
}

function cellMaterial(key) {
  const armed = score.has(key);
  return new THREE.MeshPhysicalMaterial({
    color: armed ? armedColor : unarmedColor,
    transparent: true,
    opacity: cellAlpha,
    depthTest: true,
    depthWrite: true,
    roughness: 0.18,
    metalness: 0.02,
    clearcoat: 0.75,
    clearcoatRoughness: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
}

function setCellVisual(mesh) {
  const armed = score.has(mesh.userData.cell.key);
  const flash = mesh.userData.flash ?? 0;
  const pop = mesh.userData.pop ?? 0;
  const normal = mesh.userData.normal ?? [0, 0, 1];
  mesh.material.color.set(flash > 0 ? 0xffffff : armed ? armedColor : unarmedColor);
  mesh.material.opacity = flash > 0 ? Math.max(0.82, cellAlpha) : cellAlpha;
  mesh.material.depthWrite = true;
  mesh.material.transparent = cellAlpha < 0.98 || flash > 0;
  mesh.position.set(normal[0] * pop * 0.08, normal[1] * pop * 0.08, normal[2] * pop * 0.08);
}

function refreshCellVisuals() {
  for (const mesh of cellMeshes) setCellVisual(mesh);
}

function applyStructureVisibility() {
  if (wireMesh) wireMesh.visible = structureVisible;
  if (surfaceMesh) surfaceMesh.visible = structureVisible;
}

function updateCamera() {
  camera.position.set(target.x, target.y - cameraDistance, target.z + cameraDistance * 0.52);
  camera.lookAt(target);
}

function toggleCell(mesh) {
  const key = mesh.userData.cell.key;
  if (score.has(key)) score.delete(key);
  else score.add(key);
  setCellVisual(mesh);
  updateReadout();
}

function strikeCell(key) {
  const mesh = cellByKey.get(key);
  if (!mesh) return;
  noteHits += 1;
  hitLog.push({ key, at: performance.now() });
  if (hitLog.length > 32) hitLog.shift();
  mesh.userData.flash = 1;
  mesh.userData.pop = 1;
  setCellVisual(mesh);
}

function decayCellFlashes() {
  for (const mesh of cellMeshes) {
    const flash = mesh.userData.flash ?? 0;
    const pop = mesh.userData.pop ?? 0;
    if (flash <= 0 && pop <= 0) continue;
    mesh.userData.flash = Math.max(0, flash - 0.08);
    mesh.userData.pop = Math.max(0, pop - 0.025);
    setCellVisual(mesh);
  }
}

function pickCell(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointerNdc, camera);
  rig.updateMatrixWorld(true);
  const surfaceHit = raycaster.intersectObject(surfaceMesh, false)[0];
  const maxDistance = surfaceHit ? surfaceHit.distance + 0.12 : Infinity;
  const hit = raycaster
    .intersectObjects(cellMeshes, false)
    .find((entry) => entry.object.visible && entry.distance <= maxDistance);
  if (hit) toggleCell(hit.object);
}

function cellKey(faceId, i, j) {
  return `${faceId}:${i}:${j}`;
}

function cellAtHead(surf, head) {
  const face = surf.faceById(head.faceId);
  const grid = gridForFace(surf, face);
  if (grid.kind === 'triangle') return { key: cellKey(face.id, 0, 0), faceId: face.id, i: 0, j: 0, grid };
  const u = Math.max(0, Math.min(0.999999, (head.x - grid.minX) / (grid.maxX - grid.minX)));
  const v = Math.max(0, Math.min(0.999999, (head.y - grid.minY) / (grid.maxY - grid.minY)));
  const i = Math.floor(u * grid.u);
  const j = Math.floor(v * grid.v);
  return { key: cellKey(face.id, i, j), faceId: face.id, i, j, grid };
}

function pitchForHead(head) {
  return DRUMS[head.instrument]?.type ?? 'rim';
}

function addSquareTubeCornerRails(group, surf) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xfaffff, transparent: true, opacity: 0.94 });
  for (const face of surf.faces) {
    const points = [];
    for (let i = 0; i <= 160; i++) {
      const x = -surf.length / 2 + (i / 160) * surf.length;
      const p = embedOnSurface(surf, face.id, x, surf.side / 2);
      points.push(new THREE.Vector3(p[0], p[1], p[2]));
    }
    const curve = new THREE.CatmullRomCurve3(points, surf.twistQuarter === 0);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.012, 6, surf.twistQuarter === 0), mat);
    group.add(rail);
  }
}

function addGridLine(positions, steps, pointAt) {
  let prev = pointAt(0);
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(i / steps);
    positions.push(...prev, ...p);
    prev = p;
  }
}

function embedOnSurface(surf, faceId, x, y) {
  return surf.embed({ faceId, x, y }, surf);
}

function embedOffset(surf, faceId, x, y, amount) {
  const p = surf.embed({ faceId, x, y }, surf);
  const n = surfaceNormal(surf, faceId, x, y);
  return [p[0] + n[0] * amount, p[1] + n[1] * amount, p[2] + n[2] * amount];
}

function surfaceNormal(surf, faceId, x, y) {
  const face = surf.faceById?.(faceId);
  if (face?.verts2?.length === 3 && face.n) return face.n;
  const grid = face ? gridForFace(surf, face) : null;
  const spanX = grid?.kind === 'rect' ? grid.maxX - grid.minX : 1;
  const spanY = grid?.kind === 'rect' ? grid.maxY - grid.minY : 1;
  const dx = Math.max(spanX * 1e-4, 1e-4);
  const dy = Math.max(spanY * 1e-4, 1e-4);
  const px0 = surf.embed({ faceId, x: x - dx, y }, surf);
  const px1 = surf.embed({ faceId, x: x + dx, y }, surf);
  const py0 = surf.embed({ faceId, x, y: y - dy }, surf);
  const py1 = surf.embed({ faceId, x, y: y + dy }, surf);
  const tx = new THREE.Vector3(px1[0] - px0[0], px1[1] - px0[1], px1[2] - px0[2]);
  const ty = new THREE.Vector3(py1[0] - py0[0], py1[1] - py0[1], py1[2] - py0[2]);
  const n = tx.cross(ty).normalize();
  return Number.isFinite(n.x) ? [n.x, n.y, n.z] : [0, 0, 1];
}

function paintByPosition(geo) {
  const pos = geo.getAttribute('position');
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const c = new THREE.Color().setHSL(
      (Math.atan2(pos.getY(i), pos.getX(i)) / (Math.PI * 2) + 1) % 1,
      0.72,
      0.5 + 0.18 * pos.getZ(i),
    );
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function twistedStripGeometry(surf) {
  const face = surf.faces[0];
  const cols = 128;
  const rows = 12;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let i = 0; i <= cols; i++) {
    const x = -face.width / 2 + (i / cols) * face.width;
    for (let j = 0; j <= rows; j++) {
      const y = -face.height / 2 + (j / rows) * face.height;
      const p = surf.embed({ x, y });
      const sample = surf.sample({ faceId: 0, x, y });
      const c = new THREE.Color(sample.color);
      positions.push(...p);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function squareTubeGeometry(surf) {
  const cols = 144;
  const rows = 1;
  const positions = [];
  const colors = [];
  const indices = [];
  let offset = 0;
  for (const face of surf.faces) {
    for (let i = 0; i <= cols; i++) {
      const x = -surf.length / 2 + (i / cols) * surf.length;
      for (let j = 0; j <= rows; j++) {
        const y = -surf.side / 2 + (j / rows) * surf.side;
        const p = surf.embed({ faceId: face.id, x, y }, surf);
        const sample = surf.sample({ faceId: face.id, x, y }, surf);
        const c = new THREE.Color(sample.color);
        positions.push(...p);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = offset + i * (rows + 1) + j;
        const b = a + rows + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    offset += (cols + 1) * (rows + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function update(dt) {
  const swatchColors = [];
  if (running) {
    for (const head of heads) {
      if (head.muted) {
        swatchColors.push(head.lastSample?.color ?? head.color);
        continue;
      }
      const speedNow = Math.hypot(head.vx, head.vy) || 1;
      const targetSpeed = head.baseSpeed * head.speed;
      head.vx = (head.vx / speedNow) * targetSpeed;
      head.vy = (head.vy / speedNow) * targetSpeed;
      surface.stepHead(head, dt);
      const sample = surface.sample(head, surface);
      const cell = cellAtHead(surface, head);
      head.lastSample = sample;
      if (cell.key !== head.readKey) {
        head.readKey = cell.key;
        if (score.has(cell.key)) {
          if (soundOn && audio) {
            notePlays += 1;
            audio.playDrum(pitchForHead(head), 0.9);
          }
          strikeCell(cell.key);
        }
      }
      swatchColors.push(sample.color);
    }
    if (collisionsOn) checkCollisions();
  }
  decayCellFlashes();
  for (let i = 0; i < heads.length; i++) {
    const p = surface.embed(heads[i], surface);
    headMeshes[i].position.set(p[0], p[1], p[2]);
    headMeshes[i].visible = !heads[i].muted;
    if (heads[i].lastSample) {
      headMeshes[i].material.color.set(heads[i].lastSample.color);
      headMeshes[i].material.emissive.set(heads[i].lastSample.color);
    }
  }
  updateSwatches(swatchColors);
}

function sampleAndPlaceHeads() {
  const swatchColors = [];
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    const sample = surface.sample(head, surface);
    head.lastSample = sample;
    head.readKey = cellAtHead(surface, head).key;
    swatchColors.push(sample.color);
    const p = surface.embed(head, surface);
    headMeshes[i].position.set(p[0], p[1], p[2]);
    headMeshes[i].material.color.set(sample.color);
    headMeshes[i].material.emissive.set(sample.color);
  }
  updateSwatches(swatchColors);
}

function checkCollisions() {
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const a = surface.embed(heads[i], surface);
      const b = surface.embed(heads[j], surface);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < 0.13) {
        if (soundOn && audio) audio.tick();
        headMeshes[i].scale.setScalar(1.9);
        headMeshes[j].scale.setScalar(1.9);
      }
    }
  }
  for (const mesh of headMeshes) mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);
}

function updateSwatches(colors) {
  swatches.innerHTML = '';
  for (const color of colors) {
    const d = document.createElement('div');
    d.className = 'swatch';
    d.style.background = color;
    swatches.appendChild(d);
  }
}

function updateReadout() {
  const trackLine = surface.trackInfo ? `<br>${surface.trackInfo}` : '';
  readout.innerHTML = `<b>${surface.name}</b><br>${surface.description}${trackLine}<br>${surface.faces.length} chart${surface.faces.length === 1 ? '' : 's'} · ${heads.length} reading heads · ${score.size} armed note${score.size === 1 ? '' : 's'}`;
}

function buildTrackControls() {
  if (!tracksEl) return;
  tracksEl.innerHTML = '';
  for (const head of heads) {
    const row = document.createElement('div');
    row.className = 'track-row';
    const name = document.createElement('div');
    name.className = 'track-name';
    name.textContent = `H${head.id + 1}`;

    const run = document.createElement('button');
    run.textContent = head.muted ? '▶' : '■';
    run.classList.toggle('on', !head.muted);
    run.addEventListener('click', () => {
      head.muted = !head.muted;
      run.textContent = head.muted ? '▶' : '■';
      run.classList.toggle('on', !head.muted);
    });

    const inst = document.createElement('select');
    DRUMS.forEach((drum, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = drum.name;
      inst.appendChild(opt);
    });
    inst.value = head.instrument;
    inst.addEventListener('change', () => (head.instrument = Number(inst.value)));

    const speed = document.createElement('select');
    SPEEDS.forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = `${value}×`;
      speed.appendChild(opt);
    });
    speed.value = head.speed;
    speed.addEventListener('change', () => (head.speed = Number(speed.value)));

    row.append(name, run, inst, speed);
    tracksEl.appendChild(row);
  }
}

function frame(now) {
  const dt = Math.min(0.04, (now - lastTime) / 1000);
  lastTime = now;
  try {
    update(dt);
    renderer.render(scene, camera);
  } catch (err) {
    console.error('surface lab frame error', err);
  }
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateCamera();
}

function wireControls() {
  let dragging = false;
  let button = 0;
  let moved = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    dragging = true;
    button = ev.button;
    moved = false;
    downX = ev.clientX;
    downY = ev.clientY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    renderer.domElement.setPointerCapture(ev.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) moved = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (button === 2 || ev.shiftKey) {
      target.x -= dx * 0.006 * cameraDistance;
      target.z += dy * 0.006 * cameraDistance;
      updateCamera();
    } else {
      rig.rotation.z += dx * 0.006;
      rig.rotation.x += dy * 0.006;
    }
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (dragging && !moved) pickCell(ev);
    dragging = false;
  });
  renderer.domElement.addEventListener('pointercancel', () => (dragging = false));
  renderer.domElement.addEventListener('contextmenu', (ev) => ev.preventDefault());
  renderer.domElement.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      cameraDistance = Math.max(2.2, Math.min(12, cameraDistance * Math.exp(ev.deltaY * 0.0012)));
      updateCamera();
    },
    { passive: false },
  );
}

surfaceSel.addEventListener('change', () => buildScene({ clearScore: true }));
collapseBtn?.addEventListener('click', () => {
  const collapsed = !panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed', collapsed);
  collapseBtn.textContent = collapsed ? '+' : '−';
});
runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.textContent = running ? 'pause' : 'run';
  runBtn.classList.toggle('on', running);
});
resetBtn.addEventListener('click', buildScene);
soundBtn.addEventListener('click', () => {
  if (!audio) audio = new TinySynth();
  audio.resume();
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? 'sound off' : 'sound on';
  soundBtn.classList.toggle('on', soundOn);
});
collideBtn.addEventListener('click', () => {
  collisionsOn = !collisionsOn;
  collideBtn.classList.toggle('on', collisionsOn);
});
structureBtn?.addEventListener('click', () => {
  structureVisible = !structureVisible;
  structureBtn.textContent = structureVisible ? 'object on' : 'object off';
  structureBtn.classList.toggle('on', structureVisible);
  applyStructureVisibility();
});
surfaceAlphaInput?.addEventListener('input', () => {
  cellAlpha = Number(surfaceAlphaInput.value);
  refreshCellVisuals();
});
armedColorInput?.addEventListener('input', () => {
  armedColor = armedColorInput.value;
  refreshCellVisuals();
});
unarmedColorInput?.addEventListener('input', () => {
  unarmedColor = unarmedColorInput.value;
  refreshCellVisuals();
});

window.addEventListener('resize', resize);
resize();
wireControls();
buildScene();
updateCamera();
requestAnimationFrame(frame);

window.__surfaceLab = {
  get surface() {
    return surface;
  },
  get heads() {
    return heads;
  },
  get score() {
    return score;
  },
  get cellMeshes() {
    return cellMeshes;
  },
  get noteHits() {
    return noteHits;
  },
  get notePlays() {
    return notePlays;
  },
  get hitLog() {
    return hitLog;
  },
  scene,
  camera,
  renderer,
  rig,
  rebuild: buildScene,
};
