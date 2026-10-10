#pragma once

// ===========================================================================
// sequencer.hpp — the instrument core: readers, bands, score, clock, events
// ===========================================================================
//
// THE MODEL
//   * Sequence — one reader travelling a geodesic on the surface: its own
//     speed ("rate"), own note (or a scale degree inside a band), mute and
//     run flags, and a remembered start pose ("home").
//   * Band — shared tuning: a tonic plus a list of semitone intervals. Any
//     number of sequences can join a band and play its notes by degree.
//   * Sequencer — all of the above plus the score and the clock. It advances
//     readers only when told to (update()) and reports what happened as
//     events. It never touches LEDs, sound hardware, USB or flash.
//
// TIME AND EVENTS
//   update(seconds) advances every running reader by
//     speed = tempo / 60 * rate     (cell lengths per second)
//   and emits one CellEntered event per grid boundary crossed, timestamped at
//   the exact simulated crossing time. If that cell is armed and the reader
//   is audible, a Note event follows immediately.
//
//   `seconds` is normally the real time elapsed, measured by the main loop.
//   Updates longer than maxUpdateSeconds (250 ms) are CLIPPED to protect the
//   instrument from a catch-up burst, and reported as an Overrun event.
//
// EDGE CASES
//   * Landing exactly on a cube corner (two boundaries at once) makes the
//     continuation mathematically ambiguous: the reader STOPS and a Vertex
//     event is emitted. On a periodic surface (torus) the corner is smooth,
//     so the reader crosses both edges and continues.
//   * A reader reversed while sitting exactly on a boundary crosses straight
//     back (the "leaving" check in advance()).
//
// MEMORY
//   No new/delete anywhere and no dynamic containers: the arrays are sized at
//   compile time for the largest supported configuration (the whole instance
//   is a few KB). The instance itself lives in static storage — see main.cpp.
// ===========================================================================

#include "surface.hpp"
#include <algorithm>   // std::max / std::min (pitch clamping)
#include <limits>      // std::numeric_limits::infinity (nextBoundary)

namespace topo {

// Fixed storage limits. Everything below is sized for these maxima, so the
// instrument never allocates: 48 readers and 8 bands are the built-in caps.
constexpr unsigned maxSequences = 48;
constexpr unsigned maxBands = 8;

// A musical scale that readers can join. Bands do not constrain geometry in
// any way — they are just tuning shared by a group of sequences.
struct Band {
  uint8_t tonic = 60;                                   // MIDI note of degree 0 (C4 = 60)
  std::array<uint8_t, 12> intervals{{0, 2, 4, 7, 9}};   // semitone offsets, e.g. pentatonic
  uint8_t degreeCount = 5;                              // how many entries are used
  bool muted = false;                                   // mutes the group; motion continues
};

// One travelling geodesic reader: everything needed to advance it and to know
// what it sounds like. `home` is the pose addSequence() remembered; resets and
// the UI's align use it.
struct Sequence {
  Pose pose;                    // current position + heading
  Pose home;                    // start pose, used by resets
  double rate = 4;              // speed in cell lengths per beat (tempo multiplies it)
  uint8_t note = 60;            // MIDI note used when band < 0
  uint8_t instrument = 0;       // audio instrument index; the core never interprets it
  int8_t band = -1;             // band membership, -1 = independent reader
  uint8_t degree = 0;           // position inside the band's scale (wraps octaves)
  int8_t transpose = 0;         // semitone offset added to the final pitch
  bool running = true;          // false after a Vertex stop, or when stopped individually
  bool muted = false;           // silences Note events; motion continues
};

// What update() can report: one CellEntered per crossed grid boundary; a Note
// on top of that when the cell is armed and the reader audible; Vertex when a
// reader stopped at an ambiguous cube corner; Overrun when the catch-up
// protection clipped an update.
enum class EventKind : uint8_t { CellEntered, Note, Vertex, Overrun };

// One self-contained event. `time` is SIMULATED time (seconds since the last
// resetPositions()), the same clock as Sequencer::time(). note/velocity/
// instrument/durationMs are only meaningful for Note. Events are delivered per
// reader, not globally sorted in time — fine for the current immediate
// playback adapter, and a documented limitation for any future sample-accurate
// scheduler.
struct Event {
  EventKind kind = EventKind::CellEntered;
  uint8_t sequence = 0;          // which reader this happened to
  Cell cell;                     // where it happened
  double time = 0;               // simulated seconds
  uint8_t note = 0;              // MIDI note         (Note only)
  uint8_t velocity = 0;          // 1..127            (Note only)
  uint8_t instrument = 0;        // audio instrument  (Note only)
  uint16_t durationMs = 100;     // note length in ms (Note only)
};

// Event delivery: a plain function pointer + context, so the core stays free
// of <functional>, heap allocations and std::bind. The audio adapter and the
// tests both use this.
using EventSink = void (*)(void*, const Event&);

// ---------------------------------------------------------------------------
// Sequencer — the whole instrument
//
// Owns the surface, the readers, the bands, the score, the clock and the
// pause flag. It knows nothing about LEDs, speakers, USB or flash: other
// modules read its state (presentation) or subscribe to its events (audio,
// tests). Two rules keep it predictable:
//   1. Nothing moves unless update() is called with a positive time step.
//   2. Every mutation goes through a validating method; invalid input is
//      rejected and the stored state stays untouched.
// ---------------------------------------------------------------------------
class Sequencer {
  // --- named limits and constants -----------------------------------------
  // Collected here so the implementation below reads like prose; changing a
  // value here changes it everywhere.
  static constexpr double minTempo = 20.0;           // slowest accepted BPM
  static constexpr double maxTempo = 400.0;          // fastest accepted BPM
  static constexpr double maxRate = 16.0;            // cell lengths per beat
  static constexpr double maxUpdateSeconds = 0.25;   // catch-up clip (see update)
  static constexpr unsigned maxBoundarySteps = 128;  // crossing cap per reader per update
  static constexpr uint16_t noteMs = 100;            // fixed note length (no envelopes yet)
  static constexpr uint8_t randomVelocity = 90;      // velocity randomize() writes
  static constexpr uint32_t randomPeriod = 7;        // roughly 1 in 7 cells armed

 public:
  // A fresh instrument starts on the cube.
  explicit Sequencer(Surface surface = cubeSurface()) : surface_(surface) {}

  // Clear the instrument back to a fresh state on `surface`, IN PLACE.
  // In place matters on the ESP32: assigning a fresh Sequencer temporary would
  // build a multi-KB object on the stack (see the README's stack-frame note).
  void reset(const Surface& surface) {
    surface_ = surface;
    sequences_.fill(Sequence{});
    bands_.fill(Band{});
    score_.fill(0);
    sequenceCount_ = 0;
    bandCount_ = 0;
    tempo_ = 120;
    time_ = 0;
    paused_ = true;
    overruns_ = 0;
  }

  // --- read-only access -----------------------------------------------------
  // The indexed getters assume `index` was validated when the entry was added
  // (no bounds check, same contract as std::array::operator[]).
  const Surface& surface() const { return surface_; }
  const Sequence& sequence(unsigned index) const { return sequences_[index]; }
  const Band& band(unsigned index) const { return bands_[index]; }
  unsigned sequenceCount() const { return sequenceCount_; }
  unsigned bandCount() const { return bandCount_; }
  double tempo() const { return tempo_; }
  double time() const { return time_; }
  bool paused() const { return paused_; }
  uint32_t overruns() const { return overruns_; }

  // Global tempo in BPM. The range is deliberately narrow: slower than
  // minTempo looks frozen, faster than maxTempo is beyond what the event
  // handling can present usefully.
  bool setTempo(double value) {
    if (!std::isfinite(value) || value < minTempo || value > maxTempo) return false;
    tempo_ = value;
    return true;
  }

  void setPaused(bool value) { paused_ = value; }

  // Add a band; returns its index, or -1 when full/invalid.
  int addBand(const Band& value) {
    if (bandCount_ >= maxBands || !validBand(value)) return -1;
    bands_[bandCount_] = value;
    return static_cast<int>(bandCount_++);
  }

  // Replace a band's tuning in place (used by the USB `tonic` command).
  bool setBand(unsigned index, const Band& value) {
    if (index >= bandCount_ || !validBand(value)) return false;
    bands_[index] = value;
    return true;
  }

  // Add one reader. Returns its index, or -1 if the template is invalid.
  // The heading is normalized here, so callers may pass any non-zero vector;
  // the validated pose is also stored as this reader's `home` for resets.
  int addSequence(Sequence value) {
    if (sequenceCount_ >= maxSequences || !surface_.validStart(value.pose) ||
        !std::isfinite(value.rate) || value.rate <= 0 || value.rate > maxRate ||
        value.note > 127 || value.band < -1 ||
        value.band >= static_cast<int>(bandCount_)) {
      return -1;
    }
    const double length = std::hypot(value.pose.dx, value.pose.dy);
    value.pose.dx /= length;
    value.pose.dy /= length;
    value.home = value.pose;
    sequences_[sequenceCount_] = value;
    return static_cast<int>(sequenceCount_++);
  }

  // Per-reader run/mute flags. Muted readers keep moving — they just stop
  // emitting Note events (their position stays visible on the LEDs).
  bool setSequenceRunning(unsigned index, bool value) {
    if (index >= sequenceCount_) return false;
    sequences_[index].running = value;
    return true;
  }

  bool setSequenceMuted(unsigned index, bool value) {
    if (index >= sequenceCount_) return false;
    sequences_[index].muted = value;
    return true;
  }

  // Per-reader speed: cell lengths per beat. The global tempo multiplies it,
  // so this is the "resolution" control of the original instrument.
  bool setSequenceRate(unsigned index, double value) {
    if (index >= sequenceCount_ || !std::isfinite(value) || value <= 0 || value > maxRate) {
      return false;
    }
    sequences_[index].rate = value;
    return true;
  }

  // Flip a reader's heading by 180 degrees, in place. Works anywhere —
  // including exactly on a boundary, where advance() simply crosses back.
  bool reverse(unsigned index) {
    if (index >= sequenceCount_) return false;
    sequences_[index].pose.dx *= -1;
    sequences_[index].pose.dy *= -1;
    return true;
  }

  // Point a reader in an absolute direction: degrees counter-clockwise from
  // the face's +x axis (0 = +x, 90 = +y). The heading is face-local and gets
  // rotated by edge crossings later. Refused exactly on a chart edge: at that
  // instant the reader is mid-crossing, and reverse() is the tool for that
  // situation.
  bool setDirection(unsigned index, double degrees) {
    if (index >= sequenceCount_ || !std::isfinite(degrees)) return false;
    const Pose& pose = sequences_[index].pose;
    if (pose.x <= tolerance || pose.x >= surface_.side - tolerance ||
        pose.y <= tolerance || pose.y >= surface_.side - tolerance) {
      return false;
    }
    const double radians = std::remainder(degrees, 360.0) * pi / 180;
    sequences_[index].pose.dx = std::cos(radians);
    sequences_[index].pose.dy = std::sin(radians);
    return true;
  }

  // Put every reader back on its home pose, running, and restart the clock.
  // Score and tuning are untouched — this is the UI's "Reset heads".
  void resetPositions() {
    for (unsigned index = 0; index < sequenceCount_; ++index) {
      sequences_[index].pose = sequences_[index].home;
      sequences_[index].running = true;
    }
    time_ = 0;
  }

  // --- score editing --------------------------------------------------------
  // `velocity` doubles as the trigger flag and its strength: 0 = empty cell,
  // 1..127 = armed (the Note event carries this value).
  bool setCell(Cell cell, uint8_t velocity) {
    if (!surface_.valid(cell) || velocity > 127) return false;
    score_[surface_.index(cell)] = velocity;
    return true;
  }

  // Velocity of a cell; 0 for any address outside the surface.
  uint8_t velocity(Cell cell) const {
    return surface_.valid(cell) ? score_[surface_.index(cell)] : 0;
  }

  void clearScore() { score_.fill(0); }

  // Write a deterministic pseudo-random score: roughly one cell in seven gets
  // velocity 90 (xorshift32 — cheap, no library, no floats). The same seed
  // always produces the same score, which keeps tests and rehearsals
  // reproducible.
  void randomize(uint32_t seed) {
    if (!seed) seed = 1;                 // xorshift must not start at 0
    for (unsigned index = 0; index < surface_.cellCount(); ++index) {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      score_[index] = seed % randomPeriod == 0 ? randomVelocity : 0;
    }
  }

  // The note a reader sounds on its next armed cell:
  //   * band == -1: the reader's own note, independent of everything else;
  //   * band >= 0: tonic + the band's interval for its degree; degrees beyond
  //     the scale wrap upward into the next octave (+12 semitones per wrap).
  // The reader's transpose is added last and the result clamped to 0..127.
  // Pitch depends only on tuning — not on where the reader happens to be.
  int pitch(unsigned index) const {
    const Sequence& reader = sequences_[index];
    int note = reader.note;
    if (reader.band >= 0) {
      const Band& group = bands_[reader.band];
      note = group.tonic + group.intervals[reader.degree % group.degreeCount] +
             12 * (reader.degree / group.degreeCount);
    }
    return std::max(0, std::min(127, note + reader.transpose));
  }

  // Advance the instrument by `seconds` of simulated time. The ONLY entry
  // point that moves readers; the main loop calls it with the real elapsed
  // time. `sink` receives every event in order of occurrence per reader
  // (see the note above Event).
  void update(double seconds, EventSink sink = nullptr, void* context = nullptr) {
    if (paused_ || !std::isfinite(seconds) || seconds <= 0) return;

    // Catch-up protection: never simulate more than maxUpdateSeconds in one
    // call, however long the loop was blocked. The excess time is DROPPED and
    // reported, so a debugger pause cannot fire a burst of notes.
    if (seconds > maxUpdateSeconds) {
      ++overruns_;
      emit(sink, context, {EventKind::Overrun, 0, {}, time_});
      seconds = maxUpdateSeconds;
    }
    for (unsigned index = 0; index < sequenceCount_; ++index) {
      if (sequences_[index].running) advance(index, seconds, sink, context);
    }
    time_ += seconds;
  }

 private:
  // A band is valid when the tonic fits in MIDI, there is at least one scale
  // degree, at most 12, and every interval is smaller than an octave.
  static bool validBand(const Band& value) {
    if (value.tonic > 127 || !value.degreeCount || value.degreeCount > 12) return false;
    for (unsigned index = 0; index < value.degreeCount; ++index) {
      if (value.intervals[index] > 11) return false;
    }
    return true;
  }

  // Deliver one event, if anyone is listening.
  static void emit(EventSink sink, void* context, const Event& event) {
    if (sink) sink(context, event);
  }

  // Distance, along the heading, from `coordinate` to the NEXT grid line on
  // one axis. Returns infinity when the reader does not move on that axis.
  // Uses the same boundary convention as Surface::forwardIndex(): standing
  // exactly on a line, the next line is one full cell away.
  static double nextBoundary(double coordinate, double direction) {
    if (std::abs(direction) < tolerance) return std::numeric_limits<double>::infinity();
    const int cell = Surface::forwardIndex(coordinate, direction);
    return ((direction > 0 ? cell + 1 : cell) - coordinate) / direction;
  }

  // Move ONE reader for up to `seconds` of simulated time and emit everything
  // it encounters. This is where the "topological" behaviour actually lives:
  // a straight line inside each chart, re-glued at every boundary it crosses.
  void advance(unsigned index, double seconds, EventSink sink, void* context) {
    Sequence& reader = sequences_[index];
    Pose& pose = reader.pose;
    const double speed = tempo_ / 60 * reader.rate;   // cell lengths per second
    double remaining = seconds * speed;               // distance budget
    double travelled = 0;                             // distance covered so far

    for (unsigned step = 0; remaining > tolerance && step < maxBoundarySteps; ++step) {
      // Are we sitting exactly ON a boundary while heading OUT of the face?
      // (This happens right after a reversal, which is why the reader must
      // cross back immediately instead of trying to move off the chart.)
      const bool leavingX = (pose.x <= tolerance && pose.dx < 0) ||
                            (pose.x >= surface_.side - tolerance && pose.dx > 0);
      const bool leavingY = (pose.y <= tolerance && pose.dy < 0) ||
                            (pose.y >= surface_.side - tolerance && pose.dy > 0);

      // Distance to the next x-grid line and y-grid line; the nearer wins.
      // A reader that is leaving an edge has distance 0: cross back now.
      const double distance = (leavingX || leavingY) ? 0 :
          std::min(nextBoundary(pose.x, pose.dx), nextBoundary(pose.y, pose.dy));

      // Move as far as the remaining budget allows...
      const double advanceBy = std::min(remaining, distance);
      pose.x += pose.dx * advanceBy;
      pose.y += pose.dy * advanceBy;
      remaining -= advanceBy;
      travelled += advanceBy;

      // ...if the budget ran out before reaching a boundary, we are done.
      if (advanceBy + tolerance < distance) return;

      // We are exactly on a boundary now (possibly two). Timestamp the event
      // with the simulated crossing time, not with the frame time.
      const bool onXEdge = pose.x <= tolerance || pose.x >= surface_.side - tolerance;
      const bool onYEdge = pose.y <= tolerance || pose.y >= surface_.side - tolerance;
      const double eventTime = time_ + travelled / speed;

      // Both boundaries at once = a corner. On the cube, continuing straight
      // is ambiguous (a cone point), so the reader stops and says why. On a
      // periodic surface the corner is smooth, so we just cross both edges.
      if (onXEdge && onYEdge && !surface_.periodicCorners) {
        reader.running = false;
        emit(sink, context, {EventKind::Vertex, static_cast<uint8_t>(index), surface_.cellAt(pose), eventTime});
        return;
      }

      // Cross the boundary (or boundaries). Edge numbering: 0=+x 1=+y
      // 2=-x 3=-y. cross() rewrites both position and heading.
      if (onXEdge) surface_.cross(pose, pose.dx > 0 ? 0 : 2);
      if (onYEdge) surface_.cross(pose, pose.dy > 0 ? 1 : 3);

      // The cell that was just entered (forwardIndex assigns boundary points
      // to the cell ahead). Always reported; sounded only when armed AND
      // audible — muted readers keep moving, they just stay silent.
      const Cell cell = surface_.cellAt(pose);
      emit(sink, context, {EventKind::CellEntered, static_cast<uint8_t>(index), cell, eventTime});
      const uint8_t strength = velocity(cell);
      const bool bandMuted = reader.band >= 0 && bands_[reader.band].muted;
      if (strength && !reader.muted && !bandMuted) {
        emit(sink, context, {EventKind::Note, static_cast<uint8_t>(index), cell, eventTime,
                             static_cast<uint8_t>(pitch(index)), strength, reader.instrument, noteMs});
      }
    }

    // Step cap reached with budget left: report it instead of spinning.
    // Only reachable through pathological inputs (absurd rate/tempo combos).
    if (remaining > tolerance) {
      ++overruns_;
      emit(sink, context, {EventKind::Overrun, static_cast<uint8_t>(index), surface_.cellAt(pose), time_});
    }
  }

  // --- state ----------------------------------------------------------------
  Surface surface_;                                 // geometry; cube by default, torus in tests
  std::array<Sequence, maxSequences> sequences_{};  // fixed pool; first sequenceCount_ entries valid
  std::array<Band, maxBands> bands_{};              // fixed pool; first bandCount_ entries valid
  std::array<uint8_t, maxCells> score_{};           // velocity per cell (0 = empty), 2048 B worst case
  unsigned sequenceCount_ = 0, bandCount_ = 0;
  double tempo_ = 120, time_ = 0;                   // BPM; seconds since the last resetPositions()
  bool paused_ = true;                              // boots paused; main.cpp decides when to run
  uint32_t overruns_ = 0;                           // clipped updates + step-cap hits, shown in the UI
};

}