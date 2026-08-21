#pragma once

#include <Adafruit_NeoMatrix.h>
#include <Adafruit_NeoPixel.h>

#include <array>

#include "cube_display_config.hpp"
#include "led_mapper.hpp"
#include "virtual_display.hpp"

namespace cube {

enum DisplayLayer : uint8_t {
  kLayerArmed = 0,
  kLayerHeads = 1,
  kLayerCursor = 2,
  kDisplayLayerCount = 3,
};

class DisplayManager {
 public:
  DisplayManager(uint8_t pin, uint8_t brightness);
  ~DisplayManager();

  void begin();
  void setBrightness(uint8_t brightness);

  LedMapper& mapper();

  uint8_t layerCount() const;
  VirtualDisplay& layer(uint8_t index);
  VirtualDisplay& layerArmed();
  VirtualDisplay& layerHeads();
  VirtualDisplay& layerCursor();

  void clearLayers();
  void clearLayer(uint8_t index);
  void composeAndShow();

  void scanRaw(uint16_t index, uint8_t r = 255, uint8_t g = 255, uint8_t b = 255);
  void scanMapped(uint8_t face, uint8_t x, uint8_t y, uint8_t r = 255, uint8_t g = 0, uint8_t b = 255);

 private:
  static uint8_t from5(uint8_t v5);
  static uint8_t from6(uint8_t v6);
  static void add565(uint16_t c, uint16_t& rr, uint16_t& gg, uint16_t& bb);
  static uint8_t clampByte(uint16_t v);

  void flushLayeredCanvas();

  Adafruit_NeoMatrix matrix_;
  LedMapper mapper_;
  std::array<VirtualDisplay*, kDisplayLayerCount> layers_{};
  uint8_t brightness_;
};

}  // namespace cube
