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
- The head samples a procedural colour field on the surface.
- The sampled colour is mapped to pitch and head colour.
- Nearby heads create collision ticks.

## Included Surfaces

- **Flat torus**: one rectangle, opposite edges glued. This is exact as a flat quotient surface.
- **Mobius strip, 180 twist**: one strip, left/right edges glued with a flip. The open boundaries reflect heads in this lab.
- **Quarter-turn 90 / 270 quotients**: square fundamental domains with edge maps that rotate coordinates by a quarter turn. These are deliberately experimental twisted atlas maps.
- **Icosahedral sphere**: a polyhedral sphere approximation. Geodesics are straight inside triangular facets; curvature is concentrated at vertices.

## Not Yet Included

Smooth-surface geodesics are intentionally not part of this first pass. A true smooth sphere or embedded donut torus needs a different backend where the state is a point on a parametric surface plus tangent velocity, and the integrator follows the geodesic equation or an equivalent constrained dynamics method.

## Reusable Parts

The file `src/atlas.js` is the seed of a generalized surface core:

- `AtlasSurface`: chart collection plus edge transitions.
- `Head`: minimal moving pickup state.
- `stepHead()`: polygon chart stepping and edge transition handling.
- surface builders for torus, twists, and icosahedral sphere.

This is intentionally standalone so the main Cube Carillon instrument stays stable while the topology experiments can become a second project.
