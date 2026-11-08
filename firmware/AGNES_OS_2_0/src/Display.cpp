#include "Display.h"
#include "Util.h"
#include <Wire.h>
#include <string.h>

#if AGNES_OLED_SH1106
static U8G2_SH1106_128X64_NONAME_F_HW_I2C gDisplay(U8G2_R0, U8X8_PIN_NONE);
#else
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C gDisplay(U8G2_R0, U8X8_PIN_NONE);
#endif

namespace {

// Returns true when a line (possibly blank) was produced. Advances cursor.
bool nextWrappedLine(const char*& cursor, char* line, size_t capacity,
                     int maxWidth, U8G2& gfx) {
  line[0] = '\0';
  size_t length = 0;
  int lastSpace = -1;
  const char* afterSpace = nullptr;

  while (*cursor) {
    char c = *cursor;
    if (c == '\r') {
      cursor++;
      continue;
    }
    if (c == '\n') {
      cursor++;
      if (length == 0) return true;  // explicit blank line
      break;
    }
    if (length == 0 && c == ' ') {
      cursor++;
      continue;
    }
    if (length + 1 >= capacity) break;

    line[length] = c;
    line[length + 1] = '\0';
    if (gfx.getUTF8Width(line) > maxWidth) {
      line[length] = '\0';
      if (length == 0) {
        // A single glyph wider than the box: keep it rather than looping.
        line[0] = c;
        line[1] = '\0';
        cursor++;
      } else if (lastSpace >= 0) {
        line[lastSpace] = '\0';
        cursor = afterSpace;
      }
      break;
    }
    if (c == ' ') {
      lastSpace = (int)length;
      afterSpace = cursor + 1;
    }
    length++;
    cursor++;
  }

  while (length > 0 && line[length - 1] == ' ') {
    line[--length] = '\0';
  }
  return length > 0;
}

}  // namespace

bool Display::begin() {
  Wire.begin(AGNES_PIN_I2C_SDA, AGNES_PIN_I2C_SCL);
  Wire.setClock(400000);
  gfx_ = &gDisplay;
  gfx_->setI2CAddress((uint8_t)(AGNES_OLED_I2C_ADDRESS << 1));
  gfx_->begin();
  gfx_->setBusClock(400000);
  gfx_->setContrast(brightness_);
  gfx_->clearBuffer();
  gfx_->sendBuffer();
  return true;
}

void Display::flush() {
  if (!gfx_ || !power_) return;
  gfx_->sendBuffer();
}

void Display::clear() {
  if (!gfx_) return;
  gfx_->clearBuffer();
}

void Display::setPower(bool on) {
  if (!gfx_) return;
  power_ = on;
  if (on) {
    gfx_->setPowerSave(0);
    gfx_->setContrast(brightness_);
    gfx_->clearBuffer();
    gfx_->sendBuffer();
  } else {
    gfx_->setPowerSave(1);
  }
}

void Display::setBrightness(uint8_t value) {
  brightness_ = value;
  if (gfx_) gfx_->setContrast(brightness_);
}

void Display::setTheme(const char* theme) {
  AgnesUtil::copyString(theme_, sizeof(theme_), theme ? theme : "cyber");
}

void Display::header(const char* title, const char* right) {
  if (!gfx_) return;
  gfx_->setFont(u8g2_font_6x10_tf);
  gfx_->setDrawColor(1);
  if (strcmp(theme_, "retro") == 0) {
    gfx_->drawBox(0, 0, 3, 11);
  } else if (strcmp(theme_, "cyber") == 0) {
    gfx_->drawBox(0, 0, 6, 2);
  }
  gfx_->drawStr(4, 9, title ? title : "");
  gfx_->setFont(u8g2_font_5x7_tf);
  if (right && right[0]) {
    int width = gfx_->getUTF8Width(right);
    gfx_->drawStr(126 - width, 8, right);
  }
  gfx_->drawHLine(0, 11, 128);
  if (strcmp(theme_, "retro") == 0) {
    gfx_->drawFrame(0, 0, 128, 64);
  }
}

void Display::footer(const char* left, const char* right) {
  if (!gfx_) return;
  gfx_->setFont(u8g2_font_5x7_tf);
  gfx_->setDrawColor(1);
  gfx_->drawHLine(0, 55, 128);
  if (left && left[0]) gfx_->drawStr(1, 63, left);
  if (right && right[0]) {
    int width = gfx_->getUTF8Width(right);
    gfx_->drawStr(127 - width, 63, right);
  }
}

void Display::centered(const char* text, int y) {
  if (!gfx_ || !text) return;
  int width = gfx_->getUTF8Width(text);
  gfx_->drawStr((128 - width) / 2, y, text);
}

void Display::rightAligned(const char* text, int rightX, int y) {
  if (!gfx_ || !text) return;
  int width = gfx_->getUTF8Width(text);
  gfx_->drawStr(rightX - width, y, text);
}

void Display::batteryIcon(int x, int y, uint8_t percent) {
  if (!gfx_) return;
  gfx_->drawFrame(x, y, 14, 7);
  gfx_->drawBox(x + 14, y + 2, 2, 3);
  int fill = (int)(percent > 100 ? 100 : percent) * 11 / 100;
  if (fill > 0) gfx_->drawBox(x + 1, y + 1, fill, 5);
}

void Display::wifiIcon(int x, int y, bool connected) {
  if (!gfx_) return;
  gfx_->drawBox(x + 9, y, 2, 2);
  if (connected) {
    gfx_->drawBox(x + 5, y + 3, 2, 2);
    gfx_->drawBox(x + 13, y + 3, 2, 2);
    gfx_->drawBox(x + 1, y + 6, 2, 2);
    gfx_->drawBox(x + 17, y + 6, 2, 2);
  }
}

void Display::progressBar(int x, int y, int width, uint8_t percent) {
  if (!gfx_) return;
  gfx_->drawFrame(x, y, width, 6);
  int fill = (int)(percent > 100 ? 100 : percent) * (width - 2) / 100;
  if (fill > 0) gfx_->drawBox(x + 1, y + 1, fill, 4);
}

uint8_t Display::drawWrapped(const char* text, int x, int y, int maxWidth,
                             int lineHeight, uint8_t maxLines) {
  if (!gfx_ || !text) return 0;
  const char* cursor = text;
  char line[64];
  uint8_t drawn = 0;
  while (drawn < maxLines && nextWrappedLine(cursor, line, sizeof(line), maxWidth, *gfx_)) {
    gfx_->drawStr(x, y + drawn * lineHeight, line);
    drawn++;
  }
  return drawn;
}

uint16_t Display::textPageCount(const char* text, int maxWidth, uint8_t linesPerPage) {
  if (!gfx_ || !text || linesPerPage == 0) return 1;
  const char* cursor = text;
  char line[64];
  uint16_t lines = 0;
  while (nextWrappedLine(cursor, line, sizeof(line), maxWidth, *gfx_)) {
    lines++;
    if (lines > 2000) break;
  }
  if (lines == 0) lines = 1;
  return (lines + linesPerPage - 1) / linesPerPage;
}

uint8_t Display::drawTextPage(const char* text, uint16_t page, int x, int y,
                              int maxWidth, int lineHeight, uint8_t linesPerPage) {
  if (!gfx_ || !text) return 0;
  const char* cursor = text;
  char line[64];
  uint16_t index = 0;
  uint8_t drawn = 0;
  const uint16_t first = page * linesPerPage;
  while (nextWrappedLine(cursor, line, sizeof(line), maxWidth, *gfx_)) {
    if (index >= first && drawn < linesPerPage) {
      gfx_->drawStr(x, y + drawn * lineHeight, line);
      drawn++;
    }
    index++;
    if (drawn >= linesPerPage) break;
    if (index > 2000) break;
  }
  return drawn;
}

uint16_t Display::lineCount(const char* text, int maxWidth, uint8_t linesPerPage) {
  return textPageCount(text, maxWidth, linesPerPage);
}
