#pragma once
#include <Arduino.h>
#include "Types.h"

class Buttons {
 public:
  bool begin();
  // Returns one queued logical button event at a time.
  bool poll(ButtonEvent& out);
  bool rawPressed(ButtonId id) const;

 private:
  struct State {
    uint8_t pin = 0;
    bool stable = false;
    bool reading = false;
    uint32_t changedAt = 0;
    uint32_t pressedAt = 0;
    uint32_t nextRepeatAt = 0;
    bool longSent = false;
  };

  State states_[3];
};
