#pragma once

// ===========================================================================
// session_codec.hpp — convert a Sequencer to/from the saved-session JSON text
// ===========================================================================
//
// A "session" is everything persistent about the instrument: tempo, band
// tuning, reader definitions, mutes and the whole score. It is stored as JSON
// text (see store.cpp, which keeps it in the `toposeq_v2` NVS namespace) so it
// is easy to inspect, back up and hand-edit off the device.
//
// This file is deliberately free of Arduino/NVS code: it only translates
// between a topo::Sequencer and an ArduinoJson document. That makes the whole
// file format testable on a PC (see test/core_test.cpp) instead of only on the
// board.
//
// ---------------------------------------------------------------------------
// The file format (schema version 1) — a complete, realistic example
// ---------------------------------------------------------------------------
//
// {
//   "version": 1,                 // schema version; anything else is refused
//   "side":    8,                 // cells per cube edge; must match firmware
//   "tempo":   120,               // BPM, 20..400
//
//   "bands": [                    // scale groups the readers can join (0..8)
//     {
//       "tonic": 60,              // MIDI note of scale degree 0 (C4 = 60)
//       "muted": false,           // mutes the group without stopping motion
//       "intervals": [0,2,4,7,9]  // semitone offsets of the scale
//     }                           //   1..12 values, each 0..11
//   ],
//
//   "readers": [                  // travelling geodesics (0..48 entries)
//     {
//       "face": 2,                // start face: 0..5 = +X,-X,+Y,-Y,+Z,-Z
//       "x": 0.5, "y": 0.5,       // start position, in cell units (0..8)
//       "dx": 1.0, "dy": 0.0,     // heading; any angle, stored as a vector
//       "rate": 4.0,              // speed in cell lengths per beat (0..16)
//       "note": 60,               // MIDI note used when "band" is -1
//       "instrument": 0,          // audio-layer instrument index (0..255)
//       "band": 0,                // band index, or -1 = independent reader
//       "degree": 0,              // scale degree inside the band (wraps
//                                 //   upward into higher octaves)
//       "transpose": 0,           // semitones added to the final pitch
//       "muted": false            // silences the reader, not its motion
//     }
//   ],
//
//   "score": [0,0,90,0, ...]      // exactly 384 velocities (0..127), one per
// }                               //   cube cell; 0 = no trigger
//
// The score array is ordered face -> row (y) -> column (x), matching
// topo::Surface::index() = (face*8 + y)*8 + x.
//
// Only the HOME pose of each reader is stored. The live position, a temporary
// reverse or angle change, and anything diagnostic are intentionally not
// persisted: after a reload the composition restarts from its homes.
//
// Decoding is strict and transactional: decode() fills a caller-provided
// STAGING instance and returns false if a single field is missing or out of
// range. The caller (store.cpp) only copies the staging instance into the live
// instrument on success, so a corrupted or older session can never half-load.

#include "core/sequencer.hpp"
#include <ArduinoJson.h>

namespace SessionCodec {

// Compile-time upper bound for the JSON document's memory footprint, computed
// from the largest session this firmware can produce (8 bands, 48 readers,
// 384 score entries, plus slack). ArduinoJson uses it to size a static,
// heap-free document — see store.cpp.
constexpr size_t capacity = JSON_OBJECT_SIZE(6) + JSON_ARRAY_SIZE(topo::maxBands) +
    topo::maxBands * (JSON_OBJECT_SIZE(3) + JSON_ARRAY_SIZE(12)) + JSON_ARRAY_SIZE(topo::maxSequences) +
    topo::maxSequences * JSON_OBJECT_SIZE(13) + JSON_ARRAY_SIZE(384) + 2048;

// ---------------------------------------------------------------------------
// decode helpers
//
// One function per section of the document. Keeping them small means the main
// decode() below reads like the schema description above, and a broken field
// is easy to test on its own.
// ---------------------------------------------------------------------------

// Read one entry of "bands". Checks: tonic 0..127, 1..12 intervals, each
// interval 0..11 semitones, muted present. Returns false on the first problem.
inline bool readBand(JsonObjectConst item, topo::Band& band) {
  const JsonArrayConst intervals = item["intervals"].as<JsonArrayConst>();
  if (!item["tonic"].is<unsigned>() || item["tonic"].as<unsigned>() > 127 ||
      intervals.size() == 0 || intervals.size() > 12 ||
      !item["muted"].is<bool>()) {
    return false;
  }

  band.tonic = item["tonic"].as<unsigned>();
  band.muted = item["muted"].as<bool>();
  band.degreeCount = intervals.size();
  for (unsigned degree = 0; degree < intervals.size(); ++degree) {
    if (!intervals[degree].is<unsigned>() || intervals[degree].as<unsigned>() > 11) {
      return false;
    }
    band.intervals[degree] = intervals[degree].as<unsigned>();
  }
  return true;
}

// Read one entry of "readers". The geometric fields (inside-face start,
// non-zero heading, rate range) are re-checked by Sequencer::addSequence(),
// so here we only validate types and the ranges that get cast to integers.
// `bandCount` is the number of band entries present in the document.
inline bool readReader(JsonObjectConst item, unsigned bandCount, topo::Sequence& reader) {
  const bool faceOk = item["face"].is<unsigned>() && item["face"].as<unsigned>() < 6;
  const bool noteOk = item["note"].is<unsigned>() && item["note"].as<unsigned>() <= 127;
  const bool instrumentOk = item["instrument"].is<unsigned>() && item["instrument"].as<unsigned>() <= 255;
  const bool degreeOk = item["degree"].is<unsigned>() && item["degree"].as<unsigned>() <= 255;
  const bool transposeOk = item["transpose"].is<int>() &&
                           item["transpose"].as<int>() >= -128 && item["transpose"].as<int>() <= 127;
  const bool bandOk = item["band"].is<int>() && item["band"].as<int>() >= -1 &&
                      item["band"].as<int>() < static_cast<int>(bandCount);
  if (!faceOk || !noteOk || !instrumentOk || !degreeOk || !transposeOk || !bandOk ||
      !item["muted"].is<bool>()) {
    return false;
  }
  for (const char* key : {"x", "y", "dx", "dy", "rate"}) {
    if (!item[key].is<double>()) return false;
  }

  reader.pose = {item["face"].as<uint8_t>(), item["x"].as<double>(), item["y"].as<double>(),
                 item["dx"].as<double>(), item["dy"].as<double>()};
  reader.rate = item["rate"].as<double>();
  reader.note = item["note"].as<uint8_t>();
  reader.instrument = item["instrument"].as<uint8_t>();
  reader.band = item["band"].as<int8_t>();
  reader.degree = item["degree"].as<uint8_t>();
  reader.transpose = item["transpose"].as<int8_t>();
  reader.muted = item["muted"].as<bool>();
  return true;
}

// Read the whole "score" array: exactly 384 values (6 faces * 8 * 8 cells),
// each 0..127, ordered like topo::Surface::index().
inline bool readScore(JsonArrayConst values, topo::Sequencer& target) {
  if (values.size() != 384) return false;
  for (unsigned index = 0; index < 384; ++index) {
    const JsonVariantConst entry = values[index];
    if (!entry.is<unsigned>() || entry.as<unsigned>() > 127) return false;

    // index = (face * 8 + y) * 8 + x — the same layout Surface::index() uses.
    const topo::Cell cell{static_cast<uint8_t>(index / 64),          // face
                          static_cast<uint8_t>(index % 8),           // x
                          static_cast<uint8_t>((index % 64) / 8)};   // y
    target.setCell(cell, entry.as<uint8_t>());
  }
  return true;
}

// ---------------------------------------------------------------------------
// decode() / encode()
// ---------------------------------------------------------------------------

// Decode one session document into `candidate`, a STAGING instance owned by the
// caller. Returns true only if every field passed its checks. On false,
// `candidate` may be partially filled and must be discarded — the caller must
// not copy it into the live instrument.
inline bool decode(JsonVariantConst document, topo::Sequencer& candidate) {
  if (document["version"] != 1 || document["side"] != 8) return false;
  const JsonArrayConst bands = document["bands"].as<JsonArrayConst>();
  const JsonArrayConst readers = document["readers"].as<JsonArrayConst>();
  const JsonArrayConst score = document["score"].as<JsonArrayConst>();
  if (bands.isNull() || readers.isNull() ||
      score.size() != 384 || bands.size() > topo::maxBands ||
      readers.size() > topo::maxSequences) {
    return false;
  }

  candidate.reset(topo::cubeSurface());
  if (!document["tempo"].is<double>() || !candidate.setTempo(document["tempo"].as<double>())) {
    return false;
  }

  for (JsonObjectConst item : bands) {
    topo::Band band;
    if (!readBand(item, band)) return false;
    if (candidate.addBand(band) < 0) return false;   // count already checked
  }
  for (JsonObjectConst item : readers) {
    topo::Sequence reader;
    if (!readReader(item, bands.size(), reader)) return false;
    if (candidate.addSequence(reader) < 0) return false;
  }
  return readScore(score, candidate);
}

// Encode the current instrument into `document` (cleared first). Returns false
// if the document ran out of capacity; the caller must then treat the save as
// failed and write nothing.
inline bool encode(const topo::Sequencer& instrument, JsonDocument& document) {
  document.clear();
  // The schema only describes the 8x8x6 cube: refuse anything else rather
  // than writing a file that could not be loaded back correctly.
  if (instrument.surface().side != 8 || instrument.surface().faceCount != 6) return false;
  document["version"] = 1;
  document["side"] = instrument.surface().side;
  document["tempo"] = instrument.tempo();
  JsonArray bands = document.createNestedArray("bands");
  for (unsigned index = 0; index < instrument.bandCount(); ++index) {
    const auto& band = instrument.band(index);
    JsonObject item = bands.createNestedObject();
    item["tonic"] = band.tonic;
    item["muted"] = band.muted;
    JsonArray intervals = item.createNestedArray("intervals");
    for (unsigned degree = 0; degree < band.degreeCount; ++degree) intervals.add(band.intervals[degree]);
  }
  JsonArray readers = document.createNestedArray("readers");
  for (unsigned index = 0; index < instrument.sequenceCount(); ++index) {
    const auto& reader = instrument.sequence(index);
    JsonObject item = readers.createNestedObject();
    // Home pose, not the live one — see the note in the header comment.
    item["face"] = reader.home.face;
    item["x"] = reader.home.x;
    item["y"] = reader.home.y;
    item["dx"] = reader.home.dx;
    item["dy"] = reader.home.dy;
    item["rate"] = reader.rate;
    item["note"] = reader.note;
    item["instrument"] = reader.instrument;
    item["band"] = reader.band;
    item["degree"] = reader.degree;
    item["transpose"] = reader.transpose;
    item["muted"] = reader.muted;
  }
  // One velocity per cell, ordered face -> row(y) -> column(x): the same
  // layout as Surface::index() and the example in the header comment.
  JsonArray score = document.createNestedArray("score");
  for (unsigned index = 0; index < 384; ++index) {
    const topo::Cell cell{static_cast<uint8_t>(index / 64),
                          static_cast<uint8_t>(index % 8),
                          static_cast<uint8_t>((index % 64) / 8)};
    score.add(instrument.velocity(cell));
  }
  return !document.overflowed();
}

}