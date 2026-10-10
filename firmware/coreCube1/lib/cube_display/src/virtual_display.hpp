#pragma once

#include <Adafruit_GFX.h>

#include "cube_display_config.hpp"

namespace cube {

class VirtualDisplay : public GFXcanvas16 {
 public:
  VirtualDisplay(uint16_t width, uint16_t height);
  VirtualDisplay();

  void clear();
  void setPixelRgb(uint16_t x, uint16_t y, float r, float g, float b);
  void addPixelRgb(uint16_t x, uint16_t y, float r, float g, float b);
  void getPixelRgb(uint16_t x, uint16_t y, float& r, float& g, float& b) const;

  void set(uint8_t face, uint8_t x, uint8_t y, float r, float g, float b);
  void add(uint8_t face, uint8_t x, uint8_t y, float r, float g, float b);
  void get(uint8_t face, uint8_t x, uint8_t y, float& r, float& g, float& b) const;
  uint16_t color565(uint8_t face, uint8_t x, uint8_t y) const;

 private:
  static uint16_t rgb565(float r, float g, float b);
};

}  // namespace cube
