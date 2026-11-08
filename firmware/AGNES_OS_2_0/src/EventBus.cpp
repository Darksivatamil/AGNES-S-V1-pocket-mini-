#include "EventBus.h"
#include "Config.h"

bool EventBus::begin() {
  queue_ = xQueueCreate(AGNES_QUEUE_MAX, sizeof(Event));
  return queue_ != nullptr;
}

bool EventBus::push(EventType type, uint8_t code, int32_t a, int32_t b) {
  if (!queue_) return false;
  Event event;
  event.type = type;
  event.code = code;
  event.a = a;
  event.b = b;
  event.at = millis();
  if (xQueueSend(queue_, &event, 0) != pdTRUE) {
    dropped_++;
    return false;
  }
  return true;
}

bool EventBus::pop(Event& event) {
  if (!queue_) return false;
  return xQueueReceive(queue_, &event, 0) == pdTRUE;
}

uint8_t EventBus::depth() const {
  return queue_ ? (uint8_t)uxQueueMessagesWaiting(queue_) : 0;
}
