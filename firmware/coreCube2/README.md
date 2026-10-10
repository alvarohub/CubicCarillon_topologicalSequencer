# Topological Sequencer: coreCube2

The sequence-first firmware, in `firmware/coreCube2/`. Its sibling
`firmware/coreCube1/` is the original firmware; nothing here includes or
changes it, its saved settings, or the browser application. This is a working
first implementation, not feature parity with the original.

## The musical model

- **Sequence**: one travelling geodesic reader, with a position, direction,
  speed, note, instrument identifier, mute state, and optional band membership.
- **Band**: an optional grouping of sequences sharing a tonic and scale. Eight
  parallel readers can form one complete band on the 8-cell cube. Neither eight
  members nor three bands is imposed by the engine; parallelism is a construction
  choice, not a membership constraint.
- **Sequencer**: the complete instrument, owning the surface, readers, bands,
  score and clock. Current fixed storage allows 48 sequences and eight bands.

A reader need not belong to a band. Its direction need not follow an axis.
Changing a band's tuning does not change its readers' trajectories. Independent
readers use their own MIDI note; grouped readers use their degree within the
band's scale, plus an optional transposition. This first version implements
fixed-per-reader pitches, not position-dependent score interpretation.

An armed cell is a trigger with velocity 1..127; zero means off. Entering it
emits a typed note event. Readers continue moving while muted. Band muting also
suppresses sound without stopping motion.

## Geometry and time

The pure C++ core supports equal-sized square charts with affine edge gluings:
an 8-cell cube by default and a flat periodic torus for tests. Coordinates are in
cell lengths, from 0 to `side`; cell centres are at half integers. Sequence start
positions must be strictly inside a chart. Direction is normalized on insertion.

Motion is continuous. Speed in cell lengths per second is `tempo / 60 * rate`.
`rate = 4` means four cell lengths per beat; on an oblique path this does not mean
exactly four grid-boundary crossings per beat. Every crossed grid boundary is
processed, including multiple crossings within one update. The LED image is
currently cell-snapped; snapping does not alter the trajectory.

Geodesics need not close or repeat. At an exact cube vertex, continuation is
ambiguous: the reader stops and emits `Vertex`. No random turn is invented.
`Reset heads` restarts it at home. A flat torus's identified square corners have
no conical singularity and are traversed periodically instead.

Updates longer than 250 ms are clipped and reported as `Overrun`; excess time is
dropped rather than producing an unbounded catch-up burst. A second bound limits
boundary traversal work. Event times are simulation times. Events are delivered
per reader, not globally sorted for a sample-accurate audio scheduler.

The cube's 24 transitions come from the geometry-derived JavaScript
[surface implementation](../../src/core/surface.js). They are converted from its
centred coordinates to cell units, not inferred from panel wiring. The
[conformance test](test/conformance.mjs) checks every transition against that
reference without modifying it.

## Structure

| File                                                                 | Responsibility                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| [src/main.cpp](src/main.cpp)                                         | Explicit setup and loop; selects which subsystem advances      |
| [src/core/surface.hpp](src/core/surface.hpp)                         | Chart coordinates, cube/torus topology, edge transport         |
| [src/core/sequencer.hpp](src/core/sequencer.hpp)                     | Sequences, optional bands, score, motion, musical events       |
| [src/commands.hpp](src/commands.hpp)                                 | Shared validated edits for local and external controls         |
| [src/modes.hpp](src/modes.hpp)                                       | Mode policy and an independent diagnostic walker               |
| [src/presentation.hpp](src/presentation.hpp)                         | Read-only state to logical RGB cells                           |
| [src/demo.hpp](src/demo.hpp)                                         | Initial 24 grouped readers plus one independent oblique reader |
| [src/adapters/devices.hpp](src/adapters/devices.hpp)                 | Ordinary namespace functions for device services               |
| [src/adapters/cores3.cpp](src/adapters/cores3.cpp)                   | Power, clock, LED output, LCD/touch, speaker, USB              |
| [src/adapters/panel_mapping.hpp](src/adapters/panel_mapping.hpp)     | Logical chart to physical panel transform                      |
| [src/adapters/serial_protocol.hpp](src/adapters/serial_protocol.hpp) | USB text to shared commands                                    |
| [src/adapters/session_codec.hpp](src/adapters/session_codec.hpp)     | Testable versioned preset encoding and validation              |
| [src/adapters/store.cpp](src/adapters/store.cpp)                     | Deferred writes to a separate `toposeq_v2` NVS namespace       |

There is no umbrella app-controller class, generic event bus, or mode inheritance
framework. `topo::Sequencer` is instantiable: the instrument and diagnostic walker
are independent instances. Device services are namespaces. Presentation never
moves a reader or chooses a pitch. Audio consumes note events chosen by the core.

Large instrument resets happen in place to avoid full-object stack temporaries
on the ESP32. The build enables a 2 KB stack-frame warning. M5GFX compression
routines may produce separate dependency warnings on a clean build; this
firmware does not use those compression paths. A frame warning is not a
measurement of total runtime stack usage.

## Reading the code

Every file in `src/` opens with a header comment saying what it is, what its
important state is, and which traps to avoid. A few conventions worth knowing:

- **The core uses the C++ standard library, not Arduino types.** `src/core/`
  (plus `presentation.hpp`, `commands.hpp`, `modes.hpp`) compiles on a PC —
  that is what makes the native tests possible. `<cstdint>`, `<array>` and
  `<cmath>` are fixed-size, heap-free and identical on both toolchains; see
  the note at the top of [src/core/surface.hpp](src/core/surface.hpp).
- **All storage is fixed-size and static.** Arrays are sized for the largest
  supported configuration (`maxSequences`, `maxBands`, `maxCells`), and the
  big instances (`Sequencer`, `SurfaceFrame`, the JSON document) live in
  static storage — never on the stack.
- **One entry point per concern.** Motion + events: `src/core/sequencer.hpp`;
  surface math: `src/core/surface.hpp`; drawing: `src/presentation.hpp`;
  validation of every edit: `src/commands.hpp`; hardware: `src/adapters/`.
- **The saved-session format** — schema plus a complete example — is
  documented at the top of `src/adapters/session_codec.hpp`.

## Build and test

From the repository root:

```sh
cd firmware/coreCube2
pio run -e cores3
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -g \
  -Isrc -I.pio/libdeps/cores3/ArduinoJson/src test/core_test.cpp \
  -o /tmp/cubic-sequencer-v2-test
/tmp/cubic-sequencer-v2-test
node test/conformance.mjs
```

PlatformIO installs the pinned dependencies. Native tests use a C++17 compiler
and the ArduinoJson headers installed by that build. Node is needed only for the
JavaScript conformance comparison.

Tests cover cube closure, arbitrary-angle timestep invariance, boundary reversal,
cube vertices and torus corners, independent bands and diagnostics, note timing,
muting, command rejection, all 384 mapped pixels, and full-capacity preset round
trips. Mapping bijectivity is not proof of correct physical cube assembly.

Uploading is deliberately a separate action and replaces the firmware running
on the selected board. No upload was performed as part of creating this firmware:

```sh
pio run -e cores3 -t upload
pio device monitor -b 115200
```

The board enables external 5V before initializing the LEDs. Output is GPIO 1,
GRB NeoPixels at 800 kHz, with six 8x8 serpentine panels. Brightness starts at 12
and is limited to 64; this is not a current limiter. Use an appropriate power
supply for the cube. The firmware boots paused, showing native panel axes.

## Diagnostics and calibration

| ID  | Mode          | Coordinate space                                        |
| --- | ------------- | ------------------------------------------------------- |
| 0   | Performance   | Sequencer cells, then physical mapping                  |
| 1   | Surface axes  | Logical chart axes, then physical mapping               |
| 2   | Surface scan  | Logical cells, then physical mapping                    |
| 3   | Topology walk | Independent geodesic test reader, then physical mapping |
| 4   | Panel axes    | Native panel coordinates; logical mapping bypassed      |
| 5   | Panel scan    | Native panel coordinates; logical mapping bypassed      |
| 6   | Raw chain     | Direct physical LED index                               |

Axes: green is +x, red is +y, white is the origin. Displayed digits are 1..6.
Native panel digits identify panel slots; mapped digits identify logical faces.
The digit's top row is at larger y, matching the logical y-up convention.

The current mapping is explicitly **unverified**: it copies the existing
firmware's six transforms as a starting point, not as a new calibration claim.
The native tests permit independent observations of panel numbering and axes.
Measure these on the assembled cube before changing `legacyUnverified` or
marking it calibrated. Folding alone does not determine a required correction;
the answer depends on both the chosen chart frames and the actual assembly.

Changing modes preserves the instrument's position and score. Diagnostics have
their own state and never advance the real instrument. Returning to Performance
resumes only if its playback flag was already running. The screen's Run/Pause
button toggles the active diagnostic when outside Performance; Step advances it
manually. The header's paused/running indicator refers to the instrument.

## USB commands

Send one command per line at 115200 baud. Commands report `OK`, `ERR syntax`, or
`ERR rejected`. Input has a 159-character line limit and bounded processing per
loop. This is a new local text protocol, **not the original CubeLink protocol**.
All face, sequence and band IDs here are **zero-based**, unlike the original
CubeLink wire face convention. Faces 0..5 are +X, -X, +Y, -Y, +Z, -Z.

```text
status
mode 0
play
pause
toggle
tempo 120
brightness 12
random 123
clear
reset
step
reverse 0
rate 0 4
mute 0 1
angle 0 23
tonic 0 62
cell 4 2 3 100
add 4 2.1 3.2 23 2 81
```

`cell FACE COLUMN ROW VELOCITY` edits a trigger. `add FACE X Y ANGLE RATE NOTE`
adds an independent reader. Angles are degrees from local +x toward +y.
`angle INDEX DEGREES` changes the current local heading; it is rejected exactly
on a chart edge. `reverse` reverses the current heading. `reset` restores all
home positions and headings, without erasing notes or tuning. `random SEED`
replaces the score deterministically. `step` is diagnostic-only.

Tempo range is 20..400, rate is greater than zero and at most 16, MIDI notes and
velocities are 0..127. Use `mute INDEX 0` to unmute. `play`/`pause` control the
instrument; `toggle` follows the active mode. Band creation and membership
editing currently use the C++ API; the USB `add` command creates ungrouped readers.

The speaker adapter is intentionally simple and monophonic: overlapping calls
replace the current tone, and instrument identifiers do not yet select different
synth voices. It does not represent the polyphonic MIDI result.

## Saved state

NVS namespace `toposeq_v2`, key `session`, schema version 1. It does not read or
write the original firmware's namespace. A loaded session must pass all checks
in a staging instance before replacing the live instrument.

Tempo, tuning, reader definitions, rates, mutes and score are saved after 1.5
seconds without another persistent edit, and only while playback is paused or
suspended by diagnostics. Wait for `Session saved (v2)` before powering off.
Changes made during continuous performance remain pending until it is paused.

Reload starts paused at saved home poses. Current playback position, live
angle/reverse edits, diagnostic state, mode and brightness are not persisted.
The preset format currently supports the 8x8 cube only. The codec is host-tested;
actual flash writes, reboot recovery, audio and physical LEDs still need a board
test.

## Next boundaries

The next hardware step is measured panel calibration, followed by an explicit
decision to upload this firmware. Subsequent independent work can add band-editing controls,
polyphonic/MIDI audio, smooth LED presentation, positional score reading and
collisions, then network commands and browser interoperability. Configuration
sharing and clock/phase synchronization are different tasks.

Unequal rectangular charts, triangular polyhedra and smooth surfaces such as a
sphere are not implemented here. They require suitable geometry backends; a
sphere is not represented by pretending the cube's edge table is universal.
