#include "osc_handler.hpp"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef CUBE_WIFI_SSID
#define CUBE_WIFI_SSID ""
#endif

#ifndef CUBE_WIFI_PASS
#define CUBE_WIFI_PASS ""
#endif

namespace cube {

OSCHandler::OSCHandler(TransportState& transport, ScoreGrid& score, PresetStore& store)
    : transport_(transport), score_(score), store_(store) {}

bool OSCHandler::begin() {
#if CUBE_WIFI_MODE == CUBE_WIFI_MODE_OFF
  Serial.println("WiFi disabled by CUBE_WIFI_MODE");
  return false;
#elif CUBE_WIFI_MODE == CUBE_WIFI_MODE_STATION
  if (String(CUBE_WIFI_SSID).length() > 0 && startStation()) return true;
  return startAccessPoint();
#else
  return startAccessPoint();
#endif
}

bool OSCHandler::startAccessPoint() {
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(CUBE_AP_SSID, CUBE_AP_PASS)) {
    Serial.println("Failed to start CubeCarillon AP");
    return false;
  }
  Serial.printf("CubeCarillon AP: %s  IP: %s\n", CUBE_AP_SSID, WiFi.softAPIP().toString().c_str());
  return startUdpListener();
}

bool OSCHandler::startStation() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(CUBE_WIFI_SSID, CUBE_WIFI_PASS);
  Serial.print("Connecting to WiFi");

  const unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < CUBE_WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi station connection timed out");
    return false;
  }

  Serial.printf("WiFi station IP: %s\n", WiFi.localIP().toString().c_str());
  return startUdpListener();
}

bool OSCHandler::startUdpListener() {
  udp_.stop();
  udpActive_ = udp_.begin(kOscPort) == 1;
  Serial.printf("OSC UDP %s on port %u\n", udpActive_ ? "listening" : "failed", (unsigned)kOscPort);
  return udpActive_;
}

void OSCHandler::update() {
  if (!udpActive_) return;

  int size;
  while ((size = udp_.parsePacket()) > 0) {
    OSCMessage msg;
    while (size--) msg.fill(udp_.read());
    if (!msg.hasError()) {
      processMessage(msg);
    } else {
      Serial.println("OSC parse error");
    }
  }
}

bool OSCHandler::executeCommand(const char* line, String* response) {
  if (!line) return false;

  char buffer[192];
  strncpy(buffer, line, sizeof(buffer) - 1);
  buffer[sizeof(buffer) - 1] = '\0';

  char* save = nullptr;
  char* address = strtok_r(buffer, " \t\r\n", &save);
  if (!address) return false;

  char* argv[8] = {};
  int argc = 0;
  while (argc < 8 && (argv[argc] = strtok_r(nullptr, " \t\r\n", &save)) != nullptr) argc++;

  return handleTextCommand(address, argc, argv, response);
}

String OSCHandler::statusJson() const {
  String out;
  out.reserve(320);
  out += "{\"wifiMode\":\"";
  out += wifiModeName();
  out += "\",\"ip\":\"";
  out += localIP().toString();
  out += "\",\"ap\":";
  out += accessPointActive() ? "true" : "false";
  out += ",\"clients\":";
  out += String((int)connectedClientCount());
  out += ",\"oscPort\":";
  out += String((int)kOscPort);
  out += ",\"webPort\":";
  out += String((int)kWebPort);
  out += ",\"bpm\":";
  out += String(transport_.bpm, 2);
  out += ",\"paused\":";
  out += transport_.paused ? "true" : "false";
  out += ",\"stepMode\":";
  out += transport_.stepMode ? "true" : "false";
  out += ",\"railed\":";
  out += transport_.railed ? "true" : "false";
  out += ",\"armed\":";
  out += String((int)score_.armedCount());
  out += "}";
  return out;
}

IPAddress OSCHandler::localIP() const {
  if (accessPointActive()) return WiFi.softAPIP();
  return WiFi.localIP();
}

bool OSCHandler::accessPointActive() const { return (WiFi.getMode() & WIFI_AP) != 0; }

uint8_t OSCHandler::connectedClientCount() const { return accessPointActive() ? (uint8_t)WiFi.softAPgetStationNum() : 0; }

const char* OSCHandler::wifiModeName() const {
#if CUBE_WIFI_MODE == CUBE_WIFI_MODE_OFF
  return "off";
#elif CUBE_WIFI_MODE == CUBE_WIFI_MODE_STATION
  return accessPointActive() ? "ap-fallback" : "station";
#else
  return "ap";
#endif
}

void OSCHandler::processMessage(OSCMessage& msg) {
  char address[64];
  msg.getAddress(address, 0);
  if (!handleOscCommand(address, msg)) {
    Serial.printf("Unhandled OSC: %s\n", address);
  }
}

bool OSCHandler::handleOscCommand(const char* address, OSCMessage& msg) {
  if (strcmp(address, "/transport/bpm") == 0 || strcmp(address, "/bpm") == 0) {
    if (msg.size() < 1) return false;
    const float bpm = msg.isFloat(0) ? msg.getFloat(0) : (float)msg.getInt(0);
    transport_.bpm = clampf(bpm, 20.0f, 400.0f);
    store_.markDirty();
    return true;
  }

  if (strcmp(address, "/transport/pause") == 0 || strcmp(address, "/pause") == 0) {
    if (msg.size() < 1) return false;
    transport_.paused = msg.isInt(0) ? msg.getInt(0) != 0 : msg.getFloat(0) != 0.0f;
    store_.markDirty();
    return true;
  }

  if (strcmp(address, "/transport/toggle") == 0 || strcmp(address, "/toggle") == 0) {
    transport_.paused = !transport_.paused;
    store_.markDirty();
    return true;
  }

  if (strcmp(address, "/score/clear") == 0 || strcmp(address, "/clear") == 0) {
    score_.clear();
    store_.markDirty();
    return true;
  }

  if (strcmp(address, "/score/random") == 0 || strcmp(address, "/random") == 0) {
    const float density = msg.size() > 0 ? (msg.isFloat(0) ? msg.getFloat(0) : (float)msg.getInt(0)) : 0.16f;
    score_.randomize(density, 0.55f, 0.90f);
    store_.markDirty();
    return true;
  }

  if (strcmp(address, "/score/set") == 0 || strcmp(address, "/cell") == 0) {
    if (msg.size() < 4) return false;
    const uint8_t face = (uint8_t)msg.getInt(0);
    const uint8_t x = (uint8_t)msg.getInt(1);
    const uint8_t y = (uint8_t)msg.getInt(2);
    const float velocity = msg.isFloat(3) ? msg.getFloat(3) : (float)msg.getInt(3);
    score_.set(face, x, y, velocity);
    store_.markDirty();
    return true;
  }

  return false;
}

bool OSCHandler::handleTextCommand(const char* address, const int argc, char* argv[], String* response) {
  if (strcmp(address, "/transport/bpm") == 0 || strcmp(address, "/bpm") == 0) {
    if (argc < 1) return false;
    transport_.bpm = clampf(atof(argv[0]), 20.0f, 400.0f);
    store_.markDirty();
    appendOk(response, "bpm " + String(transport_.bpm, 2));
    return true;
  }

  if (strcmp(address, "/transport/pause") == 0 || strcmp(address, "/pause") == 0) {
    if (argc < 1) return false;
    transport_.paused = tokenBool(argv[0], transport_.paused);
    store_.markDirty();
    appendOk(response, transport_.paused ? "paused" : "running");
    return true;
  }

  if (strcmp(address, "/transport/toggle") == 0 || strcmp(address, "/toggle") == 0) {
    transport_.paused = !transport_.paused;
    store_.markDirty();
    appendOk(response, transport_.paused ? "paused" : "running");
    return true;
  }

  if (strcmp(address, "/score/clear") == 0 || strcmp(address, "/clear") == 0) {
    score_.clear();
    store_.markDirty();
    appendOk(response, "score cleared");
    return true;
  }

  if (strcmp(address, "/score/random") == 0 || strcmp(address, "/random") == 0) {
    const float density = argc > 0 ? atof(argv[0]) : 0.16f;
    score_.randomize(density, 0.55f, 0.90f);
    store_.markDirty();
    appendOk(response, "score randomized");
    return true;
  }

  if (strcmp(address, "/score/set") == 0 || strcmp(address, "/cell") == 0) {
    if (argc < 4) {
      appendError(response, "usage: /score/set face x y velocity");
      return false;
    }
    const uint8_t face = (uint8_t)atoi(argv[0]);
    const uint8_t x = (uint8_t)atoi(argv[1]);
    const uint8_t y = (uint8_t)atoi(argv[2]);
    const float velocity = atof(argv[3]);
    score_.set(face, x, y, velocity);
    store_.markDirty();
    appendOk(response, "cell set");
    return true;
  }

  if (strcmp(address, "/score/toggle") == 0 || strcmp(address, "/togglecell") == 0) {
    if (argc < 3) {
      appendError(response, "usage: /score/toggle face x y [velocity]");
      return false;
    }
    const uint8_t face = (uint8_t)atoi(argv[0]);
    const uint8_t x = (uint8_t)atoi(argv[1]);
    const uint8_t y = (uint8_t)atoi(argv[2]);
    const float current = score_.velocity01(face, x, y);
    const float velocity = argc > 3 ? atof(argv[3]) : 0.75f;
    score_.set(face, x, y, current > 0.0f ? 0.0f : velocity);
    store_.markDirty();
    appendOk(response, "cell toggled");
    return true;
  }

  if (strcmp(address, "/status") == 0) {
    if (response) *response = statusJson();
    return true;
  }

  appendError(response, String("unknown command ") + address);
  return false;
}

float OSCHandler::clampf(const float v, const float lo, const float hi) { return v < lo ? lo : (v > hi ? hi : v); }

bool OSCHandler::tokenBool(const char* value, const bool fallback) {
  if (!value) return fallback;
  if (strcmp(value, "1") == 0 || strcasecmp(value, "true") == 0 || strcasecmp(value, "on") == 0) return true;
  if (strcmp(value, "0") == 0 || strcasecmp(value, "false") == 0 || strcasecmp(value, "off") == 0) return false;
  return fallback;
}

void OSCHandler::appendOk(String* response, const String& message) {
  if (response) *response = String("OK ") + message;
}

void OSCHandler::appendError(String* response, const String& message) {
  if (response) *response = String("ERR ") + message;
}

}  // namespace cube
