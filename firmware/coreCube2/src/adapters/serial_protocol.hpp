#pragma once

// ===========================================================================
// serial_protocol.hpp — USB text protocol: parse one line into a Command
// ===========================================================================
//
// One command per line at 115200 baud; `status` is handled by the Com adapter
// (cores3.cpp) and everything else arrives here. THIS IS NOT the original
// CubeLink wire protocol — it is a new, human-friendly local protocol, and
// every face/sequence/band ID is ZERO-BASED (full list in the README):
//
//   play | pause | toggle | clear | reset | step          no arguments
//   tempo VALUE            20..400 BPM
//   brightness VALUE       1..64
//   mode UNSIGNED          0..6, see Modes::Kind
//   random SEED            deterministic score
//   reverse INDEX          flip one reader's heading
//   rate INDEX VALUE       cell lengths per beat, 0..16
//   mute INDEX VALUE       0/1
//   angle INDEX DEGREES    0..360; refused exactly on a chart edge
//   tonic BAND-INDEX NOTE  MIDI note 0..127
//   cell FACE COLUMN ROW VELOCITY     velocity 0..127
//   add FACE X Y ANGLE RATE NOTE      new independent reader
//
// This file only TRANSLATES text -> Commands::Command; range validation lives
// in Commands::apply() and the core, so both control paths cannot disagree.
//
// Parser notes:
//   * the trailing "%c" in every format string catches a stray extra token:
//     "tempo 120 extra" reads 'e' into `extra`, the field count grows, and
//     the command is rejected;
//   * "%u" follows sscanf rules for unsigned numbers; negative input is
//     rejected by the range checks downstream;
//   * only <cstdio>/<cstring>/<cmath> are used, so the parser is host-testable
//     like the rest of the code (see test/core_test.cpp).

#include "commands.hpp"
#include <cmath>     // std::isfinite / std::cos / std::sin / std::remainder
#include <cstdio>    // std::sscanf
#include <cstring>   // std::strcmp

namespace SerialProtocol {

// Parse one line into `command`. Returns false for unknown syntax; `command`
// is left default-constructed in that case. (Range validation is NOT done
// here — see the file header.)
inline bool parse(const char* text, Commands::Command& command) {
  using Commands::Kind;
  char verb[24]{};   // command word ("tempo", "cell", ...)
  char extra = 0;    // catches unwanted trailing tokens (see parser notes)
  if (std::sscanf(text, "%23s", verb) != 1) return false;

  unsigned index = 0, face = 0, column = 0, row = 0;
  double value = 0;
  command = {};

  // --- commands without arguments ------------------------------------------
  if (std::strcmp(verb, "play") == 0 || std::strcmp(verb, "pause") == 0 ||
      std::strcmp(verb, "toggle") == 0 || std::strcmp(verb, "clear") == 0 ||
      std::strcmp(verb, "reset") == 0 || std::strcmp(verb, "step") == 0) {
    if (std::sscanf(text, "%23s %c", verb, &extra) != 1) return false;
    if (std::strcmp(verb, "play") == 0) command.kind = Kind::Play;
    if (std::strcmp(verb, "pause") == 0) command.kind = Kind::Pause;
    if (std::strcmp(verb, "toggle") == 0) command.kind = Kind::Toggle;
    if (std::strcmp(verb, "clear") == 0) command.kind = Kind::Clear;
    if (std::strcmp(verb, "reset") == 0) command.kind = Kind::Reset;
    if (std::strcmp(verb, "step") == 0) command.kind = Kind::DiagnosticStep;
    return true;
  }
  // --- one numeric argument ------------------------------------------------
  if (std::strcmp(verb, "tempo") == 0 || std::strcmp(verb, "brightness") == 0) {
    if (std::sscanf(text, "%23s %lf %c", verb, &value, &extra) != 2) return false;
    command.kind = std::strcmp(verb, "tempo") == 0 ? Kind::Tempo : Kind::Brightness;
    command.value = value;
    return true;
  }

  // --- one unsigned argument -----------------------------------------------
  if (std::strcmp(verb, "mode") == 0 || std::strcmp(verb, "random") == 0 ||
      std::strcmp(verb, "reverse") == 0) {
    if (std::sscanf(text, "%23s %u %c", verb, &index, &extra) != 2) return false;
    if (std::strcmp(verb, "mode") == 0) {
      command.kind = Kind::Mode;
    } else if (std::strcmp(verb, "random") == 0) {
      command.kind = Kind::Randomize;   // index doubles as the seed
    } else {
      command.kind = Kind::Reverse;
    }
    command.index = index;
    return true;
  }
  // --- index + number ------------------------------------------------------
  if (std::strcmp(verb, "rate") == 0 || std::strcmp(verb, "mute") == 0 ||
      std::strcmp(verb, "angle") == 0 || std::strcmp(verb, "tonic") == 0) {
    if (std::sscanf(text, "%23s %u %lf %c", verb, &index, &value, &extra) != 3) return false;
    if (std::strcmp(verb, "rate") == 0) {
      command.kind = Kind::Rate;
    } else if (std::strcmp(verb, "mute") == 0) {
      command.kind = Kind::Mute;
    } else if (std::strcmp(verb, "angle") == 0) {
      command.kind = Kind::Direction;
    } else {
      command.kind = Kind::Tonic;
    }
    command.index = index;
    command.value = value;
    return true;
  }

  // --- cell FACE COLUMN ROW VELOCITY ---------------------------------------
  if (std::strcmp(verb, "cell") == 0) {
    if (std::sscanf(text, "%23s %u %u %u %lf %c", verb, &face, &column, &row, &value, &extra) != 5) return false;
    if (face >= topo::maxFaces || column >= topo::maxSide || row >= topo::maxSide) return false;
    command.kind = Kind::Cell;
    command.cell = {static_cast<uint8_t>(face), static_cast<uint8_t>(column), static_cast<uint8_t>(row)};
    command.value = value;
    return true;
  }

  // --- add FACE X Y ANGLE RATE NOTE ----------------------------------------
  if (std::strcmp(verb, "add") == 0) {
    double positionX = 0, positionY = 0, degrees = 0, rate = 0;
    unsigned note = 0;
    if (std::sscanf(text, "%23s %u %lf %lf %lf %lf %u %c", verb, &face, &positionX, &positionY,
                    &degrees, &rate, &note, &extra) != 7) return false;
    if (face >= topo::maxFaces || note > 127 || !std::isfinite(degrees)) return false;
    const double radians = std::remainder(degrees, 360.0) * topo::pi / 180;
    command.kind = Kind::AddSequence;
    command.reader.pose = {static_cast<uint8_t>(face), positionX, positionY,
                           std::cos(radians), std::sin(radians)};
    command.reader.rate = rate;
    command.reader.note = static_cast<uint8_t>(note);
    return true;
  }

  // Unknown verb.
  return false;
}

}