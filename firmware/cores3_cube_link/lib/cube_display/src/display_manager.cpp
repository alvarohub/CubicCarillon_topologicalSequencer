#include "display_manager.hpp"

namespace cube {

DisplayManager::DisplayManager(const uint8_t pin, const uint8_t brightness)
  : matrix_(kFaceCells, kFaceCells, kFaceCount, 1, pin, CUBE_MATRIX_LAYOUT, CUBE_NEOPIXEL_TYPE),
    brightness_(brightness) {
  for (uint8_t i = 0; i < kDisplayLayerCount; ++i) {
    layers_[i] = new VirtualDisplay(kFaceCells * kFaceCount, kFaceCells);
  }
}

DisplayManager::~DisplayManager() {
  for (VirtualDisplay* layer : layers_) {
    delete layer;
  }
}

void DisplayManager::begin() {
  matrix_.begin();
  matrix_.setBrightness(brightness_);
  matrix_.fillScreen(0);
  matrix_.show();
}

void DisplayManager::setBrightness(const uint8_t brightness) {
  brightness_ = brightness;
  matrix_.setBrightness(brightness_);
}

LedMapper& DisplayManager::mapper() { return mapper_; }

uint8_t DisplayManager::layerCount() const { return kDisplayLayerCount; }

VirtualDisplay& DisplayManager::layer(const uint8_t index) {
  return *layers_[index < kDisplayLayerCount ? index : 0];
}

VirtualDisplay& DisplayManager::layerArmed() { return layer(kLayerArmed); }
VirtualDisplay& DisplayManager::layerHeads() { return layer(kLayerHeads); }
VirtualDisplay& DisplayManager::layerCursor() { return layer(kLayerCursor); }

void DisplayManager::clearLayers() {
  for (VirtualDisplay* layer : layers_) {
    layer->clear();
  }
}

void DisplayManager::clearLayer(const uint8_t index) {
  if (index >= kDisplayLayerCount) return;
  layers_[index]->clear();
}

void DisplayManager::composeAndShow() {
  matrix_.fillScreen(0);
  flushLayeredCanvas();
  matrix_.show();
}

void DisplayManager::scanRaw(const uint16_t index, const uint8_t r, const uint8_t g, const uint8_t b) {
  matrix_.fillScreen(0);
  if (index < kTotalLeds) matrix_.setPixelColor(index, r, g, b);
  matrix_.show();
}

void DisplayManager::scanMapped(
    const uint8_t face, const uint8_t x, const uint8_t y, const uint8_t r, const uint8_t g, const uint8_t b) {
  matrix_.fillScreen(0);
  uint16_t logicalX = 0;
  uint16_t logicalY = 0;
  if (mapper_.mapLogical(face, x, y, logicalX, logicalY)) matrix_.drawPixel(logicalX, logicalY, matrix_.Color(r, g, b));
  matrix_.show();
}

uint8_t DisplayManager::from5(const uint8_t v5) { return (uint8_t)(v5 * 255u / 31u); }
uint8_t DisplayManager::from6(const uint8_t v6) { return (uint8_t)(v6 * 255u / 63u); }

void DisplayManager::add565(const uint16_t c, uint16_t& rr, uint16_t& gg, uint16_t& bb) {
  rr += from5((uint8_t)((c >> 11) & 0x1F));
  gg += from6((uint8_t)((c >> 5) & 0x3F));
  bb += from5((uint8_t)(c & 0x1F));
}

uint8_t DisplayManager::clampByte(const uint16_t v) { return (uint8_t)(v > 255 ? 255 : v); }

void DisplayManager::flushLayeredCanvas() {
  // Local chart pixels are converted in two stages:
  // 1. LedMapper places a cube face chart into the global chart atlas.
  // 2. Adafruit_NeoMatrix maps that rectangular chart atlas to the physical strip.
  // TODO(manifold-display): replace the fixed 6-face atlas with explicit Chart,
  // Transition, and EmitterMap objects once the cube hardware is stable.
  for (uint8_t face = 1; face <= kFaceCount; ++face) {
    for (uint8_t y = 0; y < kFaceCells; ++y) {
      for (uint8_t x = 0; x < kFaceCells; ++x) {
        uint16_t logicalX = 0;
        uint16_t logicalY = 0;
        if (!mapper_.mapLogical(face, x, y, logicalX, logicalY)) continue;

        uint16_t rr = 0, gg = 0, bb = 0;
        for (VirtualDisplay* layer : layers_) {
          add565(layer->color565(face, x, y), rr, gg, bb);
        }

        matrix_.drawPixel(logicalX, logicalY, matrix_.Color(clampByte(rr), clampByte(gg), clampByte(bb)));
      }
    }
  }
}

}  // namespace cube
