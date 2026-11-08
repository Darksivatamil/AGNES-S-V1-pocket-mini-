#pragma once
#include <Arduino.h>
#include "Config.h"

enum class Emotion : uint8_t {
  Normal = 0,
  Happy,
  Excited,
  Love,
  Angry,
  Sad,
  Sleepy,
  Surprised,
  Thinking,
  Curious,
  Shy,
  Cool,
  Confused,
  Concerned,
  Playful,
  Count,
};

enum class Animation : uint8_t {
  None = 0,
  Blink,
  Bounce,
  Sway,
  Sparkle,
  Shake,
  Float,
  Count,
};

enum class Personality : uint8_t {
  Friendly = 0,
  Genius,
  Savage,
  Shy,
  Sleepy,
  Count,
};

enum class Screen : uint8_t {
  Boot = 0,
  Home,
  Menu,
  Chat,
  Apps,
  AppRun,
  Pet,
  Memory,
  Notes,
  Notifications,
  Settings,
  Diagnostics,
  About,
  WifiSetup,
};

enum class ButtonId : uint8_t {
  Previous = 0,
  Select = 1,
  Next = 2,
};

enum class EventType : uint8_t {
  Tick = 0,
  Button,
  WifiConnected,
  WifiDisconnected,
  CloudChatDone,
  CloudChatError,
  CloudSyncDone,
  CloudSyncError,
  CloudPairDone,
  CloudPairError,
  CloudAuthDone,
  CloudAuthError,
  CloudToolDone,
  CloudToolError,
  CloudStatusDone,
  CloudStatusError,
  BatteryUpdate,
  Idle,
  Notification,
};

enum class PowerState : uint8_t {
  Active = 0,
  Chat,
  Idle,
  ScreenSleep,
  LightSleep,
  DeepSleep,
};

enum class WifiState : uint8_t {
  Unprovisioned = 0,
  Connecting,
  Connected,
  Backoff,
  Failed,
  Provisioning,
};

struct Event {
  EventType type = EventType::Tick;
  uint8_t code = 0;
  int32_t a = 0;
  int32_t b = 0;
  uint32_t at = 0;
};

struct ButtonEvent {
  ButtonId id = ButtonId::Select;
  bool longPress = false;
  bool repeat = false;
};

struct AgnesSettings {
  char personality[12] = "friendly";
  char theme[10] = "cyber";
  uint8_t brightness = 160;
  bool idleAnimations = true;
  uint16_t sleepTimeoutSeconds = 120;
  bool cloudMemoryEnabled = true;
  bool notificationsEnabled = true;
  char timezonePosix[32] = "UTC0";
  bool hasLocation = false;
  float latitude = 0.0f;
  float longitude = 0.0f;
  uint32_t settingsVersion = 0;
};

struct ChatOption {
  char id[24] = {0};
  char label[32] = {0};
};

struct ChatReply {
  char conversationId[40] = {0};
  char questionId[40] = {0};
  char reply[256] = {0};
  char question[96] = {0};
  ChatOption options[3];
  uint8_t optionCount = 0;
  bool hasQuestion = false;
  char emotion[20] = "normal";
  char animation[20] = "none";
  uint8_t intensity = 1;
  int8_t moodDelta = 0;
  char provider[24] = {0};
  char model[64] = {0};
  char warning[96] = {0};
  uint32_t questionExpiresEpoch = 0;
};

struct PetState {
  char name[24] = "Agnes";
  uint8_t happiness = 70;
  uint8_t energy = 80;
  uint8_t hunger = 20;
  uint16_t friendshipXp = 0;
  uint8_t level = 1;
  char stage[12] = "newborn";
  uint32_t lastDecayEpoch = 0;
  uint32_t version = 1;
};

struct MoodEntry {
  uint8_t emotion = 0;
  uint32_t at = 0;
};

struct CloudCommand {
  char id[40] = {0};
  char type[32] = {0};
  char payload[160] = {0};
  uint32_t expiresEpoch = 0;
};

struct PendingAck {
  char id[40] = {0};
  char status[12] = {0};
  char error[64] = {0};
};

struct PendingPetEvent {
  char id[40] = {0};
  char type[12] = {0};
};

struct CloudMemory {
  char id[40] = {0};
  char category[24] = {0};
  char content[240] = {0};
  bool pinned = false;
};

struct CloudNote {
  char id[40] = {0};
  char title[48] = {0};
  char body[400] = {0};
  uint32_t version = 1;
  bool pinned = false;
};

struct CloudNotification {
  char id[40] = {0};
  char title[64] = {0};
  char body[160] = {0};
  char kind[16] = {0};
};

struct DeviceStatus {
  uint16_t batteryMv = 0;
  uint8_t batteryPercent = 0;
  int8_t rssi = 0;
  uint32_t freeHeap = 0;
  uint32_t uptimeSeconds = 0;
  Emotion emotion = Emotion::Normal;
  uint8_t personality = 0;
  bool valid = false;
};

struct CloudSettings {
  bool valid = false;
  AgnesSettings settings;
};

struct CloudSyncResult {
  bool valid = false;
  CloudSettings settings;
  bool petValid = false;
  PetState pet;
  uint8_t commandCount = 0;
  CloudCommand commands[8];
  uint8_t memoryCount = 0;
  CloudMemory memories[AGNES_LOCAL_MEMORY_MAX];
  uint8_t noteCount = 0;
  CloudNote notes[10];
  uint8_t notificationCount = 0;
  CloudNotification notifications[5];
  char conversationId[40] = {0};
  char questionId[40] = {0};
  char questionText[96] = {0};
  ChatOption questionOptions[3];
  uint8_t questionOptionCount = 0;
  bool hasPendingQuestion = false;
  uint32_t serverEpoch = 0;
  uint32_t settingsVersion = 0;
  bool cloudMemoryEnabled = true;
};

struct CloudPairResult {
  bool valid = false;
  char deviceId[40] = {0};
  char token[72] = {0};
  char name[40] = {0};
  CloudSettings settings;
  bool petValid = false;
  PetState pet;
  uint32_t serverEpoch = 0;
};

struct CloudAuthResult {
  bool valid = false;
  char name[40] = {0};
  CloudSettings settings;
  bool petValid = false;
  PetState pet;
  uint32_t serverEpoch = 0;
};

struct CloudToolResult {
  bool valid = false;
  char title[32] = {0};
  char body[768] = {0};
  uint32_t observedEpoch = 0;
};

enum class CloudErrorCode : uint8_t {
  None = 0,
  Offline,
  NotConfigured,
  Network,
  Timeout,
  Unauthorized,
  Revoked,
  RateLimited,
  Server,
  InvalidResponse,
  Provider,
  Rejected,
  Busy,
};

struct CloudError {
  CloudErrorCode code = CloudErrorCode::None;
  int httpStatus = 0;
  char message[128] = {0};
};

const char* emotionName(Emotion emotion);
const char* animationName(Animation animation);
const char* personalityName(Personality personality);
Emotion emotionFromString(const char* value);
Animation animationFromString(const char* value);
Personality personalityFromString(const char* value);
const char* personalityDisplayName(Personality personality);
