#pragma once
#include <Arduino.h>
#include <U8g2lib.h>
#include "Types.h"

class Face {
 public:
  void set(Emotion emotion, Animation animation, uint8_t intensity);
  void setEmotion(Emotion emotion);
  void setAnimation(Animation animation);
  Emotion emotion() const { return emotion_; }
  Animation animation() const { return animation_; }

  // Draws the face centered on (cx, cy). scale 1.0 uses ~46x34 px.
  void render(U8G2& g, int cx, int cy, float scale = 1.0f);

 private:
  Emotion emotion_ = Emotion::Normal;
  Animation animation_ = Animation::None;
  uint8_t intensity_ = 1;
  uint32_t startedAt_ = 0;

  void applyAnimation(int& offsetX, int& offsetY, bool& blink, U8G2& g, int cx, int cy, float scale);
  void drawEye(U8G2& g, int x, int y, int w, int h, uint8_t variant);
  void drawMouth(U8G2& g, int cx, int y, Emotion emotion);
  void drawBrows(U8G2& g, int leftX, int rightX, int y, Emotion emotion, int width);
};
