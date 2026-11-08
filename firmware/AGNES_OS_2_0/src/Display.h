#pragma once
#include <Arduino.h>
#include <U8g2lib.h>
#include "Config.h"

class Display {
 public:
  bool begin();
  void flush();
  void clear();
  U8G2& g() { return *gfx_; }

  void setPower(bool on);
  bool isOn() const { return power_; }
  void setBrightness(uint8_t value);
  uint8_t brightness() const { return brightness_; }
  void setTheme(const char* theme);
  const char* theme() const { return theme_; }

  void header(const char* title, const char* right = nullptr);
  void footer(const char* left, const char* right = nullptr);
  void centered(const char* text, int y);
  void rightAligned(const char* text, int rightX, int y);
  void batteryIcon(int x, int y, uint8_t percent);
  void wifiIcon(int x, int y, bool connected);
  void progressBar(int x, int y, int width, uint8_t percent);
  uint8_t drawWrapped(const char* text, int x, int y, int maxWidth,
                      int lineHeight, uint8_t maxLines);
  uint16_t textPageCount(const char* text, int maxWidth, uint8_t linesPerPage);
  uint8_t drawTextPage(const char* text, uint16_t page, int x, int y,
                       int maxWidth, int lineHeight, uint8_t linesPerPage);
  uint16_t lineCount(const char* text, int maxWidth, uint8_t linesPerPage);

 private:
  U8G2* gfx_ = nullptr;
  bool power_ = true;
  uint8_t brightness_ = AGNES_BRIGHTNESS_DEFAULT;
  char theme_[10] = "cyber";
};
