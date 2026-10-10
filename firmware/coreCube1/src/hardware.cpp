// =============================================================================
// hardware.cpp -- CoreS3 hardware boot (M5, display, external 5V rail).
// =============================================================================

#include "hardware.hpp"

#include <M5Unified.h>

#include "config.hpp"

namespace Hw {

void init() {
  // Ask M5Unified to enable the external 5V output at boot.
  auto cfg = M5.config();
  cfg.output_power = cube::kExternalPowerOutput;
  M5.begin(cfg);

  // Belt-and-braces: also force the PMIC line explicitly. On some CoreS3
  // firmware versions M5.begin() does not act on `output_power`, so we
  // do it directly. This MUST happen BEFORE the LED strip is initialised.
  M5.Power.setExtOutput(cube::kExternalPowerOutput);

  // LCD orientation and brightness. Rotation 1 puts the USB port on the left,
  // which matches the touch-button layout drawn by Hud::draw().
  M5.Display.setRotation(1);
  M5.Display.setBrightness(90);
}

}  // namespace Hw
