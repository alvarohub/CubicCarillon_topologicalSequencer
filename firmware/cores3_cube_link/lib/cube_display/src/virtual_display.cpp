#include "virtual_display.hpp"

namespace cube {

VirtualDisplay::VirtualDisplay(const uint16_t width, const uint16_t height) : GFXcanvas16(width, height) { clear(); }

VirtualDisplay::VirtualDisplay() : VirtualDisplay(kFaceCells * kFaceCount, kFaceCells) {}

void VirtualDisplay::clear() { fillScreen(0); }

void VirtualDisplay::setPixelRgb(const uint16_t x, const uint16_t y, const float r, const float g, const float b) {
  if (x >= width() || y >= height()) return;
  drawPixel(x, y, rgb565(r, g, b));
}

void VirtualDisplay::addPixelRgb(const uint16_t x, const uint16_t y, const float r, const float g, const float b) {
  if (x >= width() || y >= height()) return;
  float rr = 0, gg = 0, bb = 0;
  getPixelRgb(x, y, rr, gg, bb);
  drawPixel(x, y, rgb565(rr + r, gg + g, bb + b));
}

void VirtualDisplay::getPixelRgb(const uint16_t x, const uint16_t y, float& r, float& g, float& b) const {
  if (x >= width() || y >= height()) {
    r = g = b = 0.0f;
    return;
  }
  const uint16_t c = getPixel(x, y);
  r = (float)((c >> 11) & 0x1F) * 255.0f / 31.0f;
  g = (float)((c >> 5) & 0x3F) * 255.0f / 63.0f;
  b = (float)(c & 0x1F) * 255.0f / 31.0f;
}

void VirtualDisplay::set(const uint8_t face, const uint8_t x, const uint8_t y, const float r, const float g, const float b) {
  if (!validFace(face) || !validCoord(x, y)) return;
  setPixelRgb((uint16_t)(face - 1) * kFaceCells + x, y, r, g, b);
}

void VirtualDisplay::add(const uint8_t face, const uint8_t x, const uint8_t y, const float r, const float g, const float b) {
  if (!validFace(face) || !validCoord(x, y)) return;
  addPixelRgb((uint16_t)(face - 1) * kFaceCells + x, y, r, g, b);
}

void VirtualDisplay::get(const uint8_t face, const uint8_t x, const uint8_t y, float& r, float& g, float& b) const {
  if (!validFace(face) || !validCoord(x, y)) {
    r = g = b = 0.0f;
    return;
  }
  getPixelRgb((uint16_t)(face - 1) * kFaceCells + x, y, r, g, b);
}

uint16_t VirtualDisplay::color565(const uint8_t face, const uint8_t x, const uint8_t y) const {
  if (!validFace(face) || !validCoord(x, y)) return 0;
  return getPixel((face - 1) * kFaceCells + x, y);
}

uint16_t VirtualDisplay::rgb565(const float r, const float g, const float b) {
  const uint8_t rr = (uint8_t)(r < 0 ? 0 : (r > 255 ? 255 : r));
  const uint8_t gg = (uint8_t)(g < 0 ? 0 : (g > 255 ? 255 : g));
  const uint8_t bb = (uint8_t)(b < 0 ? 0 : (b > 255 ? 255 : b));
  return ((rr & 0xF8) << 8) | ((gg & 0xFC) << 3) | (bb >> 3);
}

}  // namespace cube
