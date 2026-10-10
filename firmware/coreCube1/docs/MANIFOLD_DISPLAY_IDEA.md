# Manifold Display Idea

This is a design note, not an implementation ticket.

## Core Idea

Most rendering systems assume a flat framebuffer, usually a rectangle. Even when
content is later placed on a 3D object as a texture, the display model is still
fundamentally rectangular: draw on a 2D plane, then map the result onto a surface.

For this project, the more general idea is different:

A display can live directly on a manifold.

The display is not only a pixel buffer. It also contains maps between:

- logical coordinates used by an instrument/game/animation,
- local charts on a surface,
- adjacency/gluing between charts,
- physical emitters such as daisy-chained NeoPixels,
- and possibly a 3D embedding used only for visualization or fabrication.

The cube is the first simple case. Its six faces are charts. The edge maps tell us
how motion, drawing, and LED addressing continue across chart boundaries.

## Why This Is Not Just A Texture

A common graphics workflow is:

1. Render an animation to a rectangular texture.
2. Place that texture on a mesh using UV coordinates.

That is useful, but it is not the same as a manifold display.

In a manifold display, the topology and maps are part of the display itself. A
cursor, particle, read-head, brush stroke, or musical trajectory can move across
charts according to the manifold's transition maps. The display should know how a
pixel/chip/facet/LED relates to its neighbors, not only where a flat image lands
on a mesh.

## Pixel Addressing On A Manifold

A flat framebuffer has a global addressing scheme: pixel `(x, y)`, one origin,
one pair of axes shared by every pixel. A manifold display has **no global flat
map** — by Gauss's Theorema Egregium, a curved surface cannot be flattened
without distortion, so no single rectangular addressing can cover it faithfully.
Addressing is therefore _chart-relative_:

- A pixel is addressed as `(chartId, i, j)` — the current implementation already
  uses this shape: `(face, x, y)` in `LedMapper`, `ScoreGrid`, and the firmware's
  `(faceId, x, y)` cells.
- Neighbor queries go through the chart's grid _inside_ the chart, and through
  the transition maps _across_ chart edges (`kCubeGluings` / `crossEdge` in
  `cube_topology.hpp`, or the computed `{toFaceId, toEdge, M, t}` records in the
  JS `Surface`/`AtlasSurface`).
- The emitter chain index (the daisy-chained NeoPixel position) is a _third,
  independent_ addressing layer, resolved last, by the `EmitterMap`. Geometric
  adjacency and electrical order are deliberately decoupled.

What this _simplifies_ compared to texture mapping: there is no UV unwrapping
step, no seam artefacts, no resampling of a rectangular image onto a curved
domain, and no pole singularities (a sphere UV map crams a whole edge into two
pixels). Each chart is an honest, undistorted grid; all the curvature is pushed
into the transition maps at the seams and the cone points at the vertices.

What it _costs_: anything that assumed a global coordinate system — blits, line
drawing between arbitrary pixels, convolutions, bounding boxes — must be
reformulated chart-wise plus seam crossings. The function set below is the
replacement toolbox.

## Only Local Frames: No Global Up/Down/Left/Right

A manifold display has no global notion of direction. "Up", "down", "left" and
"right" exist **only inside one chart** (the chart's `u`/`v` axes). Across a
seam, directions are transported by the transition map's matrix `M`: a motion
that was `+x` in chart A may become `−y` in chart B.

This is not a limitation of the hardware — it is a theorem about curved
surfaces. On a sphere there is no global, continuous, non-vanishing direction
field (hairy ball theorem): any "global up" must break somewhere. The cube
already shows this concretely: carry a direction once around a cube vertex and
it comes back rotated by 90° (the vertex's angle deficit — holonomy). Around a
closed loop, direction is path-dependent.

Design consequences:

- UI concepts like "scroll up" or "a right-pointing arrow" are chart-local
  statements; content that must look upright everywhere needs a deliberate
  _frame field_ choice per chart, and that choice is part of the display map.
- Direction-dependent content should be specified intrinsically: relative to a
  trajectory ("forward/left/right of the moving particle"), to a gradient
  ("downhill"), or to a stored frame field — never to a global compass.
- Conversely, intrinsic behavior is _portable_: the same particle/rules code
  runs on the cube, a tube, or an icosahedron unchanged, because it never
  references a global frame.

## Agents Moving On The Surface

Because motion is defined intrinsically (chart coordinates + transition maps),
this display model is a natural simulator for agents constrained to a surface:
people or vehicles on the surface of the Earth, robots on a factory floor,
animals on terrain, pedestrians in a building. On a sphere-like manifold there
is no edge of the world and no map projection distortion — an agent just keeps
walking its geodesic and the chart machinery handles everything.

Required function set (the geodesic toolbox):

- `step(agent, dt)` — geodesic motion: straight inside a chart, transition map
  at each seam. This is exactly the `Ball.step` / `stepHead` loop already in the
  project; in Polthier–Schmies' language it traces a **straightest geodesic**
  (equal angle sum left/right at each crossing), which gives a _unique_
  continuation from a point and tangential direction — the right notion of "keep
  walking straight" on a polyhedron.
- `distance(a, b)` — intrinsic surface distance between two chart points
  (chart-local points `(chartId, x, y)`). Options: unfolding candidate paths and
  measuring in the plane (exact-ish for few faces), or graph/mesh geodesic
  approximations (MMP / heat method family) for dense meshes.
- `transport(frame, path)` — parallel-transport of a direction along a path
  (Polthier–Schmies define this directly from straightest geodesics); needed for
  agent heading, oriented sprites, and "keep facing forward" behavior.
- `neighbors(pixel)` — the display-level primitive everything else composes:
  chart grid neighbors inside, transition-mapped neighbors across seams.
- Later: vector-field integration on the surface (their discrete Runge–Kutta
  section) for flow-following agents — currents, winds, crowds.

Note the vertex case: a geodesic aimed exactly at a cone point (a vertex with
angle deficit, e.g. a cube corner) has no unique continuation — the straightest
geodesic is undefined there, and locally-shortest geodesics refuse to pass
through positive-deficit vertices at all. For a display/simulator this is a
feature to expose, not to hide: on the cube it is the natural "accent event";
for agents it is a decision point.

## References

- K. Polthier, M. Schmies — _Straightest Geodesics on Polyhedral Surfaces_.
  The seminal paper. Two versions of the same work:
  SIGGRAPH '06 Courses, pp. 30–38 — <https://dl.acm.org/doi/10.1145/1185657.1185664>
  and the earlier book chapter in _Mathematical Visualization_ (1998) —
  <https://www.researchgate.net/publication/234790847_Straightest_Geodesics_on_Polyhedral_Surfaces>.
  Introduces discrete geodesic curvature and straightest geodesics; gives a
  unique initial-value solution for "move in this tangential direction",
  defines parallel translation, and a discrete Runge–Kutta integrator for
  vector fields on polyhedral surfaces. All definitions are intrinsic — no
  reference to the ambient 3D space — which matches this project's atlas
  design exactly: our per-edge transition maps `p' = M·p + t` _are_ the
  unfold-and-continue-straight construction of that paper.

Related reading directions (to fill in as the library grows):

- Mesh geodesic distance algorithms: MMP (Mitchell–Mount–Papadimitriou) exact
  algorithm family; the heat method (Crane–Weischedel–Wardetzky) for fast
  approximate distance fields.
- Hairy ball theorem (why no global direction field exists on a sphere);
  Gauss–Bonnet and angle deficit (why curvature concentrates at vertices);
  Theorema Egregium (why no distortion-free global flat map exists).

## Software

- **Geometry Central** (C++ geometry-processing library, Keenan Crane's group):
  <https://geometry-central.net/surface/algorithms/geodesic_paths/>. This is
  essentially the production-grade version of the toolbox sketched above.
  Notably:
  - `traceGeodesic(start, dir)` — traces a straightest geodesic from a
    `SurfacePoint` along a tangent vector, returning the endpoint, full path,
    length, and the incoming direction _transported into the endpoint's tangent
    space_. This is our `step(agent, dt)` primitive, and the fact that the
    answer arrives in the _local_ tangent space matches the chart-relative
    design: geometry-central has no global frame either — tangent axes are
    defined per mesh element (x-axis along a halfedge, y 90° CCW; rescaled
    corner angles at vertices).
  - All routines run on `IntrinsicGeometryInterface` — pure intrinsic geometry
    (edge lengths / corner angles), no embedding required. Exactly the
    manifold-display philosophy: the 3D embedding is optional display data.
  - Also relevant: FlipOut/geodesic path shortening, heat-method and
    vector-heat-method solvers (distance fields + parallel transport),
    logarithmic map (inverse of tracing: direction+distance from A to B),
    direction fields, and intrinsic triangulations (retriangulating a mesh by
    intrinsic data only).

### Algorithm map for the manifold display

From the verified docs (all of these are intrinsic-only unless noted):

- **Geodesic distance** (`surface/algorithms/geodesic_distance/`). Three
  backends for `distance(a, b)`:
  - _MMP exact_ (`GeodesicAlgorithmExact`, Kirsanov's implementation of
    Mitchell–Mount–Papadimitriou '87): exact polyhedral distance from a source
    set, with `traceBack()` returning the actual shortest _path_ as a list of
    `SurfacePoint`s — plus `getLog()` (exact log map: direction+distance from
    the nearest source to a query point) and `getDistanceGradient()`. Any
    triangle mesh, even non-manifold; edge lengths only.
  - _Heat method_ (`HeatMethodDistanceSolver`, Crane–Weischedel–Wardetzky):
    approximate but just two linear solves; the stateful solver precomputes a
    factorization so repeated single-source queries are nearly free — the
    right choice for a host app recomputing distance fields every edit.
  - _Fast marching_ (`FMMDistance`, Kimmel–Sethian '98): wavefront
    propagation, also gives _signed_ distance to closed source curves —
    useful for "distance to a drawn boundary/stroke" features.
- **Direction fields** (`surface/algorithms/direction_fields/`, after
  Knöppel–Crane–Pinkall–Schröder 2013): smoothest n-direction fields with
  automatically placed singularities, boundary-aligned variants, and index
  computation. This is the principled answer to the "no global up/down"
  section: instead of hand-choosing a per-chart frame field, compute the
  smoothest one and read off where the singularities _must_ live (on the
  cube: the vertices, index 1/4 each — the Poincaré–Hopf theorem made
  visible on the display).
- **Parameterization** (`surface/algorithms/parameterization/`, BFF —
  Sawhney–Crane 2017): conformal flattening of a disk-topology mesh to the
  plane. For a manifold display this is the bridge the other way: when a
  global flat view _is_ wanted (a companion screen, printing the score),
  BFF gives the least-distorted one, with user control of boundary shape.
- **Geodesic centroidal Voronoi tessellations** (`geodesic_voronoi_...`, after
  the Vector Heat Method paper): partition the surface into cells closest to
  each site, with sites relaxed to cell centroids. Display uses: zone
  assignment (which region of the surface "belongs" to which agent/instrument),
  even emitter placement on an irregular body, and Karcher-mean-style
  "surface centers" (also exposed separately as `surface_centers`).
- Everything runs on `IntrinsicGeometryInterface` — edge lengths / corner
  angles only. A physical LED sculpture whose embedding is approximate (or
  even unknown) can still compute correct intrinsic distances and fields.

  The gap between the two codebases is mostly _robustness and data structure_:
  geometry-central uses halfedge meshes with exact predicates and handles
  vertex/edge hits carefully; our atlas uses a polygon soup with chart frames.
  For arbitrary-mesh surfaces beyond the lab (dense triangulated displays),
  their model is the reference implementation to mine; for the LED cube and
  small-chart instruments, our lighter atlas is sufficient and much easier to
  port to firmware.

## What Would Be Our Contribution?

If geometry-central (and the geodesics literature) already covers the general
math, the honest answer is: **not the math**. The open niche is the _display +
interaction_ side, plus a set of regimes where the general machinery collapses
into something much cheaper. Concretely:

### 1. The display itself as the research object

The literature treats a polyhedron as a domain to _analyze_; we treat it as a
device to _drive_. Nobody ships "a manifold with pixels": a persistent state
layer on the charts (the score/pixel buffer living on the surface, not in a
texture), an emitter chain decoupled from geometry, seam-aware drawing
primitives, live re-tessellation (our cuboid re-slicing: changing divisions
keeps heads on their cells instead of rebuilding the world). The contribution
is the **systems architecture** — `VirtualDisplay` / `Chart` / `Transition` /
`EmitterMap` as separable concepts — and showing that the atlas model is the
right abstraction for physical displays. A paper-shaped version of this would
be: "geodesic interaction on emissive polyhedra" — the instrument as the
proof that the model works under real-time, real-hardware constraints.

### 2. Structure-exploiting fast paths (the interesting CS part)

General mesh geodesics pay for generality (halfedge traversal, exact
predicates, heat-method linear solves). Our surfaces are not general, and
each structural class admits a much cheaper special case:

- **Regular polyhedra (cube, icosahedron...)**: all faces congruent, all
  transition maps come from a tiny symmetry group. On the cube every `M` is a
  signed permutation — a transition costs a few sign flips, no floats, no
  atan2, no matrices. The _entire_ atlas is generated from the symmetry group;
  the firmware already exploits this (`kCubeGluings` is 24 integer entries).
- **Regular tilings / cells aligned to faces**: when the pixel grid subdivides
  each face uniformly, seam crossings of _grid cells_ are also combinatorial —
  index arithmetic, not ray-polygon tests. BFS on the cell graph gives exact
  unit-step geodesic distance with zero geometry code (the physical-cube
  `distance` plan).
- **Prisms and tubes (square tube, extrusions)**: transitions along the
  extrusion axis are identities; only the end-gluing carries information
  (twist). One map parameterizes the whole family.
- **Flat quotients (torus, Möbius)**: no geometry at all — the charts are one
  rectangle and the maps are translations/flips; geodesics are literally
  modular arithmetic.

So there is a real, demonstrable claim: a complexity ladder where the same
interaction primitives run at cost $O(1)$-integer (cube), $O(\text{chart})$
(small atlas), or full mesh cost (arbitrary display) — chosen by the surface
class, with one shared API. Geometry-central will not do this for you: its
abstraction deliberately hides the special cases.

### 3. Firmware-real-time geodesics

A second honest contribution: the whole pipeline running on a
microcontroller at LED frame rates, with integer/fixed-point seam crossings
and sub-ms budgets. The literature assumes a workstation; the constraint
profile of a 200 MHz MCU driving 384 NeoPixels is different enough that design
decisions (precomputed integer gluings, cell-quantized motion, no heap) become
the content, not an afterthought.

### 4. The cone points as first-class events

Geodesic code treats vertices as numerical hazards to route around. We treat
the angle deficit as _signal_: vertex hits are musical accents, decision
points for agents, branching events for visuals. Turning the failure mode of
the general theory into a feature is a small but genuinely novel twist.

### What we should NOT claim

Exact geodesic distance on arbitrary meshes (MMP/heat method exist and are
better), straightest-geodesic theory (Polthier–Schmies), or robust general
tracing (geometry-central). Our story is: **intrinsic displays + interactive
geodesic instruments + structure-exploiting fast paths on constrained
hardware** — a combination nobody has assembled.

## Examples To Keep In Mind

- Cube made from six 8x8 LED faces.
- Torus / donut display with charts wrapping around two cycles.
- Triangulated bunny or arbitrary mesh with LEDs or cells sampled on the surface.
- Polyhedral displays where curvature lives at vertices and motion crosses face
  boundaries via explicit maps.
- Physical LED sculptures where the electrical order is a daisy chain unrelated
  to the geometric adjacency.

## Library Direction

The reusable library should eventually distinguish these concepts:

- `VirtualDisplay`: drawing surface/layer storage.
- `DisplayMap`: maps logical surface coordinates to display samples.
- `Chart`: a local coordinate system over a patch of the manifold.
- `ChartMatrixLayout`: rectangular matrix wiring for one local orthogonal chart
  (today this is handled by `Adafruit_NeoMatrix` and `CUBE_MATRIX_LAYOUT`).
- `Transition`: how coordinates cross between adjacent charts.
- `EmitterMap`: maps display samples to physical LED chain indices.
- `DisplayManager`: owns layers, composition, and physical output.
- `Renderer` or app adapter: musical/game-specific interpretation.

The current `cube_display` library is only the first practical step. It still has
cube-specific helpers because the hardware target is an 8x8x6 LED cube. The long
term direction is to make the display topology explicit enough that other games,
instruments, and surfaces can reuse the same concepts.

## Guiding Principle

Do not treat a physical display as merely a flat framebuffer unless it truly is
one. Treat it as a mapped surface with topology, charts, transitions, and an
emitter layout.

## Future Directions: From Display To Intrinsic Computation Stack

The atlas (charts + transitions) is a general-purpose substrate, not only a
display driver. Three extensions turn the library into a fuller toolkit.

### Texture extraction (surface → texture atlas)

Anything drawn on the manifold by walking it (painted strokes, particle
trails, agent footprints, simulated fields) lives in chart coordinates. To
show it on a _virtual_ 3D model — or to communicate with the standard graphics
pipeline — extract a conventional texture:

1. Choose a UV parameterization of the mesh (any standard unwrapping; for
   disk-topology pieces BFF from geometry-central is the high-quality option).
2. For each texel, find which chart/point it samples (UV → face + local
   coordinates).
3. Read the display/score state at that chart point and write the texel.

The walk-and-draw direction (manifold → atlas state) and this extraction
direction (atlas state → flat texture) are inverses bridged by the same
transition maps. Once the texture exists, applying it in OpenGL is immediate
and free at render time — the manifold only pays when content changes. This
also gives a practical pipeline: _author on the physical/intrinsic display,
publish as a normal textured mesh_.

### Metric and physics on the surface

With distances and geodesics available, a "physics" layer can be defined
intrinsically:

- **Metric tensor per chart** — for polyhedra every chart is flat, so `g` is
  the identity inside a chart and all the geometry lives in the transitions
  (this is why our motion code needs no Christoffel symbols). For embedded
  curved approximations (the torus skin), `g` comes from the first fundamental
  form of the embedding — the same `embed()` function differentiated.
- **Forces along geodesics** — attraction/repulsion computed with intrinsic
  distance instead of ambient 3D distance: two agents interact through the
  _surface_ path between them, not through space. On a cube, two points on
  opposite faces repel along the surface — the "2D particles feeling a 3D
  world" idea (IDEAS §8, Thomson-problem-on-a-cube configurations).
- **Gradient flows** — agents following gradients of intrinsic fields (heat,
  density, distance-to-source) using the distance gradient (`getDistanceGradient`
  in MMP, or cheap chart-local approximations).
- **Vector-field integration** — Polthier–Schmies' discrete Runge–Kutta gives
  the integrator for flow-following agents.

### Massive particles that bend the display

The speculative endpoint, and the most fun one: let agents carry "mass" that
deforms the manifold itself, so geodesics bend toward concentrations of mass —
a tabletop general-relativity toy.

- On a polyhedron this has a clean discrete form: adding curvature at a vertex
  = changing its angle deficit = _cutting or adding a wedge_ (a conical
  metric). Mass at a vertex literally eats or adds angle; geodesics then
  deflect near it because the straightest-path rule now sees a different
  total angle.
- Implementation-wise this is cheap to prototype: deficits become per-vertex
  variables, the transition maps are recomputed (or perturbed) when they
  change, and the tracing loop doesn't change at all.
- This is discrete Regge calculus in miniature — curvature as vertex deficit
  is exactly how simplicial GR works — so even the "physics modifies geometry"
  step has respectable literature behind it (Regge 1961; and the whole
  discrete-exterior-calculus program it seeded).

### Ordering by feasibility

1. Texture extraction — straightforward, mostly plumbing.
2. Intrinsic forces / gradient flows — moderate, reuses distance machinery.
3. Back-reacting geometry — research-toy tier, but uniquely suited to this
   library: because the atlas _is_ the geometry, "mass changing the display"
   is a data edit, not a re-meshing.

## Immediate TODOs Implied By This Idea

- Move face/chart helpers out of `VirtualDisplay` and into a mapping/topology layer.
- Keep `VirtualDisplay` as generic layer storage, not as the owner of cube semantics.
- Keep using `Adafruit_NeoMatrix` for rectangular local charts instead of reimplementing row/column/zigzag wiring.
- Treat the current `LedMapper` + `Adafruit_NeoMatrix` pair as the first concrete `DisplayMap`/`EmitterMap` boundary, not as the final abstraction.
- Promote `CUBE_MATRIX_LAYOUT` to a per-chart property if different faces use different matrix modules or orientations.
- Add a second topology test case before over-generalizing the library API.
- Preserve the distinction between app behavior (`LedRenderer`, sequencer rules) and reusable display concepts (`VirtualDisplay`, maps, transitions, emitter layout).
