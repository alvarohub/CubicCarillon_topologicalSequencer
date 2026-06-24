# Geodesic Surface Lab

Experimental branch prototype for heads moving on non-cuboid surfaces and reading the surface as a pickup.

Run from the repository root:

```sh
python3 -m http.server 8001
```

Open:

```text
http://localhost:8001/experiments/geodesic-surfaces/
```

## What This Proves

The lab separates the idea of a reading head from the Cube Carillon cuboid renderer.

- A head moves in a local chart.
- Edge crossings use explicit atlas transition maps.
- Square grids are drawn as explicit surface curves, so the visible tracks match the chart logic.
- The head samples a procedural colour field on the surface.
- The sampled colour is mapped to pitch and head colour.
- Nearby heads create collision ticks.

## Included Surfaces

- **Flat torus**: one rectangle, opposite edges glued. Warm heads run around the large circle; cool heads run through the hole.
- **Square tube torus**: four rectangular side charts, like a cuboid bent into a ring and glued end-to-end.
- **Square tube 90 / 180 / 270 twists**: the same square-section tube, but the end frame is rotated before gluing. This is the direct extension of the Cube Carillon cuboid idea.
- **Icosahedral sphere**: a polyhedral sphere approximation. Geodesics are straight inside triangular facets; curvature is concentrated at vertices.

## Not Yet Included

Smooth-surface geodesics are intentionally not part of this first pass. A true smooth sphere or embedded donut torus needs a different backend where the state is a point on a parametric surface plus tangent velocity, and the integrator follows the geodesic equation or an equivalent constrained dynamics method.

## Reusable Parts

The file `src/atlas.js` is the seed of a generalized surface core:

- `AtlasSurface`: chart collection plus edge transitions.
- `Head`: minimal moving pickup state.
- `stepHead()`: polygon chart stepping and edge transition handling.
- surface builders for the flat torus, square-tube twists, and icosahedral sphere.

This is intentionally standalone so the main Cube Carillon instrument stays stable while the topology experiments can become a second project.
