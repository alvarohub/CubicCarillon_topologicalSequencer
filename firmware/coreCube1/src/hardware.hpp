#pragma once

// =============================================================================
// hardware.hpp -- CoreS3 hardware boot (M5, display, external 5V rail).
// =============================================================================
// Called exactly once from setup(). Kept in its own module so the boot ritual
// (power ordering, display rotation, external rail enable) is visible in
// one place rather than smeared across main.cpp.
// =============================================================================

namespace Hw {

// Initialise the M5 stack: begin the M5 library, enable the external/Grove
// 5V rail via the PMIC (required BEFORE the WS2812 strip is initialised), set
// screen rotation and brightness. See config.hpp for the compile-time knobs.
void init();

}  // namespace Hw
