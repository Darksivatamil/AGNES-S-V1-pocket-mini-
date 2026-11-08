#include "Battery.h"
#include "Config.h"
#include "Util.h"

namespace {
uint8_t voltageToPercent(uint16_t mv) {
  struct Point { uint16_t mv; uint8_t percent; };
  static const Point curve[] = {
    {3300, 0}, {3450, 5}, {3550, 12}, {3650, 25}, {3700, 40},
    {3750, 52}, {3800, 63}, {3900, 78}, {4000, 88}, {4100, 96}, {4200, 100},
  };
  if (mv <= curve[0].mv) return 0;
  if (mv >= curve[10].mv) return 100;
  for (uint8_t i = 1; i < 11; ++i) {
    if (mv <= curve[i].mv) {
      uint16_t lowMv = curve[i - 1].mv;
      uint16_t span = curve[i].mv - lowMv;
      uint8_t lowPct = curve[i - 1].percent;
      uint8_t highPct = curve[i].percent;
      return (uint8_t)(lowPct + (uint32_t)(mv - lowMv) * (highPct - lowPct) / span);
    }
  }
  return 100;
}
}

void Battery::begin() {
  analogReadResolution(12);
  analogSetPinAttenuation(AGNES_PIN_BATTERY_ADC, ADC_11db);
  update();
}

uint16_t Battery::readMillivolts() {
  uint16_t samples[7];
  for (uint8_t i = 0; i < 7; ++i) {
    uint32_t mv = analogReadMilliVolts(AGNES_PIN_BATTERY_ADC);
    samples[i] = (uint16_t)(mv > 4095 ? 4095 : mv);
    delay(2);
  }
  // Insertion sort; seven samples is cheap and avoids a dynamic allocation.
  for (uint8_t i = 1; i < 7; ++i) {
    uint16_t value = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > value) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = value;
  }
  float pinMv = (float)samples[3];
  float packMv = pinMv * AGNES_BATTERY_DIVIDER_RATIO * AGNES_BATTERY_CALIBRATION;
  if (packMv < 0) packMv = 0;
  if (packMv > 5000) packMv = 5000;
  return (uint16_t)packMv;
}

void Battery::update() {
  uint32_t now = millis();
  if (lastRead_ != 0 && (uint32_t)(now - lastRead_) < 2000) return;
  lastRead_ = now;
  millivolts_ = readMillivolts();
  percent_ = voltageToPercent(millivolts_);
}
