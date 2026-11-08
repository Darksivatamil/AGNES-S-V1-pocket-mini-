#include "Types.h"
#include <string.h>

namespace {
struct NamePair {
  const char* name;
  uint8_t value;
};

const NamePair kEmotions[] = {
  {"normal", (uint8_t)Emotion::Normal},
  {"happy", (uint8_t)Emotion::Happy},
  {"excited", (uint8_t)Emotion::Excited},
  {"love", (uint8_t)Emotion::Love},
  {"angry", (uint8_t)Emotion::Angry},
  {"sad", (uint8_t)Emotion::Sad},
  {"sleepy", (uint8_t)Emotion::Sleepy},
  {"surprised", (uint8_t)Emotion::Surprised},
  {"thinking", (uint8_t)Emotion::Thinking},
  {"curious", (uint8_t)Emotion::Curious},
  {"shy", (uint8_t)Emotion::Shy},
  {"cool", (uint8_t)Emotion::Cool},
  {"confused", (uint8_t)Emotion::Confused},
  {"concerned", (uint8_t)Emotion::Concerned},
  {"playful", (uint8_t)Emotion::Playful},
};

const NamePair kAnimations[] = {
  {"none", (uint8_t)Animation::None},
  {"blink", (uint8_t)Animation::Blink},
  {"bounce", (uint8_t)Animation::Bounce},
  {"sway", (uint8_t)Animation::Sway},
  {"sparkle", (uint8_t)Animation::Sparkle},
  {"shake", (uint8_t)Animation::Shake},
  {"float", (uint8_t)Animation::Float},
};

const NamePair kPersonalities[] = {
  {"friendly", (uint8_t)Personality::Friendly},
  {"genius", (uint8_t)Personality::Genius},
  {"savage", (uint8_t)Personality::Savage},
  {"shy", (uint8_t)Personality::Shy},
  {"sleepy", (uint8_t)Personality::Sleepy},
};
}

const char* emotionName(Emotion emotion) {
  for (const auto& item : kEmotions) {
    if (item.value == (uint8_t)emotion) return item.name;
  }
  return "normal";
}

const char* animationName(Animation animation) {
  for (const auto& item : kAnimations) {
    if (item.value == (uint8_t)animation) return item.name;
  }
  return "none";
}

const char* personalityName(Personality personality) {
  for (const auto& item : kPersonalities) {
    if (item.value == (uint8_t)personality) return item.name;
  }
  return "friendly";
}

Emotion emotionFromString(const char* value) {
  if (!value) return Emotion::Normal;
  for (const auto& item : kEmotions) {
    if (strcasecmp(item.name, value) == 0) return (Emotion)item.value;
  }
  return Emotion::Normal;
}

Animation animationFromString(const char* value) {
  if (!value) return Animation::None;
  for (const auto& item : kAnimations) {
    if (strcasecmp(item.name, value) == 0) return (Animation)item.value;
  }
  return Animation::None;
}

Personality personalityFromString(const char* value) {
  if (!value) return Personality::Friendly;
  for (const auto& item : kPersonalities) {
    if (strcasecmp(item.name, value) == 0) return (Personality)item.value;
  }
  return Personality::Friendly;
}

const char* personalityDisplayName(Personality personality) {
  switch (personality) {
    case Personality::Friendly: return "Friendly";
    case Personality::Genius: return "Genius";
    case Personality::Savage: return "Savage";
    case Personality::Shy: return "Shy";
    case Personality::Sleepy: return "Sleepy";
    default: return "Friendly";
  }
}
