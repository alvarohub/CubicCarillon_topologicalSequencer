# How a Head Moves on the Surface — the Atlas Method

This document explains the single mechanism that drives all head motion in this
project, from the original 2007 cube to the current arbitrary-polyhedron
experiment. Two implementations exist; they are the same algorithm:

- [src/core/surface.js](../src/core/surface.js) + [src/core/ball.js](../src/core/ball.js) — the
  Cube Carillon instrument (square faces, cuboid).
- [experiments/geodesic-surfaces/src/atlas.js](../experiments/geodesic-surfaces/src/atlas.js) —
  the generalized lab (arbitrary polygon charts: rectangles, triangles,
  Möbius strip, square tube with twists, icosahedral sphere).

---

## 1. The central idea: the head never lives in 3D

A head is **not** a particle moving through 3D space with constraints. Its
entire state is five numbers:

```
head = { faceId, x, y, vx, vy }
```

- `faceId` — which chart (face) of the surface it currently sits in.
- `(x, y)` — its position in that chart's local 2D coordinates.
- `(vx, vy)` — its velocity, expressed in the same local 2D coordinates.

That is the whole kinematic state. 3D is only used twice:

1. **At build time**, to _compute_ the transition maps between charts (see §4).
2. **At render time**, to _place_ the head on screen via the face's 3D frame:
   `P = C + x·u + y·v` (see `to3D` in both modules).

The motion itself is pure 2D Euclidean geometry inside flat charts, plus a
lookup table of gluing maps between them. This is exactly your 2007 structure
— a face with local coordinates (`classFaceGeom`) and a transform table
(`classFaceGraph`) — except the transform table is now **computed from the
geometry** instead of hand-typed.

The mathematical name for this object: the surface is an **atlas** (a set of
flat polygonal charts), the gluing maps are its **transition maps**, and a
trajectory that is straight inside each chart is a **geodesic**.

---

## 2. Inside one chart: motion is trivial

Within a face, the chart is a flat polygon in the plane. With no forces, the
head is a free particle:

```
x += vx * dt
y += vy * dt
```

Nothing else happens. All the topology of the surface is concentrated at the
chart boundaries.

---

## 3. Crossing a boundary: the step loop

Each frame, `stepHead(head, dt)` (atlas.js) / `ball.step(surface, dt)`
(ball.js) does this:

```
remaining = dt
while remaining > 0:
    1. Find the EARLIEST time t_hit at which the current ray
       (x,y) + t·(vx,vy) exits the current polygon.
    2. If t_hit > remaining:   no crossing this frame
           x += vx·remaining;  y += vy·remaining;  done.
    3. Otherwise:              advance exactly TO the edge
           x += vx·t_hit;  y += vy·t_hit;  remaining -= t_hit
    4. Look up the transition map of this (face, edge).
    5. Apply it:
           faceId ← toFaceId
           (x,y)  ← M·(x,y) + t        ← position re-charted
           (vx,vy) ← M·(vx,vy)         ← velocity re-charted (NO +t)
    6. Loop again with the leftover time, now inside the new chart.
```

Sub-stepping to the exact edge (step 3) is what makes the crossing exact
rather than approximate: the head never overshoots and gets corrected, it
_touches_ the seam and continues from the correct point of the neighbour
chart.

Two fine points:

- **Position gets `M·p + t`, velocity gets only `M·v`.** The translation `t`
  re-centres coordinates between charts; velocity is a _displacement_, it has
  no origin, so it is only rotated/reflected. Applying the same `M` to both is
  the invariant that keeps the trajectory straight when the two charts are
  unfolded into one plane.
- **If an edge has no neighbour** (an open boundary, like the rim of the
  Möbius strip in the lab), the head is reflected off the edge instead:
  `v ← 2(v·tangent)tangent − v`.

On the cube this loop is what you wrote in 2007: detect which side of the
square was exceeded, switch face, remap coordinates and velocity. The
generalization replaces "which side of a square" with "which side of an
arbitrary convex polygon" (§5) and the hand-typed remap table with computed
maps (§4).

---

## 4. How transition maps are _computed_ from the 3D embedding

This is the part that lets the code handle **any** polyhedron. It is done once
at build time (`_buildGluings` in surface.js, `buildComputedTransitions` in
atlas.js). For every face edge:

### Step 1 — find the neighbour by 3D point matching

Each face stores its vertices in 3D (cube: derived from `C + x·u + y·v`;
polyhedra: the actual vertex coordinates, e.g. the icosahedron's vertices).
Two faces are adjacent along an edge if their 3D edge endpoints coincide:

```
edge (A,i) ≡ edge (B,j)  iff  {P0, P1} match as a SET (either order)
```

So adjacency is discovered from the embedding, never declared by hand. Add a
new polyhedron = supply its vertex list; the maps follow automatically.

### Step 2 — express the shared edge in BOTH charts

The two shared 3D endpoints `P0, P1` are projected into each face's local 2D
frame:

```
a_A, b_A = to2D(A, P0), to2D(A, P1)   // same physical edge, chart A coords
a_B, b_B = to2D(B, P0), to2D(B, P1)   // same physical edge, chart B coords
```

(`to2D(face, P) = [dot(P − C, u), dot(P − C, v)]` — just a projection onto the
face's own axes.)

### Step 3 — build an orthonormal "edge frame" in each chart

In each chart, build a little coordinate system attached to the edge:

```
e1 = normalized(b − a)          // unit tangent ALONG the edge
e2 = perp(e1) = (−e1.y, e1.x)   // unit normal to the edge, in the plane
```

The change-of-basis from "chart A coordinates" to "chart A edge-frame
coordinates" is the transpose of the matrix whose columns are `(e1_A, e2_A)`
(the frames are orthonormal, so transpose = inverse — no matrix inversion
code needed anywhere).

### Step 4 — two candidate isometries

Going A → edge-frame-A → edge-frame-B → B gives a rigid 2D motion
`p_B = M·p_A + t`. But there are **two** ways to superimpose the two edge
frames, and both correctly map the shared segment onto itself:

```
M_pres = [e1_B | e2_B] · [e1_A | e2_A]ᵀ      // orientation-PRESERVING
M_rev  = [e1_B | −e2_B] · [e1_A | e2_A]ᵀ     // orientation-REVERSING
```

For each candidate, the translation is pinned by anchoring one endpoint:

```
t = a_B − M·a_A        (because M·a_A + t must equal a_B)
```

### Step 5 — the interior probe disambiguates

Both candidates glue the _edge line_ correctly, but only one glues the
_interiors_ correctly: a point just **outside** face A across the edge must
land just **inside** face B. So the code builds a probe:

```
midA   = midpoint of the edge in chart A
outA   = direction from A's centre to midA   (faces are centred at origin)
probe  = midA + ε·outA                       // ε = small fraction of the face size
```

then maps the probe with each candidate and scores it by how far the image
lies toward B's interior:

```
score(M, t) = (M·probe + t − midB) · inB
```

The winner becomes the stored transition map
`{ toFaceId, toEdge, M, t }`.

This interior test is what makes the construction physically correct for
convex polyhedra without ever measuring dihedral angles: the two faces _are_
rigidly hinged along the edge in 3D, and the correct unfolding is the one that
does not flip the outside to the outside.

### Why M is what it is

`M` is orthonormal — it preserves lengths and angles. On the cube it comes out
as a signed permutation (entries in {−1, 0, +1}) because face axes meet at
multiples of 90°; on the icosahedron it is a general rotation by the angle
between the two triangles' edge frames. The code does not care: it is the same
formula.

---

## 5. Polygons instead of squares: finding the exit edge

On the cube, the face is an axis-aligned rectangle, so "earliest exit" is four
divisions (`(halfU − x)/vx`, etc.). For arbitrary convex polygons (triangles
included), `firstExit` in atlas.js tests the ray against each edge segment
using 2D cross products:

For each edge `(a → b)` of the polygon, with edge vector `E = b − a`:

```
value  = cross(E, p − a)      // signed side of the edge line the point is on
                               //   (for a CCW polygon: positive = inside)
denom  = cross(E, v)          // how fast the velocity changes that side
```

- `denom ≥ 0` → the ray is parallel to the edge or moving _toward the inside_
  through it — it cannot exit there. Skip.
- Otherwise the exit time is `t = −value / denom`.

Take the smallest non-negative `t` within the remaining frame time; that is
the edge the head leaves through. This is the standard convex-polygon raycast;
for triangles it is three of these tests per frame.

Everything else (the map application, the sub-stepping loop) is identical to
the cube. A triangle is just a chart with 3 entries in its `edges` array
instead of 4.

---

## 6. Why this gives geodesics (the unfolding picture)

A geodesic on a polyhedron is the curve that becomes a **straight line** when
the faces it visits are unfolded flat. The transition map `p_B = M·p_A + t` is
_exactly_ that unfolding, expressed as a change of coordinates instead of a
physical fold:

- **Folding picture**: rotate face B in 3D around the shared edge until it is
  coplanar with A; the trajectory continues straight across.
- **Chart picture (what the code does)**: stay flat the whole time, and change
  coordinates so the two charts overlap on the shared edge.

They are the same rigid motion. So the algorithm "ray inside a chart + map at
the seam" _is_ geodesic integration on a polyhedron, exact up to float
precision — no differential equations, no normal corrections, no projection
steps.

### Curvature lives only at the vertices

Faces are flat and edges are flat (folding along an edge costs no curvature).
All Gaussian curvature of a polyhedron concentrates at vertices as **angle
deficit**. On the cube: three 90° corners meet → 270° around a vertex →
deficit 90°; eight vertices give 8·90° = 720° = 4π (Gauss–Bonnet for a
sphere, χ = 2). On the icosahedron: five 60° triangles meet → 300° around a
vertex → deficit 60°; twelve vertices give 12·60° = 720° = 4π. ✓

Consequences for the sequencer:

- A trajectory aimed **exactly at a vertex** has no unique continuation (the
  cone point): the unfolded angle there is less than 360°, so "straight ahead"
  is ambiguous. In code this is a measure-zero event; in practice float noise
  nudges the head off the vertex. This is the natural "accent event" hook
  discussed in IDEAS.md.
- Parallel transport around a vertex rotates a vector by the deficit — this is
  why a head that loops a closed path around a corner comes back heading in a
  _different_ direction than it left (holonomy). On a flat torus (no vertices,
  no deficit) directions are globally consistent; on the icosahedral sphere
  they cannot be.

---

## 7. The full data flow, end to end

```
3D vertex list of the polyhedron
        │
        ▼  build time
per-face frames (C, u, v, n)  +  3D edge matching  +  edge frames  +  probe test
        │
        ▼
face.edges[e] = { toFaceId, toEdge, M, t }        (the atlas)
        │
        ▼  every frame, pure 2D
firstExit(ray vs polygon) → M·p+t / M·v at the seam → continue in next chart
        │
        ▼  render time only
P = C + x·u + y·v   (embed the 2D state back into 3D for three.js)
```

Cell grids (the musical score) are just a uniform subdivision of each chart's
(x, y) domain; "head entered cell (i, j)" is an index computation in the local
chart, so the score is painted on the _surface_, not on the 3D embedding — the
same score survives any re-embedding of the atlas (this is what the twisted
square-tube demos show: four identical charts, four different 3D placements).

---

## 8. Cube vs. generalized lab: side by side

| Concern        | Cube (`src/core/`)                        | Lab (`experiments/geodesic-surfaces/`)                                                    |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Chart shape    | axis-aligned rectangle (`su × sv`)        | arbitrary convex polygon (`verts2`)                                                       |
| Exit test      | 4 analytic divisions                      | cross-product raycast per edge (`firstExit`)                                              |
| Frames         | `u, v` axis-aligned with the face         | `u = B−A` direction of first edge, `v = n×u` (`triangleFace`)                             |
| Maps           | computed in `_buildGluings`/`_transition` | computed in `buildComputedTransitions`/`transition` (identical math)                      |
| Hand-made maps | not used                                  | allowed via `glue()` for abstract surfaces with no natural embedding (flat torus, Möbius) |
| Open edges     | bounce                                    | bounce (same reflection rule)                                                             |

Note the last row: the atlas also supports surfaces that have **no 3D
embedding at all** — you just write the maps by hand with `glue()` (flat
torus: one rectangle, opposite edges identified; Möbius: one rectangle, one
pair of edges identified with a flip). Hand-made maps are still legal; the
contribution of the generalized code is that they are _derived automatically_
whenever a 3D embedding exists.

---

## 9. What is _not_ covered (and would need a different backend)

Smooth surfaces (a true sphere, a donut torus) have curvature distributed
continuously, not concentrated at vertices. There the state is a point on a
parametric surface plus a tangent velocity, and the step must integrate the
geodesic equation (or use constrained dynamics). The atlas method above is for
**flat charts glued by isometries** — polyhedra, polygon unfoldings, and flat
quotients — which is where the instrument's musical structure (cell grids,
edge events, vertex accents) is exact and cheap.

---

# Part II — From a 3D mesh to flat charts: the embedding layer

Part I described motion as pure 2D geometry plus gluing maps. This part
answers the other half: where the charts come from, how a local coordinate
system is attached to each triangle, how the head's 2D state becomes a 3D
point on screen, and how the polyhedron is stored as data.

All references are to
[experiments/geodesic-surfaces/src/atlas.js](../experiments/geodesic-surfaces/src/atlas.js)
(core) and
[experiments/geodesic-surfaces/src/main.js](../experiments/geodesic-surfaces/src/main.js)
(renderer). The cube instrument's
[src/core/surface.js](../src/core/surface.js) does exactly the same things with
a shorthand (its faces are axis-aligned rectangles, so the frames are written
down directly in `FACE_SPECS`).

## 10. How the polyhedron is represented as data

It is the classic mesh representation — the same thing OpenGL/Direct3D have
used since forever, nothing exotic:

```
raw     = [v0, v1, ..., v11]    // flat list of 3D vertices (floats)
indices = [[a,b,c], ...]        // one triplet per face: WHICH three vertices
```

For the icosahedron (`createIcosaSphere`): 12 vertices (the
$(\pm 1, \pm\varphi, 0)$ rectangle-corner construction, normalized and scaled
to radius 1.55) and 20 index triplets. The triplets also encode **winding**:
`[a, b, c]` is counter-clockwise seen from outside, which is what lets the
code compute an outward normal later.

So: **vertices carry geometry, indices carry topology.** Two faces are
adjacent not because of a pointer structure, but because two triplets happen
to contain the same two vertex coordinates — and the transition-map builder
(Part I, §4) discovers that by comparing 3D endpoints (`buildComputedTransitions`
matches `[A0,A1]` against `[B0,B1]` in either order).

Note that each face then **copies** its three vertex positions into
`face.verts3`. The mesh becomes a "polygon soup": duplicated vertices, no
shared half-edge structure. For 20–1000 faces that is a feature, not a bug —
edge matching by coordinate equality is $O(F^2)$ once at build time, and after
that nothing chases pointers.

## 11. How the coordinate frame is attached to a triangle (`triangleFace`)

This is the step that "applies a coordinate system over the triangle". Given
the three 3D vertices $(a, b, c)$, `triangleFace` builds a small 3D
orthonormal frame glued to the triangle's plane:

1. **Normal.**
   $$n = \operatorname{norm}\big((b-a)\times(c-a)\big)$$
   If $n$ points toward the mesh centre ($n\cdot C < 0$), swap $b$ and $c$ —
   this is how the code *repairs* wrong winding instead of trusting the index
   list.

2. **In-plane axes.** Pick the first edge as the local $u$ axis, and get $v$
   as the normal rotated 90° inside the plane:
   $$u = \operatorname{norm}(b-a), \qquad v = \operatorname{norm}(n\times u)$$
   Now $(u, v, n)$ is a right-handed orthonormal basis: a tiny 3D coordinate
   system sitting on the triangle.

3. **Origin.** $C = (a+b+c)/3$, the barycentre — so local coordinates are
   centred, exactly like the cube faces are centred.

The frame defines the two maps that convert between the chart and 3D:

$$
\text{to3D}:\quad P = C + x\,u + y\,v
$$

$$
\text{to2D}:\quad x = (P-C)\cdot u, \qquad y = (P-C)\cdot v
$$

The second line works *because the basis is orthonormal*: projecting onto $u$
and $v$ is the inverse of the first line. No matrix inversion anywhere — the
dot product with an orthonormal basis **is** the inverse transform. (For the
cube, the same formulas appear in `Surface.to3D` / `Surface.to2D`.)

Then `triangleFace` computes `verts2 = [to2D(a), to2D(b), to2D(c)]`: the same
triangle, flattened into its own plane coordinates. That `verts2` polygon is
the entire playing field of the chart — the exit test (`firstExit`) only ever
sees these three 2D points, and by construction $a$ lands at
$(|b-a|/... )$ on the $x$-axis side: $u$ points from $a$ to $b$, so in local
coords the edge $a\!\to\!b$ is horizontal-ish. The choice is arbitrary (any
rotation of the frame would work); fixing $u$ along an edge just makes the
numbers tidy.

**Per-face summary** — each triangle is tracked as one plain object:

```
face = {
  id,                     // index in the faces array (the "tracking" key)
  C, u, v, n,             // 3D frame: origin + orthonormal basis
  verts3: [a, b, c],      // 3D corners (copied from the mesh)
  verts2: [a2, b2, c2],   // the SAME corners in local 2D  (the chart)
  edges:  [e0, e1, e2],   // transition maps, filled by buildComputedTransitions
}
```

`AtlasSurface` puts these in an array plus a `Map` (`_byId`), so the head's
`faceId` is just an integer and "which triangle am I on" is an $O(1)$ lookup.

## 12. From head state to pixels: two different paths

The renderer never simulates in 3D — it only *consumes* the 2D state, through
one of two doors depending on the surface kind.

### Path A — polyhedra: the frame formula directly

For `kind: 'polyhedron'` the embedding function is literally the chart map:

```js
embed: (head, surface) =>
  surface.to3D(surface.faceById(head.faceId), head.x, head.y)
```

Each frame, `sampleAndPlaceHeads` calls it and writes the result into the
three.js mesh:

```js
const p = surface.embed(head, surface);
headMeshes[i].position.set(p[0], p[1], p[2]);
```

So the chain is:

```
(faceId, x, y)  ──to3D: C + x·u + y·v──▶  3D point  ──▶  mesh.position
```

The head sphere then rides the polyhedron exactly, including across seams —
the seam crossing already happened in 2D (Part I); 3D only sees the result.
`checkCollisions` compares these embedded 3D positions pairwise (two heads
meeting on an edge have *different* chart states but the *same* 3D point —
embedding is the correct place to detect that).

### Path B — abstract surfaces: `embed` is a parametric display function

For the torus / tube / Möbius there is no frame per face; `embed` is an
ordinary parametric surface $E(x, y)$ (e.g. `torusEmbed` is the textbook
torus formula). The charts are flat rectangles; the display is curved. The
musical logic (cells, transitions, distances) lives in the flat chart; the
curve is a pure rendering choice. This is the "skin for any mesh" idea —
dynamics in $(x,y)$, polyhedron (or torus) just the texture-mapping display.

The grid lines on the curved skins are drawn the same way: sample
$E(x, y=\text{const})$ at ~160 points and emit a polyline (`buildGrid` →
`addGridLine` with `embedOffset`). On the polyhedron the "grid" is just the
triangle outlines themselves: `verts2` edges pushed through `to3D`.

## 13. The OpenGL side: how the mesh is actually drawn

`buildSurfaceMesh` in main.js is the GPU-facing half. For the icosahedron:

```js
const positions = [];               // flat float array, 9 floats per triangle
for (const face of surf.faces)
  for (const p of face.verts3) positions.push(...p);

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
geo.computeVertexNormals();
new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, ... }));
```

Three things to note:

1. **Non-indexed soup again.** The 3D vertex list (`raw`) used at build time
   is *not* what goes to the GPU. For rendering, each face re-emits its three
   corners into one flat `position` buffer — 20 triangles × 3 = 60 vertices
   with duplicates. That is deliberate: with `vertexColors` (one colour per
   face) and flat facets you *want* duplicated vertices, because a shared
   vertex can't carry two different colours/normals. This is the standard
   "flat-shaded low-poly" recipe.

2. **Normals.** `computeVertexNormals()` on a non-indexed buffer gives each
   triangle its own constant normal (the cross product of its edges — the same
   $n$ the chart frame uses). That's what makes the facets read as hard,
   gem-like planes under the lights instead of a blurry blob. (The square-tube
   mesh sets `flatShading: true` for the same reason on indexed geometry.)

3. **Wireframe + grid are extra line layers.** `WireframeGeometry` extracts
   the triangle edges as a `LineSegments` buffer (faint blue), and the bright
   grid layer is built by pushing chart-coordinate points through the
   embedding — the visible tracks are therefore guaranteed to coincide with
   the logical cells, because both are functions of the same $(x, y)$.

The correspondence to keep in mind:

| Layer | Data | Produced from |
|---|---|---|
| Logic | `face.verts2`, `edges[]` | 3D mesh, once, at build time |
| Display mesh | `position`/`color` float buffers | `face.verts3` |
| Head markers | `mesh.position` | `to3D(face, x, y)` each frame |
| Grid lines | polyline buffers | `embed(x, y)` sampled |

Same surface, four views of it. The head only ever *lives* in the first row.
