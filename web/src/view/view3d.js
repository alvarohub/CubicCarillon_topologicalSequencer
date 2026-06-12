// view/view3d.js
//
// Display adapter: draws the cube and the reading-heads in 3D with three.js.
//
// The reading-heads are flat SQUARES that live IN the surface (one cell of the
// sequencer grid), oriented with each face's (u,v) frame so they stay parallel
// to the cube edges. This is deliberately LED-cube-friendly: the head is just a
// lit cell, and the same face-local (x,y) the core produces would light an LED.
//
// Key design point (answering the "blended textures" question): there is NO
// framebuffer cropping and NO baked face textures. (x,y) maps straight to 3D via
// P = C + x*u + y*v. The faces show a cell grid (the flat coordinate frame /
// monome button matrix) plus the cube wireframe.
//
// This is the ONLY module that imports three.js. The core never touches it.

import * as THREE from 'three';

export class View3D {
  constructor(surface, balls, container, opts = {}) {
    this.surface = surface;
    this.balls = balls;
    this.cells = opts.cells || 8; // grid resolution per face side

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c12);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // physically-based tone mapping makes the acrylic specular and the
    // light-emitting heads read correctly (emissive can glow past white).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.cubeGroup = new THREE.Group();
    this.scene.add(this.cubeGroup);

    // The cube BODY (faces + grid + wireframe) lives in a shell that is rendered
    // slightly SMALLER than the ideal surface the heads ride on. So the heads sit
    // just proud of the body (room for future cast shadows) AND — crucially — the
    // heads stay on the true cube (radius = half-size) with ZERO outward lift, so
    // when a head folds around an edge its two pieces meet exactly on the shared
    // edge instead of separating (a per-face lift used to pull them apart).
    this.shellGroup = new THREE.Group();
    this.shellGroup.scale.setScalar(0.985);
    this.cubeGroup.add(this.shellGroup);

    this._buildLights();
    this._buildCubeMesh();
    this._buildGrid();
    this._buildHeadMeshes();
    this._wireDrag();

    // device-orientation helpers
    this._euler = new THREE.Euler();
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X
    this._useDeviceOrientation = false;

    this._onResize();
    window.addEventListener('resize', () => this._onResize());
  }

  // Fixed scene lights (added to the SCENE, not the cubeGroup) so the specular
  // highlight slides across the acrylic as you rotate the cube — that motion is
  // what makes it read as a solid, glossy object rather than a flat panel.
  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x4a5568, 1.3)); // soft fill
    const key = new THREE.PointLight(0xffffff, 60, 0, 2); // "not so far" key light
    key.position.set(3, 4, 5);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x88aaff, 22, 0, 2); // cool rim for depth
    rim.position.set(-4, -2, 3);
    this.scene.add(rim);
  }

  _buildCubeMesh() {
    const s = this.surface.faces[0].size;
    // Acrylic-like faces: glossy clearcoat (the specular sheen the light glides
    // over) + adjustable translucency. Opacity is a live control (setCubeOpacity)
    // so the cube can range from clear acrylic to fully opaque. depthWrite stays
    // off while translucent so the light-emitting heads inside show through.
    this.cubeOpacity = 0.28;
    this.faceMats = [];
    for (const f of this.surface.faces) {
      const geo = new THREE.PlaneGeometry(s, s);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x9fc4e8,
        metalness: 0.0,
        roughness: 0.18,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        transparent: true,
        opacity: this.cubeOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.faceMats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      const u = f.u,
        v = f.v,
        n = f.n,
        C = f.C;
      mesh.matrix.set(u[0], v[0], n[0], C[0], u[1], v[1], n[1], C[1], u[2], v[2], n[2], C[2], 0, 0, 0, 1);
      this.shellGroup.add(mesh);
    }
    // wireframe edges
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s));
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x88aadd }));
    this.shellGroup.add(line);
  }

  // Live control: dial the cube from clear acrylic (0) to fully opaque (1).
  // Near 1 we switch to an opaque, depth-writing material so back faces occlude
  // properly instead of blending.
  setCubeOpacity(v) {
    this.cubeOpacity = Math.max(0, Math.min(1, v));
    const solid = this.cubeOpacity > 0.96;
    for (const m of this.faceMats) {
      m.opacity = this.cubeOpacity;
      m.transparent = !solid;
      m.depthWrite = solid;
      m.needsUpdate = true;
    }
  }

  adjustCubeOpacity(delta) {
    this.setCubeOpacity(this.cubeOpacity + delta);
    return this.cubeOpacity;
  }

  // The cell grid on every face: the flat coordinate frame / step-button matrix.
  _buildGrid() {
    const positions = [];
    for (const f of this.surface.faces) {
      const half = f.size / 2;
      const cell = f.size / this.cells;
      for (let i = 0; i <= this.cells; i++) {
        const t = -half + i * cell;
        positions.push(...this.surface.to3D(f, t, -half), ...this.surface.to3D(f, t, half));
        positions.push(...this.surface.to3D(f, -half, t), ...this.surface.to3D(f, half, t));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x24344c });
    this.shellGroup.add(new THREE.LineSegments(geo, mat));
  }

  // One flat square per reading-head — but a head near an edge is split into
  // several rectangular PIECES (see _headPieces), so each head owns a small POOL
  // of quad meshes (1 in-face + up to 2 folded overflow). Geometry is a UNIT
  // plane (1x1) so a piece can be scaled to any rectangle. No per-frame alloc.
  _buildHeadMeshes() {
    const cell = this.surface.faces[0].size / this.cells;
    // Heads sit on the TRUE surface (lift 0); the body shell is shrunk instead.
    // This keeps folded edge-pieces meeting exactly on the shared edge.
    this._lift = 0;
    this._headHalf = cell * 0.86 * 0.5; // half-side of the square head
    this._POOL = 3; // max simultaneous pieces (in-face + 2 perpendicular folds)
    this._headGlow = 1.0; // baseline emissive intensity
    this.headPools = this.balls.map((b) => {
      const base = new THREE.Color(b.color);
      const pool = [];
      for (let k = 0; k < this._POOL; k++) {
        const geo = new THREE.PlaneGeometry(1, 1);
        // A head is a LIGHT SOURCE: emissive = the instrument's colour (constant —
        // colour identifies the voice, never the pitch). We pulse only its
        // brightness on a hit, never its hue. Black base colour so only the
        // emission shows; tone mapping lets it bloom past white when pulsed.
        const mat = new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: base.clone(),
          emissiveIntensity: this._headGlow,
          roughness: 0.5,
          metalness: 0.0,
          transparent: true,
          opacity: 0.96,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        this.cubeGroup.add(mesh);
        pool.push(mesh);
      }
      return pool;
    });
  }

  // Map a face-local rectangle through an edge gluing (M, t) onto the neighbour
  // face. Because M is a signed permutation (±90° / 180° / reflection), an
  // axis-aligned rectangle maps to an axis-aligned rectangle, so we just take the
  // min/max of the mapped corners. This is the SAME isometry the ball uses to
  // cross the edge — so the folded piece meets the in-face piece exactly on the
  // shared edge, and the head visually bends around the cube instead of poking
  // out into space. (Generalizes Álvaro's 2007 "four sub-squares + framebuffer
  // crop" trick: clip + fold, driven by the atlas maps rather than a flat copy.)
  _foldRect(e, x0, x1, y0, y1) {
    const M = e.M, t = e.t;
    const xs = [], ys = [];
    for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
      xs.push(M.a * px + M.b * py + t[0]);
      ys.push(M.c * px + M.d * py + t[1]);
    }
    return {
      faceId: e.toFaceId,
      x0: Math.min(...xs), x1: Math.max(...xs),
      y0: Math.min(...ys), y1: Math.max(...ys),
    };
  }

  // Decompose a head (square centred at (cx,cy) on `faceId`, half-side s) into
  // the rectangular pieces that actually fit inside faces:
  //   - the part clipped to the current face, plus
  //   - each part that spills past an edge, FOLDED onto the neighbour.
  // The cross-axis of each overflow piece is clipped to the face bounds, which
  // DROPS the little corner sliver that would overlap two edges at once. That
  // sliver is the non-developable, cone-point case (a head sitting on a cube
  // vertex): you cannot flatten three 90° faces around a 270° corner without a
  // gap, so the square would have to SPLIT into two rectangles riding away on
  // perpendicular edges. We never reach a corner with the current row/column
  // layout, so clipping it is invisible here — but see docs/IDEAS.md §3: turning
  // that split into a visible feature is reserved for a future project.
  _headPieces(faceId, cx, cy, s) {
    const f = this.surface.faceById(faceId);
    const H = f.size / 2;
    const pieces = [
      { faceId, x0: Math.max(cx - s, -H), x1: Math.min(cx + s, H), y0: Math.max(cy - s, -H), y1: Math.min(cy + s, H) },
    ];
    const yLo = Math.max(cy - s, -H), yHi = Math.min(cy + s, H);
    const xLo = Math.max(cx - s, -H), xHi = Math.min(cx + s, H);
    if (cx + s > H && f.edges[0]) pieces.push(this._foldRect(f.edges[0], H, cx + s, yLo, yHi)); // +x
    if (cy + s > H && f.edges[1]) pieces.push(this._foldRect(f.edges[1], xLo, xHi, H, cy + s)); // +y
    if (cx - s < -H && f.edges[2]) pieces.push(this._foldRect(f.edges[2], cx - s, -H, yLo, yHi)); // -x
    if (cy - s < -H && f.edges[3]) pieces.push(this._foldRect(f.edges[3], xLo, xHi, cy - s, -H)); // -y
    return pieces;
  }

  // Place one rectangular piece flat on its face, axis-aligned to (u,v), lifted
  // slightly along the normal. Geometry is a unit plane, so column scales = the
  // piece's width/height. Hidden if the piece is degenerate (zero area).
  _placeRect(mesh, piece, lift) {
    const f = this.surface.faceById(piece.faceId);
    const w = piece.x1 - piece.x0, h = piece.y1 - piece.y0;
    if (w <= 1e-6 || h <= 1e-6) { mesh.visible = false; return; }
    const cx = (piece.x0 + piece.x1) / 2, cy = (piece.y0 + piece.y1) / 2;
    const u = f.u, v = f.v, n = f.n;
    const P = this.surface.to3D(f, cx, cy);
    mesh.matrix.set(
      u[0] * w, v[0] * h, n[0], P[0] + n[0] * lift,
      u[1] * w, v[1] * h, n[1], P[1] + n[1] * lift,
      u[2] * w, v[2] * h, n[2], P[2] + n[2] * lift,
      0, 0, 0, 1,
    );
    mesh.visible = true;
  }

  // pointer drag rotates the cube (on a phone the device orientation takes over)
  _wireDrag() {
    const el = this.renderer.domElement;
    let dragging = false,
      px = 0,
      py = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this._useDeviceOrientation) return;
      const dx = e.clientX - px,
        dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      this.cubeGroup.rotation.y += dx * 0.01;
      this.cubeGroup.rotation.x += dy * 0.01;
    });
  }

  setDeviceOrientation(alphaDeg, betaDeg, gammaDeg) {
    this._useDeviceOrientation = true;
    const deg = Math.PI / 180;
    const alpha = (alphaDeg || 0) * deg;
    const beta = (betaDeg || 0) * deg;
    const gamma = (gammaDeg || 0) * deg;
    this._euler.set(beta, alpha, -gamma, 'YXZ');
    this.cubeGroup.quaternion.setFromEuler(this._euler);
    this.cubeGroup.quaternion.multiply(this._q1);
  }

  // current local->world rotation as a row-major 3x3 array (for engine gravity)
  rotationArray() {
    this.cubeGroup.updateMatrixWorld();
    const e = this.cubeGroup.matrixWorld.elements; // column-major
    return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
  }

  flash(ball) {
    ball.flash = performance.now();
  }

  // read head state from the core and update the square meshes
  sync(now) {
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      const pool = this.headPools[i];
      const dt = now - b.flash;
      const k = dt < 220 ? 1 - dt / 220 : 0; // hit pulse 1 -> 0
      // A hit pulses BRIGHTNESS only (the head flares like a struck LED); its
      // colour — the instrument identity — never changes. The square also stays
      // exactly one cell (no growth that would poke back past the folded edge).
      const glow = this._headGlow + k * 1.8;
      const pieces = this._headPieces(b.faceId, b.x, b.y, this._headHalf);
      for (let k2 = 0; k2 < pool.length; k2++) {
        const mesh = pool[k2];
        if (k2 < pieces.length) {
          this._placeRect(mesh, pieces[k2], this._lift);
          mesh.material.emissiveIntensity = glow;
        } else {
          mesh.visible = false;
        }
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
