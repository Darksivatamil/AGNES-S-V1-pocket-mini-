#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Storage.h"

class PetEngine {
 public:
  void begin(Storage& storage);
  void adopt(const PetState& state);
  void decay(uint32_t nowEpoch);
  bool interact(const char* type, char* eventIdOut, size_t capacity, uint32_t nowEpoch);
  bool canInteract(const char* type, uint16_t* remainingSeconds) const;

  const PetState& state() const { return pet_; }
  PetState& state() { return pet_; }

  uint8_t pendingEventCount() const { return queueCount_; }
  uint8_t pendingEvents(PendingPetEvent* out, uint8_t maxCount) const;
  void clearPendingEvents(uint8_t sentCount);
  void save();

 private:
  Storage* storage_ = nullptr;
  PetState pet_;
  PendingPetEvent queue_[AGNES_OFFLINE_QUEUE_MAX];
  uint8_t queueCount_ = 0;
  uint32_t cooldownUntilMs_[4] = {0, 0, 0, 0};
  uint32_t lastDecaySaveMs_ = 0;

  static int typeIndex(const char* type);
  static uint32_t cooldownMs(const char* type);
  static uint32_t levelForXp(uint32_t xp);
  static const char* stageForLevel(uint8_t level);
  void enqueue(const char* id, const char* type);
};
