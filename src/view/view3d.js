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
    // PER-AXIS grid resolution (shared {X,Y,Z} object, kept in sync with the
    // engine). A face's u/v directions take the division of the world axis they
    // point along, so the six faces are non-square grids.
    this.divisions = opts.divisions || { X: 8, Y: 8, Z: 8 };

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
    // Start at a friendly 3/4 angle with the +X/+Z corner toward the viewer, so
    // ALL THREE bands' starting edges of heads are visible at once: X on the top
    // facet, Y down the front-left face, Z down the front-right face. Drag from
    // here.
    this.cubeGroup.rotation.set(0.62, -0.78, 0);
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
    this._buildFacets();
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
    // Ambient is now user-controlled from the UI.
    this.ambientIntensity = 2.2;
    this.ambientLight = new THREE.AmbientLight(0x7a8499, this.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Multi-side key/fill/rim points so the cube reads clearly from any angle.
    const lights = [
      [0xffffff, 44, [3.5, 4.2, 5.0]],
      [0xfff4d8, 32, [-4.0, 2.0, 4.2]],
      [0xcfe0ff, 24, [4.2, -3.4, -2.6]],
      [0xaac6ff, 20, [-3.8, -2.8, -4.4]],
    ];
    this.sideLights = lights.map(([col, intensity, pos]) => {
      const L = new THREE.PointLight(col, intensity, 0, 2);
      L.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(L);
      return L;
    });

    // A dedicated key light straight from ABOVE — the top facet (+Y) faces the
    // ceiling and caught almost nothing from the side points, so it read dark.
    // A directional light (parallel rays "at infinity") pointing down lights it
    // evenly regardless of cube size; it follows the world, not the cube group.
    this.topLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.topLight.position.set(0, 10, 0); // high overhead → rays point -Y (down)
    this.topLight.target.position.set(0, 0, 0);
    this.scene.add(this.topLight);
    this.scene.add(this.topLight.target);
  }

  setAmbientIntensity(v) {
    this.ambientIntensity = Math.max(0, Math.min(6, v));
    if (this.ambientLight) this.ambientLight.intensity = this.ambientIntensity;
  }

  // ---- per-axis grid helpers ----
  // divisions along a face's u / v local direction (its two spanning world axes)
  _nu(f) {
    return this.divisions[f.uAxis] ?? 8;
  }
  _nv(f) {
    return this.divisions[f.vAxis] ?? 8;
  }
  _maxDiv() {
    return Math.max(this.divisions.X, this.divisions.Y, this.divisions.Z);
  }

  _buildCubeMesh() {
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
      const geo = new THREE.PlaneGeometry(f.su, f.sv);
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
    // (no wireframe edges: the cube outline is carried by the facet gaps)
  }

  // When the cuboid is re-shaped (per-axis track count changes), each rectangular
  // face changes size (su × sv) and its centre C moves: regenerate the plane
  // geometry and refresh the placement matrix, reusing the materials.
  _resizeCubeMesh() {
    for (let i = 0; i < this.surface.faces.length; i++) {
      const f = this.surface.faces[i];
      const mesh = this.faceMeshes[i];
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(f.su, f.sv);
      const u = f.u,
        v = f.v,
        n = f.n,
        C = f.C;
      mesh.matrix.set(u[0], v[0], n[0], C[0], u[1], v[1], n[1], C[1], u[2], v[2], n[2], C[2], 0, 0, 0, 1);
    }
  }

  // Live control: dial the cube from clear acrylic (0) to fully opaque (1).
  // The transition is GRADUAL all the way: the material only flips to the
  // opaque render path at exactly 1, so there's no sudden "snap" near the top.
  setCubeOpacity(v) {
    this.cubeOpacity = Math.max(0, Math.min(1, v));
    const solid = this.cubeOpacity >= 0.999;
    for (const m of this.faceMats) {
      m.opacity = this.cubeOpacity;
      m.transparent = !solid;
      m.depthWrite = solid;
      m.needsUpdate = true;
    }
    if (this.facetMat) {
      // the facet tiles follow the same translucency dial (so the fireflies
      // can glow through them), but never go fully invisible
      const fo = this._facetOpacity();
      this.facetMat.opacity = fo;
      this.facetMat.transparent = fo < 0.999;
      this.facetMat.depthWrite = fo >= 0.999;
      this.facetMat.needsUpdate = true;
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
    if (this.facets) this._refreshFacetColors(); // unarmed facet tiles wear the body colour
  }

  // The cell grid on every face: the flat coordinate frame / step-button matrix.
  // Rebuildable (the divisions dial): geometry is regenerated, material reused.
  _buildGrid() {
    const positions = [];
    for (const f of this.surface.faces) {
      const halfU = f.su / 2,
        halfV = f.sv / 2;
      const nu = this._nu(f),
        nv = this._nv(f);
      const cu = f.su / nu,
        cv = f.sv / nv;
      // lines of constant u (the nu+1 dividers across the v span)
      for (let i = 0; i <= nu; i++) {
        const t = -halfU + i * cu;
        positions.push(...this.surface.to3D(f, t, -halfV), ...this.surface.to3D(f, t, halfV));
      }
      // lines of constant v (the nv+1 dividers across the u span)
      for (let j = 0; j <= nv; j++) {
        const t = -halfV + j * cv;
        positions.push(...this.surface.to3D(f, -halfU, t), ...this.surface.to3D(f, halfU, t));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (!this.gridMat) this.gridMat = new THREE.LineBasicMaterial({ color: 0x3a4f70 });
    this.gridLines = new THREE.LineSegments(geo, this.gridMat);
    this.shellGroup.add(this.gridLines);
  }

  // Live control: grid line colour (WebGL ignores line WIDTH, so legibility
  // comes from colour here — or from the facet body, where the gaps ARE the grid).
  setGridColor(hex) {
    this.gridMat.color.set(hex);
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
    // ARMED cell colour: by default the body colour, brightened — the note is
    // the same material as the cube, just lit from within. Tweakable live.
    this.armedColor = '#' + new THREE.Color(this.cubeColor).lerp(new THREE.Color(0xffffff), 0.55).getHexString();
    this._padColor = new THREE.Color(this.armedColor);
    this._padFlash = new THREE.Color(0xffffff); // strike flash (when flashMode='white')
    this._flashTmp = new THREE.Color();
    this.flashMode = 'instrument'; // strike colour: 'instrument' (saturated) | 'white'
    this._PAD_LIFT = 0.006; // above the muted strips, above the face
    this._MUTE_LIFT = 0.003;
  }

  // Live control: the colour an armed (note-carrying) cell wears.
  setArmedColor(hex) {
    this.armedColor = hex;
    this._padColor.set(hex);
    for (const mesh of this._armedMeshes.values()) mesh.material.emissive.copy(this._padColor);
    if (this.facets) this._refreshFacetColors();
  }

  setFlashMode(mode) {
    this.flashMode = mode;
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
    for (const keyStr of mutedKeys) {
      const [fStr, iStr, jStr] = keyStr.split(':');
      const faceId = +fStr,
        i = +iStr,
        j = +jStr;
      const f = this.surface.faceById(faceId);
      const halfU = f.su / 2,
        halfV = f.sv / 2;
      const cu = f.su / this._nu(f),
        cv = f.sv / this._nv(f);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.matrixAutoUpdate = false;
      const x0 = -halfU + i * cu,
        y0 = -halfV + j * cv;
      this._placeRect(mesh, { faceId, x0, x1: x0 + cu, y0, y1: y0 + cv }, this._MUTE_LIFT);
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

    for (const keyStr of sequencer.armed.keys()) {
      const [fStr, iStr, jStr] = keyStr.split(':');
      const faceId = +fStr,
        i = +iStr,
        j = +jStr;
      const f = this.surface.faceById(faceId);
      const halfU = f.su / 2,
        halfV = f.sv / 2;
      const cu = f.su / this._nu(f),
        cv = f.sv / this._nv(f);
      const pad = Math.min(cu, cv) * 0.78; // pad size (a little smaller than the cell)
      const cx = -halfU + (i + 0.5) * cu;
      const cy = -halfV + (j + 0.5) * cv;
      const rect = { faceId, x0: cx - pad / 2, x1: cx + pad / 2, y0: cy - pad / 2, y1: cy + pad / 2 };

      if (sequencer.mutedCells && sequencer.mutedCells.has(keyStr)) {
        // armed-but-muted: contour only (the note is remembered, not sounding)
        const pts = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line = new THREE.LineLoop(
          geo,
          new THREE.LineBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.6 }),
        );
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

    // the facet body shows the same score as tile colours
    if (this.facets) this._refreshFacetColors(sequencer);
  }

  // ---- the FACET body --------------------------------------------------------
  // Every cell is its own slightly-shrunk TILE (one InstancedMesh instance per
  // cell). There are no grid lines to alias: the GAP between facets IS the grid.
  // An armed cell is simply a brighter tile ("you just change the colour of the
  // square"); a strike re-colours it and can POP it along the face normal — the
  // surface itself plays. Tiles are lit (MeshStandard + per-instance colour), so
  // the firefly point-lights inside bleed through the translucent body: the
  // LED-matrix-behind-a-diffuser look of the future physical cube.
  _buildFacets() {
    this.surfaceStyle = 'facets'; // 'grid' | 'facets' | 'both'
    this.facetGap = 0.12; // fraction of the cell left as gap between tiles
    // A struck tile becomes a PRISM: the tile itself extrudes along the face
    // normal — outward (popAmount > 0) or INTO the cube (popAmount < 0) — and
    // relaxes back. At rest every tile protrudes slightly from the acrylic.
    this.popAmount = 0.6; // -1 (full inward) .. 0 (off) .. +1 (full outward)
    this._FACET_REST = 0.012; // resting tile thickness (slight protrusion)
    this._FACET_LIFT = 0.0015;
    this._facetGeo = new THREE.BoxGeometry(1, 1, 1);
    this.facetMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // per-instance colours carry everything
      roughness: 0.55,
      metalness: 0.0,
      transparent: true,
      opacity: this._facetOpacity(),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.facets = null;
    this._facetSeq = null; // last sequencer seen, for re-colouring
    this._struckIds = new Set(); // tiles flashed/extruded last frame (to restore)
    this._tmpCol = new THREE.Color();
    this._tmpMat = new THREE.Matrix4();
    this._createFacetMeshes();
    this._refreshFacetColors();
    this._applySurfaceStyle();
  }

  // (Re)create the six per-face InstancedMeshes — called at build time and again
  // whenever the grid divisions change.
  // ONE InstancedMesh PER FACE (not one for the whole cube): three.js depth-
  // sorts transparent OBJECTS, never instances, so with a single mesh the far
  // faces could blend on top of the near ones (the "messy overlap" artefact).
  _createFacetMeshes() {
    if (this.facets) {
      for (const m of this.facets) {
        this.shellGroup.remove(m);
        m.dispose();
      }
    }
    // Each face has its OWN nu×nv (non-square) tile grid. A flat global tile id
    // is offset[fi] + j*nu + i; offsets are prefix sums of the per-face counts.
    this._faceIndex = new Map(this.surface.faces.map((f, k) => [f.id, k]));
    this._faceNu = [];
    this._faceNv = [];
    this._faceOffset = [];
    let off = 0;
    this.facets = this.surface.faces.map((f, fi) => {
      const nu = this._nu(f),
        nv = this._nv(f);
      this._faceNu[fi] = nu;
      this._faceNv[fi] = nv;
      this._faceOffset[fi] = off;
      off += nu * nv;
      const m = new THREE.InstancedMesh(this._facetGeo, this.facetMat, nu * nv);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.userData = { pick: 'facets', faceIdx: fi };
      this.shellGroup.add(m);
      return m;
    });
    this._facetCount = off;
    this._facetBase = new Array(this._facetCount); // id -> { m, n: normal, P, key }
    this._struckIds.clear();
    this._rebuildFacetMatrices();
  }

  // tile opacity follows the cube translucency dial, but never fully vanishes
  _facetOpacity() {
    return Math.min(1, 0.45 + 0.55 * this.cubeOpacity);
  }

  _facetIdFromKey(keyStr) {
    const [f, i, j] = keyStr.split(':').map(Number);
    const fi = this._faceIndex.get(f);
    if (fi == null) return null;
    return this._faceOffset[fi] + j * this._faceNu[fi] + i;
  }

  // global tile id -> the per-face mesh + its local instance index
  _facetAt(id) {
    for (let fi = 0; fi < this.facets.length; fi++) {
      const count = this._faceNu[fi] * this._faceNv[fi];
      if (id < this._faceOffset[fi] + count) return { mesh: this.facets[fi], local: id - this._faceOffset[fi] };
    }
    return { mesh: this.facets[this.facets.length - 1], local: 0 };
  }

  _facetSetColor(id, col) {
    const { mesh, local } = this._facetAt(id);
    mesh.setColorAt(local, col);
    mesh.instanceColor.needsUpdate = true;
  }

  _facetSetMatrix(id, m) {
    const { mesh, local } = this._facetAt(id);
    mesh.setMatrixAt(local, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  _rebuildFacetMatrices() {
    // every tile is a thin box (thickness FACET_REST) whose BASE sits on the
    // surface — the slight resting protrusion. A strike re-scales the normal
    // column to extrude it into a prism (see sync()).
    const dz = this._FACET_REST;
    const L = dz / 2 + this._FACET_LIFT;
    for (let fi = 0; fi < this.surface.faces.length; fi++) {
      const f = this.surface.faces[fi];
      const halfU = f.su / 2,
        halfV = f.sv / 2;
      const nu = this._faceNu[fi],
        nv = this._faceNv[fi];
      const cu = f.su / nu,
        cv = f.sv / nv;
      const su = cu * (1 - this.facetGap);
      const sv = cv * (1 - this.facetGap);
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const cx = -halfU + (i + 0.5) * cu;
          const cy = -halfV + (j + 0.5) * cv;
          const P = this.surface.to3D(f, cx, cy);
          const u = f.u,
            v = f.v,
            nn = f.n;
          const m = new THREE.Matrix4().set(
            u[0] * su,
            v[0] * sv,
            nn[0] * dz,
            P[0] + nn[0] * L,
            u[1] * su,
            v[1] * sv,
            nn[1] * dz,
            P[1] + nn[1] * L,
            u[2] * su,
            v[2] * sv,
            nn[2] * dz,
            P[2] + nn[2] * L,
            0,
            0,
            0,
            1,
          );
          const id = this._faceOffset[fi] + j * nu + i;
          this._facetBase[id] = { m, n: nn, P, key: `${f.id}:${i}:${j}` };
          this.facets[fi].setMatrixAt(j * nu + i, m);
        }
      }
    }
    for (const mesh of this.facets) mesh.instanceMatrix.needsUpdate = true;
  }

  // a tile's resting colour: body colour if silent, the armed colour scaled by
  // the note's velocity if armed (returns the shared temp colour)
  _facetColorFor(id) {
    const rec = this._facetBase[id];
    const vel = this._facetSeq ? this._facetSeq.armed.get(rec.key) : undefined;
    if (vel == null) return this._tmpCol.set(this.cubeColor);
    return this._tmpCol.copy(this._padColor).multiplyScalar(0.5 + vel * 0.9);
  }

  _refreshFacetColors(sequencer) {
    if (sequencer) this._facetSeq = sequencer;
    for (let id = 0; id < this._facetCount; id++) this._facetSetColor(id, this._facetColorFor(id));
  }

  // Surface look: 'grid' (acrylic body + grid lines + glowing pads), 'facets'
  // (tile body only — the gaps are the grid), or 'both' (tiles over the body).
  setSurfaceStyle(style) {
    this.surfaceStyle = style;
    this._applySurfaceStyle();
  }

  _applySurfaceStyle() {
    const facetsOn = this.surfaceStyle !== 'grid';
    const bodyOn = this.surfaceStyle !== 'facets';
    for (const m of this.facets) m.visible = facetsOn;
    for (const m of this.faceMeshes) m.visible = bodyOn;
    this.gridLines.visible = this.surfaceStyle === 'grid';
    this.armedGroup.visible = this.surfaceStyle === 'grid';
    this.mutedGroup.visible = this.surfaceStyle === 'grid';
  }

  setFacetGap(g) {
    this.facetGap = Math.max(0, Math.min(0.5, g));
    this._rebuildFacetMatrices();
  }

  setPopAmount(p) {
    this.popAmount = Math.max(-1, Math.min(1, p));
  }

  // Record a strike so the corresponding armed pad/facet flashes (called by main
  // when a head sounds a cell). `color` = the striking head's instrument colour,
  // used when flashMode === 'instrument'.
  strikeCell(faceId, i, j, color = null) {
    this._struck.set(`${faceId}:${i}:${j}`, { t: performance.now(), color });
  }

  // Live-update one pad's brightness while the velocity gesture drags (cheap:
  // no rebuild; the full refresh happens once on release).
  setPadVelocity(keyStr, v) {
    const mesh = this._armedMeshes.get(keyStr);
    if (mesh) {
      mesh.userData.baseGlow = this._padGlow(v);
      mesh.material.emissiveIntensity = mesh.userData.baseGlow;
    }
    if (this.facets && this.facets[0].visible) {
      const id = this._facetIdFromKey(keyStr);
      if (id != null) {
        this._facetSetColor(id, this._tmpCol.copy(this._padColor).multiplyScalar(0.5 + v * 0.9));
      }
    }
  }

  // Re-tint a head's emissive colour (e.g. after its instrument changes).
  setHeadColor(index, color) {
    const c = new THREE.Color(color);
    this.headBaseCols[index].copy(c);
    for (const mesh of this.headPools[index]) mesh.material.emissive.copy(c);
    for (const led of this.headLeds[index]) led.material.emissive.copy(c);
    this.headInners[index].material.emissive.copy(c);
    this.headRings[index].material.color.copy(c);
    this.headLights[index].color.copy(c);
    this.headLightsMirror[index].color.copy(c);
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
    for (const arr of this.headLeds) for (const m of arr) if (m.visible) headMeshes.push(m);
    for (const m of this.headInners) if (m.visible) headMeshes.push(m);
    for (const m of this.headRings) if (m.visible) headMeshes.push(m);
    for (const m of this.headFrames) if (m.visible) headMeshes.push(m);
    const hHit = this._ray.intersectObjects(headMeshes, false);
    if (hHit.length) return { type: 'head', index: hHit[0].object.userData.index };

    // facet tiles (when the facet body is on, the tiles ARE the buttons)
    if (this.facets[0].visible) {
      const tHit = this._ray.intersectObjects(this.facets, false);
      if (tHit.length) {
        const hit = tHit[0];
        const fi = hit.object.userData.faceIdx;
        const local = hit.instanceId;
        const nu = this._faceNu[fi];
        return { type: 'cell', faceId: this.surface.faces[fi].id, i: local % nu, j: Math.floor(local / nu) };
      }
    }

    // then faces -> convert hit point to face-local (x,y) -> cell index
    if (this.faceMeshes[0].visible) {
      const fHit = this._ray.intersectObjects(this.faceMeshes, false);
      if (fHit.length) {
        const hit = fHit[0];
        const faceId = hit.object.userData.faceId;
        const local = hit.object.worldToLocal(hit.point.clone()); // plane-local = (u,v)
        const f = this.surface.faceById(faceId);
        const halfU = f.su / 2,
          halfV = f.sv / 2;
        const nu = this._nu(f),
          nv = this._nv(f);
        const cu = f.su / nu,
          cv = f.sv / nv;
        const idxU = (c) => Math.max(0, Math.min(nu - 1, Math.floor((c + halfU) / cu)));
        const idxV = (c) => Math.max(0, Math.min(nv - 1, Math.floor((c + halfV) / cv)));
        return { type: 'cell', faceId, i: idxU(local.x), j: idxV(local.y) };
      }
    }
    return null;
  }

  // One flat square per reading-head — but a head near an edge is split into
  // several rectangular PIECES (see _headPieces), so each head owns a small POOL
  // of quad meshes (1 in-face + up to 2 folded overflow). Geometry is a UNIT
  // plane (1x1) so a piece can be scaled to any rectangle. No per-frame alloc.
  _buildHeadMeshes() {
    // Shared head geometries are sized to one UNIT cell (every facet is a unit
    // square on the cuboid), so a head exactly fills a cell on every face.
    const cell = this.surface.unit;
    // Heads sit on the TRUE surface (lift 0); the body shell is shrunk instead.
    // This keeps folded edge-pieces meeting exactly on the shared edge.
    this._lift = 0;
    this._POOL = 3; // max simultaneous pieces (in-face + 2 perpendicular folds)
    this._headGlow = 1.0; // baseline emissive intensity
    this._headGeos(cell); // shared, rebuildable geometries (the divisions dial)
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
    //   'led'    — the head lights the FIXED LEDs of the (future, physical) LED
    //              matrix: the TWO leds bracketing its continuous position glow,
    //              brightness following a Fechner-law (log) compression of
    //              proximity. The motion is continuous; the lights are discrete.
    //   'inner'  — the firefly: a tiny emissive core + a POINT LIGHT riding just
    //              inside the cube, bleeding through the translucent body and
    //              facet tiles (the LED-behind-a-diffuser effect).
    //   'square' — the original full-cell square (folds around edges).
    this.headStyle = 'led';
    // Firefly geometry (all live controls, see setters below):
    //   headDepth    — distance from the surface along the normal. POSITIVE =
    //                  inside the cube, NEGATIVE = riding OUTSIDE (where the
    //                  facets' front sides catch the light). Small values keep
    //                  the firefly glued to the surface, so the corner "pause"
    //                  (the constant-depth offset can't fold around an edge)
    //                  becomes imperceptible.
    //   headCoreSize — scale of the visible emissive core. 0 = pure light, no
    //                  sphere at all (the default: only the glow shows).
    //   mirrorFirefly— an INVISIBLE TWIN light mirrored on the other side of
    //                  the surface: fakes diffusion, since a one-sided facet
    //                  only catches light on the side facing the source.
    this.headDepth = 0.05;
    this.headCoreSize = 0;
    this.mirrorFirefly = false;
    // Note-driven firefly LIGHT (all live controls): idle fireflies glow dim
    // and desaturated; flying OVER an armed cell they bloom to full instrument
    // colour for the whole crossing — the NOTE lights the firefly.
    this.fireflyBright = 4.0; // intensity while over an armed cell
    this.fireflyDim = 0.4; // idle intensity
    this.fireflyDesat = 0.7; // 0 = full colour when idle, 1 = white
    this.headBaseCols = this.balls.map((b) => new THREE.Color(b.color));
    this._fireflyCol = new THREE.Color();
    this._white = new THREE.Color(0xffffff);
    this.headLeds = this.balls.map((b, bi) => {
      const arr = [];
      for (let k = 0; k < 2; k++) {
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
        const mesh = new THREE.Mesh(this._ledGeo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        mesh.userData = { pick: 'head', index: bi };
        this.cubeGroup.add(mesh);
        arr.push(mesh);
      }
      return arr;
    });
    // paused-head contour: a thicker coloured RING on the head's cell — the head
    // goes ghost-transparent but stays clearly findable (and clickable to wake).
    this.headRings = this.balls.map((b, bi) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(b.color),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._ringGeo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.userData = { pick: 'head', index: bi };
      this.cubeGroup.add(mesh);
      return mesh;
    });
    // the FRAME head (Logic's playhead): a plain non-filled white square sitting
    // on the head's current cell, its contour as thick as the tile gap.
    this.headFrames = this.balls.map((b, bi) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._frameGeo, mat);
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
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this._coreGeo, mat);
      mesh.visible = false;
      mesh.userData = { pick: 'head', index: bi };
      this.cubeGroup.add(mesh);
      return mesh;
    });
    // the firefly's LIGHT: spreads over the translucent body — the closer the
    // head rides to a face, the hotter the glow pooled on it
    this.headLights = this.balls.map((b) => {
      const L = new THREE.PointLight(new THREE.Color(b.color), 1.6, 3.4, 2);
      L.visible = false;
      this.cubeGroup.add(L);
      return L;
    });
    // the optional mirrored twin (see mirrorFirefly above)
    this.headLightsMirror = this.balls.map((b) => {
      const L = new THREE.PointLight(new THREE.Color(b.color), 1.6, 3.4, 2);
      L.visible = false;
      this.cubeGroup.add(L);
      return L;
    });
  }

  // (Re)create the cell-size-dependent shared head geometries.
  _headGeos(cell) {
    const old = [this._ledGeo, this._ringGeo, this._coreGeo, this._frameGeo];
    this._headHalf = cell * 0.86 * 0.5; // half-side of the square head
    this._ledGeo = new THREE.CircleGeometry(cell * 0.15, 24);
    this._ringGeo = new THREE.RingGeometry(cell * 0.17, cell * 0.26, 28);
    this._coreGeo = new THREE.SphereGeometry(cell * 0.14, 18, 12);
    // square frame: outer = the full cell, contour thickness = the tile gap
    const half = cell / 2;
    const th = Math.max(0.012, cell * (this.facetGap ?? 0.12));
    const inner = half - th;
    const shape = new THREE.Shape();
    shape.moveTo(-half, -half);
    shape.lineTo(half, -half);
    shape.lineTo(half, half);
    shape.lineTo(-half, half);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-inner, -inner);
    hole.lineTo(-inner, inner);
    hole.lineTo(inner, inner);
    hole.lineTo(inner, -inner);
    hole.closePath();
    shape.holes.push(hole);
    this._frameGeo = new THREE.ShapeGeometry(shape);
    for (const g of old) if (g) g.dispose();
  }

  // Re-slice live after the shared `divisions` object changes (the per-group
  // "Tracks on" dial): rebuild everything that depends on the cell sizes. The
  // caller refreshes the armed cells.
  applyDivisions() {
    // grid lines
    this.shellGroup.remove(this.gridLines);
    this.gridLines.geometry.dispose();
    this._buildGrid();
    // facet tiles
    this._struck.clear();
    this._createFacetMeshes();
    this._refreshFacetColors();
    this._applySurfaceStyle();
    // the cuboid itself re-shapes (faces resize / recenter)
    this._resizeCubeMesh();
    // head geometries (sized to one unit cell — every facet is a unit square)
    const cell = this.surface.unit;
    this._headGeos(cell);
    for (const arr of this.headLeds) for (const m of arr) m.geometry = this._ledGeo;
    for (const m of this.headRings) m.geometry = this._ringGeo;
    for (const m of this.headInners) m.geometry = this._coreGeo;
    for (const m of this.headFrames) m.geometry = this._frameGeo;
  }

  // Switch the head look ('led' | 'inner' | 'square' | 'frame'). Everything
  // hides; the next sync() shows the active style.
  setHeadStyle(style) {
    this.headStyle = style;
    for (const pool of this.headPools) for (const m of pool) m.visible = false;
    for (const arr of this.headLeds) for (const m of arr) m.visible = false;
    for (const m of this.headRings) m.visible = false;
    for (const m of this.headInners) m.visible = false;
    for (const m of this.headFrames) m.visible = false;
    for (const L of this.headLights) L.visible = false;
    for (const L of this.headLightsMirror) L.visible = false;
  }

  // Firefly distance from the surface: + inside the cube, − outside.
  setHeadDepth(d) {
    this.headDepth = Math.max(-0.5, Math.min(0.5, d));
  }

  // Visible core scale, 0..1 (0 = invisible: a pure light source).
  setHeadCoreSize(s) {
    this.headCoreSize = Math.max(0, Math.min(1, s));
  }

  // Toggle the invisible mirrored twin light (fake diffusion).
  setMirrorFirefly(on) {
    this.mirrorFirefly = !!on;
    if (!on) for (const L of this.headLightsMirror) L.visible = false;
  }

  // Firefly glow over an armed cell (the note's light).
  setFireflyBright(v) {
    this.fireflyBright = Math.max(0, Math.min(10, v));
  }

  // Firefly idle glow (between notes).
  setFireflyDim(v) {
    this.fireflyDim = Math.max(0, Math.min(3, v));
  }

  // How washed-out the idle firefly is (0 = full colour, 1 = white).
  setFireflyDesat(v) {
    this.fireflyDesat = Math.max(0, Math.min(1, v));
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
    const HU = f.su / 2, // face half-extent along u (x)
      HV = f.sv / 2; // and along v (y)
    const pieces = [
      {
        faceId,
        x0: Math.max(cx - s, -HU),
        x1: Math.min(cx + s, HU),
        y0: Math.max(cy - s, -HV),
        y1: Math.min(cy + s, HV),
      },
    ];
    const yLo = Math.max(cy - s, -HV),
      yHi = Math.min(cy + s, HV);
    const xLo = Math.max(cx - s, -HU),
      xHi = Math.min(cx + s, HU);
    if (cx + s > HU && f.edges[0]) pieces.push(this._foldRect(f.edges[0], HU, cx + s, yLo, yHi)); // +x
    if (cy + s > HV && f.edges[1]) pieces.push(this._foldRect(f.edges[1], xLo, xHi, HV, cy + s)); // +y
    if (cx - s < -HU && f.edges[2]) pieces.push(this._foldRect(f.edges[2], cx - s, -HU, yLo, yHi)); // -x
    if (cy - s < -HV && f.edges[3]) pieces.push(this._foldRect(f.edges[3], xLo, xHi, cy - s, -HV)); // -y
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
    this._pts = new Map(); // active pointers, for the pinch-zoom gesture
    this._pinchDist = 0;
    // mouse wheel zoom (trackpad pinch arrives as a wheel event too)
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
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
      this._pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._pts.size === 2) {
        // second finger lands: this is a PINCH, not a drag/long-press
        clearTimeout(velTimer);
        this._velCell = null;
        const p = [...this._pts.values()];
        this._pinchDist = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        return;
      }
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
      this._pts.delete(e.pointerId);
      this._pinchDist = 0;
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
      if (this._pts.has(e.pointerId)) this._pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._pts.size === 2) {
        // pinch zoom (the iPad gesture)
        const p = [...this._pts.values()];
        const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        if (this._pinchDist > 0 && d > 0) this.zoomBy(this._pinchDist / d);
        this._pinchDist = d;
        return;
      }
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
      if (downButton === 2) {
        // right-drag = PAN: translate the cube in the screen plane
        const sc = 0.0016 * this.camera.position.z;
        this.cubeGroup.position.x += dx * sc;
        this.cubeGroup.position.y -= dy * sc;
        return;
      }
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

  // dolly the camera in/out (wheel or pinch), clamped to sane bounds
  zoomBy(factor) {
    this.camera.position.z = Math.max(2.2, Math.min(14, this.camera.position.z * factor));
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
    if (
      !this._dragging &&
      !this._useDeviceOrientation &&
      (Math.abs(this._spinX) > 1e-4 || Math.abs(this._spinY) > 1e-4)
    ) {
      this.cubeGroup.rotation.y += this._spinY * dts;
      this.cubeGroup.rotation.x += this._spinX * dts;
      const damp = Math.exp(-1.8 * dts);
      this._spinX *= damp;
      this._spinY *= damp;
    }

    // forget strikes once their flash has fully decayed
    for (const [key, rec] of this._struck) if (now - rec.t > 400) this._struck.delete(key);

    // flash struck armed pads (grid mode): the strike pushes the greyish pad to
    // a saturated instrument colour (or pure white) — a colour change, not just
    // brightness, so it reads at any base velocity
    for (const [key, mesh] of this._armedMeshes) {
      const rec = this._struck.get(key);
      const k = rec && now - rec.t < 260 ? 1 - (now - rec.t) / 260 : 0;
      const base = mesh.userData.baseGlow ?? this._armedBaseGlow;
      mesh.material.emissiveIntensity = base + k * 5.0;
      if (k > 0) {
        const fc = this.flashMode === 'instrument' && rec.color ? this._flashTmp.set(rec.color) : this._padFlash;
        mesh.material.emissive.copy(this._padColor).lerp(fc, k);
        mesh.userData._flashing = true;
      } else if (mesh.userData._flashing) {
        mesh.material.emissive.copy(this._padColor);
        mesh.userData._flashing = false;
      }
    }

    // facet strikes: the tile EXTRUDES into a prism along its normal (outward
    // or into the cube, per popAmount) and flashes HOT — colour pushed well past
    // the resting palette so the strike reads on its own, not just by reflection
    if (this.facets[0].visible) {
      for (const id of this._struckIds) {
        this._facetSetColor(id, this._facetColorFor(id));
        this._facetSetMatrix(id, this._facetBase[id].m);
      }
      this._struckIds.clear();
      for (const [key, rec] of this._struck) {
        const age = now - rec.t;
        if (age >= 320) continue;
        const id = this._facetIdFromKey(key);
        if (id == null) continue;
        const k2 = 1 - age / 320;
        const fc =
          this.flashMode === 'instrument' && rec.color ? this._flashTmp.set(rec.color) : this._flashTmp.set(0xffffff);
        this._facetSetColor(
          id,
          this._facetColorFor(id)
            .lerp(fc, k2)
            .multiplyScalar(1 + 2.2 * k2),
        );
        if (this.popAmount) {
          const fb = this._facetBase[id];
          const h = this._FACET_REST + Math.abs(this.popAmount) * 0.42 * k2;
          const sgn = this.popAmount >= 0 ? 1 : -1;
          this._tmpMat.copy(fb.m);
          const e = this._tmpMat.elements;
          const sc = h / this._FACET_REST;
          e[8] *= sc; // normal column = nn * h (the prism height)
          e[9] *= sc;
          e[10] *= sc;
          e[12] = fb.P[0] + fb.n[0] * ((sgn * h) / 2); // base stays on the surface
          e[13] = fb.P[1] + fb.n[1] * ((sgn * h) / 2);
          e[14] = fb.P[2] + fb.n[2] * ((sgn * h) / 2);
          this._facetSetMatrix(id, this._tmpMat);
        }
        this._struckIds.add(id);
      }
    }
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      const pool = this.headPools[i];
      // a DISABLED track (the track-count dial) simply doesn't exist on stage
      if (b.active === false) {
        for (const m of pool) m.visible = false;
        for (const led of this.headLeds[i]) led.visible = false;
        this.headInners[i].visible = false;
        this.headLights[i].visible = false;
        this.headLightsMirror[i].visible = false;
        this.headRings[i].visible = false;
        this.headFrames[i].visible = false;
        continue;
      }
      const dt = now - b.flash;
      const k = dt < 220 ? 1 - dt / 220 : 0; // hit pulse 1 -> 0
      // A hit pulses BRIGHTNESS only (the head flares like a struck LED); its
      // colour — the instrument identity — never changes. A PAUSED head goes
      // ghost-transparent with a thicker coloured contour: clearly asleep, still
      // findable, still clickable to wake. (Pausing stops ONLY this head — the
      // notes on its track stay live for the perpendicular band.)
      const glow = this._headGlow + k * 1.8;
      const ring = this.headRings[i];

      if (this.headStyle === 'led') {
        // continuous motion, discrete lights: the head excites the two fixed
        // LEDs bracketing its position; brightness = Fechner-law (log)
        // compression of the linear proximity weight — a faithful preview of
        // the physical LED-matrix cube.
        for (const m of pool) m.visible = false;
        this.headInners[i].visible = false;
        this.headLights[i].visible = false;
        this.headLightsMirror[i].visible = false;
        this.headFrames[i].visible = false;
        const f = this.surface.faceById(b.faceId);
        const halfU = f.su / 2,
          halfV = f.sv / 2;
        const nu = this._nu(f),
          nv = this._nv(f);
        const cu = f.su / nu,
          cv = f.sv / nv;
        const alongX = Math.abs(b.vx) >= Math.abs(b.vy);
        const nMot = alongX ? nu : nv; // cells along the motion axis
        const cMot = alongX ? cu : cv; // cell size along the motion axis
        const nRail = alongX ? nv : nu; // cells on the rail (perpendicular) axis
        const cRail = alongX ? cv : cu; // cell size on the rail axis
        const halfMot = alongX ? halfU : halfV;
        const halfRail = alongX ? halfV : halfU;
        const idxRail = (c) => Math.max(0, Math.min(nRail - 1, Math.floor((c + halfRail) / cRail)));
        const centreMot = (kk) => -halfMot + (kk + 0.5) * cMot;
        const centreRail = (kk) => -halfRail + (kk + 0.5) * cRail;
        const p = alongX ? b.x : b.y; // continuous coordinate along the motion
        const qc = centreRail(idxRail(alongX ? b.y : b.x)); // rail coordinate, snapped
        const s = (p + halfMot) / cMot - 0.5; // position in "LED units"
        const k0 = Math.floor(s);
        const frac = s - k0;
        const leds = this.headLeds[i];
        for (let m2 = 0; m2 < 2; m2++) {
          const led = leds[m2];
          const kk = k0 + m2;
          const w = m2 === 0 ? 1 - frac : frac; // linear proximity weight
          if (kk < 0 || kk >= nMot || w < 0.02) {
            led.visible = false;
            continue;
          }
          const cx = alongX ? centreMot(kk) : qc;
          const cy = alongX ? qc : centreMot(kk);
          this._placeOnFace(led, b.faceId, cx, cy, 0.009);
          led.material.emissiveIntensity = glow * (Math.log1p(9 * w) / Math.log1p(9));
          led.material.opacity = b.muted ? 0.15 : 0.95;
        }
        if (b.muted) {
          const kk = Math.max(0, Math.min(nMot - 1, Math.round(s)));
          this._placeOnFace(ring, b.faceId, alongX ? centreMot(kk) : qc, alongX ? qc : centreMot(kk), 0.011);
        } else ring.visible = false;
      } else if (this.headStyle === 'frame') {
        // Logic's playhead: a plain white non-filled square sitting on the
        // head's current CELL (snapped), its contour as thick as the tile gap
        for (const m of pool) m.visible = false;
        for (const led of this.headLeds[i]) led.visible = false;
        this.headInners[i].visible = false;
        this.headLights[i].visible = false;
        this.headLightsMirror[i].visible = false;
        ring.visible = false;
        const f = this.surface.faceById(b.faceId);
        const halfU = f.su / 2,
          halfV = f.sv / 2;
        const nu = this._nu(f),
          nv = this._nv(f);
        const cu = f.su / nu,
          cv = f.sv / nv;
        const idxU = (c) => Math.max(0, Math.min(nu - 1, Math.floor((c + halfU) / cu)));
        const idxV = (c) => Math.max(0, Math.min(nv - 1, Math.floor((c + halfV) / cv)));
        const centreU = (kk) => -halfU + (kk + 0.5) * cu;
        const centreV = (kk) => -halfV + (kk + 0.5) * cv;
        const fr = this.headFrames[i];
        this._placeOnFace(fr, b.faceId, centreU(idxU(b.x)), centreV(idxV(b.y)), 0.014);
        fr.material.opacity = b.muted ? 0.2 : 0.7 + k * 0.3;
      } else if (this.headStyle === 'inner') {
        // the firefly: a point light (+ optional tiny core) riding headDepth
        // from the surface — inside (clamped so it can't poke out while folding
        // around an edge) or OUTSIDE when headDepth is negative.
        for (const m of pool) m.visible = false;
        for (const led of this.headLeds[i]) led.visible = false;
        ring.visible = false;
        this.headFrames[i].visible = false;
        const f = this.surface.faceById(b.faceId);
        const P = this.surface.to3D(f, b.x, b.y);
        const d = this.headDepth;
        // clamp per WORLD axis to the cuboid's (possibly unequal) half-extents,
        // so the firefly can't poke out while folding around an edge
        const dims = this.surface.dims;
        const limX = dims.X / 2 - d,
          limY = dims.Y / 2 - d,
          limZ = dims.Z / 2 - d;
        const px = Math.max(-limX, Math.min(limX, P[0] - f.n[0] * d)),
          py = Math.max(-limY, Math.min(limY, P[1] - f.n[1] * d)),
          pz = Math.max(-limZ, Math.min(limZ, P[2] - f.n[2] * d));
        const core = this.headInners[i];
        // the NOTE lights the firefly: idle = dim + desaturated; over an armed
        // cell = full instrument colour at fireflyBright, for the whole crossing
        const over = this._facetSeq && this._facetSeq.armed.has(`${b.faceId}:${b.cellI}:${b.cellJ}`) && !b.muted;
        const col = this._fireflyCol.copy(this.headBaseCols[i]);
        if (!over) col.lerp(this._white, this.fireflyDesat);
        core.visible = this.headCoreSize > 0.02;
        if (core.visible) {
          core.position.set(px, py, pz);
          core.scale.setScalar(this.headCoreSize);
          core.material.emissive.copy(col);
          core.material.emissiveIntensity = b.muted ? 0.3 : (over ? this._headGlow + 1.4 : 0.5) + k * 2.2;
          core.material.opacity = b.muted ? 0.25 : 1;
        }
        const L = this.headLights[i];
        L.position.set(px, py, pz);
        L.visible = true;
        L.color.copy(col);
        L.intensity = b.muted ? 0.05 : (over ? this.fireflyBright : this.fireflyDim) + k * 4.0;
        // the invisible twin, mirrored on the OTHER side of the surface: lights
        // the facet sides the main firefly can't reach (fake diffusion)
        const ML = this.headLightsMirror[i];
        if (this.mirrorFirefly) {
          ML.position.set(P[0] + f.n[0] * d, P[1] + f.n[1] * d, P[2] + f.n[2] * d);
          ML.visible = true;
          ML.color.copy(col);
          ML.intensity = L.intensity;
        } else ML.visible = false;
      } else {
        // 'square': the original folding full-cell head
        for (const led of this.headLeds[i]) led.visible = false;
        this.headInners[i].visible = false;
        this.headLights[i].visible = false;
        this.headLightsMirror[i].visible = false;
        this.headFrames[i].visible = false;
        ring.visible = false;
        const pieces = this._headPieces(b.faceId, b.x, b.y, this._headHalf);
        for (let k2 = 0; k2 < pool.length; k2++) {
          const mesh = pool[k2];
          if (k2 < pieces.length) {
            this._placeRect(mesh, pieces[k2], this._lift);
            mesh.material.emissiveIntensity = b.muted ? 0.6 : glow;
            mesh.material.opacity = b.muted ? 0.14 : 0.5;
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
