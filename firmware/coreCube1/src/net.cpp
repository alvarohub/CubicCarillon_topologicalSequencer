// =============================================================================
// net.cpp -- Wi-Fi / OSC / Web / WebSocket bring-up and JSON sync protocol.
// See net.hpp for the module rationale.
// =============================================================================

#include "net.hpp"

#include <ArduinoJson.h>
#include <WebSocketsServer.h>

#include "config.hpp"
#include "osc_handler.hpp"
#include "preset_store.hpp"
#include "score_grid.hpp"
#include "transport_state.hpp"
#include "web_interface.hpp"

namespace Net {

// -----------------------------------------------------------------------------
// Shared state (definitions)
// -----------------------------------------------------------------------------
bool started = false;

// -----------------------------------------------------------------------------
// File-private state (not exposed in the header)
// -----------------------------------------------------------------------------
namespace {

// The one WebSocket server. Constructed here rather than in singletons.cpp
// because nobody outside this module ever touches it directly.
WebSocketsServer ws(cube::kWsPort);

// Stable "core-xxxxxxxx" id emitted as the "sender" of every message.
String nodeId;

// Timestamp of the last periodic broadcast (used by broadcastIfDue).
unsigned long lastBroadcastMs = 0;

// Numeric clamp for values arriving from clients we don't trust.
float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// Build a stable per-device id from the ESP32 eFuse MAC (lower 32 bits).
String makeNodeId() {
  const uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "core-%08lx",
           static_cast<unsigned long>(mac & 0xffffffffu));
  return String(buf);
}

// ---------------------------------------------------------------------------
// JSON helpers -- serialize a JsonDocument once and send it to one client
// or to all connected clients.
// ---------------------------------------------------------------------------
void sendDoc(uint8_t client, JsonDocument& doc, bool broadcast) {
  String out;
  serializeJson(doc, out);
  if (broadcast) ws.broadcastTXT(out);
  else           ws.sendTXT(client, out);
}

// Copy the current transport into a JsonObject.
void putTransport(JsonObject obj) {
  obj["bpm"]      = Transport::state.bpm;
  obj["paused"]   = Transport::state.paused;
  obj["stepMode"] = Transport::state.stepMode;
  obj["railed"]   = Transport::state.railed;
  obj["gravity"]  = Transport::state.gravity;
}

// Apply an inbound "transport.set" payload. Every field is optional.
void applyTransport(JsonObjectConst p) {
  if (p.containsKey("bpm"))      Transport::state.bpm      = clampf(p["bpm"].as<float>(), 20.0f, 400.0f);
  if (p.containsKey("paused"))   Transport::state.paused   = p["paused"].as<bool>();
  if (p.containsKey("stepMode")) Transport::state.stepMode = p["stepMode"].as<bool>();
  if (p.containsKey("railed"))   Transport::state.railed   = p["railed"].as<bool>();
  if (p.containsKey("gravity"))  Transport::state.gravity  = p["gravity"].as<float>();
}

// ---------------------------------------------------------------------------
// Outbound messages
// ---------------------------------------------------------------------------

// Advertise our role + protocol version + supported commands.
void sendHello(uint8_t client) {
  StaticJsonDocument<512> doc;
  doc["type"]   = "hello";
  doc["sender"] = nodeId;
  doc["ts"]     = (uint32_t)millis();

  JsonObject p = doc.createNestedObject("payload");
  p["role"]     = "core";
  p["protocol"] = 1;

  JsonArray caps = p.createNestedArray("capabilities");
  caps.add("transport.set");
  caps.add("score.replace");
  caps.add("score.clear");
  caps.add("score.random");
  caps.add("snapshot");

  sendDoc(client, doc, false);
}

// Full transport + score dump. Sent on connect and by explicit request.
void sendSnapshot(uint8_t client) {
  DynamicJsonDocument doc(32768);
  doc["type"]   = "snapshot";
  doc["sender"] = nodeId;
  doc["ts"]     = (uint32_t)millis();

  JsonObject p = doc.createNestedObject("payload");
  putTransport(p.createNestedObject("transport"));
  Score::grid.toJson(p.createNestedObject("score"));

  sendDoc(client, doc, false);
}

// ---------------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------------

// One WebSocket text frame -> parse JSON -> dispatch by "type" field.
// Malformed frames are silently dropped so a bad client cannot crash us.
void onTextMessage(uint8_t client, const String& text) {
  DynamicJsonDocument doc(32768);
  if (deserializeJson(doc, text)) return;

  const String     type    = doc["type"] | "";
  JsonVariantConst payload = doc["payload"];

  if (type == "ping") {
    StaticJsonDocument<256> out;
    out["type"]   = "pong";
    out["sender"] = nodeId;
    out["ts"]     = (uint32_t)millis();
    out.createNestedObject("payload");
    sendDoc(client, out, false);
    return;
  }

  if (type == "hello") { sendHello(client); return; }

  if (type == "transport.set") {
    if (payload.is<JsonObjectConst>()) applyTransport(payload.as<JsonObjectConst>());
    Store::instance.markDirty();
    broadcastState();
    return;
  }

  if (type == "score.clear") {
    Score::grid.clear();
    Store::instance.markDirty();
    broadcastState();
    return;
  }

  if (type == "score.random") {
    float density = 0.16f, vMin = 0.55f, vMax = 0.90f;
    if (payload.is<JsonObjectConst>()) {
      auto p = payload.as<JsonObjectConst>();
      if (p.containsKey("density")) density = p["density"].as<float>();
      if (p.containsKey("vMin"))    vMin    = p["vMin"].as<float>();
      if (p.containsKey("vMax"))    vMax    = p["vMax"].as<float>();
    }
    Score::grid.randomize(density, vMin, vMax);
    Store::instance.markDirty();
    broadcastState();
    return;
  }

  if (type == "score.replace") {
    if (payload.is<JsonObjectConst>()) {
      auto p = payload.as<JsonObjectConst>();
      if (p.containsKey("score") && p["score"].is<JsonObjectConst>())
        Score::grid.fromJson(p["score"].as<JsonObjectConst>());
      else
        Score::grid.fromJson(p);
    }
    Store::instance.markDirty();
    broadcastState();
    return;
  }

  if (type == "snapshot.request") { sendSnapshot(client); return; }

  // Any other "type" is silently ignored so protocol drift can't crash us.
}

// Raw WS event callback (registered with WebSocketsServer::onEvent).
void onWsEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      sendHello(client);
      sendSnapshot(client);
      break;
    case WStype_TEXT:
      onTextMessage(client, String((const char*)payload).substring(0, length));
      break;
    default:
      break;   // BIN / ERROR / PING etc. not used by our protocol yet.
  }
}

}  // namespace (file-private)

// -----------------------------------------------------------------------------
// ============================== PUBLIC API ==================================
// -----------------------------------------------------------------------------

void begin() {
  nodeId = makeNodeId();

  // 1) Wi-Fi (STA or AP fallback) + OSC UDP listener.
  Osc::handler.begin();
  // 2) On-device HTTP UI.
  Web::server.begin();
  // 3) WebSocket sync server, routed back through us for JSON dispatch.
  ws.begin();
  ws.onEvent(onWsEvent);

  started = true;
}

void update() {
  if (!started) return;
  Osc::handler.update();
  Web::server.update();
  ws.loop();
}

void broadcastIfDue(unsigned long nowMs) {
  if (!started) return;
  if (nowMs - lastBroadcastMs <= 1000) return;      // 1 Hz max
  lastBroadcastMs = nowMs;
  if (ws.connectedClients() == 0) return;
  broadcastState();
}

void broadcastState() {
  if (!started) return;

  // transport.state -- small; sent often.
  {
    StaticJsonDocument<512> doc;
    doc["type"]   = "transport.state";
    doc["sender"] = nodeId;
    doc["ts"]     = (uint32_t)millis();
    putTransport(doc.createNestedObject("payload"));
    sendDoc(0, doc, true);
  }
  // score.state -- larger; still cheap at ~1 Hz.
  {
    DynamicJsonDocument doc(32768);
    doc["type"]   = "score.state";
    doc["sender"] = nodeId;
    doc["ts"]     = (uint32_t)millis();
    JsonObject p  = doc.createNestedObject("payload");
    Score::grid.toJson(p.createNestedObject("score"));
    sendDoc(0, doc, true);
  }
}

}  // namespace Net
