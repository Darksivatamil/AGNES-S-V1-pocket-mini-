#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Storage.h"

class MoodEngine {
 public:
  void begin(Storage& storage);
  void set(Emotion emotion, uint8_t intensity = 1, bool record = true);
  void applyDelta(int8_t delta);
  Emotion current() const { return emotion_; }
  uint8_t intensity() const { return intensity_; }
  const MoodEntry* history() const { return history_; }
  uint8_t historyCount() const { return historyCount_; }
  void clearHistory();

 private:
  Storage* storage_ = nullptr;
  Emotion emotion_ = Emotion::Normal;
  uint8_t intensity_ = 1;
  MoodEntry history_[AGNES_MOOD_HISTORY_MAX];
  uint8_t historyCount_ = 0;

  void record(Emotion emotion);
};
