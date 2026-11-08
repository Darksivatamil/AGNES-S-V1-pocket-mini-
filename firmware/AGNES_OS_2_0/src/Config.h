#pragma once

// ---------------------------------------------------------------------------
// AGNES OS 2.0 build configuration
// Verify every hardware value against the actual board. See docs/HARDWARE.md.
// ---------------------------------------------------------------------------

#define AGNES_VERSION "2.0.0"
#define AGNES_BOARD "esp32-c3-super-mini"

// OLED: 0 = SSD1306 (default), 1 = SH1106. MUST be verified on the module.
#ifndef AGNES_OLED_SH1106
#define AGNES_OLED_SH1106 0
#endif
#ifndef AGNES_OLED_I2C_ADDRESS
#define AGNES_OLED_I2C_ADDRESS 0x3C  // 0x3D is also common
#endif

#define AGNES_PIN_I2C_SDA 4
#define AGNES_PIN_I2C_SCL 5
#define AGNES_PIN_BTN_PREV 6
#define AGNES_PIN_BTN_SELECT 7

// GPIO8 is a strapping pin and the onboard LED on many clones. The default is
// kept for the existing wiring. Recommended: move NEXT to GPIO10 and build with
// -DAGNES_BUTTON_NEXT_PIN=10 (verify GPIO10 is exposed on your clone).
#ifndef AGNES_BUTTON_NEXT_PIN
#define AGNES_BUTTON_NEXT_PIN 8
#endif
#define AGNES_PIN_BTN_NEXT AGNES_BUTTON_NEXT_PIN

#define AGNES_PIN_BATTERY_ADC 0
#define AGNES_BATTERY_DIVIDER_RATIO 2.0f
#define AGNES_BATTERY_CALIBRATION 1.0f
#define AGNES_BATTERY_EMPTY_MV 3300
#define AGNES_BATTERY_FULL_MV 4200
#define AGNES_BATTERY_LOW_MV 3450

// ---------------------------------------------------------------------------
// Cloud endpoints. Only the project URL is deployment-specific. No provider
// keys, service-role keys or database passwords belong in firmware.
// ---------------------------------------------------------------------------
#ifndef AGNES_SUPABASE_URL
#define AGNES_SUPABASE_URL "https://cvoiqoydjqmowhjewxle.supabase.co"
#endif

// Optional publishable/anon key. It is public by design; it is only sent as an
// `apikey` header for Supabase deployments that require one at the gateway.
// NEVER put a service_role key here.
#ifndef AGNES_SUPABASE_ANON_KEY
#define AGNES_SUPABASE_ANON_KEY "sb_publishable_R46rGIvdH5VlHnLmtZwK_Q_-mIDs2lV"
#endif

#define AGNES_FUNCTION_PAIR "/functions/v1/agnes-pair"
#define AGNES_FUNCTION_AUTH "/functions/v1/agnes-device-auth"
#define AGNES_FUNCTION_CHAT "/functions/v1/agnes-chat"
#define AGNES_FUNCTION_SYNC "/functions/v1/agnes-sync"
#define AGNES_FUNCTION_STATUS "/functions/v1/agnes-device-status"
#define AGNES_FUNCTION_TOOLS "/functions/v1/agnes-tools"

#define AGNES_HTTP_TIMEOUT_MS 30000
#define AGNES_HTTP_BODY_MAX 24576
#define AGNES_SYNC_REQUEST_MAX 8192
#define AGNES_NETWORK_STACK 16384
#define AGNES_NETWORK_TASK_PRIORITY 2

// ---------------------------------------------------------------------------
// UI / behaviour
// ---------------------------------------------------------------------------
#define AGNES_BUTTON_DEBOUNCE_MS 25
#define AGNES_LONG_PRESS_MS 700
#define AGNES_REPEAT_DELAY_MS 420
#define AGNES_REPEAT_RATE_MS 160
#define AGNES_IDLE_ANIMATION_MS 9000
#define AGNES_BRIGHTNESS_DEFAULT 160
#define AGNES_SLEEP_TIMEOUT_DEFAULT_S 120
#define AGNES_UI_FPS 30

#define AGNES_WIFI_CONNECT_TIMEOUT_MS 20000
#define AGNES_WIFI_BACKOFF_MIN_MS 2000
#define AGNES_WIFI_BACKOFF_MAX_MS 300000
#define AGNES_SYNC_INTERVAL_MS 60000
#define AGNES_STATUS_INTERVAL_MS 120000
#define AGNES_PROVISION_TIMEOUT_MS 600000

#define AGNES_QUEUE_MAX 32
#define AGNES_OFFLINE_QUEUE_MAX 24
#define AGNES_LOCAL_NOTES_MAX 20
#define AGNES_LOCAL_MEMORY_MAX 12
#define AGNES_MOOD_HISTORY_MAX 12
#define AGNES_CHAT_CACHE_MAX 8
#define AGNES_NOTIFICATION_CACHE_MAX 5
#define AGNES_NOTIFICATION_READ_MAX 20

#define AGNES_APP_COUNT 18

// Serial diagnostics. Set to 0 for release builds if desired.
#ifndef AGNES_DEBUG_SERIAL
#define AGNES_DEBUG_SERIAL 1
#endif

#if AGNES_DEBUG_SERIAL
#define AGNES_LOG(fmt, ...) Serial.printf("[AGNES] " fmt "\n", ##__VA_ARGS__)
#else
#define AGNES_LOG(fmt, ...) do {} while (0)
#endif
