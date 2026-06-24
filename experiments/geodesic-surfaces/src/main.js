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
const surfaceSel = document.getElementById('surface');
const runBtn = document.getElementById('run');
const resetBtn = document.getElementById('reset');
const soundBtn = document.getElementById('sound');
const collideBtn = document.getElementById('collide');
const readout = document.getElementById('readout');
const swatches = document.getElementById('swatches');

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
container.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const rig = new THREE.Group();
rig.rotation.x = 0.95;
scene.add(rig);
scene.add(new THREE.HemisphereLight(0xdff8ff, 0x10202a, 2.6));
const key = new THREE.DirectionalLight(0xffffff, 3.0);
key.position.set(3, -4, 5);
scene.add(key);

let surface = null;
let surfaceMesh = null;
let wireMesh = null;
let gridMesh = null;
let heads = [];
let headMeshes = [];
let running = true;
let soundOn = false;
let collisionsOn = true;
let lastTime = performance.now();
let audio = null;

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

  tick() {
    this.play(31, '#fff', 0.35);
  }
}

function buildScene() {
  const spec = SURFACES.find((s) => s.id === surfaceSel.value) || SURFACES[0];
  surface = spec.build();
  orientRig(surface);
  if (surfaceMesh) rig.remove(surfaceMesh);
  if (wireMesh) rig.remove(wireMesh);
  if (gridMesh) rig.remove(gridMesh);
  for (const m of headMeshes) rig.remove(m);
  surfaceMesh = buildSurfaceMesh(surface);
  wireMesh = buildWire(surfaceMesh.geometry);
  gridMesh = buildGrid(surface);
  rig.add(surfaceMesh, wireMesh, gridMesh);
  heads = spawnHeads(surface);
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
  updateReadout();
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
    const warm = ['#ff5d5d', '#ff8a47', '#ffc857', '#fff275'];
    const cool = ['#64f4c4', '#48c7ff', '#7a8cff', '#d16bff'];
    for (let side = 0; side < 4; side++) {
      heads.push(new Head({ id: heads.length, faceId: side, x: -surf.length * 0.32, y: 0, vx: 0.58, vy: 0, color: warm[side] }));
    }
    for (let i = 0; i < 4; i++) {
      const x = -surf.length / 2 + ((i + 0.5) / 4) * surf.length;
      heads.push(new Head({ id: heads.length, faceId: 0, x, y: -surf.side * 0.36, vx: 0, vy: 0.42, color: cool[i] }));
    }
    return heads;
  }
  if (surf.kind === 'torus') {
    const face = surf.faces[0];
    const heads = [];
    const warm = ['#ff5d5d', '#ff8a47', '#ffc857', '#fff275'];
    const cool = ['#64f4c4', '#48c7ff', '#7a8cff', '#d16bff'];
    for (let j = 0; j < 4; j++) {
      const y = -face.height / 2 + ((j + 0.5) / 4) * face.height;
      heads.push(new Head({ id: heads.length, x: -face.width * 0.38, y, vx: 0.64, vy: 0, color: warm[j] }));
    }
    for (let i = 0; i < 4; i++) {
      const x = -face.width / 2 + ((i + 0.5) / 4) * face.width;
      heads.push(new Head({ id: heads.length, x, y: -face.height * 0.38, vx: 0, vy: 0.45, color: cool[i] }));
    }
    return heads;
  }
  return [
    new Head({ id: 0, x: -1.6, y: -0.33, vx: 0.72, vy: 0.29, color: '#ff6b6b' }),
    new Head({ id: 1, x: 0.6, y: 0.18, vx: -0.52, vy: 0.37, color: '#59d7ff' }),
    new Head({ id: 2, x: -0.2, y: 0.42, vx: 0.31, vy: -0.64, color: '#ffe66d' }),
  ];
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
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.66, metalness: 0.02, flatShading: true }),
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
      addGridLine(positions, 160, (t) => surf.embed({ faceId: 0, x: -face.width / 2 + t * face.width, y }, surf));
    }
    for (let i = 0; i <= uDiv; i++) {
      const x = -face.width / 2 + (i / uDiv) * face.width;
      addGridLine(positions, 96, (t) => surf.embed({ faceId: 0, x, y: -face.height / 2 + t * face.height }, surf));
    }
  } else if (surf.kind === 'squareTube') {
    const uDiv = surf.grid?.u ?? 16;
    const vDiv = surf.grid?.v ?? 4;
    for (const face of surf.faces) {
      for (let j = 0; j <= vDiv; j++) {
        const y = -surf.side / 2 + (j / vDiv) * surf.side;
        addGridLine(positions, 160, (t) => surf.embed({ faceId: face.id, x: -surf.length / 2 + t * surf.length, y }, surf));
      }
    }
    for (let i = 0; i <= uDiv; i++) {
      const x = -surf.length / 2 + (i / uDiv) * surf.length;
      for (const face of surf.faces) {
        addGridLine(positions, 12, (t) => surf.embed({ faceId: face.id, x, y: -surf.side / 2 + t * surf.side }, surf));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const group = new THREE.Group();
  group.add(new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xf5feff, transparent: true, opacity: 0.94 }),
  ));
  if (surf.kind === 'squareTube') addSquareTubeCornerRails(group, surf);
  return group;
}

function addSquareTubeCornerRails(group, surf) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xfaffff, transparent: true, opacity: 0.94 });
  for (const face of surf.faces) {
    const points = [];
    for (let i = 0; i <= 160; i++) {
      const x = -surf.length / 2 + (i / 160) * surf.length;
      const p = embedLifted(surf, face.id, x, surf.side / 2, 0.035);
      points.push(new THREE.Vector3(p[0], p[1], p[2]));
    }
    const curve = new THREE.CatmullRomCurve3(points, surf.twistQuarter === 0);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.012, 6, surf.twistQuarter === 0), mat);
    group.add(rail);
  }
}

function addGridLine(positions, steps, pointAt) {
  let prev = lift(pointAt(0));
  for (let i = 1; i <= steps; i++) {
    const p = lift(pointAt(i / steps));
    positions.push(...prev, ...p);
    prev = p;
  }
}

function embedLifted(surf, faceId, x, y, amount) {
  return lift(surf.embed({ faceId, x, y }, surf), amount);
}

function lift(p, amount = 0.022) {
  const n = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] + (p[0] / n) * amount, p[1] + (p[1] / n) * amount, p[2] + (p[2] / n) * amount];
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
      surface.stepHead(head, dt);
      const sample = surface.sample(head, surface);
      head.lastSample = sample;
      if (sample.key !== head.readKey) {
        head.readKey = sample.key;
        if (soundOn && audio) audio.play(sample.midi, sample.color);
      }
      swatchColors.push(sample.color);
    }
    if (collisionsOn) checkCollisions();
  }
  for (let i = 0; i < heads.length; i++) {
    const p = surface.embed(heads[i], surface);
    headMeshes[i].position.set(p[0], p[1], p[2]);
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
    head.readKey = sample.key;
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
  readout.innerHTML = `<b>${surface.name}</b><br>${surface.description}${trackLine}<br>${surface.faces.length} chart${surface.faces.length === 1 ? '' : 's'} · ${heads.length} reading heads`;
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
}

function wireControls() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    renderer.domElement.setPointerCapture(ev.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    rig.rotation.z += dx * 0.006;
    rig.rotation.x += dy * 0.006;
  });
  renderer.domElement.addEventListener('pointerup', () => (dragging = false));
  renderer.domElement.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      camera.position.z = Math.max(1.8, Math.min(8, camera.position.z + ev.deltaY * 0.004));
    },
    { passive: false },
  );
}

surfaceSel.addEventListener('change', buildScene);
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

window.addEventListener('resize', resize);
resize();
wireControls();
buildScene();
requestAnimationFrame(frame);

window.__surfaceLab = {
  get surface() {
    return surface;
  },
  get heads() {
    return heads;
  },
  rebuild: buildScene,
};
