#pragma once

// =============================================================================
// net.hpp -- Wi-Fi / OSC / Web / WebSocket bring-up and JSON sync protocol.
// =============================================================================
//
// This module is the ONE place that knows how the firmware talks to the outside
// world. Everything else calls into it via free functions.
//
//   1. Net::begin()             -- start Wi-Fi + OSC + Web + WebSocket.
//   2. Net::update()            -- service all transports each loop tick.
//   3. Net::broadcastIfDue(ms)  -- periodic state broadcast (~1 Hz).
//   4. Net::broadcastState()    -- immediate state broadcast (after local edits).
//
// The classes that actually implement Wi-Fi/HTTP/WebSocket bookkeeping live
// under `namespace cube` (OSCHandler, WebInterface). This namespace glues them
// together and adds the JSON protocol used to sync with browser clients.
// =============================================================================

#include <Arduino.h>

namespace Net {

// True once begin() has succeeded. Read by Hud when it decides whether a
// local state change should be echoed to WebSocket clients.
extern bool started;

// Start Wi-Fi, OSC, Web, WebSocket. Skipped in quiet-diagnostics mode by main.cpp.
void begin();

// Service all network transports. Safe no-op if begin() was never called.
void update();

// If enough time has elapsed since the last broadcast and someone is listening,
// send a fresh transport + score snapshot.
void broadcastIfDue(unsigned long nowMs);

// Send a fresh transport + score snapshot right now (used after Hud edits).
void broadcastState();

}  // namespace Net
