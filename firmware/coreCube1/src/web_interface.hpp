#pragma once

#include <Arduino.h>
#include <WebServer.h>

#include "config.hpp"
#include "osc_handler.hpp"

namespace cube {

class WebInterface {
 public:
  explicit WebInterface(OSCHandler& osc);

  bool begin();
  void update();
  bool running() const;

 private:
  OSCHandler& osc_;
  WebServer server_;
  bool running_ = false;
  bool routesConfigured_ = false;

  void ensureRoutes();
  void handleRoot();
  void handleCommand();
  void handleStatus();
  String buildPage() const;
};

}  // namespace cube

// -----------------------------------------------------------------------------
// Web:: -- singleton alias for the on-device web server.
// -----------------------------------------------------------------------------
namespace Web {
  extern cube::WebInterface server;
}
