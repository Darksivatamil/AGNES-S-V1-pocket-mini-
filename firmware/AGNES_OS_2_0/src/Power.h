#pragma once
#include <Arduino.h>

// ESP32-C3 note: deep sleep GPIO wake is limited on this chip; the firmware
// never relies on a button to leave deep sleep. Light sleep does wake from the
// three button GPIOs on this board.
class Power {
 public:
  void begin();
  void enterLightSleep(uint32_t durationMs);
  void enterDeepSleep(uint32_t seconds);
};
