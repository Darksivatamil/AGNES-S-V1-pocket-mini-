#include "Cloud.h"
#include "Util.h"
#include <ArduinoJson.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>

namespace {
constexpr int kHttpNotConfigured = -100;
constexpr int kHttpOffline = -101;
constexpr int kHttpTooLarge = -2;

void copyAscii(JsonVariantConst value, char* out, size_t capacity) {
  if (!out || capacity == 0) return;
  const char* text = value.is<const char*>() ? value.as<const char*>() : "";
  AgnesUtil::asciiCopy(out, capacity, text ? text : "");
}

uint32_t isoEpoch(JsonVariantConst value) {
  const char* text = value.is<const char*>() ? value.as<const char*>() : nullptr;
  return text ? AgnesUtil::epochFromIso8601(text) : 0;
}

const char* serverErrorCode(JsonDocument& doc) {
  return doc["error"]["code"] | "";
}

const char* serverErrorMessage(JsonDocument& doc) {
  return doc["error"]["message"] | "";
}
}

bool Cloud::begin(EventBus& events, WifiManager& wifi, Storage& storage) {
  events_ = &events;
  wifi_ = &wifi;
  storage_ = &storage;

  responseBuffer_ = (char*)malloc(AGNES_HTTP_BODY_MAX + 1);
  syncMutex_ = xSemaphoreCreateMutex();
  queue_ = xQueueCreate(6, sizeof(CloudJob));
  if (!responseBuffer_ || !syncMutex_ || !queue_) {
    AGNES_LOG("Cloud init failed: out of memory");
    return false;
  }
  BaseType_t created = xTaskCreate(taskEntry, "agnes_net", AGNES_NETWORK_STACK,
                                   this, AGNES_NETWORK_TASK_PRIORITY, &task_);
  if (created != pdPASS) {
    AGNES_LOG("Cloud task creation failed");
    return false;
  }
  return true;
}

void Cloud::taskEntry(void* parameter) {
  static_cast<Cloud*>(parameter)->taskLoop();
}

void Cloud::taskLoop() {
  CloudJob job;
  for (;;) {
    if (xQueueReceive(queue_, &job, portMAX_DELAY) != pdTRUE) continue;
    busy_ = true;
    lastJobType_ = job.type;
    dispatch(job);
    busy_ = false;
  }
}

bool Cloud::enqueuePair(const char* pairingCode) {
  if (!pairingCode || !pairingCode[0] || !queue_) return false;
  CloudJob job;
  job.type = CloudJobType::Pair;
  AgnesUtil::copyString(job.a, sizeof(job.a), pairingCode);
  return xQueueSend(queue_, &job, 0) == pdTRUE;
}

bool Cloud::enqueueVerify() {
  if (!queue_) return false;
  CloudJob job;
  job.type = CloudJobType::Verify;
  return xQueueSend(queue_, &job, 0) == pdTRUE;
}

bool Cloud::enqueueChat(CloudJobType action, const char* conversationId,
                        const char* questionId, const char* optionId, const char* message) {
  if (!queue_) return false;
  if (action != CloudJobType::ChatStart && action != CloudJobType::ChatResume &&
      action != CloudJobType::ChatSelect && action != CloudJobType::ChatMessage) {
    return false;
  }
  CloudJob job;
  job.type = action;
  if (conversationId) AgnesUtil::copyString(job.a, sizeof(job.a), conversationId);
  if (questionId) AgnesUtil::copyString(job.b, sizeof(job.b), questionId);
  if (optionId) AgnesUtil::copyString(job.c, sizeof(job.c), optionId);
  if (message) AgnesUtil::copyString(job.d, sizeof(job.d), message);
  return xQueueSend(queue_, &job, 0) == pdTRUE;
}

bool Cloud::enqueueSync(uint32_t settingsVersion, const DeviceStatus& status,
                        const PendingPetEvent* petEvents, uint8_t petCount,
                        const PendingAck* acks, uint8_t ackCount,
                        const char notificationIds[][40], uint8_t notificationCount) {
  if (!queue_ || !syncMutex_) return false;

  char requestId[40];
  AgnesUtil::uuidV4(requestId, sizeof(requestId));

  JsonDocument doc;
  doc["request_id"] = requestId;
  doc["action"] = "sync";
  doc["settings_version"] = settingsVersion;

  JsonObject statusObject = doc["status"].to<JsonObject>();
  writeStatus(statusObject, status, nullptr);

  JsonArray petArray = doc["pet_events"].to<JsonArray>();
  for (uint8_t i = 0; i < petCount; ++i) {
    if (!petEvents[i].id[0] || !petEvents[i].type[0]) continue;
    JsonObject item = petArray.add<JsonObject>();
    item["client_event_id"] = petEvents[i].id;
    item["event_type"] = petEvents[i].type;
  }

  JsonArray ackArray = doc["commands_ack"].to<JsonArray>();
  for (uint8_t i = 0; i < ackCount; ++i) {
    if (!acks[i].id[0] || !acks[i].status[0]) continue;
    JsonObject item = ackArray.add<JsonObject>();
    item["id"] = acks[i].id;
    item["status"] = acks[i].status;
    if (acks[i].error[0]) item["error"] = acks[i].error;
  }

  JsonArray readArray = doc["notifications_read"].to<JsonArray>();
  for (uint8_t i = 0; i < notificationCount; ++i) {
    if (notificationIds[i][0]) readArray.add(notificationIds[i]);
  }

  String body;
  body.reserve(2048);
  serializeJson(doc, body);
  if (body.length() > AGNES_SYNC_REQUEST_MAX) {
    AGNES_LOG("Sync request too large (%u bytes)", (unsigned)body.length());
    return false;
  }

  if (xSemaphoreTake(syncMutex_, pdMS_TO_TICKS(50)) != pdTRUE) return false;
  if (syncQueued_) {
    xSemaphoreGive(syncMutex_);
    return false;
  }
  memcpy(syncJson_, body.c_str(), body.length() + 1);
  syncQueued_ = true;
  xSemaphoreGive(syncMutex_);

  CloudJob job;
  job.type = CloudJobType::Sync;
  if (xQueueSend(queue_, &job, 0) != pdTRUE) {
    if (xSemaphoreTake(syncMutex_, pdMS_TO_TICKS(50)) == pdTRUE) {
      syncQueued_ = false;
      xSemaphoreGive(syncMutex_);
    }
    return false;
  }
  return true;
}

bool Cloud::enqueueStatus(const DeviceStatus& status, const char* lastError) {
  if (!queue_) return false;
  char requestId[40];
  AgnesUtil::uuidV4(requestId, sizeof(requestId));

  JsonDocument doc;
  doc["request_id"] = requestId;
  JsonObject statusObject = doc["status"].to<JsonObject>();
  writeStatus(statusObject, status, lastError);

  CloudJob job;
  job.type = CloudJobType::Status;
  size_t length = serializeJson(doc, job.payload, sizeof(job.payload));
  if (length == 0 || length >= sizeof(job.payload)) return false;
  return xQueueSend(queue_, &job, 0) == pdTRUE;
}

bool Cloud::enqueueWeather() {
  if (!queue_) return false;
  CloudJob job;
  job.type = CloudJobType::Weather;
  return xQueueSend(queue_, &job, 0) == pdTRUE;
}

uint8_t Cloud::queueDepth() const {
  return queue_ ? (uint8_t)uxQueueMessagesWaiting(queue_) : 0;
}

void Cloud::writeStatus(JsonObject status, const DeviceStatus& snapshot,
                        const char* lastError) const {
  status["firmware_version"] = AGNES_VERSION;
  if (snapshot.batteryMv >= 2000 && snapshot.batteryMv <= 5000) {
    status["battery_voltage_mv"] = snapshot.batteryMv;
  }
  status["battery_percent"] = snapshot.batteryPercent;
  if (snapshot.rssi < 0) status["wifi_rssi"] = snapshot.rssi;
  status["free_heap"] = snapshot.freeHeap;
  status["uptime_seconds"] = snapshot.uptimeSeconds;
  status["current_emotion"] = emotionName(snapshot.emotion);
  status["current_personality"] = personalityName((Personality)snapshot.personality);
  status["oled_controller"] = AGNES_OLED_SH1106 ? "sh1106" : "ssd1306";
  if (lastError && lastError[0]) status["last_error"] = lastError;
}

void Cloud::dispatch(CloudJob& job) {
  switch (job.type) {
    case CloudJobType::Pair:
      postPair(job);
      break;
    case CloudJobType::Verify:
      postVerify();
      break;
    case CloudJobType::ChatStart:
    case CloudJobType::ChatResume:
    case CloudJobType::ChatSelect:
    case CloudJobType::ChatMessage:
      postChat(job);
      break;
    case CloudJobType::Sync:
      postSync(job);
      break;
    case CloudJobType::Status:
      postStatus(job);
      break;
    case CloudJobType::Weather:
      postWeather();
      break;
    default:
      break;
  }
}

bool Cloud::postPair(CloudJob& job) {
  char requestId[40];
  AgnesUtil::uuidV4(requestId, sizeof(requestId));
  JsonDocument doc;
  doc["request_id"] = requestId;
  doc["action"] = "claim";
  doc["hardware_id"] = storage_ ? storage_->hardwareId() : "";
  doc["pairing_code"] = job.a;
  doc["name"] = storage_ ? storage_->deviceName() : "AGNES";
  doc["firmware_version"] = AGNES_VERSION;
  doc["oled_controller"] = AGNES_OLED_SH1106 ? "sh1106" : "ssd1306";
  JsonObject capabilities = doc["capabilities"].to<JsonObject>();
  capabilities["display"] = "128x64";
  capabilities["buttons"] = 3;
  capabilities["cloud_ai"] = true;
  capabilities["offline_local"] = true;
  capabilities["three_option_chat"] = true;

  String body;
  serializeJson(doc, body);
  int status = httpPost(AGNES_FUNCTION_PAIR, body.c_str(), body.length(), false);
  JsonDocument response;
  if (!parseEnvelope(response, status, CloudJobType::Pair)) return false;

  parsePair(response["data"]);
  if (strlen(pairResult_.deviceId) != 36 || strlen(pairResult_.token) != 64) {
    fail(CloudJobType::Pair, CloudErrorCode::InvalidResponse, status,
         "The server returned an invalid device credential");
    return false;
  }
  pairFresh_ = true;
  emit(EventType::CloudPairDone, CloudJobType::Pair);
  return true;
}

bool Cloud::postVerify() {
  String body = "{\"action\":\"verify\"}";
  int status = httpPost(AGNES_FUNCTION_AUTH, body.c_str(), body.length(), true);
  JsonDocument response;
  if (!parseEnvelope(response, status, CloudJobType::Verify)) return false;

  parseAuth(response["data"]);
  authFresh_ = true;
  emit(EventType::CloudAuthDone, CloudJobType::Verify);
  return true;
}

bool Cloud::postChat(CloudJob& job) {
  char requestId[40];
  AgnesUtil::uuidV4(requestId, sizeof(requestId));

  JsonDocument doc;
  doc["request_id"] = requestId;
  if (storage_ && storage_->hasDevice()) doc["device_id"] = storage_->deviceId();
  if (job.type == CloudJobType::ChatStart) {
    doc["action"] = "start";
  } else if (job.type == CloudJobType::ChatResume) {
    doc["action"] = "resume";
  } else if (job.type == CloudJobType::ChatSelect) {
    doc["action"] = "select";
    doc["question_id"] = job.b;
    doc["selected_option_id"] = job.c;
  } else {
    doc["action"] = "message";
    doc["message"] = job.d;
  }
  if (job.a[0]) doc["conversation_id"] = job.a;
  doc["input_source"] = "device";

  String body;
  serializeJson(doc, body);
  int status = httpPost(AGNES_FUNCTION_CHAT, body.c_str(), body.length(), true);
  JsonDocument response;
  if (!parseEnvelope(response, status, job.type)) return false;

  JsonVariantConst data = response["data"];
  if (!data.is<JsonObjectConst>()) {
    fail(job.type, CloudErrorCode::InvalidResponse, status, "The server returned no chat data");
    return false;
  }
  parseChat(data);
  if (!chatResult_.reply[0] && !chatResult_.hasQuestion) {
    fail(job.type, CloudErrorCode::InvalidResponse, status, "The AI reply was empty");
    return false;
  }
  chatFresh_ = true;
  emit(EventType::CloudChatDone, job.type);
  return true;
}

bool Cloud::postSync(CloudJob& job) {
  if (!syncMutex_) return false;
  if (xSemaphoreTake(syncMutex_, portMAX_DELAY) != pdTRUE) return false;
  memcpy(syncOut_, syncJson_, sizeof(syncOut_));
  xSemaphoreGive(syncMutex_);

  int status = httpPost(AGNES_FUNCTION_SYNC, syncOut_, strlen(syncOut_), true);
  JsonDocument response;
  bool delivered = false;
  if (parseEnvelope(response, status, CloudJobType::Sync)) {
    JsonVariantConst data = response["data"];
    if (!data.is<JsonObjectConst>()) {
      fail(CloudJobType::Sync, CloudErrorCode::InvalidResponse, status, "The server returned no sync data");
    } else {
      parseSync(data);
      syncFresh_ = true;
      emit(EventType::CloudSyncDone, CloudJobType::Sync);
      delivered = true;
    }
  }

  // Keep syncQueued_ set until the response has been handled so a second sync
  // cannot be built while this one is in flight and overwrite sent counts.
  if (xSemaphoreTake(syncMutex_, portMAX_DELAY) == pdTRUE) {
    syncQueued_ = false;
    xSemaphoreGive(syncMutex_);
  }
  return delivered;
}

bool Cloud::postStatus(CloudJob& job) {
  int status = httpPost(AGNES_FUNCTION_STATUS, job.payload, strlen(job.payload), true);
  JsonDocument response;
  if (!parseEnvelope(response, status, CloudJobType::Status)) return false;
  emit(EventType::CloudStatusDone, CloudJobType::Status);
  return true;
}

bool Cloud::postWeather() {
  String body = "{\"action\":\"weather\"}";
  int status = httpPost(AGNES_FUNCTION_TOOLS, body.c_str(), body.length(), true);
  JsonDocument response;
  if (!parseEnvelope(response, status, CloudJobType::Weather)) return false;
  JsonVariantConst data = response["data"];
  if (!data.is<JsonObjectConst>()) {
    fail(CloudJobType::Weather, CloudErrorCode::InvalidResponse, status, "The tool returned no data");
    return false;
  }
  parseWeather(data);
  toolFresh_ = true;
  emit(EventType::CloudToolDone, CloudJobType::Weather);
  return true;
}

int Cloud::httpPost(const char* path, const char* body, size_t length, bool needsAuth) {
  if (!wifi_ || !wifi_->connected()) return kHttpOffline;
  if (strstr(AGNES_SUPABASE_URL, "REPLACE-WITH") != nullptr) return kHttpNotConfigured;
  if (!responseBuffer_) return 0;
  responseBuffer_[0] = '\0';

  String url = String(AGNES_SUPABASE_URL) + path;
  esp_http_client_config_t config = {};
  config.url = url.c_str();
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = AGNES_HTTP_TIMEOUT_MS;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.buffer_size = 4096;
  config.buffer_size_tx = 1024;
  config.disable_auto_redirect = true;
  config.user_agent = "AGNES-OS/2.0";

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return 0;

  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "Accept", "application/json");
  esp_http_client_set_header(client, "X-Client-Info", "agnes-firmware/2.0");
  if (strlen(AGNES_SUPABASE_ANON_KEY) > 0) {
    esp_http_client_set_header(client, "apikey", AGNES_SUPABASE_ANON_KEY);
  }
  if (needsAuth && storage_ && storage_->hasDevice()) {
    esp_http_client_set_header(client, "x-agnes-device-id", storage_->deviceId());
    esp_http_client_set_header(client, "x-agnes-device-token", storage_->token());
  }

  if (esp_http_client_open(client, (int)length) != ESP_OK) {
    esp_http_client_cleanup(client);
    return 0;
  }

  size_t written = 0;
  while (written < length) {
    int result = esp_http_client_write(client, body + written, (int)(length - written));
    if (result <= 0) break;
    written += (size_t)result;
  }
  if (written != length) {
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return 0;
  }

  int64_t contentLength = esp_http_client_fetch_headers(client);
  int status = esp_http_client_get_status_code(client);
  if (status <= 0) {
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return 0;
  }

  bool tooLarge = contentLength > AGNES_HTTP_BODY_MAX;
  size_t total = 0;
  if (!tooLarge) {
    int limit = contentLength > 0 ? (int)contentLength : AGNES_HTTP_BODY_MAX;
    if (limit > AGNES_HTTP_BODY_MAX) limit = AGNES_HTTP_BODY_MAX;
    while ((int)total < limit) {
      int result = esp_http_client_read(client, responseBuffer_ + total, limit - (int)total);
      if (result < 0) {
        total = 0;
        status = 0;
        break;
      }
      if (result == 0) break;
      total += (size_t)result;
    }
    if (contentLength < 0 && total >= AGNES_HTTP_BODY_MAX) {
      char extra = 0;
      if (esp_http_client_read(client, &extra, 1) > 0) tooLarge = true;
    }
  }
  responseBuffer_[total] = '\0';

  esp_http_client_close(client);
  esp_http_client_cleanup(client);

  if (tooLarge) {
    responseBuffer_[0] = '\0';
    return kHttpTooLarge;
  }
  return status;
}

bool Cloud::parseEnvelope(JsonDocument& doc, int status, CloudJobType jobType) {
  if (status == kHttpOffline) {
    fail(jobType, CloudErrorCode::Offline, 0, "Wi-Fi is offline; cloud AI is unavailable");
    return false;
  }
  if (status == kHttpNotConfigured) {
    fail(jobType, CloudErrorCode::NotConfigured, 0,
         "Set AGNES_SUPABASE_URL in Config.h before flashing");
    return false;
  }
  if (status == kHttpTooLarge) {
    fail(jobType, CloudErrorCode::InvalidResponse, 0, "The server response was too large");
    return false;
  }
  if (status <= 0) {
    fail(jobType, CloudErrorCode::Network, 0, "Network or TLS request failed");
    return false;
  }

  DeserializationError error = deserializeJson(doc, responseBuffer_);
  if (error) {
    fail(jobType, CloudErrorCode::InvalidResponse, status, "The server returned invalid JSON");
    return false;
  }
  if (status < 200 || status >= 300) {
    failFromDocument(jobType, status, doc);
    return false;
  }
  if (!(doc["ok"] | false)) {
    failFromDocument(jobType, status >= 400 ? status : 502, doc);
    return false;
  }
  return true;
}

void Cloud::fail(CloudJobType jobType, CloudErrorCode code, int status, const char* message) {
  error_.code = code;
  error_.httpStatus = status;
  if (!message || !message[0]) {
    switch (code) {
      case CloudErrorCode::Offline: message = "Cloud AI is unavailable while offline"; break;
      case CloudErrorCode::NotConfigured: message = "The Supabase URL is not configured"; break;
      case CloudErrorCode::Network: message = "Network request failed"; break;
      case CloudErrorCode::Timeout: message = "The request timed out"; break;
      case CloudErrorCode::Unauthorized: message = "Authentication failed; re-pair the device"; break;
      case CloudErrorCode::Revoked: message = "This device was revoked; re-pair it"; break;
      case CloudErrorCode::RateLimited: message = "Too many requests; wait a moment"; break;
      case CloudErrorCode::Server: message = "The server reported an error"; break;
      case CloudErrorCode::InvalidResponse: message = "The server response was not valid"; break;
      case CloudErrorCode::Provider: message = "The AI provider is unavailable"; break;
      case CloudErrorCode::Rejected: message = "The request was rejected"; break;
      case CloudErrorCode::Busy: message = "The network queue is full"; break;
      default: message = "Request failed"; break;
    }
  }
  AgnesUtil::asciiCopy(error_.message, sizeof(error_.message), message);
  errorFresh_ = true;
  emit(errorEvent(jobType), jobType, (uint8_t)code);
}

void Cloud::failFromDocument(CloudJobType jobType, int status, JsonDocument& doc) {
  const char* code = serverErrorCode(doc);
  const char* message = serverErrorMessage(doc);
  CloudErrorCode mapped = CloudErrorCode::Rejected;

  if (strcmp(code, "device_revoked") == 0) {
    mapped = CloudErrorCode::Revoked;
  } else if (strcmp(code, "rate_limited") == 0 || status == 429) {
    mapped = CloudErrorCode::RateLimited;
  } else if (status == 401 || status == 403 || strcmp(code, "unauthorized") == 0) {
    mapped = CloudErrorCode::Unauthorized;
  } else if (status >= 500) {
    mapped = CloudErrorCode::Server;
  } else if (strncmp(code, "provider_", 9) == 0 ||
             strcmp(code, "all_providers_failed") == 0 ||
             strcmp(code, "model_unavailable") == 0) {
    mapped = CloudErrorCode::Provider;
  } else if (strcmp(code, "device_not_paired") == 0) {
    mapped = CloudErrorCode::Unauthorized;
  }

  if (!message[0]) message = code[0] ? code : "The server rejected the request";
  fail(jobType, mapped, status, message);
}

EventType Cloud::doneEvent(CloudJobType jobType) const {
  switch (jobType) {
    case CloudJobType::Pair: return EventType::CloudPairDone;
    case CloudJobType::Verify: return EventType::CloudAuthDone;
    case CloudJobType::ChatStart:
    case CloudJobType::ChatResume:
    case CloudJobType::ChatSelect:
    case CloudJobType::ChatMessage: return EventType::CloudChatDone;
    case CloudJobType::Sync: return EventType::CloudSyncDone;
    case CloudJobType::Status: return EventType::CloudStatusDone;
    case CloudJobType::Weather: return EventType::CloudToolDone;
    default: return EventType::CloudChatDone;
  }
}

EventType Cloud::errorEvent(CloudJobType jobType) const {
  switch (jobType) {
    case CloudJobType::Pair: return EventType::CloudPairError;
    case CloudJobType::Verify: return EventType::CloudAuthError;
    case CloudJobType::ChatStart:
    case CloudJobType::ChatResume:
    case CloudJobType::ChatSelect:
    case CloudJobType::ChatMessage: return EventType::CloudChatError;
    case CloudJobType::Sync: return EventType::CloudSyncError;
    case CloudJobType::Status: return EventType::CloudStatusError;
    case CloudJobType::Weather: return EventType::CloudToolError;
    default: return EventType::CloudChatError;
  }
}

void Cloud::emit(EventType type, CloudJobType jobType, uint8_t code) {
  if (events_) events_->push(type, code, (int32_t)jobType, 0);
}

void Cloud::parseSettings(JsonVariantConst value, CloudSettings& out) {
  if (!value.is<JsonObjectConst>()) return;
  JsonObjectConst obj = value.as<JsonObjectConst>();
  out.valid = true;
  out.settings = AgnesSettings();

  const char* personality = obj["personality"] | "friendly";
  AgnesUtil::copyString(out.settings.personality, sizeof(out.settings.personality),
                        personalityName(personalityFromString(personality)));
  const char* theme = obj["theme"] | "cyber";
  if (strcmp(theme, "minimal") == 0 || strcmp(theme, "retro") == 0) {
    AgnesUtil::copyString(out.settings.theme, sizeof(out.settings.theme), theme);
  } else {
    AgnesUtil::copyString(out.settings.theme, sizeof(out.settings.theme), "cyber");
  }
  out.settings.brightness = (uint8_t)AgnesUtil::clampInt(obj["brightness"] | 160, 1, 255);
  out.settings.idleAnimations = obj["idle_animations"] | true;
  out.settings.sleepTimeoutSeconds =
    (uint16_t)AgnesUtil::clampInt(obj["sleep_timeout_seconds"] | 120, 30, 3600);
  out.settings.cloudMemoryEnabled = obj["cloud_memory_enabled"] | true;
  out.settings.notificationsEnabled = obj["notifications_enabled"] | true;
  const char* timezone = obj["timezone_posix"] | "UTC0";
  AgnesUtil::copyString(out.settings.timezonePosix, sizeof(out.settings.timezonePosix), timezone);

  bool hasLat = !obj["latitude"].isNull() && obj["latitude"].is<float>();
  bool hasLon = !obj["longitude"].isNull() && obj["longitude"].is<float>();
  if (!hasLat && obj["latitude"].is<int>()) hasLat = true;
  if (!hasLon && obj["longitude"].is<int>()) hasLon = true;
  if (hasLat && hasLon) {
    out.settings.hasLocation = true;
    out.settings.latitude = obj["latitude"].as<float>();
    out.settings.longitude = obj["longitude"].as<float>();
  } else {
    out.settings.hasLocation = false;
    out.settings.latitude = 0.0f;
    out.settings.longitude = 0.0f;
  }
  out.settings.settingsVersion = obj["sync_version"] | 0UL;
}

void Cloud::parsePet(JsonVariantConst value, PetState& out, bool& valid) {
  valid = false;
  if (!value.is<JsonObjectConst>()) return;
  out = PetState();
  copyAscii(value["name"], out.name, sizeof(out.name));
  if (!out.name[0]) AgnesUtil::copyString(out.name, sizeof(out.name), "Agnes");
  out.happiness = (uint8_t)AgnesUtil::clampInt(value["happiness"] | 70, 0, 100);
  out.energy = (uint8_t)AgnesUtil::clampInt(value["energy"] | 80, 0, 100);
  out.hunger = (uint8_t)AgnesUtil::clampInt(value["hunger"] | 20, 0, 100);
  out.friendshipXp = (uint16_t)AgnesUtil::clampInt(value["friendship_xp"] | 0, 0, 65535);
  out.level = (uint8_t)AgnesUtil::clampInt(value["level"] | 1, 1, 255);
  copyAscii(value["stage"], out.stage, sizeof(out.stage));
  if (!out.stage[0]) AgnesUtil::copyString(out.stage, sizeof(out.stage), "newborn");
  out.lastDecayEpoch = isoEpoch(value["last_decay_at"]);
  out.version = value["version"] | 1UL;
  valid = true;
}

void Cloud::parseChat(JsonVariantConst data) {
  chatResult_ = ChatReply();
  chatFresh_ = false;
  copyAscii(data["conversation_id"], chatResult_.conversationId, sizeof(chatResult_.conversationId));
  copyAscii(data["reply"], chatResult_.reply, sizeof(chatResult_.reply));
  copyAscii(data["emotion"], chatResult_.emotion, sizeof(chatResult_.emotion));
  copyAscii(data["animation"], chatResult_.animation, sizeof(chatResult_.animation));
  copyAscii(data["provider"], chatResult_.provider, sizeof(chatResult_.provider));
  copyAscii(data["model"], chatResult_.model, sizeof(chatResult_.model));
  chatResult_.intensity = (uint8_t)AgnesUtil::clampInt(data["intensity"] | 1, 1, 3);
  chatResult_.moodDelta = (int8_t)AgnesUtil::clampInt(data["mood_delta"] | 0, -3, 3);

  const char* warning = data["warning"] | "";
  bool fallback = data["fallback_used"] | false;
  if (warning[0]) {
    AgnesUtil::asciiCopy(chatResult_.warning, sizeof(chatResult_.warning), warning);
  } else if (fallback) {
    AgnesUtil::copyString(chatResult_.warning, sizeof(chatResult_.warning), "fallback model used");
  }

  JsonVariantConst question = data["question"];
  if (question.is<JsonObjectConst>()) {
    copyAscii(question["id"], chatResult_.questionId, sizeof(chatResult_.questionId));
    copyAscii(question["text"], chatResult_.question, sizeof(chatResult_.question));
    JsonArrayConst options = question["options"].as<JsonArrayConst>();
    chatResult_.optionCount = 0;
    for (JsonVariantConst option : options) {
      if (chatResult_.optionCount >= 3) break;
      ChatOption& target = chatResult_.options[chatResult_.optionCount];
      copyAscii(option["id"], target.id, sizeof(target.id));
      copyAscii(option["label"], target.label, sizeof(target.label));
      if (target.id[0] && target.label[0]) chatResult_.optionCount++;
    }
    chatResult_.questionExpiresEpoch = isoEpoch(question["expires_at"]);
    chatResult_.hasQuestion = chatResult_.questionId[0] && chatResult_.question[0] &&
                              chatResult_.optionCount == 3;
  } else {
    chatResult_.hasQuestion = false;
    chatResult_.optionCount = 0;
  }

  if (!chatResult_.emotion[0]) AgnesUtil::copyString(chatResult_.emotion,
                                                     sizeof(chatResult_.emotion), "normal");
  if (!chatResult_.animation[0]) AgnesUtil::copyString(chatResult_.animation,
                                                       sizeof(chatResult_.animation), "none");
}

void Cloud::parseSync(JsonVariantConst data) {
  syncResult_ = CloudSyncResult();
  syncFresh_ = false;

  parseSettings(data["settings"], syncResult_.settings);
  parsePet(data["pet_state"], syncResult_.pet, syncResult_.petValid);

  copyAscii(data["conversation"]["id"], syncResult_.conversationId,
            sizeof(syncResult_.conversationId));
  syncResult_.serverEpoch = isoEpoch(data["server_time"]);
  syncResult_.settingsVersion = data["settings_version"] | 0UL;
  syncResult_.cloudMemoryEnabled =
    syncResult_.settings.valid ? syncResult_.settings.settings.cloudMemoryEnabled : true;

  JsonArrayConst notes = data["notes"].as<JsonArrayConst>();
  for (JsonVariantConst note : notes) {
    if (syncResult_.noteCount >= 10) break;
    CloudNote& target = syncResult_.notes[syncResult_.noteCount];
    copyAscii(note["id"], target.id, sizeof(target.id));
    copyAscii(note["title"], target.title, sizeof(target.title));
    copyAscii(note["body"], target.body, sizeof(target.body));
    target.pinned = note["pinned"] | false;
    target.version = note["version"] | 1UL;
    if (target.id[0]) syncResult_.noteCount++;
  }

  JsonArrayConst memories = data["memories"].as<JsonArrayConst>();
  for (JsonVariantConst memory : memories) {
    if (syncResult_.memoryCount >= AGNES_LOCAL_MEMORY_MAX) break;
    CloudMemory& target = syncResult_.memories[syncResult_.memoryCount];
    copyAscii(memory["id"], target.id, sizeof(target.id));
    copyAscii(memory["category"], target.category, sizeof(target.category));
    copyAscii(memory["content"], target.content, sizeof(target.content));
    target.pinned = memory["pinned"] | false;
    if (target.id[0]) syncResult_.memoryCount++;
  }

  JsonArrayConst notifications = data["notifications"].as<JsonArrayConst>();
  for (JsonVariantConst notification : notifications) {
    if (syncResult_.notificationCount >= 5) break;
    CloudNotification& target = syncResult_.notifications[syncResult_.notificationCount];
    copyAscii(notification["id"], target.id, sizeof(target.id));
    copyAscii(notification["title"], target.title, sizeof(target.title));
    copyAscii(notification["body"], target.body, sizeof(target.body));
    copyAscii(notification["kind"], target.kind, sizeof(target.kind));
    if (target.id[0]) syncResult_.notificationCount++;
  }

  JsonArrayConst commands = data["commands"].as<JsonArrayConst>();
  for (JsonVariantConst command : commands) {
    if (syncResult_.commandCount >= 8) break;
    CloudCommand& target = syncResult_.commands[syncResult_.commandCount];
    copyAscii(command["id"], target.id, sizeof(target.id));
    copyAscii(command["type"], target.type, sizeof(target.type));
    serializeJson(command["payload"], target.payload, sizeof(target.payload));
    target.expiresEpoch = isoEpoch(command["expires_at"]);
    if (target.id[0] && target.type[0]) syncResult_.commandCount++;
  }

  JsonVariantConst question = data["pending_question"];
  if (question.is<JsonObjectConst>()) {
    copyAscii(question["id"], syncResult_.questionId, sizeof(syncResult_.questionId));
    copyAscii(question["text"], syncResult_.questionText, sizeof(syncResult_.questionText));
    JsonArrayConst options = question["options"].as<JsonArrayConst>();
    syncResult_.questionOptionCount = 0;
    for (JsonVariantConst option : options) {
      if (syncResult_.questionOptionCount >= 3) break;
      ChatOption& target = syncResult_.questionOptions[syncResult_.questionOptionCount];
      copyAscii(option["id"], target.id, sizeof(target.id));
      copyAscii(option["label"], target.label, sizeof(target.label));
      if (target.id[0] && target.label[0]) syncResult_.questionOptionCount++;
    }
  }
  syncResult_.hasPendingQuestion = syncResult_.questionId[0] &&
    syncResult_.questionText[0] && syncResult_.questionOptionCount == 3;
  syncResult_.valid = true;
}

void Cloud::parsePair(JsonVariantConst data) {
  pairResult_ = CloudPairResult();
  pairFresh_ = false;
  copyAscii(data["device_id"], pairResult_.deviceId, sizeof(pairResult_.deviceId));
  copyAscii(data["device_token"], pairResult_.token, sizeof(pairResult_.token));
  copyAscii(data["name"], pairResult_.name, sizeof(pairResult_.name));
  parseSettings(data["settings"], pairResult_.settings);
  parsePet(data["pet_state"], pairResult_.pet, pairResult_.petValid);
  pairResult_.serverEpoch = isoEpoch(data["server_time"]);
  pairResult_.valid = pairResult_.deviceId[0] && pairResult_.token[0];
}

void Cloud::parseAuth(JsonVariantConst data) {
  authResult_ = CloudAuthResult();
  authFresh_ = false;
  copyAscii(data["device"]["name"], authResult_.name, sizeof(authResult_.name));
  parseSettings(data["settings"], authResult_.settings);
  parsePet(data["pet_state"], authResult_.pet, authResult_.petValid);
  authResult_.serverEpoch = isoEpoch(data["server_time"]);
  authResult_.valid = true;
}

void Cloud::parseWeather(JsonVariantConst data) {
  toolResult_ = CloudToolResult();
  toolFresh_ = false;
  AgnesUtil::copyString(toolResult_.title, sizeof(toolResult_.title), "WEATHER");
  float temperature = data["temperature_c"] | 0.0f;
  float feels = data["apparent_temperature_c"] | 0.0f;
  int humidity = data["humidity_percent"] | 0;
  float wind = data["wind_kmh"] | 0.0f;
  const char* condition = data["condition"] | "Unknown";
  const char* location = data["location_name"] | "";
  toolResult_.observedEpoch = isoEpoch(data["observed_at"]);
  if (location && location[0]) {
    snprintf(toolResult_.body, sizeof(toolResult_.body),
             "%.1f C (feels %.1f)\nHumidity %d%%\nWind %.0f km/h\n%s\n%s",
             temperature, feels, humidity, wind, condition, location);
  } else {
    snprintf(toolResult_.body, sizeof(toolResult_.body),
             "%.1f C (feels %.1f)\nHumidity %d%%\nWind %.0f km/h\n%s\nSet a location in the dashboard",
             temperature, feels, humidity, wind, condition);
  }
  toolResult_.valid = true;
}

bool Cloud::takeChat(ChatReply& out) {
  if (!chatFresh_) return false;
  out = chatResult_;
  chatFresh_ = false;
  return true;
}

bool Cloud::takePair(CloudPairResult& out) {
  if (!pairFresh_) return false;
  out = pairResult_;
  pairFresh_ = false;
  return true;
}

bool Cloud::takeAuth(CloudAuthResult& out) {
  if (!authFresh_) return false;
  out = authResult_;
  authFresh_ = false;
  return true;
}

bool Cloud::takeTool(CloudToolResult& out) {
  if (!toolFresh_) return false;
  out = toolResult_;
  toolFresh_ = false;
  return true;
}

bool Cloud::takeError(CloudError& out) {
  if (!errorFresh_) return false;
  out = error_;
  errorFresh_ = false;
  return true;
}
