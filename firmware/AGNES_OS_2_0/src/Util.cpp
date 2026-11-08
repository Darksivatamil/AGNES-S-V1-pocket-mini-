#include "Util.h"
#include "Types.h"
#include <esp_random.h>
#include <time.h>
#include <sys/time.h>
#include <string.h>

namespace AgnesUtil {

uint32_t clampU32(uint32_t value, uint32_t low, uint32_t high) {
  return value < low ? low : (value > high ? high : value);
}

int clampInt(int value, int low, int high) {
  return value < low ? low : (value > high ? high : value);
}

uint8_t clampU8(int value) {
  return (uint8_t)clampInt(value, 0, 255);
}

float clampFloat(float value, float low, float high) {
  return value < low ? low : (value > high ? high : value);
}

void copyString(char* destination, size_t capacity, const char* source) {
  if (!destination || capacity == 0) return;
  if (!source) source = "";
  strncpy(destination, source, capacity - 1);
  destination[capacity - 1] = '\0';
}

void asciiCopy(char* destination, size_t capacity, const char* source) {
  if (!destination || capacity == 0) return;
  if (!source) source = "";
  size_t written = 0;
  const uint8_t* cursor = (const uint8_t*)source;
  while (*cursor && written + 1 < capacity) {
    uint8_t c = *cursor++;
    if (c < 0x80) {
      if (c == '\n' || c == '\r' || (c >= 32 && c <= 126)) {
        destination[written++] = (char)c;
      } else {
        destination[written++] = ' ';
      }
    } else if ((c & 0xE0) == 0xC0 && *cursor) {
      cursor++;  // 2-byte sequence: drop it
      destination[written++] = '?';
    } else if ((c & 0xF0) == 0xE0 && cursor[0] && cursor[1]) {
      cursor += 2;
      destination[written++] = '?';
    } else if ((c & 0xF8) == 0xF0 && cursor[0] && cursor[1] && cursor[2]) {
      cursor += 3;
      destination[written++] = '?';
    }
  }
  destination[written] = '\0';
}

void uuidV4(char* out, size_t capacity) {
  if (!out || capacity < 37) {
    if (out && capacity) out[0] = '\0';
    return;
  }
  uint32_t a = esp_random();
  uint32_t b = esp_random();
  uint32_t c = esp_random();
  uint32_t d = esp_random();
  snprintf(out, capacity, "%08x-%04x-4%03x-%04x-%04x%08x",
           (unsigned)a,
           (unsigned)((b >> 16) & 0xFFFF),
           (unsigned)(b & 0x0FFF),
           (unsigned)(0x8000 | ((c >> 16) & 0x3FFF)),
           (unsigned)(c & 0xFFFF),
           (unsigned)d);
}

bool parseBool(const char* value) {
  if (!value) return false;
  return strcasecmp(value, "true") == 0 || strcmp(value, "1") == 0 || strcasecmp(value, "yes") == 0;
}

void formatUptime(uint32_t seconds, char* out, size_t capacity) {
  uint32_t days = seconds / 86400UL;
  uint32_t hours = (seconds % 86400UL) / 3600UL;
  uint32_t minutes = (seconds % 3600UL) / 60UL;
  if (days > 0) {
    snprintf(out, capacity, "%lud %02luh", (unsigned long)days, (unsigned long)hours);
  } else {
    snprintf(out, capacity, "%02lu:%02lu", (unsigned long)hours, (unsigned long)minutes);
  }
}

void formatClock(uint32_t epoch, char* out, size_t capacity) {
  if (epoch < 1700000000UL) {
    snprintf(out, capacity, "--:--");
    return;
  }
  time_t raw = (time_t)epoch;
  struct tm value;
  localtime_r(&raw, &value);
  snprintf(out, capacity, "%02d:%02d", value.tm_hour, value.tm_min);
}

void formatDate(uint32_t epoch, char* out, size_t capacity) {
  if (epoch < 1700000000UL) {
    snprintf(out, capacity, "time not set");
    return;
  }
  time_t raw = (time_t)epoch;
  struct tm value;
  localtime_r(&raw, &value);
  snprintf(out, capacity, "%04d-%02d-%02d", value.tm_year + 1900, value.tm_mon + 1, value.tm_mday);
}

void formatDuration(uint32_t seconds, char* out, size_t capacity) {
  uint32_t hours = seconds / 3600UL;
  uint32_t minutes = (seconds % 3600UL) / 60UL;
  uint32_t secs = seconds % 60UL;
  if (hours > 0) {
    snprintf(out, capacity, "%lu:%02lu:%02lu", (unsigned long)hours,
             (unsigned long)minutes, (unsigned long)secs);
  } else {
    snprintf(out, capacity, "%02lu:%02lu", (unsigned long)minutes, (unsigned long)secs);
  }
}

static int64_t daysFromCivil(int year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int64_t era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = (unsigned)(year - era * 400);
  const unsigned adjustedMonth = (unsigned)((int)month + (month > 2 ? -3 : 9));
  const unsigned doy = (153U * adjustedMonth + 2U) / 5U + day - 1U;
  const unsigned doe = yoe * 365U + yoe / 4U - yoe / 100U + doy;
  return era * 146097 + (int64_t)doe - 719468;
}

uint32_t epochFromIso8601(const char* value) {
  if (!value) return 0;
  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  if (sscanf(value, "%4d-%2d-%2dT%2d:%2d:%2d", &year, &month, &day, &hour, &minute, &second) != 6) {
    return 0;
  }
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) {
    return 0;
  }
  int64_t days = daysFromCivil(year, (unsigned)month, (unsigned)day);
  int64_t seconds = days * 86400 + hour * 3600 + minute * 60 + second;
  return seconds > 0 ? (uint32_t)seconds : 0;
}

bool setEpoch(uint32_t epoch) {
  if (epoch < 1700000000UL) return false;
  struct timeval tv;
  tv.tv_sec = (time_t)epoch;
  tv.tv_usec = 0;
  return settimeofday(&tv, nullptr) == 0;
}

bool timeIsValid() {
  return time(nullptr) > 1700000000L;
}

uint32_t nowEpoch() {
  time_t value = time(nullptr);
  return value > 1700000000L ? (uint32_t)value : 0;
}

const char* wifiStateName(uint8_t state) {
  switch ((WifiState)state) {
    case WifiState::Unprovisioned: return "not set up";
    case WifiState::Connecting: return "connecting";
    case WifiState::Connected: return "connected";
    case WifiState::Backoff: return "retrying";
    case WifiState::Failed: return "failed";
    case WifiState::Provisioning: return "setup mode";
    default: return "unknown";
  }
}

}
