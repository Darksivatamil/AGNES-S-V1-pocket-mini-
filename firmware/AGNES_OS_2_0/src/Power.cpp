#include "Power.h"
#include "Config.h"

#include <driver/gpio.h>
#include <esp_sleep.h>

void Power::begin() {
  // Nothing to initialize; kept for symmetry with the other modules.
}

void Power::enterLightSleep(uint32_t durationMs) {
  if (durationMs < 10) durationMs = 10;
  gpio_wakeup_enable((gpio_num_t)AGNES_PIN_BTN_PREV, GPIO_INTR_LOW_LEVEL);
  gpio_wakeup_enable((gpio_num_t)AGNES_PIN_BTN_SELECT, GPIO_INTR_LOW_LEVEL);
  gpio_wakeup_enable((gpio_num_t)AGNES_PIN_BTN_NEXT, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  esp_sleep_enable_timer_wakeup((uint64_t)durationMs * 1000ULL);
  esp_light_sleep_start();
  gpio_wakeup_disable((gpio_num_t)AGNES_PIN_BTN_PREV);
  gpio_wakeup_disable((gpio_num_t)AGNES_PIN_BTN_SELECT);
  gpio_wakeup_disable((gpio_num_t)AGNES_PIN_BTN_NEXT);
}

void Power::enterDeepSleep(uint32_t seconds) {
  if (seconds < 60) seconds = 60;
  // On ESP32-C3 the button GPIOs (6/7/8) are not RTC GPIOs, so timer wake is
  // the only reliable wake source. A reset or power cycle also wakes the board.
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
}
