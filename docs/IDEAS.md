# Cube Carillon — Ideas & Insights Notebook

A running log of conceptual discoveries made while building the _topological MIDI
sequencer_. The point of this file: **capture ideas the moment they appear** —
that is how invention actually happens. Most of these are deliberately _not_
implemented yet; they are seeds for future projects.

> "Suppose you have a figure and you apply the maps to the corners. All is good,
> until it approaches the vertex of the cube..." — Álvaro

---

## 1. The geometry we're really standing on

The cube surface is a **Euclidean (flat) surface with conical singularities** — a
set of flat polygons glued edge-to-edge by isometries. In modern terms:

- Each face is a **chart**; the per-edge gluing maps are the **transition maps**
  of an atlas. (Álvaro's original hand-typed `transformPos`/`transformSpeed`
  tables _were_ these transition maps — we now compute them from the 3D
  embedding instead.)
- Ball trajectories are **geodesics** (straight lines that continue straight when
  unfolded across an edge). This is the same object as "billiards in polygons" /
  "translation surfaces".
- **All curvature lives at the vertices.** Faces are flat, edges are flat (you
  can unfold across them), so by Gauss–Bonnet the entire curvature concentrates
  at the 8 cube corners. Each corner: $3 \times 90° = 270°$, an **angle deficit
  of $90°$**; total $8 \times 90° = 720° = 4\pi = 2\pi\chi$ (sphere). ✓

This framing means the engine generalizes for free to **any polyhedron, a flat
torus** (a square with opposite edges glued — _no_ cone points, geodesics never
get stuck), or arbitrary unfoldings: only the face list changes.

---

## 2. Drawing a moving figure across edges — the "clip + fold" method

**Status: implementing now (the protruding-squares fix).**

A head is a square living _in_ the surface. When its centre nears an edge, part
of it spills past. The fix generalizes Álvaro's original 2007 trick:

- **2007 trick:** split each "ball" into four sub-squares and crop the part that
  fell outside a face by reading it from a flattened framebuffer. Worked because
  trajectories were axis-parallel.
- **Now:** clip the square to the current face, and **fold** each overflow
  rectangle onto the neighbour face using the _same transition isometry_ the ball
  uses to cross. Because the maps are signed permutations (±90° / 180° /
  reflection), an axis-aligned rectangle maps to an axis-aligned rectangle — so
  each piece is still a clean quad, drawn in real 3D (no framebuffer crop).

The figure then **bends around the edge** instead of poking into space.

---

## 3. ⭐ FUTURE FEATURE — the figure splitting at a vertex (cone point)

**Status: idea only. Reserved for ANOTHER project. Do NOT build yet.**

This is the beautiful one. Take the "clip + fold" idea and push the figure toward
a **cube corner**:

- As long as the square overlaps only **one** edge, it folds onto one neighbour:
  a developable bend.
- The instant it overlaps **two edges at once** (i.e. it straddles a vertex), the
  overflow is **non-developable** — you cannot flatten the three faces meeting at
  a $270°$ corner without a $90°$ gap. The square must **split into two
  rectangles riding away on two perpendicular edges**, with a wedge missing
  between them.

Why it matters:

- It is the _visible signature of curvature_ — the missing $90°$ wedge is the
  angle deficit made tangible. The figure literally tears where the Gaussian
  curvature is concentrated.
- It connects to the **geodesic singularity**: a straight path is uniquely
  continuable everywhere _except_ at a cone point, where "straight ahead" is
  genuinely ambiguous. A figure (not just a point) reaching the vertex makes that
  ambiguity into a shape.
- **As an instrument:** a corner-hit is a perfect special musical event — a head
  reaching a vertex could split, reflect, or trigger an accent. Rich material for
  a future "topological" instrument where the _shape_ of the reading-head carries
  meaning.

Sketch of the moment:

```
       face A            corner (270°, missing 90° wedge)
   ┌───────────────┐    ╱
   │            ┌──┼───┐ piece 1 rides edge A–B
   │            │XX│   │
   │         ───┼──●═══╪═══  ● = the vertex
   │            └──┼───┘ piece 2 rides edge A–C (perpendicular)
   └───────────────┘
                    ╲  the two pieces diverge; a wedge of the
                       square simply has nowhere flat to go.
```

For now (current sequencer layout) heads ride fixed rows/columns and **never
reach a corner**, so we safely clip the doubly-overflowing corner sliver. The
full split is a deliberate future exploration.

---

## 4. Other threads worth keeping

- **The edge "tick" = a cell tick.** Álvaro's note: a sound when the head crosses
  an edge is conceptually identical to sounding when the head crosses a particular
  _cell_ in the grid — a periodic tick. The sequencer should treat "crossing an
  edge" as just one special case of "entering an armed cell".
- **Monome-style programmable surface.** The faces are a button matrix; pressing a
  facet _arms_ a cell. A head only sounds when it reads an armed cell. The head is
  the read-head; the surface is the score. This turns the cube into a genuine
  _topological_ step sequencer (the score wraps around a closed surface).
- **Polyrhythm from topology.** Perpendicular track groups at independent tempos
  meet at intersections whose recurrence is the LCM of the periods — rich rhythms
  emerge from pure geometry + number theory.
- **Discrete vs continuous heads.** Continuous motion is pretty; quantized
  (cell-stepped) motion at a settable BPM is a "real" sequencer. Both modes worth
  keeping as a switch.
- **LED-cube / microcontroller target.** Keep the model producing only face-local
  `(x, y)`; a hardware backend rasterizes that into per-face LED grids. Low memory,
  same core. (Reason squares are axis-aligned to edges: directly LED-addressable.)
- **Beyond the cube.** Same engine on a dodecahedron, a torus (no cone points), or
  a hand-designed unfolding → different "musical geometries".

---

## 5. ⭐ The collision function — a _non-Euclidean_ sequencer

**Status: design note. The core already emits `collision` events; deciding what
they _mean_ musically is the open question.**

In an ordinary step sequencer the tracks are **parallel lanes** — they never
touch. Two reading-heads crossing is simply impossible in flat, Euclidean,
side-by-side hardware (a monome, an MPC, a piano roll).

But here the score lives on a **closed, curved surface**. Perpendicular track
groups wrap around the cube and their heads _do_ meet — and _when_ they meet is
governed by the LCM of the track periods (topology + number theory making
rhythm). This is genuinely new territory:

> a **non-Euclidean sequencer** — an instrument whose extra musical events exist
> _only because the playing surface is not flat._

**Álvaro's proposal: head intersection = a drum.** The two melodic/looped heads
each carry their own _instrument_ (see visual model below); their **coincidence**
is a separate percussive voice — a hit that fires only at those topologically
determined meeting points. The rhythm section is therefore _emergent_: nobody
programs the kick pattern, it falls out of the geometry of which lanes cross
when. Knobs to explore:

- velocity/timbre from the **angle** or **relative speed** of the crossing,
- pitch/sample from **which cell** they meet in,
- different percussion per _pair_ of instruments (red×blue ≠ red×green),
- a "near-miss" graze vs a dead-centre hit.

Two modes worth keeping as a switch (and noting they are _different functions_,
not just settings):

1. **Voices + drum** (above): heads = pitched/looped instruments, crossings = drum.
2. **Pure collision instrument**: heads are silent while travelling and _only_
   the crossings sound — the melody is written entirely by the meeting pattern.

## 6. Visual model — the cube is the body, the heads are light

Design language for the rendering (informs the look, not just prettiness):

- **The cube is a real object** — acrylic-like: glossy, slightly translucent,
  with a specular highlight, _or_ fully opaque. This should be a **continuous
  control** (dial opacity from clear → solid), because how much you see _into_
  the instrument changes its character.
- **The heads emit light.** On real hardware a sequencer shows the play position
  as a **lit LED**; the _note_ lights up as the head sweeps over it. So a head is
  a little light source, not a painted tile.
- **Colour = instrument, not pitch.** A head's colour identifies _which voice/
  instrument_ it is (the thing that stays constant as it loops), exactly like a
  track colour. Pitch is read from the _cell_ it lands on, not from the head's
  colour. → Do **not** recolour a head when it crosses an edge or plays a note;
  at most pulse its **brightness**.
- **Future:** the armed cell itself should light up when struck (the score
  glowing under the head); per-head point lights or a bloom pass would sell the
  "made of light" feel. Reserved for later.

### 6a. Heads float just above the surface → real shadows

The rendered cube (faces + grid) can stay **slightly smaller** than the ideal
surface the heads ride on, so the heads sit _proud_ of the body instead of
co-planar. Practically this also fixes a rendering artefact: when a head folds
around an edge, a per-face outward _lift_ separated the two pieces (they lifted
along different face normals and no longer met at the edge). Putting the heads on
the true surface (zero lift) and shrinking the body inward closes that seam.

The richer payoff: once heads are physically above the body, they can **cast
shadows** onto the surface — a strong, cheap 3-D cue that reinforces "the head is
a lit object hovering over the score." (three.js: a shadow-casting light + a
receiving surface; or a fake projected blob for performance on a phone.)

---

## 7. ⭐ The head as a SENSOR reading an embedded score (generalisation)

**Status: idea only. A major conceptual generalisation. Do NOT build yet.**

So far the head copies _classic_ sequencer mechanics: a play-cursor over a grid
of armed cells. Generalise the head into a **magnetic/optical read-head** that
simply _reads whatever is under it_ as it travels.

- The surface carries a **pattern** — not necessarily colour or melody, but an
  intricate _grid / texture / engraving_: a 2-D score **embedded on a 3-D body**
  (sphere, polyhedron, arbitrary surface).
- A freely moving reader follows a **geodesic** (optionally perturbed by forces,
  see §8) and **samples** the pattern along its path. The same score reads
  _differently depending on the trajectory and direction_ — the score is no
  longer 1-D time but a 2-D field traversed along an emergent path.
- This unifies several earlier threads: "edge tick = cell tick", the monome
  programmable surface, and the LED-cube target all become _special cases_ of
  "a reader sampling a field on a closed surface."
- Instruments become **how you read**, not just **what is written**: many
  voices = many readers crossing the same engraved score on different geodesics.

This is the move from _sequencer_ → _instrument that performs a surface_.

---

## 8. ⭐ 2-D particle physics that feels the 3-D embedding (geodesic forces)

**Status: idea only, strong personal interest. Do NOT build yet — notes for a
future project.**

Earlier we had objects moving _freely_ on the 3-D surface (not locked to
rows/columns). Push that into a **physics sandbox**: particles that _live in 2-D_
(constrained to the surface) but **interact through forces measured along the
surface** — i.e. forces computed from the **geodesic distance** between pairs, not
the chord through 3-D space.

- Each pair feels a force along the **shortest geodesic** connecting them; the
  particle stays on the surface (motion is intrinsic 2-D) but the _interaction
  geometry is dictated by the 3-D embedding / curvature_.
- Álvaro has explored this before: **points on a sphere** with a repelling force
  along the great-circle (geodesic) distance, seeking optimal spacing. The stable
  configurations are the classic ones — e.g. 8 points → **cube corners** — and
  _adding one more_ destabilises/reorganises the whole pattern (Thomson problem /
  spherical codes territory; fascinating dynamics).
- On a cube (flat faces + cone points) the same experiment is richer: geodesics
  refract conceptually nowhere on faces/edges but become _ambiguous at the
  vertices_, so curvature concentrated at corners would shape the equilibria in a
  visibly different way than the smooth sphere.
- Forces to play with: repulsion (packing), attraction/springs (clustering),
  external "gravity" via the tilt control already in the engine. The musical
  layer (§5–§7) can ride on top: particles reading the surface _and_ pushing each
  other around.

Why it matters: it turns the instrument into a **little universe** — 2-D
inhabitants whose interactions secretly encode the shape of their world. A clean,
beautiful testbed for intrinsic vs. extrinsic geometry.

---

## 9. Heads leave a trace on the surface (accumulating paint / fading trail)

**Status: idea only.** As a head sweeps it could **deposit colour** on the
surface — a fading trail, or paint that _accumulates_ — turning the instrument
into a generative painting machine (abstract, colourful, driven by the geodesics

- collisions). Open question now that we no longer use a framebuffer the way the
  2007 sketch did: how to store the deposited colour?

* **Per-face render target.** Give each face its own offscreen canvas/`WebGLRenderTarget`
  used as that face's texture; heads paint into the face's 2-D buffer at their
  local (x,y); a slow fade (multiply by <1 each frame) gives trails. This is the
  modern version of the old framebuffer trick — one buffer per chart instead of a
  single flattened atlas. Clean, and LED-friendly (the buffer _is_ the per-face
  pixel grid).
* Collisions could splash; instruments could have distinct pigments.

## 10. ⭐ The whole evolution as a SHADER / texture (the deep one)

**Status: idea only, conceptually important.** Realisation: GPUs already solve
"these map things" when **texturing** surfaces — a fragment shader runs in the
flat 2-D (u,v) chart and is _then_ mapped onto the polygons. So the entire system
could be expressed as a **shader running in 2-D**, with the 3-D body as nothing
but the surface we paint that 2-D evolution onto.

- All the dynamics (heads, trails §9, even the particle physics §8) happen in the
  **flat chart space**; the polyhedron is just the display mapping.
- Huge payoff: the evolving 2-D field becomes a reusable **"skin"** you can wrap
  onto _anything_ — any mesh, any object. The sequencer/score/painting is a
  material.
- Mirrors what Álvaro was already doing with the framebuffer, but native to the
  GPU pipeline and general. (Cross-chart gluing in a shader = sampling neighbour
  charts at edges; the atlas transition maps become texture-coordinate lookups.)

---

## 11. Railed / Derailed (implemented) + the scrambling & mirror ideas

**Status: railed/derailed IS implemented.** A head is either **railed** (one
coordinate held fixed → it stays on its row/column track) or **derailed** (free
geodesic motion, e.g. when gravity pulls it off-axis). Notes:

- **Per-head type flag.** Each head is tagged _horizontal_ or _transversal_
  (which band it belongs to), rather than constantly re-zeroing the smaller speed
  component. This is cleaner AND sets up two future features below. (In practice,
  across an edge the held axis swaps local x↔y because the transition maps are
  signed permutations — the band membership is the invariant, not the local axis.)
- **Gravity is independent of railed/derailed.** In _railed_ mode gravity still
  acts, but only _along the rail_ — it accelerates/decelerates the head on its
  track (and can reverse it) without pushing it off.
- **⭐ Scramble by derail→re-rail.** Turn gravity on while _derailed_, let the
  heads slide off their tracks, then snap back to _railed_: the heads land
  scrambled — possibly several on the same track, new phase relationships. A
  performance gesture: shake the cube to reshuffle the sequence.
- **⭐ 45° mirror cell.** Because heads carry a type/direction, a special cell
  could act as a **mirror** that bounces a head onto the _perpendicular_ route
  (horizontal→transversal and vice-versa). A routing element on the score — the
  beginnings of a little "marble-machine"/Turing-tumble logic on the surface.

## 12. Pitch from coordinate — a score you can rotate (implemented)

**Status: implemented.** Pitch is read from the head's **perpendicular** cell
position (its "level in the stack"), exactly like a piano roll: a _horizontal_
head's pitch comes from its row, a _transversal_ head's from its column. So the
SAME armed cell sounds a **different pitch depending on which type of head reads
it** — like reading a musical score that has been rotated 90°. Each band has its
own **scale + key** (major / minor / pentatonic for now).

---

## 13. ⭐ Collision = MATERIAL × MATERIAL (the sound of stone hitting wood)

**Status: idea, possibly a standalone toy.** A head-on-head collision is a PAIR
of instruments — with 8 heads there's a whole **matrix of collision pairs**. The
weird-and-wonderful version: give each head a **material** (stone, wood, glass,
metal, felt...) and make the collision sound be a **sample of those two materials
physically hitting each other** — stone-on-wood, glass-on-metal... A "what does
it sound like when X hits Y" matrix. This alone, with no sequencer at all, could
be a fun instrument: little materials orbiting a cube, clacking into each other.
(For now: a single selectable collision sound from a small menu.)

## 14. Whole cube as a lamp (global flash on sound)

**Status: idea.** When any sound fires (note or collision), the whole cube body
could brighten for an instant — the object itself is the VU meter / beacon. On
the physical LED cube this is free (flash all LEDs); in three.js just pulse the
face material emissive. Needs taste: maybe only collisions, or intensity ∝ velocity.

## 15. ⭐ Growable cube — start at 1×1×1 and add slices

**Status: idea, conceptually lovely.** Muting a track "disables a slice" of the
cube. Take it literally: a muted slice could **vanish and the cube shorten** —
and conversely you could START with a 1×1×1 cube (one cell per face!) and **add
layers** one at a time, growing the instrument as the piece grows. Composition as
_constructing the world the music lives on_. Geometrically this makes the surface
a box of varying proportions (atlas already supports rectangular faces in
principle). Probably unusable, definitely worth trying.

## 16. Per-note velocity — interface sketches (open question)

**Status: thinking.** Velocity/attack are PER NOTE, but clicking each note to set
parameters is tedious. The physical dream: a **knob embedded in every facet**
(clickable to arm, turnable for velocity). GUI candidates, to pick from later:

- **Press-and-drag vertical**: tap arms the note; holding + dragging up/down sets
  velocity. Pad brightness/size encodes it (bright=loud). One gesture, no menu.
- **Tap cycles levels**: repeated taps cycle off → soft → med → loud → off.
  Dead simple on iPad, only 3 levels but sequencers thrived on that for decades.
- **Paint mode**: a velocity "brush" (slider sets the value, then you paint cells).
  Good for shaping whole phrases at once.
- **Tilt-as-pressure**: while holding a note, tilting the cube/phone sets the
  velocity — uses the sensor we already have, very "instrument-like".

## 17. Head = 3D model of its instrument floating above the track

**Status: idea.** The head square could become (or carry) a tiny **3D model of
its instrument** — a little drum, a bell, a stone — floating just above the
surface, riding the rail. The square on the surface stays as the "read cursor"
(translucent), the floating model is the identity. Pairs beautifully with the
materials idea (§13) and the cast-shadow idea (§6a).

---

## 18. ⭐ The unifying architecture — one trigger pipeline, three sources (IMPLEMENTED, June 2026)

**Status: implemented (iter 18).** The decision that turns "two separate modes"
(sequencer notes vs. collisions) into one coherent instrument.

**The spine: `trigger → resolve to a list of voices → play the list`.** Every
musical instant is the same kind of thing; the only difference is _arity_ and
_where the pitch comes from_:

| Trigger                | Voices                                             | Pitch source                                          |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| head enters armed cell | 1 (head's instrument)                              | positional (perpendicular coordinate)                 |
| **collision**          | the participating heads' voices, launched together | each head's own coordinate → a dyad from the geometry |

So a collision is just a **2-voice trigger**. The dreaded N×M×O combinatorics
(which percussion for X-head × Y-head × …) **never materialise** — you never
enumerate pairs, you _launch each participant's voice_. This is also why it stays
**hardware-honest**: an embedded controller computes "play both voices now" in a
few instructions; it could never hold a pair-table.

**Collision SOURCE — one global switch** (`sequencer.collisionSource`):

- `fixed` — a chosen, independent collision sound (the old Thud/Wood/Metal/Clap).
- `cell` — the armed note _under_ the meeting point (gated by the score).
- `heads` (default) — each head **is** an instrument; both sound together.

**Instrumentless head** (`ball.instrument < 0`, "— silent" in the menus) = a
**silent carrier**: it makes no note of its own but still collides, so in `heads`
mode only its partner sounds. One nullable field, big expressive payoff.

**Head = instrument is already the track UI.** The track rows _are_ the per-head
instrument + scale + key + rate. No "per-head instrument" panel was needed; it
was done.

**The reserved NOTE record (designed-for, dormant).** Today an armed cell stores
only a velocity (a bare number) — a pure trigger ("a hole the head falls
through"), inheriting instrument + pitch from the head. The non-breaking growth
is to let the value become an object with **`null = inherit`** overrides:

```
cell = { velocity, gate:null, prob:null, pitch:null }
```

`velocity/gate/prob` shape the _trigger_ (they apply to whichever pitch sounds);
`pitch` is the one orthogonal axis — `null` = **positional** (head) pitch, a
number = an **engraved** absolute pitch. A global `pitchMode` then selects
positional / engraved / **both** (a hole that triggers the head's voice _and_ its
own). `sequencer.cellData()` already normalises number→object so the resolver is
ready; storage stays a number for now (everything resolves to today's behaviour
byte-for-byte). **Two pitches, but only ONE is stored** — the positional one is
always derivable, so the device's soul (pitch = where you are on the body) is
never duplicated, only optionally overridden.

**Physical/visual mapping (the proof it's hardware-honest):** velocity → pad
height + brightness; gate → dwell-glow length; prob → pad shimmer; engraved pitch
→ a hue/marker vs. unmarked positional pitch. A few bytes per cell, no tables.

**The one genuinely hard physical part — and the dodge:** per-button editing on
the physical cube (selecting _this_ pad's velocity/gate/pitch with only the cube
surface). Plan: **separate authoring from performance** — the screen/companion
app is the _studio_ where you engrave per-pad values; the physical cube is the
_performance instrument_ (play, wake heads, collide). The score is just data
either side edits, so the device can ship without solving on-cube editing first.

## 19. ⭐ Sample-accurate timing — two clocks (IMPLEMENTED, June 2026)

**Status: implemented (iter 18).** The fix for the audible jitter + the "doubled"
collision flam.

The bug: notes played _immediately_ at whatever `ctx.currentTime` the animation
frame happened to fire, so every onset inherited ~16 ms of rAF jitter; two heads
meeting on a diagonal sounded a few ms apart (a flam), not together.

The fix (Chris Wilson's "A Tale of Two Clocks", adapted): note ONSETS are placed
on the **`AudioContext` sample clock**, not the frame clock. When a step boundary
is detected (a sub-frame _late_, after the accumulator crosses the period), the
engine reconstructs the **true** boundary time from the leftover accumulator and
schedules the note at `boundary + scheduleLatency` (50 ms look-ahead, > one
frame, so it's always in the playable future). Consequences:

- consecutive onsets of a head are exactly `period` apart → **zero rhythmic
  jitter** (verified: onset jitter 0.00000 s over a 2 s run);
- two heads crossing on the **same** beat get the **same** scheduled instant →
  the flam collapses into a clean dyad (no more "one head then the other");
- the collision event is aligned to whichever head hopped most recently
  (`b._lastHopWhen`), so the percussive hit sits _with_ the heads' notes.

The visuals still ride rAF; only the **sound** rides the audio clock. The price
is a constant ~50 ms audio-vs-visual offset (imperceptible, and adjustable via
`engine.scheduleLatency`) in exchange for tight _relative_ timing — the right
trade for a music device. Continuous (polyrhythm) mode schedules at
`audioNow + latency` (no sub-frame correction; it's the "wild" mode where exact
grid timing matters less). MIDI out stays immediate (the simple WebMIDI API can't
schedule sample-accurately).

**Note — collision does NOT "replace" the enter-notes.** A meeting can still
produce the two heads' own enter-notes _plus_ the collision layer; the scheduler
quantisation is what removes the doubling (co-beat enter-notes coincide as a
chord instead of flamming). Collisions are an independent, toggleable layer
(`flags.collisionSound`). If strict replace is ever wanted, it's a localised
follow-up (tractable only in step mode, where both heads hop in the same frame).
