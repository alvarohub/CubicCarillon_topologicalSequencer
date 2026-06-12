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
    this._buildArmedCells();
    this._buildMutedCells();
    this._buildHeadMeshes();
    this._buildGizmo();
    this._wireDrag();

    // picking (click a head -> instrument menu; click a cell -> toggle the score)
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._struck = new Map(); // "faceId:i:j" -> timestamp, for the strike flash
    this.pickHandler = null; // set by controls; receives a pick result object

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
    // Body colour is a live control too (setCubeColor); default a very dark red,
    // so the white note pads read like ivory keys on dark lacquer.
    this.cubeOpacity = 0.28;
    this.cubeColor = '#3a0a0a';
    this.faceMats = [];
    this.faceMeshes = [];
    for (const f of this.surface.faces) {
      const geo = new THREE.PlaneGeometry(s, s);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(this.cubeColor),
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
      mesh.userData = { pick: 'face', faceId: f.id };
      const u = f.u,
        v = f.v,
        n = f.n,
        C = f.C;
      mesh.matrix.set(u[0], v[0], n[0], C[0], u[1], v[1], n[1], C[1], u[2], v[2], n[2], C[2], 0, 0, 0, 1);
      this.shellGroup.add(mesh);
      this.faceMeshes.push(mesh);
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

  // Live control: the cube body colour (hex string from the UI colour picker).
  setCubeColor(hex) {
    this.cubeColor = hex;
    const c = new THREE.Color(hex);
    for (const m of this.faceMats) m.color.copy(c);
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

  // The SCORE: armed cells drawn as warm AMBER pads on the surface — their
  // brightness encodes the note's VELOCITY (the press-and-drag gesture). A pad
  // flares to bright WHITE when a head strikes it: the flash changes COLOUR as
  // well as intensity, so it stays perceptible whatever the base brightness.
  // Pads sit a hair above the face along the normal (PAD_LIFT) so they never
  // z-fight the body even at full opacity. Meshes are (re)built whenever the
  // armed set changes — the set is small (<= 6 * cells^2), so a rebuild on edit
  // is cheap and simple.
  _buildArmedCells() {
    this.armedGroup = new THREE.Group();
    this.shellGroup.add(this.armedGroup);
    this._armedMeshes = new Map(); // "faceId:i:j" -> filled pad mesh
    this._armedOutlines = new Map(); // "faceId:i:j" -> contour (muted slice)
    this._armedBaseGlow = 0.5;
    this._padColor = new THREE.Color(0xffb45d); // warm amber — clearly not white
    this._padFlash = new THREE.Color(0xffffff); // strike flash colour
    this._PAD_LIFT = 0.006; // above the muted strips, above the face
    this._MUTE_LIFT = 0.003;
  }

  // brightness encoding of a cell's velocity (0..1)
  _padGlow(v) {
    return 0.16 + v * 0.7;
  }

  // Dark translucent strips marking MUTED slices (the cells of a muted track's
  // ring). Armed cells inside them are drawn as contour-only by refreshArmedCells.
  _buildMutedCells() {
    this.mutedGroup = new THREE.Group();
    this.shellGroup.add(this.mutedGroup);
    this._mutedMeshes = [];
  }

  refreshMutedCells(mutedKeys) {
    for (const mesh of this._mutedMeshes) {
      this.mutedGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._mutedMeshes = [];
    const cell = this.surface.faces[0].size / this.cells;
    for (const keyStr of mutedKeys) {
      const [fStr, iStr, jStr] = keyStr.split(':');
      const faceId = +fStr,
        i = +iStr,
        j = +jStr;
      const f = this.surface.faceById(faceId);
      const half = f.size / 2;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.matrixAutoUpdate = false;
      const x0 = -half + i * cell,
        y0 = -half + j * cell;
      this._placeRect(mesh, { faceId, x0, x1: x0 + cell, y0, y1: y0 + cell }, this._MUTE_LIFT);
      this.mutedGroup.add(mesh);
      this._mutedMeshes.push(mesh);
    }
  }

  refreshArmedCells(sequencer) {
    // dispose previous
    for (const mesh of this._armedMeshes.values()) {
      this.armedGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._armedMeshes.clear();
    for (const line of this._armedOutlines.values()) {
      this.armedGroup.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this._armedOutlines.clear();

    const cell = this.surface.faces[0].size / this.cells;
    const pad = cell * 0.78; // pad size (a little smaller than the cell)
    for (const keyStr of sequencer.armed.keys()) {
      const [fStr, iStr, jStr] = keyStr.split(':');
      const faceId = +fStr,
        i = +iStr,
        j = +jStr;
      const f = this.surface.faceById(faceId);
      const half = f.size / 2;
      const cx = -half + (i + 0.5) * cell;
      const cy = -half + (j + 0.5) * cell;
      const rect = { faceId, x0: cx - pad / 2, x1: cx + pad / 2, y0: cy - pad / 2, y1: cy + pad / 2 };

      if (sequencer.mutedCells && sequencer.mutedCells.has(keyStr)) {
        // armed-but-muted: contour only (the note is remembered, not sounding)
        const pts = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.6 }));
        line.matrixAutoUpdate = false;
        this._placeRect(line, rect, this._PAD_LIFT);
        this.armedGroup.add(line);
        this._armedOutlines.set(keyStr, line);
        continue;
      }

      const geo = new THREE.PlaneGeometry(1, 1);
      const vel = sequencer.armed.get(keyStr) ?? 0.7;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: this._padColor.clone(),
        emissiveIntensity: this._padGlow(vel),
        roughness: 0.6,
        metalness: 0.0,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.userData = { cellKey: keyStr, baseGlow: this._padGlow(vel) };
      this._placeRect(mesh, rect, this._PAD_LIFT);
      this.armedGroup.add(mesh);
      this._armedMeshes.set(keyStr, mesh);
    }
  }

  // Record a strike so the corresponding armed pad flashes (called by main when a
  // head sounds a cell).
  strikeCell(faceId, i, j) {
    this._struck.set(`${faceId}:${i}:${j}`, performance.now());
  }

  // Live-update one pad's brightness while the velocity gesture drags (cheap:
  // no rebuild; the full refresh happens once on release).
  setPadVelocity(keyStr, v) {
    const mesh = this._armedMeshes.get(keyStr);
    if (!mesh) return;
    mesh.userData.baseGlow = this._padGlow(v);
    mesh.material.emissiveIntensity = mesh.userData.baseGlow;
  }

  // Re-tint a head's emissive colour (e.g. after its instrument changes).
  setHeadColor(index, color) {
    const c = new THREE.Color(color);
    for (const mesh of this.headPools[index]) mesh.material.emissive.copy(c);
    this.headLeds[index].material.emissive.copy(c);
    this.headInners[index].material.emissive.copy(c);
  }

  // Raycast pick at screen coords. Heads take priority over cells. Returns one of
  //   { type:'head', index }
  //   { type:'cell', faceId, i, j }
  //   null
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.scene.updateMatrixWorld(true);
    this._ray.setFromCamera(this._ndc, this.camera);

    // heads first (only currently-visible pieces, whatever the head style)
    const headMeshes = [];
    for (const pool of this.headPools) for (const m of pool) if (m.visible) headMeshes.push(m);
    for (const m of this.headLeds) if (m.visible) headMeshes.push(m);
    for (const m of this.headInners) if (m.visible) headMeshes.push(m);
    const hHit = this._ray.intersectObjects(headMeshes, false);
    if (hHit.length) return { type: 'head', index: hHit[0].object.userData.index };

    // then faces -> convert hit point to face-local (x,y) -> cell index
    const fHit = this._ray.intersectObjects(this.faceMeshes, false);
    if (fHit.length) {
      const hit = fHit[0];
      const faceId = hit.object.userData.faceId;
      const local = hit.object.worldToLocal(hit.point.clone()); // plane-local = (u,v)
      const f = this.surface.faceById(faceId);
      const half = f.size / 2;
      const cell = f.size / this.cells;
      const clampIdx = (c) => Math.max(0, Math.min(this.cells - 1, Math.floor((c + half) / cell)));
      return { type: 'cell', faceId, i: clampIdx(local.x), j: clampIdx(local.y) };
    }
    return null;
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
    this.headPools = this.balls.map((b, bi) => {
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
          opacity: 0.5, // translucent: the score shows THROUGH the reading head
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        mesh.userData = { pick: 'head', index: bi };
        this.cubeGroup.add(mesh);
        pool.push(mesh);
      }
      return pool;
    });

    // Alternative head LOOKS (selectable live; see setHeadStyle):
    //   'led'    — a small glowing DISK centred on the head's current cell, like
    //              a single LED of an LED-cube. Snapped to the cell, so it never
    //              straddles an edge (no folding needed).
    //   'inner'  — a glowing SPHERE riding just INSIDE the cube, visible through
    //              the translucent body: the "firefly in the lantern".
    //   'square' — the original full-cell square (folds around edges).
    this.headStyle = 'led';
    this._INNER_DEPTH = 0.18; // how far inside the cube the inner sphere rides
    this.headLeds = this.balls.map((b, bi) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(b.color),
        emissiveIntensity: this._headGlow,
        roughness: 0.5,
        metalness: 0.0,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(cell * 0.3, 28), mat);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.userData = { pick: 'head', index: bi };
      this.cubeGroup.add(mesh);
      return mesh;
    });
    this.headInners = this.balls.map((b, bi) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(b.color),
        emissiveIntensity: this._headGlow,
        roughness: 0.4,
        metalness: 0.0,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(cell * 0.3, 20, 14), mat);
      mesh.visible = false;
      mesh.userData = { pick: 'head', index: bi };
      this.cubeGroup.add(mesh);
      return mesh;
    });
  }

  // Switch the head look ('led' | 'inner' | 'square'). Everything hides; the
  // next sync() shows the active style.
  setHeadStyle(style) {
    this.headStyle = style;
    for (const pool of this.headPools) for (const m of pool) m.visible = false;
    for (const m of this.headLeds) m.visible = false;
    for (const m of this.headInners) m.visible = false;
  }

  // Place a flat disk (unit-scale geometry) at face-local (cx,cy), aligned to
  // the face frame, lifted along the normal.
  _placeOnFace(mesh, faceId, cx, cy, lift) {
    const f = this.surface.faceById(faceId);
    const u = f.u,
      v = f.v,
      n = f.n;
    const P = this.surface.to3D(f, cx, cy);
    mesh.matrix.set(
      u[0],
      v[0],
      n[0],
      P[0] + n[0] * lift,
      u[1],
      v[1],
      n[1],
      P[1] + n[1] * lift,
      u[2],
      v[2],
      n[2],
      P[2] + n[2] * lift,
      0,
      0,
      0,
      1,
    );
    mesh.visible = true;
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
    const M = e.M,
      t = e.t;
    const xs = [],
      ys = [];
    for (const [px, py] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]) {
      xs.push(M.a * px + M.b * py + t[0]);
      ys.push(M.c * px + M.d * py + t[1]);
    }
    return {
      faceId: e.toFaceId,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
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
    const yLo = Math.max(cy - s, -H),
      yHi = Math.min(cy + s, H);
    const xLo = Math.max(cx - s, -H),
      xHi = Math.min(cx + s, H);
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
    const w = piece.x1 - piece.x0,
      h = piece.y1 - piece.y0;
    if (w <= 1e-6 || h <= 1e-6) {
      mesh.visible = false;
      return;
    }
    const cx = (piece.x0 + piece.x1) / 2,
      cy = (piece.y0 + piece.y1) / 2;
    const u = f.u,
      v = f.v,
      n = f.n;
    const P = this.surface.to3D(f, cx, cy);
    mesh.matrix.set(
      u[0] * w,
      v[0] * h,
      n[0],
      P[0] + n[0] * lift,
      u[1] * w,
      v[1] * h,
      n[1],
      P[1] + n[1] * lift,
      u[2] * w,
      v[2] * h,
      n[2],
      P[2] + n[2] * lift,
      0,
      0,
      0,
      1,
    );
    mesh.visible = true;
  }

  // pointer drag rotates the cube (on a phone the device orientation takes over).
  // A short tap that barely moves is treated as a CLICK and routed to pickHandler
  // (so the same pointer both rotates and selects, like a trackball + pick).
  // LONG-PRESSING a cell (~0.3s without moving) enters the VELOCITY gesture:
  // further vertical drag shapes that note's velocity instead of rotating — the
  // iPad move: tap arms, hold-and-drag sets how hard it plays.
  // Releasing a drag mid-motion leaves the cube SPINNING with inertia (damped in
  // sync()); grabbing it again stops it — a real trackball feel.
  _wireDrag() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click is OURS (head menu)
    this._dragging = false;
    this._spinX = 0; // rad/s, applied + damped in sync()
    this._spinY = 0;
    this.velocityHandler = null; // (cellRes, delta01, phase) set by controls
    this._velCell = null; // cell being velocity-shaped (long-press active)
    let px = 0,
      py = 0,
      downX = 0,
      downY = 0,
      downT = 0,
      moved = 0,
      lastMove = 0,
      downButton = 0,
      velTimer = 0;
    el.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      downButton = e.button;
      this._spinX = this._spinY = 0; // grabbing the cube stops it
      px = downX = e.clientX;
      py = downY = e.clientY;
      downT = lastMove = performance.now();
      moved = 0;
      this._velCell = null;
      clearTimeout(velTimer);
      if (e.button === 0 && this.velocityHandler) {
        velTimer = setTimeout(() => {
          if (!this._dragging || moved >= 6) return;
          const res = this.pick(downX, downY);
          if (res && res.type === 'cell' && this.velocityHandler(res, 0, 'start') !== false) {
            this._velCell = res;
          }
        }, 300);
      }
    });
    window.addEventListener('pointerup', (e) => {
      clearTimeout(velTimer);
      if (this._velCell) {
        this.velocityHandler?.(this._velCell, 0, 'end');
        this._velCell = null;
        this._dragging = false;
        return; // the long-press gesture swallows the tap
      }
      if (this._dragging) {
        const dt = performance.now() - downT;
        if (moved < 6 && dt < 350 && this.pickHandler) {
          const res = this.pick(e.clientX, e.clientY);
          if (res) this.pickHandler(res, e);
        }
        // if the pointer paused before release, don't fling
        if (performance.now() - lastMove > 80) this._spinX = this._spinY = 0;
      }
      this._dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging || this._useDeviceOrientation) return;
      const nowT = performance.now();
      const dx = e.clientX - px,
        dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      if (this._velCell) {
        // velocity gesture: vertical drag, up = louder (no rotation)
        this.velocityHandler?.(this._velCell, -dy * 0.004, 'move');
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (downButton !== 0) return; // only the primary button rotates the cube
      this.cubeGroup.rotation.y += dx * 0.01;
      this.cubeGroup.rotation.x += dy * 0.01;
      // instantaneous angular velocity, lightly smoothed, for the release fling
      const dtm = Math.max(1, nowT - lastMove);
      lastMove = nowT;
      this._spinY = 0.7 * this._spinY + 0.3 * ((dx * 0.01 * 1000) / dtm);
      this._spinX = 0.7 * this._spinX + 0.3 * ((dy * 0.01 * 1000) / dtm);
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
    // rotation inertia: keep spinning after a flick, damped exponentially
    if (this._lastSync == null) this._lastSync = now;
    const dts = Math.min(0.1, (now - this._lastSync) / 1000);
    this._lastSync = now;
    if (!this._dragging && !this._useDeviceOrientation && (Math.abs(this._spinX) > 1e-4 || Math.abs(this._spinY) > 1e-4)) {
      this.cubeGroup.rotation.y += this._spinY * dts;
      this.cubeGroup.rotation.x += this._spinX * dts;
      const damp = Math.exp(-1.8 * dts);
      this._spinX *= damp;
      this._spinY *= damp;
    }

    // flash struck armed pads: the strike pushes the amber pad to bright WHITE
    // (a colour change, not just brightness, so it reads at any base velocity)
    for (const [key, mesh] of this._armedMeshes) {
      const t = this._struck.get(key);
      const k = t != null && now - t < 260 ? 1 - (now - t) / 260 : 0;
      const base = mesh.userData.baseGlow ?? this._armedBaseGlow;
      mesh.material.emissiveIntensity = base + k * 5.0;
      if (k > 0) {
        mesh.material.emissive.copy(this._padColor).lerp(this._padFlash, k);
        mesh.userData._flashing = true;
      } else if (mesh.userData._flashing) {
        mesh.material.emissive.copy(this._padColor);
        mesh.userData._flashing = false;
      }
    }
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      const pool = this.headPools[i];
      const dt = now - b.flash;
      const k = dt < 220 ? 1 - dt / 220 : 0; // hit pulse 1 -> 0
      // A hit pulses BRIGHTNESS only (the head flares like a struck LED); its
      // colour — the instrument identity — never changes. A PAUSED (muted) head
      // goes dim: still visible on its track, clearly asleep.
      const glow = b.muted ? 0.12 : this._headGlow + k * 1.8;

      if (this.headStyle === 'led') {
        // a single LED: a disk snapped to the centre of the current cell
        for (const m of pool) m.visible = false;
        this.headInners[i].visible = false;
        const f = this.surface.faceById(b.faceId);
        const half = f.size / 2;
        const cellSz = f.size / this.cells;
        const idx = (c) => Math.max(0, Math.min(this.cells - 1, Math.floor((c + half) / cellSz)));
        const cx = -half + (idx(b.x) + 0.5) * cellSz;
        const cy = -half + (idx(b.y) + 0.5) * cellSz;
        const led = this.headLeds[i];
        this._placeOnFace(led, b.faceId, cx, cy, 0.008);
        led.material.emissiveIntensity = glow;
      } else if (this.headStyle === 'inner') {
        // the firefly: a glowing sphere riding just inside the cube
        for (const m of pool) m.visible = false;
        this.headLeds[i].visible = false;
        const f = this.surface.faceById(b.faceId);
        const P = this.surface.to3D(f, b.x, b.y);
        const d = this._INNER_DEPTH;
        const s = this.headInners[i];
        s.position.set(P[0] - f.n[0] * d, P[1] - f.n[1] * d, P[2] - f.n[2] * d);
        s.visible = true;
        s.material.emissiveIntensity = glow;
      } else {
        // 'square': the original folding full-cell head
        this.headLeds[i].visible = false;
        this.headInners[i].visible = false;
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
  }

  // A small "which way is the cube facing" gizmo: the cube's own axes + a faint
  // wire cube, rendered in a corner viewport, following cubeGroup's rotation.
  _buildGizmo() {
    this._gizmoScene = new THREE.Scene();
    this._gizmoCam = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    this._gizmoCam.position.set(0, 0, 3.4);
    this._gizmoGroup = new THREE.Group();
    this._gizmoGroup.add(new THREE.AxesHelper(1.0)); // x red, y green, z blue
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 1.1)),
      new THREE.LineBasicMaterial({ color: 0x3a4a60, transparent: true, opacity: 0.8 }),
    );
    this._gizmoGroup.add(wire);
    this._gizmoScene.add(this._gizmoGroup);
  }

  render() {
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this._w, this._h);
    r.render(this.scene, this.camera);

    // corner gizmo (bottom-right), drawn on top with its own depth
    const s = 92,
      m = 10;
    this._gizmoGroup.quaternion.copy(this.cubeGroup.quaternion);
    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(this._w - s - m, m, s, s);
    r.setViewport(this._w - s - m, m, s, s);
    r.render(this._gizmoScene, this._gizmoCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, this._w, this._h);
  }

  _onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this._w = w;
    this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
