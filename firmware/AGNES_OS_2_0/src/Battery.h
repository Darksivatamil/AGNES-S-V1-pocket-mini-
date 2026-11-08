#pragma once
#include <Arduino.h>
#include "Config.h"

class Battery {
 public:
  void begin();
  void update();
  uint16_t millivolts() const { return millivolts_; }
  uint8_t percent() const { return percent_; }
  bool low() const { return percent_ <= 10; }
  bool critical() const { return millivolts_ > 0 && millivolts_ < AGNES_BATTERY_LOW_MV; }

 private:
  uint16_t millivolts_ = 0;
  uint8_t percent_ = 0;
  uint32_t lastRead_ = 0;
  uint16_t readMillivolts();
};
