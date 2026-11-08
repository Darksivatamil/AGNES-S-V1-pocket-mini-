#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Config.h"
#include "Types.h"
#include "EventBus.h"
#include "Storage.h"
#include "WifiManager.h"

enum class CloudJobType : uint8_t {
  None = 0,
  Pair,
  Verify,
  ChatStart,
  ChatResume,
  ChatSelect,
  ChatMessage,
  Sync,
  Status,
  Weather,
};

struct CloudJob {
  CloudJobType type = CloudJobType::None;
  char a[40] = {0};      // pairing code / conversation id
  char b[40] = {0};      // question id
  char c[40] = {0};      // option id
  char d[160] = {0};     // message text
  char payload[512] = {0};
};

class Cloud {
 public:
  bool begin(EventBus& events, WifiManager& wifi, Storage& storage);
  void loop() {}  // network work runs in its own task

  bool enqueuePair(const char* pairingCode);
  bool enqueueVerify();
  bool enqueueChat(CloudJobType action, const char* conversationId,
                   const char* questionId, const char* optionId, const char* message);
  bool enqueueSync(uint32_t settingsVersion, const DeviceStatus& status,
                   const PendingPetEvent* petEvents, uint8_t petCount,
                   const PendingAck* acks, uint8_t ackCount,
                   const char notificationIds[][40], uint8_t notificationCount);
  bool enqueueStatus(const DeviceStatus& status, const char* lastError);
  bool enqueueWeather();

  bool busy() const { return busy_; }
  uint8_t queueDepth() const;
  CloudJobType lastJobType() const { return lastJobType_; }

  bool takeChat(ChatReply& out);
  bool takePair(CloudPairResult& out);
  bool takeAuth(CloudAuthResult& out);
  bool takeTool(CloudToolResult& out);
  bool takeError(CloudError& out);
  const CloudSyncResult& syncResult() const { return syncResult_; }
  bool syncFresh() const { return syncFresh_; }
  void consumeSync() { syncFresh_ = false; }

 private:
  EventBus* events_ = nullptr;
  WifiManager* wifi_ = nullptr;
  Storage* storage_ = nullptr;

  QueueHandle_t queue_ = nullptr;
  TaskHandle_t task_ = nullptr;
  SemaphoreHandle_t syncMutex_ = nullptr;
  char syncJson_[AGNES_SYNC_REQUEST_MAX + 1] = {0};
  char syncOut_[AGNES_SYNC_REQUEST_MAX + 1] = {0};
  bool syncQueued_ = false;
  char* responseBuffer_ = nullptr;

  volatile bool busy_ = false;
  volatile CloudJobType lastJobType_ = CloudJobType::None;

  ChatReply chatResult_;
  bool chatFresh_ = false;
  CloudPairResult pairResult_;
  bool pairFresh_ = false;
  CloudAuthResult authResult_;
  bool authFresh_ = false;
  CloudToolResult toolResult_;
  bool toolFresh_ = false;
  CloudSyncResult syncResult_;
  bool syncFresh_ = false;
  CloudError error_;
  bool errorFresh_ = false;

  static void taskEntry(void* parameter);
  void taskLoop();
  void dispatch(CloudJob& job);

  bool postPair(CloudJob& job);
  bool postVerify();
  bool postChat(CloudJob& job);
  bool postSync(CloudJob& job);
  bool postStatus(CloudJob& job);
  bool postWeather();

  int httpPost(const char* path, const char* body, size_t length, bool needsAuth);
  bool parseEnvelope(JsonDocument& doc, int status, CloudJobType jobType);
  void fail(CloudJobType jobType, CloudErrorCode code, int status, const char* message);
  void failFromDocument(CloudJobType jobType, int status, JsonDocument& doc);
  void emit(EventType type, CloudJobType jobType, uint8_t code = 0);
  EventType errorEvent(CloudJobType jobType) const;
  EventType doneEvent(CloudJobType jobType) const;

  void parseSettings(JsonVariantConst value, CloudSettings& out);
  void parsePet(JsonVariantConst value, PetState& out, bool& valid);
  void parseChat(JsonVariantConst data);
  void parseSync(JsonVariantConst data);
  void parsePair(JsonVariantConst data);
  void parseAuth(JsonVariantConst data);
  void parseWeather(JsonVariantConst data);
  void writeStatus(JsonObject status, const DeviceStatus& snapshot, const char* lastError) const;
};
