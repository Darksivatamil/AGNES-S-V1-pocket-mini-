#include "Face.h"
#include "Util.h"
#include <math.h>

namespace {
void thickLine(U8G2& g, int x1, int y1, int x2, int y2) {
  g.drawLine(x1, y1, x2, y2);
  g.drawLine(x1, y1 + 1, x2, y2 + 1);
}

void plus(U8G2& g, int x, int y, int size) {
  g.drawHLine(x - size, y, size * 2 + 1);
  g.drawVLine(x, y - size, size * 2 + 1);
}
}

void Face::set(Emotion emotion, Animation animation, uint8_t intensity) {
  if (emotion != emotion_ || animation != animation_) startedAt_ = millis();
  emotion_ = emotion;
  animation_ = animation;
  intensity_ = AgnesUtil::clampU8(intensity);
  if (intensity_ < 1) intensity_ = 1;
  if (intensity_ > 3) intensity_ = 3;
}

void Face::setEmotion(Emotion emotion) {
  set(emotion, animation_, intensity_);
}

void Face::setAnimation(Animation animation) {
  set(emotion_, animation, intensity_);
}

void Face::applyAnimation(int& offsetX, int& offsetY, bool& blink, U8G2& g,
                          int cx, int cy, float scale) {
  offsetX = 0;
  offsetY = 0;
  blink = false;
  uint32_t now = millis();
  float amplitude = (float)intensity_;

  switch (animation_) {
    case Animation::Blink: {
      uint32_t phase = (now - startedAt_) % 4200;
      blink = phase < 130;
      break;
    }
    case Animation::Bounce: {
      float phase = (float)((now - startedAt_) % 1200) / 1200.0f;
      offsetY = -(int)(fabsf(sinf(phase * 3.1415926f)) * 2.5f * amplitude);
      break;
    }
    case Animation::Sway: {
      float phase = (float)((now - startedAt_) % 1800) / 1800.0f;
      offsetX = (int)(sinf(phase * 6.2831853f) * 3.0f * amplitude);
      break;
    }
    case Animation::Shake: {
      uint32_t phase = (now - startedAt_) % 500;
      offsetX = (phase < 80 || (phase > 180 && phase < 260)) ? (int)amplitude : -(int)amplitude;
      break;
    }
    case Animation::Float: {
      float phase = (float)((now - startedAt_) % 2400) / 2400.0f;
      offsetY = (int)(sinf(phase * 6.2831853f) * 2.0f);
      break;
    }
    case Animation::Sparkle: {
      uint32_t phase = (now / 240) % 4;
      if (phase != 3) {
        plus(g, cx - 38, cy - 16, 2);
        plus(g, cx + 36, cy - 9, 1 + (int)amplitude);
        plus(g, cx + 24, cy + 17, 2);
      }
      break;
    }
    case Animation::None:
    default:
      break;
  }

  // Gentle breathing even without an explicit animation.
  if (animation_ == Animation::None) {
    float phase = (float)(now % 5200) / 5200.0f;
    offsetY = (int)(sinf(phase * 6.2831853f) * 0.9f);
  }

  if (emotion_ == Emotion::Sleepy) blink = ((now / 2600) % 4) != 0;
  if (emotion_ == Emotion::Excited) {
    float phase = (float)(now % 900) / 900.0f;
    offsetY -= (int)(fabsf(sinf(phase * 3.1415926f)) * 1.5f);
  }
}

void Face::drawEye(U8G2& g, int x, int y, int w, int h, uint8_t variant) {
  if (w < 2) w = 2;
  if (h < 2) h = 2;
  g.setDrawColor(1);
  switch (variant) {
    case 1:  // blink
      g.drawRBox(x + 1, y + h / 2 - 1, w - 2, 3, 1);
      break;
    case 2: {  // heart
      int cx = x + w / 2;
      int cy = y + h / 2;
      int r = w / 5;
      g.drawDisc(cx - r, cy - r / 2, r);
      g.drawDisc(cx + r, cy - r / 2, r);
      g.drawTriangle(cx - 2 * r, cy - r / 3, cx + 2 * r, cy - r / 3, cx, cy + h / 3);
      break;
    }
    case 3:  // half-lidded
      g.drawRBox(x, y + h / 2, w, h / 2, 2);
      g.drawHLine(x + 1, y + h / 2, w - 2);
      break;
    case 4: {  // big disc with highlight
      int r = (w < h ? w : h) / 2;
      int cx = x + w / 2;
      int cy = y + h / 2;
      g.drawDisc(cx, cy, r);
      g.setDrawColor(0);
      g.drawDisc(cx + r / 3, cy - r / 3, r / 3);
      g.setDrawColor(1);
      break;
    }
    case 5:  // narrow
      g.drawRBox(x, y + h / 3, w, h / 2 + 1, 2);
      break;
    case 6:  // small
      g.drawRBox(x + w / 4, y + h / 4, w / 2, h / 2, 2);
      break;
    case 0:
    default:
      g.drawRBox(x, y, w, h, 4);
      g.setDrawColor(0);
      g.drawDisc(x + w / 3, y + h / 3, (w < h ? w : h) / 8 + 1);
      g.setDrawColor(1);
      break;
  }
}

void Face::drawBrows(U8G2& g, int leftX, int rightX, int y, Emotion emotion, int width) {
  if (emotion != Emotion::Angry && emotion != Emotion::Sad && emotion != Emotion::Concerned &&
      emotion != Emotion::Thinking && emotion != Emotion::Confused) {
    return;
  }
  g.setDrawColor(1);
  if (emotion == Emotion::Angry) {
    thickLine(g, leftX, y + 2, leftX + width, y);
    thickLine(g, rightX, y, rightX + width, y + 2);
  } else if (emotion == Emotion::Sad || emotion == Emotion::Concerned) {
    thickLine(g, leftX, y, leftX + width, y + 2);
    thickLine(g, rightX, y + 2, rightX + width, y);
  } else if (emotion == Emotion::Thinking) {
    thickLine(g, leftX, y + 1, leftX + width, y + 2);
  } else if (emotion == Emotion::Confused) {
    thickLine(g, leftX, y, leftX + width, y + 2);
    thickLine(g, rightX, y + 3, rightX + width, y + 1);
  }
}

void Face::drawMouth(U8G2& g, int cx, int y, Emotion emotion) {
  g.setDrawColor(1);
  switch (emotion) {
    case Emotion::Happy:
    case Emotion::Excited:
    case Emotion::Love:
    case Emotion::Playful:
    case Emotion::Shy:
      g.drawLine(cx - 5, y, cx - 2, y + 3);
      g.drawLine(cx - 2, y + 3, cx + 2, y + 3);
      g.drawLine(cx + 2, y + 3, cx + 5, y);
      break;
    case Emotion::Sad:
    case Emotion::Concerned:
      g.drawLine(cx - 5, y + 3, cx - 2, y);
      g.drawLine(cx - 2, y, cx + 2, y);
      g.drawLine(cx + 2, y, cx + 5, y + 3);
      break;
    case Emotion::Angry:
      g.drawLine(cx - 5, y + 2, cx + 5, y + 2);
      g.drawLine(cx - 2, y, cx - 2, y + 2);
      g.drawLine(cx + 2, y, cx + 2, y + 2);
      break;
    case Emotion::Surprised:
      g.drawCircle(cx, y + 1, 3);
      break;
    case Emotion::Sleepy:
      g.drawLine(cx - 3, y + 1, cx + 3, y + 1);
      break;
    case Emotion::Confused:
      g.drawLine(cx - 5, y + 2, cx - 2, y);
      g.drawLine(cx - 2, y, cx + 2, y + 2);
      g.drawLine(cx + 2, y + 2, cx + 5, y);
      break;
    case Emotion::Thinking:
      g.drawLine(cx - 3, y + 1, cx + 2, y + 1);
      break;
    default:
      g.drawLine(cx - 3, y + 1, cx + 3, y + 1);
      break;
  }
}

void Face::render(U8G2& g, int cx, int cy, float scale) {
  if (scale <= 0.1f) scale = 1.0f;
  int offsetX = 0;
  int offsetY = 0;
  bool blink = false;
  applyAnimation(offsetX, offsetY, blink, g, cx, cy, scale);
  cx += offsetX;
  cy += offsetY;

  int eyeW = (int)(18 * scale);
  int eyeH = (int)(24 * scale);
  int gap = (int)(14 * scale);
  int eyeY = cy - eyeH / 2;
  int leftX = cx - gap / 2 - eyeW;
  int rightX = cx + gap / 2;
  uint8_t leftVariant = 0;
  uint8_t rightVariant = 0;
  bool drawNormalEyes = true;
  int leftY = eyeY;
  int rightY = eyeY;
  int leftW = eyeW;
  int rightW = eyeW;
  int leftH = eyeH;
  int rightH = eyeH;

  switch (emotion_) {
    case Emotion::Happy:
      leftH = rightH = (int)(eyeH * 0.78f);
      leftY = rightY = eyeY + (int)(eyeH * 0.12f);
      break;
    case Emotion::Excited:
      leftW = rightW = (int)(eyeW * 1.10f);
      leftH = rightH = (int)(eyeH * 1.10f);
      leftY = rightY = eyeY - 1;
      break;
    case Emotion::Love:
      leftW = rightW = (int)(eyeW * 1.05f);
      leftH = rightH = eyeW;
      leftY = rightY = eyeY + 2;
      leftVariant = rightVariant = 2;
      break;
    case Emotion::Angry:
      leftH = rightH = (int)(eyeH * 0.70f);
      leftY = rightY = eyeY + (int)(eyeH * 0.18f);
      leftVariant = rightVariant = 5;
      break;
    case Emotion::Sad:
      leftH = rightH = (int)(eyeH * 0.85f);
      leftY = rightY = eyeY + 2;
      break;
    case Emotion::Sleepy:
      leftH = rightH = (int)(eyeH * 0.32f);
      leftY = rightY = eyeY + (int)(eyeH * 0.35f);
      leftVariant = rightVariant = 3;
      break;
    case Emotion::Surprised:
      leftW = rightW = (int)(eyeW * 1.15f);
      leftH = rightH = (int)(eyeH * 1.05f);
      leftY = rightY = eyeY - 1;
      leftVariant = rightVariant = 4;
      break;
    case Emotion::Thinking:
      rightH = (int)(eyeH * 0.62f);
      rightY = eyeY + (int)(eyeH * 0.18f);
      rightVariant = 5;
      break;
    case Emotion::Curious:
      leftW = (int)(eyeW * 1.15f);
      rightW = (int)(eyeW * 0.85f);
      rightH = (int)(eyeH * 0.92f);
      rightY = eyeY + 1;
      break;
    case Emotion::Shy:
      leftW = rightW = (int)(eyeW * 0.80f);
      leftH = rightH = (int)(eyeH * 0.80f);
      leftY = rightY = eyeY + 3;
      leftVariant = rightVariant = 6;
      break;
    case Emotion::Cool:
      drawNormalEyes = false;
      g.drawRBox(leftX - 2, eyeY + eyeH / 3, eyeW * 2 + gap + 4, eyeH / 3, 2);
      g.drawBox(cx - 2, eyeY + eyeH / 2 - 1, 5, 2);
      g.setDrawColor(0);
      g.drawHLine(leftX + 2, eyeY + eyeH / 3 + 2, eyeW - 4);
      g.drawHLine(rightX + 2, eyeY + eyeH / 3 + 2, eyeW - 4);
      g.setDrawColor(1);
      break;
    case Emotion::Confused:
      leftY = eyeY - 2;
      rightY = eyeY + 2;
      rightH = (int)(eyeH * 0.85f);
      break;
    case Emotion::Concerned:
      leftH = rightH = (int)(eyeH * 0.85f);
      leftY = rightY = eyeY + 1;
      break;
    case Emotion::Playful:
      leftVariant = 1;
      break;
    case Emotion::Normal:
    default:
      break;
  }

  if (blink && emotion_ != Emotion::Cool && emotion_ != Emotion::Love) {
    leftVariant = rightVariant = 1;
  }

  if (drawNormalEyes) {
    drawEye(g, leftX, leftY, leftW, leftH, leftVariant);
    drawEye(g, rightX, rightY, rightW, rightH, rightVariant);
  }

  drawBrows(g, leftX, rightX, eyeY - (int)(7 * scale), emotion_, eyeW);
  drawMouth(g, cx, cy + (int)(eyeH * 0.70f) + (int)(6 * scale), emotion_);

  if (emotion_ == Emotion::Shy) {
    g.drawLine(leftX - 4, eyeY + eyeH + 2, leftX + 1, eyeY + eyeH + 1);
    g.drawLine(leftX - 4, eyeY + eyeH + 5, leftX + 1, eyeY + eyeH + 4);
    g.drawLine(rightX + rightW + 3, eyeY + eyeH + 1, rightX + rightW - 2, eyeY + eyeH + 2);
    g.drawLine(rightX + rightW + 3, eyeY + eyeH + 4, rightX + rightW - 2, eyeY + eyeH + 5);
  }

  if (emotion_ == Emotion::Excited) {
    plus(g, leftX - 6, eyeY - 5, 1);
    plus(g, rightX + rightW + 6, eyeY + 2, 2);
  }
}
