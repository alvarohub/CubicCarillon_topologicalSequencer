#include "devices.hpp"
#include "session_codec.hpp"
#include <Preferences.h>

// ===========================================================================
// store.cpp — session persistence in NVS flash (namespace "toposeq_v2")
// ===========================================================================
//
// SAVE POLICY (why saving is not immediate):
//   * Flash writes briefly stall the loop, so the session only saves when it
//     is safe: outside Performance or while paused (the `suspended` flag that
//     main.cpp computes).
//   * A burst of edits (dragging a value, tapping cells) would wear the flash
//     for nothing; markDirty() only timestamps the change, and service()
//     writes once things have been quiet for saveDelayMs.
//   * The NVS namespace is deliberately DIFFERENT from the original
//     firmware's, so flashing either firmware never erases the other's
//     presets.
//
// TRANSACTIONAL LOAD:
//   `candidate` is a staging instrument. A stored session is decoded into it
//   in full, and only on success is it copied over the live instrument — a
//   corrupted or older session can never half-load.

namespace Store {

static Preferences preferences;                               // NVS handle
static StaticJsonDocument<SessionCodec::capacity> document;   // sized once; no heap churn
static topo::Sequencer candidate;                             // staging instance (KB-sized: static, not stack)
static bool dirty = false;                                    // true = changes not yet saved
static uint32_t changedAt = 0;                                // millis() of the last change

constexpr uint32_t saveDelayMs = 1500;      // quiet time before a save is written
constexpr size_t maxSessionBytes = 24576;   // refuse absurd stored strings

void begin() { preferences.begin("toposeq_v2", false); }

// Load a stored session into `instrument`. Returns false — and changes
// nothing — when there is no session, it is malformed, too large, or fails
// SessionCodec's validation.
bool load(topo::Sequencer& instrument) {
  const String json = preferences.getString("session");
  if (json.isEmpty() || json.length() > maxSessionBytes || deserializeJson(document, json)) return false;
  if (!SessionCodec::decode(document.as<JsonVariantConst>(), candidate)) return false;
  instrument = candidate;
  document.clear();
  return true;
}

// Note that persistent state changed; service() decides when that becomes a
// flash write.
void markDirty(uint32_t now) {
  dirty = true;
  changedAt = now;
}

// Called from the main loop on every pass. Saves only when ALL THREE hold:
// something changed, the caller says saving is safe, and nothing changed for
// saveDelayMs. (Power off before "Session saved" = the last edits are lost;
// that is the price of not stalling playback.)
void service(const topo::Sequencer& instrument, uint32_t now, bool suspended) {
  if (!dirty || !suspended || uint32_t(now - changedAt) < saveDelayMs) return;

  if (!SessionCodec::encode(instrument, document)) {
    Serial.println("ERR session capacity");   // only reachable if limits grew
    changedAt = now;
    return;
  }
  String json;
  serializeJson(document, json);
  if (preferences.putString("session", json) == json.length()) {
    dirty = false;
    Serial.println("Session saved (v2)");     // "(v2)" names this folder's format
  } else {
    changedAt = now;                          // write failed; retry after another quiet period
    Serial.println("ERR session save");
  }
  document.clear();
}

}