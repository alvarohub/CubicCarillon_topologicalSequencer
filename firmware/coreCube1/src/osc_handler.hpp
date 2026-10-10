#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <OSCMessage.h>

#include "config.hpp"
#include "preset_store.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"

namespace cube {

class OSCHandler {
 public:
  OSCHandler(TransportState& transport, ScoreGrid& score, PresetStore& store);

  bool begin();
  void update();

  bool executeCommand(const char* line, String* response = nullptr);
  String statusJson() const;

  IPAddress localIP() const;
  bool accessPointActive() const;
  uint8_t connectedClientCount() const;
  const char* wifiModeName() const;

 private:
  TransportState& transport_;
  ScoreGrid& score_;
  PresetStore& store_;
  WiFiUDP udp_;
  bool udpActive_ = false;

  bool startAccessPoint();
  bool startStation();
  bool startUdpListener();

  void processMessage(OSCMessage& msg);
  bool handleTextCommand(const char* address, int argc, char* argv[], String* response);
  bool handleOscCommand(const char* address, OSCMessage& msg);

  static float clampf(float v, float lo, float hi);
  static bool tokenBool(const char* value, bool fallback);
  static void appendOk(String* response, const String& message);
  static void appendError(String* response, const String& message);
};
}  // namespace cube

// -----------------------------------------------------------------------------
// Osc:: -- singleton alias for the OSC/Wi-Fi handler.
// -----------------------------------------------------------------------------
namespace Osc {
  extern cube::OSCHandler handler;
}

