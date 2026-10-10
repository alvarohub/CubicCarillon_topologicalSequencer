#pragma once

// ===========================================================================
// commands.hpp — every edit the instrument accepts, behind ONE validator
// ===========================================================================
//
// All control paths (screen buttons, USB text, and later network messages)
// are converted into a Commands::Command and passed to apply(). Centralizing
// this means a new path cannot forget a validation, and the result can tell
// the caller two things beyond "accepted":
//
//   silence — cut the audio now (pause/clear/mute-style edits)
//   save    — persistent state changed; mark the session dirty
//
// apply() never touches hardware itself: the caller (main.cpp) reacts to the
// flags. Nothing in this file knows about Arduino, LEDs or USB.

#include "modes.hpp"

namespace Commands {

// One entry per editable action. The comments list which Command fields each
// kind reads; all other fields stay at their defaults.
enum class Kind : uint8_t {
  Play,            // resume the instrument               (—)
  Pause,           // pause the instrument                (—)
  Toggle,          // play/pause, or pause the diagnostic  (—)
  Tempo,           // set global BPM                      (value: 20..400)
  Mode,            // switch mode                         (index: Modes::Kind)
  DiagnosticStep,  // advance a diagnostic by one step    (—)
  Randomize,       // write a pseudo-random score         (index: seed)
  Clear,           // clear the score                     (—)
  Reset,           // all readers back to home poses      (—)
  Brightness,      // LED brightness                      (value: 1..64)
  Reverse,         // flip one reader's heading           (index: sequence)
  Rate,            // set one reader's speed              (index: sequence, value: >0..16)
  Mute,            // mute one reader                     (index: sequence, value: 0/1)
  Direction,       // set one reader's heading            (index: sequence, value: degrees)
  Cell,            // set one cell's velocity             (cell: address, value: 0..127)
  Tonic,           // retune one band                     (index: band, value: MIDI note)
  AddSequence,     // add one reader                      (reader: template)
};

// A generic command envelope: `kind` decides which of the remaining fields
// the command uses (see the table above); unused fields keep their defaults.
struct Command {
  Kind kind = Kind::Pause;
  unsigned index = 0;        // sequence/band/mode/seed, depending on kind
  double value = 0;          // BPM/brightness/rate/degrees/velocity/MIDI note
  topo::Cell cell{};         // Cell commands only
  topo::Sequence reader{};   // AddSequence only
};

// What the caller should do with a command's outcome. See the file header.
struct Result {
  bool accepted = false;
  bool silence = false;
  bool save = false;
};

// Validate and apply one command. Returns {accepted, silence, save}; on any
// invalid input the instrument and the mode state are left untouched.
inline Result apply(topo::Sequencer& instrument, Modes::State& modes, const Command& command) {
  // NaN/Infinity can arrive from text parsers; no command accepts them.
  if (!std::isfinite(command.value)) return {};

  switch (command.kind) {
    case Kind::Play:
      instrument.setPaused(false);
      return {true, false, false};
    case Kind::Pause:
      instrument.setPaused(true);
      return {true, true, false};    // silence: playback just stopped
    case Kind::Toggle:
      // Context-dependent: in Performance this is the transport; in any
      // diagnostic it pauses/resumes the diagnostic instead.
      if (modes.active == Modes::Kind::Performance) {
        instrument.setPaused(!instrument.paused());
        return {true, instrument.paused(), false};
      }
      modes.diagnostic.paused = !modes.diagnostic.paused;
      return {true, true, false};
    case Kind::Tempo:
      return {instrument.setTempo(command.value), false, true};
    case Kind::Mode:
      if (command.index >= static_cast<unsigned>(Modes::Kind::Count)) return {};
      return {Modes::select(modes, static_cast<Modes::Kind>(command.index), instrument.surface()), true, false};
    case Kind::DiagnosticStep:
      if (modes.active == Modes::Kind::Performance) return {};   // nothing to step
      modes.diagnostic.paused = true;                            // manual stepping implies pause
      Modes::step(modes, instrument.surface().cellCount(), 384); // 384 = CoreS3 physical emitters
      return {true, false, false};
    case Kind::Randomize:
      instrument.randomize(command.index);   // index doubles as the seed
      return {true, false, true};
    case Kind::Clear:
      instrument.clearScore();
      return {true, true, true};             // silence: notes were playing from it
    case Kind::Reset:
      instrument.resetPositions();
      return {true, true, false};
    case Kind::Brightness:
      if (command.value < 1 || command.value > 64) return {};   // 64 = electrical safety cap
      modes.brightness = static_cast<uint8_t>(command.value);
      return {true, false, false};
    case Kind::Reverse:
      // Live performance gesture; not persisted (the store saves home poses).
      return {instrument.reverse(command.index), false, false};
    case Kind::Rate:
      return {instrument.setSequenceRate(command.index, command.value), false, true};
    case Kind::Mute:
      return {instrument.setSequenceMuted(command.index, command.value != 0), true, true};
    case Kind::Direction:
      // Live performance gesture; not persisted.
      return {instrument.setDirection(command.index, command.value), false, false};
    case Kind::Cell:
      if (command.value < 0 || command.value > 127) return {};
      return {instrument.setCell(command.cell, static_cast<uint8_t>(command.value)), false, true};
    case Kind::Tonic: {
      if (command.index >= instrument.bandCount() || command.value < 0 || command.value > 127) return {};
      topo::Band band = instrument.band(command.index);
      band.tonic = static_cast<uint8_t>(command.value);
      return {instrument.setBand(command.index, band), false, true};
    }
    case Kind::AddSequence:
      return {instrument.addSequence(command.reader) >= 0, false, true};
  }
  return {};   // unreachable for a valid Kind; reject by default
}

}