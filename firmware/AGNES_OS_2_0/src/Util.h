#pragma once
#include <Arduino.h>

namespace AgnesUtil {
uint32_t clampU32(uint32_t value, uint32_t low, uint32_t high);
int clampInt(int value, int low, int high);
uint8_t clampU8(int value);
float clampFloat(float value, float low, float high);
void copyString(char* destination, size_t capacity, const char* source);
void uuidV4(char* out, size_t capacity);
void asciiCopy(char* destination, size_t capacity, const char* source);
bool parseBool(const char* value);
void formatUptime(uint32_t seconds, char* out, size_t capacity);
void formatClock(uint32_t epoch, char* out, size_t capacity);
void formatDate(uint32_t epoch, char* out, size_t capacity);
void formatDuration(uint32_t seconds, char* out, size_t capacity);
uint32_t epochFromIso8601(const char* value);
bool setEpoch(uint32_t epoch);
bool timeIsValid();
uint32_t nowEpoch();
const char* wifiStateName(uint8_t state);
}
