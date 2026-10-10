#include "led_renderer.hpp"

namespace cube {

LedRenderer::LedRenderer(const uint8_t pin, const uint8_t brightness) : display_(pin, brightness) {}

void LedRenderer::begin() { display_.begin(); }

void LedRenderer::setBrightness(const uint8_t brightness) { display_.setBrightness(brightness); }

LedMapper& LedRenderer::mapper() { return display_.mapper(); }

void LedRenderer::render(const ScoreGrid& score, const HeadEngine& heads, const TransportState& tr, const uint32_t nowMs) {
  display_.clearLayers();
  VirtualDisplay& armed = display_.layerArmed();
  VirtualDisplay& headMarks = display_.layerHeads();
  VirtualDisplay& cursor = display_.layerCursor();

  // Armed cells in warm amber (brightness reflects saved velocity).
  for (uint8_t face = 1; face <= kFaceCount; ++face) {
    for (uint8_t y = 0; y < kFaceCells; ++y) {
      for (uint8_t x = 0; x < kFaceCells; ++x) {
        const float v01 = score.velocity01(face, x, y);
        if (v01 <= 0.0f) continue;
        const uint8_t v = (uint8_t)(v01 * 255.0f);
        const uint8_t r = v;
        const uint8_t g = (uint8_t)((uint16_t)v * 170u / 255u);
        const uint8_t b = (uint8_t)((uint16_t)v * 40u / 255u);
        armed.set(face, x, y, r, g, b);
      }
    }
  }

  // Moving heads as cool markers.
  for (const auto& h : heads.heads()) headMarks.add(h.face, h.x, h.y, h.r, h.g, h.b);

  // Beat cursor for visual transport feedback.
  const float bpm = tr.bpm < 20.0f ? 20.0f : (tr.bpm > 400.0f ? 400.0f : tr.bpm);
  const float beatMs = 60000.0f / bpm;
  const uint8_t step = (uint8_t)(((uint32_t)(nowMs / beatMs)) % kFaceCells);
  const uint8_t pulse = tr.paused ? 70 : ((((nowMs / 130) % 2) == 0) ? 255 : 130);
  for (uint8_t face = 1; face <= kFaceCount; ++face) {
    cursor.add(face, step, (uint8_t)((face - 1) % kFaceCells), 20, pulse, 255);
  }

  display_.composeAndShow();
}

void LedRenderer::scanRaw(const uint16_t index, const uint8_t r, const uint8_t g, const uint8_t b) {
  display_.scanRaw(index, r, g, b);
}

void LedRenderer::scanMapped(const uint8_t face, const uint8_t x, const uint8_t y, const uint8_t r, const uint8_t g,
                             const uint8_t b) {
  display_.scanMapped(face, x, y, r, g, b);
}

}  // namespace cube
