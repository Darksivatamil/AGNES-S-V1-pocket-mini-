#pragma once
#include <Arduino.h>
#include "Types.h"

// Fixed-size queue shared by the UI loop, buttons and the network worker.
// No pointers cross tasks.
class EventBus {
 public:
  bool begin();
  bool push(EventType type, uint8_t code = 0, int32_t a = 0, int32_t b = 0);
  bool pop(Event& event);
  uint32_t dropped() const { return dropped_; }
  uint8_t depth() const;

 private:
  QueueHandle_t queue_ = nullptr;
  uint32_t dropped_ = 0;
};
