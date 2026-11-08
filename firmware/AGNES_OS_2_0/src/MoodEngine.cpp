#include "MoodEngine.h"
#include "Util.h"

namespace {
int moodLevel(Emotion emotion) {
  switch (emotion) {
    case Emotion::Sad: return -3;
    case Emotion::Angry:
    case Emotion::Concerned: return -2;
    case Emotion::Sleepy:
    case Emotion::Confused: return -1;
    case Emotion::Normal:
    case Emotion::Thinking:
    case Emotion::Shy: return 0;
    case Emotion::Curious:
    case Emotion::Surprised:
    case Emotion::Cool: return 1;
    case Emotion::Happy: return 2;
    case Emotion::Playful: return 3;
    case Emotion::Excited:
    case Emotion::Love: return 4;
    default: return 0;
  }
}

Emotion emotionForLevel(int level) {
  if (level <= -3) return Emotion::Sad;
  if (level == -2) return Emotion::Concerned;
  if (level == -1) return Emotion::Confused;
  if (level == 0) return Emotion::Normal;
  if (level == 1) return Emotion::Curious;
  if (level == 2) return Emotion::Happy;
  if (level == 3) return Emotion::Playful;
  return Emotion::Excited;
}
}

void MoodEngine::begin(Storage& storage) {
  storage_ = &storage;
  historyCount_ = storage.loadMoods(history_, AGNES_MOOD_HISTORY_MAX);
  if (historyCount_ > 0 && history_[0].emotion < (uint8_t)Emotion::Count) {
    emotion_ = (Emotion)history_[0].emotion;
  }
}

void MoodEngine::record(Emotion emotion) {
  if (historyCount_ > 0 && history_[0].emotion == (uint8_t)emotion) return;
  for (int i = AGNES_MOOD_HISTORY_MAX - 1; i > 0; --i) {
    history_[i] = history_[i - 1];
  }
  history_[0].emotion = (uint8_t)emotion;
  history_[0].at = AgnesUtil::nowEpoch();
  if (historyCount_ < AGNES_MOOD_HISTORY_MAX) historyCount_++;
  if (storage_) storage_->saveMoods(history_, historyCount_);
}

void MoodEngine::set(Emotion emotion, uint8_t intensity, bool save) {
  if (emotion >= Emotion::Count) emotion = Emotion::Normal;
  intensity_ = AgnesUtil::clampU8(intensity);
  if (intensity_ < 1) intensity_ = 1;
  if (intensity_ > 3) intensity_ = 3;
  emotion_ = emotion;
  if (save) record(emotion);
}

void MoodEngine::applyDelta(int8_t delta) {
  if (delta == 0) return;
  int level = moodLevel(emotion_) + delta;
  if (level > 4) level = 4;
  if (level < -3) level = -3;
  set(emotionForLevel(level), intensity_);
}

void MoodEngine::clearHistory() {
  historyCount_ = 0;
  if (storage_) storage_->saveMoods(history_, 0);
}
