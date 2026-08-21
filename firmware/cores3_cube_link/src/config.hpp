#pragma once

#include <stdint.h>

#include <cube_display_config.hpp>

// Low-level LED chart mapping lives in lib/cube_display/src/cube_display_config.hpp:
// CUBE_NEOPIXEL_TYPE selects the WS2812 colour/order protocol, and
// CUBE_MATRIX_LAYOUT selects the Adafruit_NeoMatrix local 8x8 chart wiring.
// This file keeps app/runtime defaults; the display library owns chart hardware defaults.

#ifndef CUBE_LED_PIN
// CoreS3 header label G1 -> GPIO1
#define CUBE_LED_PIN 1
#endif

#ifndef CUBE_LED_BRIGHTNESS
#define CUBE_LED_BRIGHTNESS 12
#endif

#ifndef CUBE_EXTERNAL_POWER_OUTPUT
#define CUBE_EXTERNAL_POWER_OUTPUT 1
#endif

// Render mode: 0 = sequencer rendering, 1 = raw chain scan test,
// 2 = mapped face scan test.
#ifndef CUBE_RENDER_MODE
#define CUBE_RENDER_MODE 1
#endif

#ifndef CUBE_SCAN_DELAY_MS
#define CUBE_SCAN_DELAY_MS 80
#endif

#ifndef CUBE_LED_DIAG_QUIET_MODE
#define CUBE_LED_DIAG_QUIET_MODE 1
#endif

#ifndef CUBE_HUD_REFRESH_MS
#define CUBE_HUD_REFRESH_MS 0
#endif

#ifndef CUBE_BOOT_SCAN_ENABLED
#define CUBE_BOOT_SCAN_ENABLED 1
#endif

#ifndef CUBE_BOOT_SCAN_DELAY_MS
#define CUBE_BOOT_SCAN_DELAY_MS 25
#endif

#ifndef CUBE_BOOT_SCAN_RAW
#define CUBE_BOOT_SCAN_RAW 1
#endif

#ifndef CUBE_BOOT_SCAN_MAPPED
#define CUBE_BOOT_SCAN_MAPPED 0
#endif

#define CUBE_WIFI_MODE_OFF 0
#define CUBE_WIFI_MODE_STATION 1
#define CUBE_WIFI_MODE_AP 2

#ifndef CUBE_WIFI_MODE
#define CUBE_WIFI_MODE CUBE_WIFI_MODE_AP
#endif

#ifndef CUBE_WIFI_CONNECT_TIMEOUT_MS
#define CUBE_WIFI_CONNECT_TIMEOUT_MS 15000
#endif

#ifndef CUBE_AP_SSID
#define CUBE_AP_SSID "CubeCarillon"
#endif

#ifndef CUBE_AP_PASS
#define CUBE_AP_PASS "cube1234"
#endif

#ifndef CUBE_OSC_PORT
#define CUBE_OSC_PORT 9000
#endif

#ifndef CUBE_WEB_PORT
#define CUBE_WEB_PORT 80
#endif

#ifndef CUBE_WS_PORT
#define CUBE_WS_PORT 8787
#endif

namespace cube {

constexpr uint8_t kLedPin = CUBE_LED_PIN;
constexpr uint8_t kLedBrightness = CUBE_LED_BRIGHTNESS;
constexpr bool kExternalPowerOutput = CUBE_EXTERNAL_POWER_OUTPUT != 0;
constexpr uint8_t kRenderMode = CUBE_RENDER_MODE;
constexpr uint16_t kScanDelayMs = CUBE_SCAN_DELAY_MS;
constexpr bool kLedDiagQuietMode = CUBE_LED_DIAG_QUIET_MODE != 0;
constexpr uint16_t kHudRefreshMs = CUBE_HUD_REFRESH_MS;
constexpr bool kBootScanEnabled = CUBE_BOOT_SCAN_ENABLED != 0;
constexpr uint16_t kBootScanDelayMs = CUBE_BOOT_SCAN_DELAY_MS;
constexpr bool kBootScanRaw = CUBE_BOOT_SCAN_RAW != 0;
constexpr bool kBootScanMapped = CUBE_BOOT_SCAN_MAPPED != 0;
constexpr uint16_t kOscPort = CUBE_OSC_PORT;
constexpr uint16_t kWebPort = CUBE_WEB_PORT;
constexpr uint16_t kWsPort = CUBE_WS_PORT;

}  // namespace cube
