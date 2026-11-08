#include "UI.h"
#include "Util.h"
#include <esp_random.h>
#include <esp_system.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

using AgnesUtil::nowEpoch;

namespace {

const char* kAppNames[] = {
  "Chat", "Pet", "Memories", "Notes", "Notifications", "Weather",
  "Clock", "Timer", "Stopwatch", "Calculator", "Dice", "Coin Flip",
  "Mood Log", "Sync", "Settings", "Diagnostics", "Wi-Fi Setup", "About",
};

const uint16_t kTimerPresets[] = {1, 3, 5, 10, 15, 30, 60};
const uint8_t kTimerPresetCount = sizeof(kTimerPresets) / sizeof(kTimerPresets[0]);
const uint8_t kDiceSides[] = {4, 6, 8, 10, 12, 20};
const uint8_t kDiceSidesCount = sizeof(kDiceSides) / sizeof(kDiceSides[0]);
const char* kPetActions[] = {"Feed", "Play", "Rest", "Pet"};

void formatAge(uint32_t sinceMs, char* out, size_t capacity) {
  if (sinceMs == 0) {
    AgnesUtil::copyString(out, capacity, "never");
    return;
  }
  AgnesUtil::formatDuration((millis() - sinceMs) / 1000UL, out, capacity);
}

const char* resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "other";
  }
}

const char* cloudJobName(CloudJobType type) {
  switch (type) {
    case CloudJobType::Pair: return "pair";
    case CloudJobType::Verify: return "verify";
    case CloudJobType::ChatStart: return "chat start";
    case CloudJobType::ChatResume: return "chat resume";
    case CloudJobType::ChatSelect: return "chat select";
    case CloudJobType::ChatMessage: return "chat msg";
    case CloudJobType::Sync: return "sync";
    case CloudJobType::Status: return "status";
    case CloudJobType::Weather: return "weather";
    default: return "idle";
  }
}

bool validTheme(const char* theme) {
  return theme && (strcmp(theme, "cyber") == 0 || strcmp(theme, "minimal") == 0 ||
                   strcmp(theme, "retro") == 0);
}

void drawDie(U8G2& g, int cx, int cy, int size, uint8_t value) {
  g.drawRFrame(cx - size / 2, cy - size / 2, size, size, 4);
  int d = size / 5;
  int l = cx - size / 4;
  int r = cx + size / 4;
  int t = cy - size / 4;
  int b = cy + size / 4;
  switch (value) {
    case 1:
      g.drawDisc(cx, cy, 2, U8G2_DRAW_ALL);
      break;
    case 2:
      g.drawDisc(l, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, b, 2, U8G2_DRAW_ALL);
      break;
    case 3:
      g.drawDisc(l, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(cx, cy, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, b, 2, U8G2_DRAW_ALL);
      break;
    case 4:
      g.drawDisc(l, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(l, b, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, b, 2, U8G2_DRAW_ALL);
      break;
    case 5:
      g.drawDisc(l, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(cx, cy, 2, U8G2_DRAW_ALL);
      g.drawDisc(l, b, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, b, 2, U8G2_DRAW_ALL);
      break;
    case 6:
      g.drawDisc(l, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, t, 2, U8G2_DRAW_ALL);
      g.drawDisc(l, cy, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, cy, 2, U8G2_DRAW_ALL);
      g.drawDisc(l, b, 2, U8G2_DRAW_ALL);
      g.drawDisc(r, b, 2, U8G2_DRAW_ALL);
      break;
    default:
      break;
  }
  (void)d;
}

}  // namespace

bool UI::begin(Display& display, Face& face, Buttons& buttons, Battery& battery,
               Power& power, WifiManager& wifi, Cloud& cloud, Storage& storage,
               MoodEngine& mood, PetEngine& pet, EventBus& events) {
  display_ = &display;
  face_ = &face;
  buttons_ = &buttons;
  battery_ = &battery;
  power_ = &power;
  wifi_ = &wifi;
  cloud_ = &cloud;
  storage_ = &storage;
  mood_ = &mood;
  pet_ = &pet;
  events_ = &events;

  storage_->loadSettings(settings_);
  appliedVersion_ = storage_->loadAppliedVersion();
  readCount_ = storage_->loadReadNotifications(readIds_, AGNES_NOTIFICATION_READ_MAX);
  ackCount_ = storage_->loadAcks(acks_, 20);
  refreshNotes();
  refreshMemories();
  refreshNotifications();

  chat_.begin(cloud, storage, mood);
  chat_.updateConnectivity(wifi.connected(), storage.hasDevice());
  applyLocalSettings();

  bootUntil_ = millis() + 1600;
  lastInputAt_ = millis();
  lastDrawAt_ = 0;
  screen_ = Screen::Boot;
  screenOn_ = true;
  display_->setPower(true);

  // First sync attempt follows the Wi-Fi connection; this keeps boot honest
  // when the network or dashboard is unavailable.
  nextSyncAt_ = millis() + 2000;
  nextStatusAt_ = millis() + 5000;
  nextVerifyAt_ = millis() + 1000;
  nextPairCheckAt_ = millis() + 500;
  return true;
}

void UI::update() {
  if (!display_ || !cloud_) return;

  wifi_->loop();

  ButtonEvent button;
  while (buttons_->poll(button)) handleButton(button);

  Event event;
  while (events_->pop(event)) handleEvent(event);

  battery_->update();
  uint32_t now = millis();
  chat_.updateConnectivity(wifi_->connected(), storage_->hasDevice());

  if (now >= bootUntil_ && screen_ == Screen::Boot) {
    screen_ = Screen::Home;
    lastInputAt_ = now;
  }

  if (nowEpoch() != 0) pet_->decay(nowEpoch());

  if (now >= nextPairCheckAt_) {
    nextPairCheckAt_ = now + 10000;
    maybePair();
  }

  if (wifi_->connected() && storage_->hasDevice()) {
    maybeVerify();
    if (!cloud_->busy() && cloud_->queueDepth() < 3) {
      if ((int32_t)(now - nextSyncAt_) >= 0) requestSync();
      if ((int32_t)(now - nextStatusAt_) >= 0) requestStatus();
    }
  }

  updateTimer(now);

  if (restartPending_ && (int32_t)(now - restartAt_) >= 0) {
    if (!cloud_->busy() || (uint32_t)(now - restartAt_) > 8000UL) {
      AGNES_LOG("Restarting after remote DEVICE_RESTART command");
      display_->setPower(false);
      ESP.restart();
    }
  }

  updateIdle(now);

  if (screenOn_ && (uint32_t)(now - lastDrawAt_) >= 50UL) {
    lastDrawAt_ = now;
    draw();
  }
}

// ---------------------------------------------------------------------------
// Events and cloud results
// ---------------------------------------------------------------------------

void UI::handleEvent(const Event& event) {
  switch (event.type) {
    case EventType::WifiConnected:
      onWifiConnected();
      break;
    case EventType::WifiDisconnected:
      verified_ = false;
      verifyRequested_ = false;
      showToast("Wi-Fi disconnected");
      break;
    case EventType::CloudChatDone: {
      ChatReply reply;
      if (cloud_->takeChat(reply)) onChatReply(reply);
      break;
    }
    case EventType::CloudChatError: {
      CloudError error;
      if (cloud_->takeError(error)) onChatError(error);
      break;
    }
    case EventType::CloudSyncDone:
      handleSyncResult();
      break;
    case EventType::CloudSyncError: {
      CloudError error;
      if (cloud_->takeError(error)) describeCloudError(error);
      break;
    }
    case EventType::CloudPairDone:
      handlePairResult();
      break;
    case EventType::CloudPairError: {
      CloudError error;
      if (cloud_->takeError(error)) {
        bool retryable = error.code == CloudErrorCode::Network ||
                         error.code == CloudErrorCode::Timeout ||
                         error.code == CloudErrorCode::Server ||
                         error.code == CloudErrorCode::Busy ||
                         error.code == CloudErrorCode::Offline;
        if (retryable && pairCodeInFlight_[0]) {
          storage_->savePairingCode(pairCodeInFlight_);
          pairingAttempted_ = false;
          nextPairCheckAt_ = millis() + 15000;
        } else {
          pairingAttempted_ = true;
        }
        pairCodeInFlight_[0] = '\0';
        describeCloudError(error);
      }
      break;
    }
    case EventType::CloudAuthDone:
      handleAuthResult();
      break;
    case EventType::CloudAuthError: {
      CloudError error;
      if (cloud_->takeError(error)) {
        verifyRequested_ = false;
        nextVerifyAt_ = millis() + 300000;
        describeCloudError(error);
      }
      break;
    }
    case EventType::CloudToolDone: {
      if ((CloudJobType)event.a == CloudJobType::Weather) {
        CloudToolResult result;
        if (cloud_->takeTool(result)) {
          weather_ = result;
          weatherValid_ = true;
          weatherLoading_ = false;
          weatherPage_ = 0;
        }
      }
      break;
    }
    case EventType::CloudToolError: {
      CloudError error;
      if (cloud_->takeError(error)) {
        weatherLoading_ = false;
        describeCloudError(error);
      }
      break;
    }
    case EventType::CloudStatusDone:
      break;
    case EventType::CloudStatusError: {
      CloudError error;
      if (cloud_->takeError(error)) {
        AgnesUtil::asciiCopy(lastError_, sizeof(lastError_), error.message);
        lastErrorAt_ = millis();
      }
      break;
    }
    default:
      break;
  }
}

void UI::onChatReply(const ChatReply& reply) {
  chat_.onReply(reply);
  if (screen_ == Screen::Chat) lastInputAt_ = millis();
  if (reply.warning[0]) showToast(reply.warning);
  if (reply.hasQuestion) {
    // A new reply is ready; keep the user on the reply text first.
    chat_.showReply();
  }
}

void UI::onChatError(const CloudError& error) {
  chat_.onError(error);
  describeCloudError(error);
}

void UI::handleSyncResult() {
  if (!cloud_->syncFresh()) return;
  const CloudSyncResult& result = cloud_->syncResult();

  if (result.serverEpoch > 0) AgnesUtil::setEpoch(result.serverEpoch);
  applyCloudSettings(result.settings, false);
  if (result.petValid) pet_->adopt(result.pet);

  // Remove the exact items sent in this request before adding command acks.
  pet_->clearPendingEvents((uint8_t)sentPetCount_);
  removeSentAcks();
  removeSentReads();

  if (storage_) {
    storage_->saveNotes(result.notes, result.noteCount);
    storage_->saveMemories(result.memories, result.memoryCount);

    CloudNotification filtered[AGNES_NOTIFICATION_CACHE_MAX];
    uint8_t filteredCount = 0;
    for (uint8_t i = 0; i < result.notificationCount &&
                        filteredCount < AGNES_NOTIFICATION_CACHE_MAX; ++i) {
      if (hasReadId(result.notifications[i].id)) continue;
      filtered[filteredCount++] = result.notifications[i];
    }
    storage_->saveNotifications(filtered, filteredCount);
    notificationCount_ = filteredCount;
    for (uint8_t i = 0; i < filteredCount; ++i) notifications_[i] = filtered[i];
  }

  chat_.adoptPendingQuestion(result);

  if (screen_ == Screen::AppRun && app_ == AppId::Notes) refreshNotes();
  if (screen_ == Screen::Memory) refreshMemories();
  if (screen_ == Screen::Notifications) refreshNotifications();

  for (uint8_t i = 0; i < result.commandCount; ++i) {
    executeCommand(result.commands[i]);
  }

  lastSyncAt_ = millis();
  verified_ = true;
  verifyRequested_ = false;
  cloud_->consumeSync();
  nextSyncAt_ = millis() + AGNES_SYNC_INTERVAL_MS;

  if (ackCount_ > 0 && wifi_->connected() && storage_->hasDevice()) {
    requestSync();  // Deliver command acknowledgements promptly.
  }
}

void UI::handlePairResult() {
  CloudPairResult result;
  if (!cloud_->takePair(result)) return;
  if (!result.valid || strlen(result.deviceId) != 36 || strlen(result.token) != 64) {
    pairingAttempted_ = true;
    showToast("Invalid pairing response");
    return;
  }
  storage_->saveDevice(result.deviceId, result.token, result.name);
  if (result.name[0]) storage_->saveDeviceName(result.name);
  if (result.serverEpoch > 0) AgnesUtil::setEpoch(result.serverEpoch);
  applyCloudSettings(result.settings, true);
  if (result.petValid) pet_->adopt(result.pet);

  pairCodeInFlight_[0] = '\0';
  pairingAttempted_ = true;
  verified_ = true;
  verifyRequested_ = false;
  screen_ = Screen::Home;
  chat_.updateConnectivity(wifi_->connected(), true);
  showToast("Paired. Dashboard connected.");
  requestSync();
}

void UI::handleAuthResult() {
  CloudAuthResult result;
  if (!cloud_->takeAuth(result)) return;
  if (!result.valid) return;
  verified_ = true;
  verifyRequested_ = false;
  nextVerifyAt_ = millis() + 900000;
  if (result.name[0]) storage_->saveDeviceName(result.name);
  if (result.serverEpoch > 0) AgnesUtil::setEpoch(result.serverEpoch);
  applyCloudSettings(result.settings, false);
  if (result.petValid) pet_->adopt(result.pet);
}

void UI::onWifiConnected() {
  verified_ = false;
  verifyRequested_ = false;
  nextVerifyAt_ = millis();
  nextSyncAt_ = millis() + 1000;
  nextStatusAt_ = millis() + 3000;
  nextPairCheckAt_ = millis();
  showToast("Wi-Fi connected");
}

void UI::applyCloudSettings(const CloudSettings& cloud, bool initial) {
  if (!cloud.valid) return;
  uint32_t version = cloud.settings.settingsVersion;
  if (!initial) {
    if (version == 0 || version <= appliedVersion_) return;
  }
  settings_ = cloud.settings;
  settings_.settingsVersion = version;
  appliedVersion_ = version;
  storage_->saveSettings(settings_);
  storage_->saveAppliedVersion(appliedVersion_);
  applyLocalSettings();
  if (screen_ != Screen::Boot && version > 0) showToast("Cloud settings updated");
}

void UI::applyLocalSettings() {
  display_->setBrightness(settings_.brightness);
  display_->setTheme(settings_.theme);
  setenv("TZ", settings_.timezonePosix, 1);
  tzset();
}

void UI::buildStatus(DeviceStatus& status) const {
  status = DeviceStatus();
  status.batteryMv = battery_->millivolts();
  status.batteryPercent = battery_->percent();
  status.rssi = wifi_->rssi();
  status.freeHeap = ESP.getFreeHeap();
  status.uptimeSeconds = millis() / 1000UL;
  status.emotion = mood_->current();
  status.personality = (uint8_t)personalityFromString(settings_.personality);
  status.valid = true;
}

void UI::requestSync() {
  if (!cloud_ || !wifi_->connected() || !storage_->hasDevice()) {
    nextSyncAt_ = millis() + 10000;
    return;
  }
  if (cloud_->queueDepth() > 4) {
    nextSyncAt_ = millis() + 5000;
    return;
  }

  DeviceStatus status;
  buildStatus(status);

  PendingPetEvent pendingPet[8];
  uint8_t petCount = pet_->pendingEvents(pendingPet, 8);

  bool queued = cloud_->enqueueSync(
    appliedVersion_, status, pendingPet, petCount, acks_, ackCount_,
    (const char (*)[40])readIds_, readCount_);
  if (queued) {
    sentPetCount_ = petCount;
    sentAckCount_ = ackCount_;
    sentReadCount_ = readCount_;
    nextSyncAt_ = millis() + AGNES_SYNC_INTERVAL_MS;
  } else {
    nextSyncAt_ = millis() + 10000;
  }
}

void UI::requestStatus() {
  if (!cloud_ || !wifi_->connected() || !storage_->hasDevice()) {
    nextStatusAt_ = millis() + 30000;
    return;
  }
  DeviceStatus status;
  buildStatus(status);
  if (cloud_->enqueueStatus(status, lastError_)) {
    nextStatusAt_ = millis() + AGNES_STATUS_INTERVAL_MS;
  } else {
    nextStatusAt_ = millis() + 30000;
  }
}

void UI::maybeVerify() {
  if (verified_ || verifyRequested_ || !wifi_->connected() || !storage_->hasDevice()) return;
  uint32_t now = millis();
  if ((int32_t)(now - nextVerifyAt_) < 0) return;
  if (cloud_->queueDepth() > 4) {
    nextVerifyAt_ = now + 10000;
    return;
  }
  if (cloud_->enqueueVerify()) {
    verifyRequested_ = true;
    nextVerifyAt_ = now + 60000;
  } else {
    nextVerifyAt_ = now + 15000;
  }
}

void UI::maybePair() {
  if (!storage_ || !wifi_ || !cloud_) return;
  if (storage_->hasDevice() || pairingAttempted_ || !wifi_->connected()) return;
  char code[32];
  if (!storage_->takePairingCode(code, sizeof(code))) return;
  if (cloud_->queueDepth() > 4) {
    storage_->savePairingCode(code);
    nextPairCheckAt_ = millis() + 10000;
    return;
  }
  AgnesUtil::copyString(pairCodeInFlight_, sizeof(pairCodeInFlight_), code);
  pairingAttempted_ = true;
  if (!cloud_->enqueuePair(code)) {
    storage_->savePairingCode(code);
    pairCodeInFlight_[0] = '\0';
    pairingAttempted_ = false;
    nextPairCheckAt_ = millis() + 10000;
  }
}

void UI::executeCommand(const CloudCommand& command) {
  if (!command.id[0] || !command.type[0]) return;

  bool expired = command.expiresEpoch > 0 && nowEpoch() > 0 &&
                 nowEpoch() > command.expiresEpoch;
  if (expired) {
    queueAck(command.id, "RECEIVED");
    queueAck(command.id, "EXECUTING");
    queueAck(command.id, "FAILED", "command expired before execution");
    return;
  }

  queueAck(command.id, "RECEIVED");
  queueAck(command.id, "EXECUTING");

  JsonDocument doc;
  DeserializationError parseError = deserializeJson(doc, command.payload);
  char failure[64] = {0};
  bool ok = true;

  if (strcmp(command.type, "UPDATE_PERSONALITY") == 0) {
    const char* value = doc["personality"] | "";
    Personality personality = personalityFromString(value);
    if (!value[0] || strcasecmp(personalityName(personality), value) != 0) {
      ok = false;
      AgnesUtil::copyString(failure, sizeof(failure), "invalid personality");
    } else {
      AgnesUtil::copyString(settings_.personality, sizeof(settings_.personality),
                            personalityName(personality));
    }
  } else if (strcmp(command.type, "UPDATE_THEME") == 0) {
    const char* value = doc["theme"] | "";
    if (!validTheme(value)) {
      ok = false;
      AgnesUtil::copyString(failure, sizeof(failure), "invalid theme");
    } else {
      AgnesUtil::copyString(settings_.theme, sizeof(settings_.theme), value);
    }
  } else if (strcmp(command.type, "UPDATE_BRIGHTNESS") == 0) {
    int value = doc["brightness"] | -1;
    if (value < 0 || parseError) {
      ok = false;
      AgnesUtil::copyString(failure, sizeof(failure), "invalid brightness");
    } else {
      settings_.brightness = (uint8_t)AgnesUtil::clampInt(value, 1, 255);
    }
  } else if (strcmp(command.type, "UPDATE_SLEEP_TIMEOUT") == 0) {
    int value = doc["seconds"] | 0;
    if (value < 30 || value > 3600 || parseError) {
      ok = false;
      AgnesUtil::copyString(failure, sizeof(failure), "invalid sleep timeout");
    } else {
      settings_.sleepTimeoutSeconds = (uint16_t)value;
    }
  } else if (strcmp(command.type, "WIFI_RECONNECT") == 0) {
    wifi_->connectNow();
  } else if (strcmp(command.type, "DEVICE_RESTART") == 0) {
    restartPending_ = true;
    restartAt_ = millis() + 3000;
  } else if (strcmp(command.type, "SYNC_NOW") == 0 ||
             strcmp(command.type, "REFRESH_SETTINGS") == 0) {
    nextSyncAt_ = millis();
    nextVerifyAt_ = millis();
  } else if (strcmp(command.type, "ENTER_SLEEP") == 0) {
    screenOn_ = false;
    display_->setPower(false);
  } else {
    ok = false;
    AgnesUtil::copyString(failure, sizeof(failure), "unsupported command");
  }

  if (ok) {
    storage_->saveSettings(settings_);
    applyLocalSettings();
    queueAck(command.id, "COMPLETED");
  } else {
    queueAck(command.id, "FAILED", failure);
  }
}

void UI::queueAck(const char* id, const char* status, const char* error) {
  if (!id || !id[0] || !status || !status[0]) return;
  for (uint8_t i = 0; i < ackCount_; ++i) {
    if (strcmp(acks_[i].id, id) == 0 && strcmp(acks_[i].status, status) == 0) {
      if (error && error[0]) AgnesUtil::asciiCopy(acks_[i].error, sizeof(acks_[i].error), error);
      storage_->saveAcks(acks_, ackCount_);
      return;
    }
  }
  if (ackCount_ >= 20) {
    for (uint8_t i = 1; i < 20; ++i) acks_[i - 1] = acks_[i];
    ackCount_ = 19;
  }
  PendingAck& ack = acks_[ackCount_++];
  ack = PendingAck();
  AgnesUtil::copyString(ack.id, sizeof(ack.id), id);
  AgnesUtil::copyString(ack.status, sizeof(ack.status), status);
  if (error) AgnesUtil::asciiCopy(ack.error, sizeof(ack.error), error);
  storage_->saveAcks(acks_, ackCount_);
}

void UI::removeSentAcks() {
  if (sentAckCount_ == 0) return;
  if (sentAckCount_ > ackCount_) sentAckCount_ = ackCount_;
  uint8_t remain = (uint8_t)(ackCount_ - sentAckCount_);
  for (uint8_t i = 0; i < remain; ++i) acks_[i] = acks_[i + sentAckCount_];
  ackCount_ = remain;
  sentAckCount_ = 0;
  storage_->saveAcks(acks_, ackCount_);
}

void UI::removeSentReads() {
  if (sentReadCount_ == 0) return;
  if (sentReadCount_ > readCount_) sentReadCount_ = readCount_;
  uint8_t remain = (uint8_t)(readCount_ - sentReadCount_);
  for (uint8_t i = 0; i < remain; ++i) {
    AgnesUtil::copyString(readIds_[i], sizeof(readIds_[i]),
                          readIds_[i + sentReadCount_]);
  }
  readCount_ = remain;
  sentReadCount_ = 0;
  saveReadQueue();
}

void UI::addReadId(const char* id) {
  if (!id || !id[0] || hasReadId(id)) return;
  if (readCount_ >= AGNES_NOTIFICATION_READ_MAX) {
    for (uint8_t i = 1; i < AGNES_NOTIFICATION_READ_MAX; ++i) {
      AgnesUtil::copyString(readIds_[i - 1], sizeof(readIds_[i - 1]), readIds_[i]);
    }
    readCount_ = AGNES_NOTIFICATION_READ_MAX - 1;
  }
  AgnesUtil::copyString(readIds_[readCount_], sizeof(readIds_[readCount_]), id);
  readCount_++;
}

bool UI::hasReadId(const char* id) const {
  if (!id || !id[0]) return false;
  for (uint8_t i = 0; i < readCount_; ++i) {
    if (strcmp(readIds_[i], id) == 0) return true;
  }
  return false;
}

void UI::saveReadQueue() {
  storage_->saveReadNotifications((const char (*)[40])readIds_, readCount_);
}

void UI::refreshNotes() {
  noteCount_ = storage_->loadNotes(notes_, AGNES_LOCAL_NOTES_MAX);
  if (noteIndex_ >= noteCount_ && noteCount_ > 0) noteIndex_ = noteCount_ - 1;
  if (noteCount_ == 0) noteIndex_ = 0;
  if (noteScroll_ > noteIndex_) noteScroll_ = noteIndex_;
}

void UI::refreshMemories() {
  memoryCount_ = storage_->loadMemories(memories_, AGNES_LOCAL_MEMORY_MAX);
  if (memoryIndex_ >= memoryCount_ && memoryCount_ > 0) memoryIndex_ = memoryCount_ - 1;
  if (memoryCount_ == 0) memoryIndex_ = 0;
  if (memoryScroll_ > memoryIndex_) memoryScroll_ = memoryIndex_;
}

void UI::refreshNotifications() {
  notificationCount_ = storage_->loadNotifications(notifications_, AGNES_NOTIFICATION_CACHE_MAX);
  if (notificationIndex_ >= notificationCount_ && notificationCount_ > 0) {
    notificationIndex_ = notificationCount_ - 1;
  }
  if (notificationCount_ == 0) notificationIndex_ = 0;
  if (notificationScroll_ > notificationIndex_) notificationScroll_ = notificationIndex_;
}

void UI::markNotificationRead(uint8_t index) {
  if (index >= notificationCount_) return;
  notificationOpen_ = notifications_[index];
  addReadId(notificationOpen_.id);
  saveReadQueue();
  for (uint8_t i = index + 1; i < notificationCount_; ++i) {
    notifications_[i - 1] = notifications_[i];
  }
  if (notificationCount_ > 0) notificationCount_--;
  storage_->saveNotifications(notifications_, notificationCount_);
  if (notificationIndex_ >= notificationCount_ && notificationCount_ > 0) {
    notificationIndex_ = notificationCount_ - 1;
  }
  if (notificationCount_ == 0) notificationIndex_ = 0;
  notificationReading_ = true;
  notificationPage_ = 0;
  if (wifi_->connected() && storage_->hasDevice()) requestSync();
}

void UI::markAllNotificationsRead() {
  for (uint8_t i = 0; i < notificationCount_; ++i) addReadId(notifications_[i].id);
  notificationCount_ = 0;
  notificationIndex_ = 0;
  notificationScroll_ = 0;
  saveReadQueue();
  storage_->saveNotifications(notifications_, 0);
  notificationReading_ = false;
  showToast("All notifications marked read");
  if (wifi_->connected() && storage_->hasDevice()) requestSync();
}

void UI::startWeather() {
  if (!settings_.hasLocation) {
    weatherLoading_ = false;
    showToast("Set a location in the dashboard");
    return;
  }
  if (!wifi_->connected() || !storage_->hasDevice()) {
    weatherLoading_ = false;
    showToast("Weather needs Wi-Fi and pairing");
    return;
  }
  if (!cloud_->enqueueWeather()) {
    weatherLoading_ = false;
    showToast("Network queue is full");
    return;
  }
  weatherLoading_ = true;
  weatherPage_ = 0;
}

void UI::describeCloudError(const CloudError& error) {
  if (error.httpStatus > 0) {
    snprintf(lastError_, sizeof(lastError_), "%s (HTTP %d)",
             error.message[0] ? error.message : "request failed", error.httpStatus);
  } else {
    AgnesUtil::asciiCopy(lastError_, sizeof(lastError_),
                         error.message[0] ? error.message : "request failed");
  }
  lastErrorAt_ = millis();
  showToast(lastError_);
}

void UI::showToast(const char* message) {
  if (!message) return;
  AgnesUtil::asciiCopy(toast_, sizeof(toast_), message);
  for (char* c = toast_; *c; ++c) {
    if (*c == '\n' || *c == '\r') *c = ' ';
  }
  toastUntil_ = millis() + 3500;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

void UI::handleWake() {
  screenOn_ = true;
  display_->setPower(true);
  display_->setBrightness(settings_.brightness);
  lastInputAt_ = millis();
}

void UI::handleButton(const ButtonEvent& event) {
  lastInputAt_ = millis();
  if (!screenOn_) {
    handleWake();
    return;
  }

  if (screen_ == Screen::Boot) {
    if (!event.longPress && millis() > 500) {
      screen_ = Screen::Home;
      lastInputAt_ = millis();
    }
    return;
  }

  if (confirm_ != UiConfirm::None) {
    if (event.repeat) return;
    if (event.longPress) {
      cancelConfirm();
    } else if (event.id == ButtonId::Select) {
      confirmAction();
    } else {
      cancelConfirm();
    }
    return;
  }

  if (event.longPress && event.id == ButtonId::Previous) {
    if (screen_ == Screen::Home) {
      screenOn_ = false;
      display_->setPower(false);
      return;
    }
    if (screen_ == Screen::Menu) {
      screen_ = Screen::Home;
      return;
    }
    leaveApp();
    return;
  }

  switch (screen_) {
    case Screen::Home: buttonHome(event); break;
    case Screen::Menu: buttonMenu(event); break;
    case Screen::Chat: buttonChat(event); break;
    case Screen::Pet: buttonPet(event); break;
    case Screen::Memory: buttonMemories(event); break;
    case Screen::Notifications: buttonNotifications(event); break;
    case Screen::Settings: buttonSettings(event); break;
    case Screen::Diagnostics: buttonDiagnostics(event); break;
    case Screen::WifiSetup: buttonWifiSetup(event); break;
    case Screen::AppRun: buttonAppRun(event); break;
    case Screen::About:
      if (event.repeat || !event.longPress) {
        if (event.id == ButtonId::Next) aboutPage_++;
        if (event.id == ButtonId::Previous) {
          if (aboutPage_ > 0) aboutPage_--;
        }
        if (event.id == ButtonId::Select) aboutPage_++;
      }
      break;
    default:
      break;
  }
}

void UI::buttonHome(const ButtonEvent& event) {
  if (event.longPress && event.id == ButtonId::Select) {
    openApp((uint8_t)AppId::Chat);
    return;
  }
  if (event.longPress) return;
  switch (event.id) {
    case ButtonId::Select:
      screen_ = Screen::Menu;
      menuIndex_ = 0;
      menuScroll_ = 0;
      break;
    case ButtonId::Next:
      homeCard_ = (homeCard_ + 1) % 3;
      break;
    case ButtonId::Previous:
      homeCard_ = (homeCard_ + 2) % 3;
      break;
  }
}

void UI::buttonMenu(const ButtonEvent& event) {
  if (event.longPress) return;
  int index = (int)menuIndex_;
  if (event.id == ButtonId::Next) index = (index + 1) % (uint8_t)AppId::Count;
  if (event.id == ButtonId::Previous) {
    index = (index + (uint8_t)AppId::Count - 1) % (uint8_t)AppId::Count;
  }
  menuIndex_ = (uint8_t)index;
  adjustMenuScroll();
  if (!event.repeat && event.id == ButtonId::Select) openApp(menuIndex_);
}

void UI::buttonChat(const ButtonEvent& event) {
  if (event.longPress) {
    if (event.id == ButtonId::Select && chat_.optionsVisible()) {
      chat_.showReply();
      return;
    }
    if (event.id == ButtonId::Next && !chat_.loading() && !chat_.optionsVisible()) {
      chat_.newConversation();
      return;
    }
    return;
  }

  if (chat_.loading()) return;

  if (chat_.optionsVisible() && chat_.hasQuestion()) {
    if (event.id == ButtonId::Next) {
      chat_.selectDelta(1);
      return;
    }
    if (event.id == ButtonId::Previous) {
      chat_.selectDelta(-1);
      return;
    }
    if (event.id == ButtonId::Select && !event.repeat) {
      if (!chat_.online()) {
        showToast("Cloud AI needs Wi-Fi to submit");
        return;
      }
      chat_.confirm();
      return;
    }
    return;
  }

  if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
    if (!chat_.hasReply()) return;
    int pages = display_->textPageCount(chat_.reply().reply, 120, 4);
    if (pages < 1) pages = 1;
    int page = chat_.replyPage();
    page += (event.id == ButtonId::Next) ? 1 : -1;
    if (page < 0) page = pages - 1;
    if (page >= pages) page = 0;
    chat_.setReplyPage((uint8_t)page);
    return;
  }

  if (event.id == ButtonId::Select && !event.repeat) {
    if (chat_.state() == ChatState::Error) {
      chat_.retry();
      return;
    }
    if (chat_.state() == ChatState::Offline && !chat_.online()) {
      if (chat_.hasQuestion() && !chat_.optionsVisible()) {
        chat_.showOptions();
      } else {
        showToast("Cloud AI is unavailable offline");
      }
      return;
    }
    chat_.confirm();
  }
}

void UI::buttonPet(const ButtonEvent& event) {
  if (event.longPress) return;
  if (event.id == ButtonId::Next) {
    petAction_ = (petAction_ + 1) % 4;
    return;
  }
  if (event.id == ButtonId::Previous) {
    petAction_ = (petAction_ + 3) % 4;
    return;
  }
  if (event.id == ButtonId::Select && !event.repeat) {
    const char* type = kPetActions[petAction_];
    char lower[8];
    AgnesUtil::copyString(lower, sizeof(lower), type);
    for (char* c = lower; *c; ++c) {
      if (*c >= 'A' && *c <= 'Z') *c = (char)(*c - 'A' + 'a');
    }
    uint16_t remaining = 0;
    if (!pet_->canInteract(lower, &remaining)) {
      char message[40];
      snprintf(message, sizeof(message), "Wait %us before %s again",
               (unsigned)remaining, lower);
      showToast(message);
      return;
    }
    char eventId[40];
    if (pet_->interact(lower, eventId, sizeof(eventId), nowEpoch())) {
      char message[40];
      snprintf(message, sizeof(message), "%s complete", type);
      showToast(message);
      if (wifi_->connected() && storage_->hasDevice()) requestSync();
    } else {
      showToast("Pet interaction failed");
    }
  }
}

void UI::buttonNotes(const ButtonEvent& event) {
  if (noteReading_) {
    if (event.longPress) return;
    if (event.id == ButtonId::Select && !event.repeat) {
      noteReading_ = false;
      return;
    }
    if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
      if (!notes_[noteIndex_].body[0]) return;
      int pages = display_->textPageCount(notes_[noteIndex_].body, 120, 3);
      if (pages < 1) pages = 1;
      int page = notePage_ + (event.id == ButtonId::Next ? 1 : -1);
      if (page < 0) page = pages - 1;
      if (page >= pages) page = 0;
      notePage_ = (uint8_t)page;
    }
    return;
  }

  if (event.longPress) {
    if (event.id == ButtonId::Select) requestSync();
    return;
  }
  if (noteCount_ == 0) {
    if (event.id == ButtonId::Select && !event.repeat) requestSync();
    return;
  }
  if (event.id == ButtonId::Next) {
    noteIndex_ = (uint8_t)((noteIndex_ + 1) % noteCount_);
  } else if (event.id == ButtonId::Previous) {
    noteIndex_ = (uint8_t)((noteIndex_ + noteCount_ - 1) % noteCount_);
  } else if (event.id == ButtonId::Select && !event.repeat) {
    noteReading_ = true;
    notePage_ = 0;
  }
  if (noteIndex_ < noteScroll_) noteScroll_ = noteIndex_;
  if (noteIndex_ >= noteScroll_ + 4) noteScroll_ = (uint8_t)(noteIndex_ - 3);
}

void UI::buttonMemories(const ButtonEvent& event) {
  if (memoryReading_) {
    if (event.longPress) return;
    if (event.id == ButtonId::Select && !event.repeat) {
      memoryReading_ = false;
      return;
    }
    if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
      if (!memories_[memoryIndex_].content[0]) return;
      int pages = display_->textPageCount(memories_[memoryIndex_].content, 120, 3);
      if (pages < 1) pages = 1;
      int page = memoryPage_ + (event.id == ButtonId::Next ? 1 : -1);
      if (page < 0) page = pages - 1;
      if (page >= pages) page = 0;
      memoryPage_ = (uint8_t)page;
    }
    return;
  }

  if (event.longPress) {
    if (event.id == ButtonId::Select) requestSync();
    return;
  }
  if (memoryCount_ == 0) {
    if (event.id == ButtonId::Select && !event.repeat) requestSync();
    return;
  }
  if (event.id == ButtonId::Next) {
    memoryIndex_ = (uint8_t)((memoryIndex_ + 1) % memoryCount_);
  } else if (event.id == ButtonId::Previous) {
    memoryIndex_ = (uint8_t)((memoryIndex_ + memoryCount_ - 1) % memoryCount_);
  } else if (event.id == ButtonId::Select && !event.repeat) {
    memoryReading_ = true;
    memoryPage_ = 0;
  }
  if (memoryIndex_ < memoryScroll_) memoryScroll_ = memoryIndex_;
  if (memoryIndex_ >= memoryScroll_ + 4) memoryScroll_ = (uint8_t)(memoryIndex_ - 3);
}

void UI::buttonNotifications(const ButtonEvent& event) {
  if (notificationReading_) {
    if (event.longPress) return;
    if (event.id == ButtonId::Select && !event.repeat) {
      notificationReading_ = false;
      return;
    }
    if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
      int pages = display_->textPageCount(notificationOpen_.body, 120, 3);
      if (pages < 1) pages = 1;
      int page = notificationPage_ + (event.id == ButtonId::Next ? 1 : -1);
      if (page < 0) page = pages - 1;
      if (page >= pages) page = 0;
      notificationPage_ = (uint8_t)page;
    }
    return;
  }

  if (event.longPress) {
    if (event.id == ButtonId::Select && notificationCount_ > 0) markAllNotificationsRead();
    return;
  }
  if (notificationCount_ == 0) {
    if (event.id == ButtonId::Select && !event.repeat) requestSync();
    return;
  }
  if (event.id == ButtonId::Next) {
    notificationIndex_ = (uint8_t)((notificationIndex_ + 1) % notificationCount_);
  } else if (event.id == ButtonId::Previous) {
    notificationIndex_ = (uint8_t)((notificationIndex_ + notificationCount_ - 1) % notificationCount_);
  } else if (event.id == ButtonId::Select && !event.repeat) {
    markNotificationRead(notificationIndex_);
  }
  if (notificationIndex_ < notificationScroll_) notificationScroll_ = notificationIndex_;
  if (notificationIndex_ >= notificationScroll_ + 4) {
    notificationScroll_ = (uint8_t)(notificationIndex_ - 3);
  }
}

void UI::buttonAppRun(const ButtonEvent& event) {
  switch (app_) {
    case AppId::Notes:
      buttonNotes(event);
      return;
    case AppId::Weather:
      if (event.longPress) return;
      if (event.id == ButtonId::Select && !event.repeat) {
        startWeather();
      } else if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        if (!weatherValid_) return;
        int pages = display_->textPageCount(weather_.body, 120, 4);
        if (pages < 1) pages = 1;
        int page = weatherPage_ + (event.id == ButtonId::Next ? 1 : -1);
        if (page < 0) page = pages - 1;
        if (page >= pages) page = 0;
        weatherPage_ = (uint8_t)page;
      }
      return;
    case AppId::Clock:
      if (event.longPress) return;
      if (event.id == ButtonId::Select && !event.repeat) clockShowSeconds_ = !clockShowSeconds_;
      if (event.id == ButtonId::Next) clockUtc_ = true;
      if (event.id == ButtonId::Previous) clockUtc_ = false;
      return;
    case AppId::Timer:
      if (event.longPress) {
        if (event.id == ButtonId::Select) {
          timerPhase_ = TimerPhase::Set;
          timerRemainingMs_ = 0;
          timerEndMs_ = 0;
        }
        return;
      }
      if (event.repeat) return;
      if (event.id == ButtonId::Select) {
        if (timerPhase_ == TimerPhase::Running) {
          uint32_t now = millis();
          timerRemainingMs_ = timerEndMs_ > now ? timerEndMs_ - now : 0;
          timerPhase_ = TimerPhase::Paused;
        } else if (timerPhase_ == TimerPhase::Paused) {
          timerEndMs_ = millis() + timerRemainingMs_;
          timerPhase_ = TimerPhase::Running;
        } else if (timerPhase_ == TimerPhase::Set) {
          timerRemainingMs_ = (uint32_t)kTimerPresets[timerPresetIndex_] * 60000UL;
          timerEndMs_ = millis() + timerRemainingMs_;
          timerPhase_ = TimerPhase::Running;
        } else {
          timerPhase_ = TimerPhase::Set;
        }
      } else if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        if (timerPhase_ == TimerPhase::Set) {
          int index = timerPresetIndex_ + (event.id == ButtonId::Next ? 1 : -1);
          if (index < 0) index = kTimerPresetCount - 1;
          if (index >= kTimerPresetCount) index = 0;
          timerPresetIndex_ = (uint8_t)index;
        }
      }
      return;
    case AppId::Stopwatch:
      if (event.longPress) {
        if (event.id == ButtonId::Select) {
          stopwatchRunning_ = false;
          stopwatchAccumMs_ = 0;
        }
        return;
      }
      if (event.id == ButtonId::Select && !event.repeat) {
        if (stopwatchRunning_) {
          stopwatchAccumMs_ += millis() - stopwatchStartMs_;
          stopwatchRunning_ = false;
        } else {
          stopwatchStartMs_ = millis();
          stopwatchRunning_ = true;
        }
      }
      return;
    case AppId::Calculator:
      if (event.longPress) {
        if (event.id == ButtonId::Next) {
          if (calcPhase_ == CalcPhase::A) calcA_ = (calcA_ + 10) % 100;
          if (calcPhase_ == CalcPhase::B) calcB_ = (calcB_ + 10) % 100;
        }
        return;
      }
      if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        int delta = event.id == ButtonId::Next ? 1 : -1;
        if (calcPhase_ == CalcPhase::A) {
          calcA_ = (int16_t)((calcA_ + delta + 100) % 100);
        } else if (calcPhase_ == CalcPhase::Operator) {
          calcOperator_ = (uint8_t)((calcOperator_ + (delta > 0 ? 1 : 3)) % 4);
        } else if (calcPhase_ == CalcPhase::B) {
          calcB_ = (int16_t)((calcB_ + delta + 100) % 100);
        }
        return;
      }
      if (event.id == ButtonId::Select && !event.repeat) {
        if (calcPhase_ == CalcPhase::A) {
          calcPhase_ = CalcPhase::Operator;
        } else if (calcPhase_ == CalcPhase::Operator) {
          calcPhase_ = CalcPhase::B;
        } else if (calcPhase_ == CalcPhase::B) {
          calcError_ = false;
          switch (calcOperator_) {
            case 0: calcResult_ = calcA_ + calcB_; break;
            case 1: calcResult_ = calcA_ - calcB_; break;
            case 2: calcResult_ = (long)calcA_ * calcB_; break;
            case 3:
              if (calcB_ == 0) calcError_ = true;
              else calcResult_ = calcA_ / calcB_;
              break;
          }
          calcPhase_ = CalcPhase::Result;
        } else {
          calcPhase_ = CalcPhase::A;
          calcA_ = 0;
          calcB_ = 0;
          calcResult_ = 0;
          calcError_ = false;
        }
      }
      return;
    case AppId::Dice:
      if (event.longPress) {
        if (event.id == ButtonId::Select) {
          diceCount_ = 0;
          diceValue_ = 0;
        }
        return;
      }
      if (event.id == ButtonId::Select && !event.repeat) {
        diceValue_ = (uint8_t)(esp_random() % kDiceSides[diceSidesIndex_] + 1);
        for (int i = 4; i > 0; --i) diceHistory_[i] = diceHistory_[i - 1];
        diceHistory_[0] = diceValue_;
        if (diceCount_ < 5) diceCount_++;
      } else if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        int index = diceSidesIndex_ + (event.id == ButtonId::Next ? 1 : -1);
        if (index < 0) index = kDiceSidesCount - 1;
        if (index >= kDiceSidesCount) index = 0;
        diceSidesIndex_ = (uint8_t)index;
        diceValue_ = 0;
      }
      return;
    case AppId::Coin:
      if (event.longPress) {
        if (event.id == ButtonId::Select) {
          coinHeadsCount_ = 0;
          coinTailsCount_ = 0;
          coinValid_ = false;
        }
        return;
      }
      if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        coinCallHeads_ = !coinCallHeads_;
        return;
      }
      if (event.id == ButtonId::Select && !event.repeat) {
        coinHeads_ = (esp_random() & 1) == 0;
        coinValid_ = true;
        if (coinHeads_) coinHeadsCount_++;
        else coinTailsCount_++;
      }
      return;
    case AppId::MoodLog:
      if (event.longPress) {
        if (event.id == ButtonId::Select) openConfirm(UiConfirm::ClearMoods);
        return;
      }
      if (event.id == ButtonId::Next || event.id == ButtonId::Select) {
        int pages = (mood_->historyCount() + 3) / 4;
        if (pages < 1) pages = 1;
        moodPage_ = (uint8_t)((moodPage_ + 1) % pages);
      } else if (event.id == ButtonId::Previous) {
        int pages = (mood_->historyCount() + 3) / 4;
        if (pages < 1) pages = 1;
        moodPage_ = (uint8_t)((moodPage_ + pages - 1) % pages);
      }
      return;
    case AppId::Sync:
      if (event.longPress) {
        if (event.id == ButtonId::Select) {
          verified_ = false;
          verifyRequested_ = false;
          nextVerifyAt_ = millis();
          showToast("Verifying device");
        }
        return;
      }
      if (event.id == ButtonId::Select && !event.repeat) {
        requestSync();
        showToast("Sync requested");
      } else if (event.id == ButtonId::Next || event.id == ButtonId::Previous) {
        syncPage_++;
      }
      return;
    default:
      break;
  }
}

void UI::buttonSettings(const ButtonEvent& event) {
  if (event.longPress) return;
  if (event.repeat) return;

  if (settingsEditing_) {
    if (event.id == ButtonId::Select) {
      settingsEditing_ = false;
      showToast("Saved locally");
      return;
    }
    int delta = event.id == ButtonId::Next ? 1 : (event.id == ButtonId::Previous ? -1 : 0);
    if (delta == 0) return;
    switch (settingsIndex_) {
      case 0: {
        int value = (int)settings_.brightness + delta * 15;
        if (value < 20) value = 255;
        if (value > 255) value = 20;
        settings_.brightness = (uint8_t)value;
        break;
      }
      case 1: {
        static const uint16_t presets[] = {30, 60, 90, 120, 180, 300, 600};
        int index = 3;
        for (int i = 0; i < 7; ++i) {
          if (presets[i] == settings_.sleepTimeoutSeconds) index = i;
        }
        index += delta;
        if (index < 0) index = 6;
        if (index > 6) index = 0;
        settings_.sleepTimeoutSeconds = presets[index];
        break;
      }
      case 2:
        settings_.idleAnimations = !settings_.idleAnimations;
        break;
      case 3: {
        const char* themes[] = {"cyber", "minimal", "retro"};
        int index = 0;
        for (int i = 0; i < 3; ++i) {
          if (strcmp(settings_.theme, themes[i]) == 0) index = i;
        }
        index += delta;
        if (index < 0) index = 2;
        if (index > 2) index = 0;
        AgnesUtil::copyString(settings_.theme, sizeof(settings_.theme), themes[index]);
        break;
      }
      default:
        settingsEditing_ = false;
        return;
    }
    storage_->saveSettings(settings_);
    applyLocalSettings();
    return;
  }

  if (event.id == ButtonId::Next) {
    settingsIndex_ = (uint8_t)((settingsIndex_ + 1) % 6);
  } else if (event.id == ButtonId::Previous) {
    settingsIndex_ = (uint8_t)((settingsIndex_ + 5) % 6);
  } else if (event.id == ButtonId::Select) {
    if (settingsIndex_ >= 4) {
      showToast("Set this in the dashboard");
      return;
    }
    settingsEditing_ = true;
  }
  if (settingsIndex_ < settingsScroll_) settingsScroll_ = settingsIndex_;
  if (settingsIndex_ >= settingsScroll_ + 4) settingsScroll_ = (uint8_t)(settingsIndex_ - 3);
}

void UI::buttonDiagnostics(const ButtonEvent& event) {
  if (event.longPress) {
    if (event.id == ButtonId::Select) openConfirm(UiConfirm::FactoryReset);
    return;
  }
  if (event.id == ButtonId::Next) diagPage_++;
  if (event.id == ButtonId::Previous && diagPage_ > 0) diagPage_--;
  if (event.id == ButtonId::Select && !event.repeat) diagPage_++;
}

void UI::buttonWifiSetup(const ButtonEvent& event) {
  if (event.longPress) {
    if (event.id == ButtonId::Select) {
      if (wifi_->portalActive()) {
        wifi_->stopPortal();
        showToast("Setup network stopped");
      } else {
        wifi_->connectNow();
        showToast("Reconnecting Wi-Fi");
      }
    }
    return;
  }
  if (event.id == ButtonId::Next) wifiPage_++;
  if (event.id == ButtonId::Previous && wifiPage_ > 0) wifiPage_--;
  if (event.id == ButtonId::Select && !event.repeat) {
    if (wifi_->portalActive()) {
      wifi_->stopPortal();
      showToast("Setup network stopped");
    } else {
      wifi_->startPortal();
      wifiPage_ = 0;
      showToast("Setup network started");
    }
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const char* UI::appName(uint8_t index) {
  if (index >= (uint8_t)AppId::Count) return "?";
  return kAppNames[index];
}

void UI::adjustMenuScroll() {
  if (menuIndex_ < menuScroll_) menuScroll_ = menuIndex_;
  if (menuIndex_ >= menuScroll_ + 4) menuScroll_ = (uint8_t)(menuIndex_ - 3);
}

void UI::openApp(uint8_t index) {
  if (index >= (uint8_t)AppId::Count) return;
  app_ = (AppId)index;
  menuIndex_ = index;
  lastInputAt_ = millis();
  confirm_ = UiConfirm::None;

  switch (app_) {
    case AppId::Chat:
      screen_ = Screen::Chat;
      chat_.updateConnectivity(wifi_->connected(), storage_->hasDevice());
      chat_.open();
      break;
    case AppId::Pet:
      screen_ = Screen::Pet;
      petAction_ = 0;
      break;
    case AppId::Memories:
      refreshMemories();
      screen_ = Screen::Memory;
      memoryReading_ = false;
      break;
    case AppId::Notes:
      refreshNotes();
      screen_ = Screen::AppRun;
      noteReading_ = false;
      break;
    case AppId::Notifications:
      refreshNotifications();
      screen_ = Screen::Notifications;
      notificationReading_ = false;
      break;
    case AppId::Weather:
      screen_ = Screen::AppRun;
      weatherPage_ = 0;
      startWeather();
      break;
    case AppId::Clock:
      screen_ = Screen::AppRun;
      break;
    case AppId::Timer:
      screen_ = Screen::AppRun;
      break;
    case AppId::Stopwatch:
      screen_ = Screen::AppRun;
      break;
    case AppId::Calculator:
      screen_ = Screen::AppRun;
      break;
    case AppId::Dice:
      screen_ = Screen::AppRun;
      break;
    case AppId::Coin:
      screen_ = Screen::AppRun;
      break;
    case AppId::MoodLog:
      screen_ = Screen::AppRun;
      moodPage_ = 0;
      break;
    case AppId::Sync:
      screen_ = Screen::AppRun;
      syncPage_ = 0;
      requestSync();
      break;
    case AppId::Settings:
      screen_ = Screen::Settings;
      settingsIndex_ = 0;
      settingsScroll_ = 0;
      settingsEditing_ = false;
      break;
    case AppId::Diagnostics:
      screen_ = Screen::Diagnostics;
      diagPage_ = 0;
      break;
    case AppId::WifiSetup:
      screen_ = Screen::WifiSetup;
      wifiPage_ = 0;
      break;
    case AppId::About:
      screen_ = Screen::About;
      aboutPage_ = 0;
      break;
    default:
      screen_ = Screen::Menu;
      break;
  }
}

void UI::leaveApp() {
  screen_ = Screen::Menu;
  menuIndex_ = (uint8_t)app_;
  adjustMenuScroll();
  lastInputAt_ = millis();
}

void UI::openConfirm(UiConfirm kind) {
  confirm_ = kind;
  lastInputAt_ = millis();
}

void UI::confirmAction() {
  if (confirm_ == UiConfirm::FactoryReset) {
    storage_->factoryResetLocal();
    display_->setPower(false);
    delay(120);
    ESP.restart();
  } else if (confirm_ == UiConfirm::ClearMoods) {
    mood_->clearHistory();
    moodPage_ = 0;
    showToast("Mood history cleared");
  }
  confirm_ = UiConfirm::None;
}

void UI::cancelConfirm() {
  confirm_ = UiConfirm::None;
}

void UI::updateTimer(uint32_t now) {
  if (timerPhase_ != TimerPhase::Running) return;
  if ((int32_t)(now - timerEndMs_) >= 0) {
    timerPhase_ = TimerPhase::Done;
    timerRemainingMs_ = 0;
    timerEndMs_ = 0;
    showToast("Timer finished");
  }
}

void UI::updateIdle(uint32_t now) {
  if (!screenOn_) {
    bool pressed = buttons_->rawPressed(ButtonId::Previous) ||
                   buttons_->rawPressed(ButtonId::Select) ||
                   buttons_->rawPressed(ButtonId::Next);
    if (!pressed && !wifi_->connected()) {
      power_->enterLightSleep(1000);
    } else {
      delay(5);
    }
    return;
  }

  if (screen_ == Screen::Boot) return;
  uint32_t timeout = (uint32_t)settings_.sleepTimeoutSeconds * 1000UL;
  if (timeout < 30000UL) timeout = 30000UL;
  if ((uint32_t)(now - lastInputAt_) >= timeout) {
    screenOn_ = false;
    display_->setPower(false);
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void UI::drawHeader(const char* title, const char* right) {
  display_->header(title, nullptr);
  if (right && right[0]) {
    display_->g().setFont(u8g2_font_5x7_tf);
    display_->rightAligned(right, 88, 8);
  }
  display_->wifiIcon(91, 3, wifi_->connected());
  display_->batteryIcon(112, 2, battery_->percent());
}

void UI::draw() {
  if (!display_) return;
  display_->clear();
  display_->g().setDrawColor(1);

  switch (screen_) {
    case Screen::Boot: {
      display_->g().setFont(u8g2_font_6x10_tf);
      display_->centered("AGNES", 14);
      face_->set(Emotion::Excited, Animation::Blink, 2);
      face_->render(display_->g(), 64, 32, 0.85f);
      display_->g().setFont(u8g2_font_5x7_tf);
      display_->centered("OS 2.0", 52);
      display_->centered("starting", 62);
      break;
    }
    case Screen::Home: drawHome(); break;
    case Screen::Menu: drawMenu(); break;
    case Screen::Chat: drawChat(); break;
    case Screen::Pet: drawPet(); break;
    case Screen::Memory: drawMemories(); break;
    case Screen::Notes:
    case Screen::Apps:
    case Screen::AppRun: drawAppRun(); break;
    case Screen::Notifications: drawNotifications(); break;
    case Screen::Settings: drawSettings(); break;
    case Screen::Diagnostics: drawDiagnostics(); break;
    case Screen::WifiSetup: drawWifiSetup(); break;
    case Screen::About: drawAbout(); break;
    default: break;
  }

  if (confirm_ != UiConfirm::None) drawConfirm();
  if (toast_[0] && (int32_t)(millis() - toastUntil_) < 0) drawToast();
  display_->flush();
}

void UI::drawHome() {
  drawHeader("AGNES");

  if (homeCard_ == 0) {
    Animation animation = Animation::None;
    if (settings_.idleAnimations) {
      static const Animation idle[] = {Animation::Blink, Animation::Sway,
                                        Animation::Float, Animation::Bounce};
      animation = idle[(millis() / AGNES_IDLE_ANIMATION_MS) % 4];
    }
    face_->set(mood_->current(), animation, mood_->intensity());
    face_->render(display_->g(), 64, 30, 0.95f);
    display_->g().setFont(u8g2_font_5x7_tf);
    char line[40];
    snprintf(line, sizeof(line), "%s / %s", emotionName(mood_->current()),
             settings_.personality);
    display_->centered(line, 53);
    display_->footer("SEL apps", "<> card");
  } else if (homeCard_ == 1) {
    const PetState& pet = pet_->state();
    display_->g().setFont(u8g2_font_5x7_tf);
    char line[40];
    snprintf(line, sizeof(line), "%s  Lv%u  %s", pet.name, (unsigned)pet.level, pet.stage);
    display_->g().drawStr(2, 20, line);
    const char* labels[3] = {"HAP", "ENR", "HUN"};
    uint8_t values[3] = {pet.happiness, pet.energy, pet.hunger};
    for (int i = 0; i < 3; ++i) {
      int y = 29 + i * 9;
      display_->g().drawStr(2, y + 5, labels[i]);
      display_->progressBar(24, y, 78, values[i]);
      snprintf(line, sizeof(line), "%u", (unsigned)values[i]);
      display_->rightAligned(line, 125, y + 5);
    }
    display_->footer("SEL apps", "<> card");
  } else {
    display_->g().setFont(u8g2_font_5x7_tf);
    char line[48];
    snprintf(line, sizeof(line), "Wi-Fi: %s", AgnesUtil::wifiStateName((uint8_t)wifi_->state()));
    display_->g().drawStr(2, 20, line);
    snprintf(line, sizeof(line), "Device: %s", storage_->hasDevice() ? "paired" : "not paired");
    display_->g().drawStr(2, 29, line);
    char age[16];
    formatAge(lastSyncAt_, age, sizeof(age));
    snprintf(line, sizeof(line), "Sync: %s", age);
    display_->g().drawStr(2, 38, line);
    snprintf(line, sizeof(line), "Battery: %u%% %umV", (unsigned)battery_->percent(),
             (unsigned)battery_->millivolts());
    display_->g().drawStr(2, 47, line);
    display_->footer("SEL apps", "<> card");
  }
}

void UI::drawMenu() {
  drawHeader("APPS");
  display_->g().setFont(u8g2_font_5x7_tf);
  uint8_t last = menuScroll_ + 4;
  if (last > (uint8_t)AppId::Count) last = (uint8_t)AppId::Count;
  for (uint8_t i = menuScroll_; i < last; ++i) {
    int y = 20 + (int)(i - menuScroll_) * 9;
    bool selected = i == menuIndex_;
    if (selected) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
    }
    char line[30];
    snprintf(line, sizeof(line), "%s%s", selected ? ">" : " ", appName(i));
    display_->g().drawStr(4, y, line);
    display_->g().setDrawColor(1);
  }
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(menuIndex_ + 1),
           (unsigned)AppId::Count);
  display_->footer("SEL open", right);
}

void UI::drawChat() {
  const ChatReply& reply = chat_.reply();
  char right[8] = "AI";
  if (chat_.loading()) {
    AgnesUtil::copyString(right, sizeof(right), "...");
  } else if (!chat_.paired()) {
    AgnesUtil::copyString(right, sizeof(right), "PAIR");
  } else if (!chat_.online()) {
    AgnesUtil::copyString(right, sizeof(right), "OFF");
  } else if (reply.warning[0]) {
    AgnesUtil::copyString(right, sizeof(right), "!");
  }

  drawHeader(chat_.fromSync() ? "WEB CHAT" : "CHAT", right);

  if (chat_.loading()) {
    face_->set(Emotion::Thinking, Animation::Blink, 2);
    face_->render(display_->g(), 64, 29, 0.72f);
    display_->g().setFont(u8g2_font_5x7_tf);
    display_->centered("Cloud AI is thinking...", 52);
    display_->footer("hold PREV back", nullptr);
    return;
  }

  if (!chat_.hasReply()) {
    display_->g().setFont(u8g2_font_5x7_tf);
    const char* message = chat_.errorText();
    if (!message[0]) message = "Open this app with Wi-Fi and pairing to chat.";
    display_->drawWrapped(message, 3, 20, 122, 8, 4);
    display_->footer(chat_.state() == ChatState::Offline ? "Wi-Fi needed" : "SEL retry", nullptr);
    return;
  }

  if (chat_.optionsVisible() && chat_.hasQuestion()) {
    display_->g().setFont(u8g2_font_4x6_tf);
    display_->drawWrapped(reply.question, 3, 20, 122, 7, 3);
    display_->g().drawFrame(3, 38, 122, 17);
    display_->g().setFont(u8g2_font_5x7_tf);
    const ChatOption& option = reply.options[chat_.selectedOption()];
    display_->drawWrapped(option.label, 8, 46, 112, 7, 2);
    char left[16];
    snprintf(left, sizeof(left), "%u/3", (unsigned)(chat_.selectedOption() + 1));
    const char* hint = chat_.state() == ChatState::Error ? "SEL retry"
                     : chat_.state() == ChatState::Offline ? "Wi-Fi needed"
                     : "SEL pick";
    display_->footer(left, hint);
    return;
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(reply.reply, 120, 4);
  if (pages < 1) pages = 1;
  if (chat_.replyPage() >= pages) chat_.setReplyPage((uint8_t)(pages - 1));
  display_->drawTextPage(reply.reply, chat_.replyPage(), 3, 20, 122, 9, 4);

  char left[24];
  if (chat_.state() == ChatState::Error) {
    AgnesUtil::copyString(left, sizeof(left), "SEL retry");
  } else if (chat_.state() == ChatState::Offline) {
    AgnesUtil::copyString(left, sizeof(left), "Wi-Fi needed");
  } else if (chat_.hasQuestion()) {
    AgnesUtil::copyString(left, sizeof(left), "SEL options");
  } else {
    AgnesUtil::copyString(left, sizeof(left), "SEL continue");
  }
  char rightText[12];
  snprintf(rightText, sizeof(rightText), "%u/%u", (unsigned)(chat_.replyPage() + 1),
           (unsigned)pages);
  display_->footer(left, rightText);
}

void UI::drawPet() {
  drawHeader("PET");
  const PetState& pet = pet_->state();
  display_->g().setFont(u8g2_font_5x7_tf);
  char line[48];
  snprintf(line, sizeof(line), "%s  Lv%u  %s", pet.name, (unsigned)pet.level, pet.stage);
  display_->g().drawStr(2, 20, line);

  const char* labels[3] = {"HAP", "ENR", "HUN"};
  uint8_t values[3] = {pet.happiness, pet.energy, pet.hunger};
  for (int i = 0; i < 3; ++i) {
    int y = 29 + i * 9;
    display_->g().drawStr(2, y + 5, labels[i]);
    display_->progressBar(24, y, 78, values[i]);
    snprintf(line, sizeof(line), "%u", (unsigned)values[i]);
    display_->rightAligned(line, 125, y + 5);
  }

  char footer[32];
  const char* action = kPetActions[petAction_];
  char lower[8];
  AgnesUtil::copyString(lower, sizeof(lower), action);
  for (char* c = lower; *c; ++c) {
    if (*c >= 'A' && *c <= 'Z') *c = (char)(*c - 'A' + 'a');
  }
  uint16_t remaining = 0;
  if (!pet_->canInteract(lower, &remaining) && remaining > 0) {
    snprintf(footer, sizeof(footer), "%s %us", action, (unsigned)remaining);
  } else {
    snprintf(footer, sizeof(footer), "> %s", action);
  }
  display_->footer(footer, "SEL do");
}

void UI::drawNotes() {
  if (noteReading_ && noteCount_ > 0) {
    const CloudNote& note = notes_[noteIndex_];
    drawHeader("NOTE");
    display_->g().setFont(u8g2_font_6x10_tf);
    display_->g().drawStr(2, 21, note.title);
    display_->g().setFont(u8g2_font_5x7_tf);
    uint16_t pages = display_->textPageCount(note.body, 122, 3);
    if (pages < 1) pages = 1;
    if (notePage_ >= pages) notePage_ = (uint8_t)(pages - 1);
    display_->drawTextPage(note.body, notePage_, 2, 31, 124, 8, 3);
    char right[12];
    snprintf(right, sizeof(right), "%u/%u", (unsigned)(notePage_ + 1), (unsigned)pages);
    display_->footer("SEL back", right);
    return;
  }

  drawHeader("NOTES");
  if (noteCount_ == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    drawEmpty("No synced notes.", "Create notes in the dashboard, then SEL to sync.");
    display_->footer("SEL sync", nullptr);
    return;
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  for (uint8_t i = noteScroll_; i < noteCount_ && i < noteScroll_ + 4; ++i) {
    int y = 20 + (int)(i - noteScroll_) * 9;
    bool selected = i == noteIndex_;
    if (selected) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
    }
    char line[40];
    snprintf(line, sizeof(line), "%s%s", notes_[i].pinned ? "*" : " ", notes_[i].title);
    display_->g().drawStr(4, y, line);
    display_->g().setDrawColor(1);
  }
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(noteIndex_ + 1), (unsigned)noteCount_);
  display_->footer("SEL read", right);
}

void UI::drawMemories() {
  if (memoryReading_ && memoryCount_ > 0) {
    const CloudMemory& memory = memories_[memoryIndex_];
    drawHeader("MEMORY");
    display_->g().setFont(u8g2_font_5x7_tf);
    char line[48];
    snprintf(line, sizeof(line), "%s%s", memory.pinned ? "* " : "", memory.category);
    display_->g().drawStr(2, 20, line);
    uint16_t pages = display_->textPageCount(memory.content, 122, 3);
    if (pages < 1) pages = 1;
    if (memoryPage_ >= pages) memoryPage_ = (uint8_t)(pages - 1);
    display_->drawTextPage(memory.content, memoryPage_, 2, 30, 124, 8, 3);
    char right[12];
    snprintf(right, sizeof(right), "%u/%u", (unsigned)(memoryPage_ + 1), (unsigned)pages);
    display_->footer("SEL back", right);
    return;
  }

  drawHeader("MEMORIES");
  if (memoryCount_ == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    if (!settings_.cloudMemoryEnabled) {
      drawEmpty("Cloud memory is off.", "Enable it in the dashboard, then sync.");
    } else {
      drawEmpty("No approved memories.", "Approve memories in the dashboard, then sync.");
    }
    display_->footer("SEL sync", nullptr);
    return;
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  for (uint8_t i = memoryScroll_; i < memoryCount_ && i < memoryScroll_ + 4; ++i) {
    int y = 20 + (int)(i - memoryScroll_) * 9;
    bool selected = i == memoryIndex_;
    if (selected) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
    }
    char line[40];
    snprintf(line, sizeof(line), "%s%s: %.18s", memories_[i].pinned ? "*" : "",
             memories_[i].category, memories_[i].content);
    display_->g().drawStr(4, y, line);
    display_->g().setDrawColor(1);
  }
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(memoryIndex_ + 1),
           (unsigned)memoryCount_);
  display_->footer("SEL read", right);
}

void UI::drawNotifications() {
  if (notificationReading_) {
    drawHeader("NOTIFY");
    display_->g().setFont(u8g2_font_6x10_tf);
    display_->g().drawStr(2, 21, notificationOpen_.title);
    display_->g().setFont(u8g2_font_5x7_tf);
    uint16_t pages = display_->textPageCount(notificationOpen_.body, 122, 3);
    if (pages < 1) pages = 1;
    if (notificationPage_ >= pages) notificationPage_ = (uint8_t)(pages - 1);
    display_->drawTextPage(notificationOpen_.body, notificationPage_, 2, 31, 124, 8, 3);
    char right[12];
    snprintf(right, sizeof(right), "%u/%u", (unsigned)(notificationPage_ + 1),
             (unsigned)pages);
    display_->footer("SEL back", right);
    return;
  }

  drawHeader("NOTIFY");
  if (notificationCount_ == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    if (!settings_.notificationsEnabled) {
      drawEmpty("Notifications are off.", "Enable them in the dashboard, then sync.");
    } else {
      drawEmpty("No unread notifications.", "The dashboard can send reminders here.");
    }
    display_->footer("SEL sync", nullptr);
    return;
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  for (uint8_t i = notificationScroll_; i < notificationCount_ &&
                      i < notificationScroll_ + 4; ++i) {
    int y = 20 + (int)(i - notificationScroll_) * 9;
    bool selected = i == notificationIndex_;
    if (selected) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
    }
    char line[40];
    snprintf(line, sizeof(line), "> %s", notifications_[i].title);
    display_->g().drawStr(4, y, line);
    display_->g().setDrawColor(1);
  }
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(notificationIndex_ + 1),
           (unsigned)notificationCount_);
  display_->footer("SEL open", right);
}

void UI::drawAppRun() {
  switch (app_) {
    case AppId::Notes: drawNotes(); break;
    case AppId::Weather: drawWeather(); break;
    case AppId::Clock: drawClock(); break;
    case AppId::Timer: drawTimer(); break;
    case AppId::Stopwatch: drawStopwatch(); break;
    case AppId::Calculator: drawCalculator(); break;
    case AppId::Dice: drawDice(); break;
    case AppId::Coin: drawCoin(); break;
    case AppId::MoodLog: drawMoodLog(); break;
    case AppId::Sync: drawSync(); break;
    default: drawEmpty("Unknown app.", "Use the menu to pick another app."); break;
  }
}

void UI::drawWeather() {
  drawHeader("WEATHER");
  if (weatherLoading_) {
    display_->g().setFont(u8g2_font_5x7_tf);
    display_->centered("Fetching weather...", 32);
    display_->footer("hold PREV back", nullptr);
    return;
  }
  if (!weatherValid_) {
    display_->g().setFont(u8g2_font_5x7_tf);
    if (!settings_.hasLocation) {
      drawEmpty("No location set.", "Set latitude/longitude in the dashboard, then sync.");
    } else if (!wifi_->connected() || !storage_->hasDevice()) {
      drawEmpty("Weather needs Wi-Fi.", "Cloud tools are unavailable offline.");
    } else {
      drawEmpty("No weather data yet.", "Press SEL to fetch weather.");
    }
    display_->footer("SEL refresh", nullptr);
    return;
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(weather_.body, 120, 4);
  if (pages < 1) pages = 1;
  if (weatherPage_ >= pages) weatherPage_ = (uint8_t)(pages - 1);
  display_->drawTextPage(weather_.body, weatherPage_, 3, 20, 122, 9, 4);
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(weatherPage_ + 1), (unsigned)pages);
  display_->footer("SEL refresh", right);
}

void UI::drawClock() {
  drawHeader("CLOCK", clockUtc_ ? "UTC" : "LOCAL");
  uint32_t epoch = nowEpoch();
  if (epoch == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    drawEmpty("Time is not set.", "Connect Wi-Fi and sync with the server.");
    display_->footer("SEL seconds", nullptr);
    return;
  }

  time_t raw = (time_t)epoch;
  struct tm value;
  if (clockUtc_) gmtime_r(&raw, &value);
  else localtime_r(&raw, &value);

  char timeText[12];
  snprintf(timeText, sizeof(timeText), "%02d:%02d", value.tm_hour, value.tm_min);
  display_->g().setFont(u8g2_font_logisoso24_tn);
  int width = display_->g().getUTF8Width(timeText);
  display_->g().drawStr((128 - width) / 2, 39, timeText);
  if (clockShowSeconds_) {
    display_->g().setFont(u8g2_font_5x7_tf);
    char seconds[8];
    snprintf(seconds, sizeof(seconds), ":%02d", value.tm_sec);
    display_->g().drawStr((128 + width) / 2 + 1, 39, seconds);
  }

  display_->g().setFont(u8g2_font_5x7_tf);
  char date[24];
  snprintf(date, sizeof(date), "%04d-%02d-%02d", value.tm_year + 1900, value.tm_mon + 1,
           value.tm_mday);
  display_->centered(date, 50);
  display_->footer(clockShowSeconds_ ? "SEL hide sec" : "SEL show sec",
                   clockUtc_ ? "UTC" : "local");
}

void UI::drawTimer() {
  drawHeader("TIMER");
  uint32_t now = millis();
  uint32_t remaining = 0;
  if (timerPhase_ == TimerPhase::Running) {
    remaining = timerEndMs_ > now ? timerEndMs_ - now : 0;
  } else if (timerPhase_ == TimerPhase::Paused) {
    remaining = timerRemainingMs_;
  } else if (timerPhase_ == TimerPhase::Set) {
    remaining = (uint32_t)kTimerPresets[timerPresetIndex_] * 60000UL;
  }

  char text[16];
  AgnesUtil::formatDuration(remaining / 1000UL, text, sizeof(text));
  display_->g().setFont(u8g2_font_logisoso24_tn);
  int width = display_->g().getUTF8Width(text);
  display_->g().drawStr((128 - width) / 2, 41, text);

  const char* state = "SET";
  if (timerPhase_ == TimerPhase::Running) state = "RUNNING";
  if (timerPhase_ == TimerPhase::Paused) state = "PAUSED";
  if (timerPhase_ == TimerPhase::Done) state = "DONE";
  display_->g().setFont(u8g2_font_5x7_tf);
  display_->centered(state, 20);

  char footer[24];
  if (timerPhase_ == TimerPhase::Running) {
    AgnesUtil::copyString(footer, sizeof(footer), "SEL pause");
  } else if (timerPhase_ == TimerPhase::Paused) {
    AgnesUtil::copyString(footer, sizeof(footer), "SEL resume");
  } else if (timerPhase_ == TimerPhase::Done) {
    AgnesUtil::copyString(footer, sizeof(footer), "SEL reset");
  } else {
    AgnesUtil::copyString(footer, sizeof(footer), "SEL start");
  }
  display_->footer(footer, timerPhase_ == TimerPhase::Set ? "<> minutes" : "hold SEL reset");
}

void UI::drawStopwatch() {
  drawHeader("STOPWATCH");
  uint32_t elapsed = stopwatchAccumMs_;
  if (stopwatchRunning_) elapsed += millis() - stopwatchStartMs_;
  uint32_t seconds = elapsed / 1000UL;
  uint32_t centis = (elapsed % 1000UL) / 10UL;
  char mainText[16];
  snprintf(mainText, sizeof(mainText), "%02lu:%02lu",
           (unsigned long)(seconds / 60UL), (unsigned long)(seconds % 60UL));
  display_->g().setFont(u8g2_font_logisoso24_tn);
  int width = display_->g().getUTF8Width(mainText);
  display_->g().drawStr((128 - width) / 2 - 6, 41, mainText);
  display_->g().setFont(u8g2_font_5x7_tf);
  char centiText[8];
  snprintf(centiText, sizeof(centiText), ".%02lu", (unsigned long)centis);
  display_->g().drawStr((128 + width) / 2 - 4, 41, centiText);
  display_->centered(stopwatchRunning_ ? "RUNNING" : "STOPPED", 20);
  display_->footer(stopwatchRunning_ ? "SEL stop" : "SEL start", "hold SEL reset");
}

void UI::drawCalculator() {
  drawHeader("CALCULATOR");
  display_->g().setFont(u8g2_font_6x10_tf);
  char line[32];
  char op = "+-*/"[calcOperator_];
  if (calcPhase_ == CalcPhase::A) {
    snprintf(line, sizeof(line), "A = %d", (int)calcA_);
  } else if (calcPhase_ == CalcPhase::Operator) {
    snprintf(line, sizeof(line), "%d %c ?", (int)calcA_, op);
  } else if (calcPhase_ == CalcPhase::B) {
    snprintf(line, sizeof(line), "%d %c %d", (int)calcA_, op, (int)calcB_);
  } else {
    snprintf(line, sizeof(line), "%d %c %d =", (int)calcA_, op, (int)calcB_);
  }
  display_->g().drawStr(2, 22, line);

  if (calcPhase_ == CalcPhase::Result) {
    display_->g().setFont(u8g2_font_logisoso24_tn);
    char result[24];
    if (calcError_) snprintf(result, sizeof(result), "ERR");
    else snprintf(result, sizeof(result), "%ld", calcResult_);
    int width = display_->g().getUTF8Width(result);
    display_->g().drawStr((128 - width) / 2, 48, result);
    display_->footer("SEL again", "hold NEXT");
  } else {
    display_->g().setFont(u8g2_font_5x7_tf);
    if (calcPhase_ == CalcPhase::Operator) {
      char opLine[24];
      snprintf(opLine, sizeof(opLine), "Operator: %c", op);
      display_->centered(opLine, 44);
    } else {
      display_->centered(calcPhase_ == CalcPhase::A ? "Set first number" : "Set second number", 44);
    }
    display_->footer("SEL next", "<> +/-");
  }
}

void UI::drawDice() {
  drawHeader("DICE");
  char right[12];
  snprintf(right, sizeof(right), "d%u", (unsigned)kDiceSides[diceSidesIndex_]);
  display_->g().setFont(u8g2_font_5x7_tf);
  display_->rightAligned(right, 88, 8);

  if (diceValue_ == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    display_->centered("Press SEL to roll", 34);
  } else {
    drawDie(display_->g(), 64, 30, 34, diceValue_);
    char value[8];
    snprintf(value, sizeof(value), "%u", (unsigned)diceValue_);
    display_->g().setFont(u8g2_font_6x10_tf);
    display_->centered(value, 52);
  }

  char history[32] = "last:";
  for (uint8_t i = 0; i < diceCount_; ++i) {
    char item[8];
    snprintf(item, sizeof(item), " %u", (unsigned)diceHistory_[i]);
    strncat(history, item, sizeof(history) - strlen(history) - 1);
  }
  display_->g().setFont(u8g2_font_5x7_tf);
  display_->g().drawStr(2, 62, history);
}

void UI::drawCoin() {
  drawHeader("COIN");
  display_->g().drawCircle(64, 29, 16);
  display_->g().setFont(u8g2_font_7x13B_tf);
  if (coinValid_) {
    const char* letter = coinHeads_ ? "H" : "T";
    int width = display_->g().getUTF8Width(letter);
    display_->g().drawStr(64 - width / 2, 35, letter);
  } else {
    display_->g().setFont(u8g2_font_5x7_tf);
    display_->centered("?", 33);
  }
  display_->g().setFont(u8g2_font_5x7_tf);
  char line[40];
  snprintf(line, sizeof(line), "Call: %s", coinCallHeads_ ? "HEADS" : "TAILS");
  display_->g().drawStr(2, 51, line);
  if (coinValid_) {
    bool won = coinHeads_ == coinCallHeads_;
    snprintf(line, sizeof(line), "%s %s", coinHeads_ ? "HEADS" : "TAILS",
             won ? "- you win" : "- no");
    display_->g().drawStr(2, 60, line);
  } else {
    display_->g().drawStr(2, 60, "SEL to flip");
  }
  char counts[20];
  snprintf(counts, sizeof(counts), "H%u T%u", (unsigned)coinHeadsCount_,
           (unsigned)coinTailsCount_);
  display_->rightAligned(counts, 126, 20);
}

void UI::drawMoodLog() {
  drawHeader("MOOD LOG");
  uint8_t count = mood_->historyCount();
  if (count == 0) {
    display_->g().setFont(u8g2_font_5x7_tf);
    drawEmpty("No mood history.", "Chat or pet interactions record mood changes.");
    display_->footer("hold SEL clear", nullptr);
    return;
  }
  const MoodEntry* history = mood_->history();
  int pages = (count + 3) / 4;
  if (pages < 1) pages = 1;
  if (moodPage_ >= pages) moodPage_ = (uint8_t)(pages - 1);
  display_->g().setFont(u8g2_font_5x7_tf);
  int first = moodPage_ * 4;
  for (int i = 0; i < 4 && first + i < count; ++i) {
    const MoodEntry& entry = history[first + i];
    int y = 20 + i * 9;
    char line[32];
    char clock[12];
    AgnesUtil::formatClock(entry.at, clock, sizeof(clock));
    snprintf(line, sizeof(line), "%s  %s", emotionName((Emotion)entry.emotion), clock);
    if (first + i == 0) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
      display_->g().drawStr(4, y, line);
      display_->g().setDrawColor(1);
    } else {
      display_->g().drawStr(4, y, line);
    }
  }
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(moodPage_ + 1), (unsigned)pages);
  display_->footer("SEL page", right);
}

void UI::drawSync() {
  drawHeader("SYNC");
  char age[16];
  formatAge(lastSyncAt_, age, sizeof(age));
  char text[560];
  int written = snprintf(
    text, sizeof(text),
    "Paired: %s\nWi-Fi: %s\nLast sync: %s\nSettings ver: %lu\n"
    "Pending pet: %u\nPending acks: %u\nUnread queue: %u\nCloud queue: %u\n"
    "Last cloud job: %s\nVerify: %s\nLast error: %s\n"
    "Cloud memory: %s\nNotifications: %s",
    storage_->hasDevice() ? "yes" : "no",
    AgnesUtil::wifiStateName((uint8_t)wifi_->state()),
    age,
    (unsigned long)appliedVersion_,
    (unsigned)pet_->pendingEventCount(),
    (unsigned)ackCount_,
    (unsigned)readCount_,
    (unsigned)cloud_->queueDepth(),
    cloudJobName(cloud_->lastJobType()),
    verified_ ? "ok" : (verifyRequested_ ? "pending" : "not yet"),
    lastError_[0] ? lastError_ : "none",
    settings_.cloudMemoryEnabled ? "on" : "off",
    settings_.notificationsEnabled ? "on" : "off");
  if (written < 0) text[0] = '\0';

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(text, 120, 4);
  if (pages < 1) pages = 1;
  if (syncPage_ >= pages) syncPage_ = (uint8_t)(pages - 1);
  display_->drawTextPage(text, syncPage_, 2, 20, 124, 9, 4);
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(syncPage_ + 1), (unsigned)pages);
  display_->footer("SEL sync", right);
}

void UI::drawSettings() {
  drawHeader("SETTINGS", settingsEditing_ ? "EDIT" : nullptr);
  display_->g().setFont(u8g2_font_5x7_tf);

  char sleep[12];
  snprintf(sleep, sizeof(sleep), "%us", (unsigned)settings_.sleepTimeoutSeconds);
  const char* labels[6] = {"Brightness", "Sleep", "Idle anim", "Theme", "Notify", "Cloud mem"};
  const char* values[6] = {
    nullptr, sleep, settings_.idleAnimations ? "on" : "off", settings_.theme,
    "dashboard", "dashboard",
  };
  char brightness[8];
  snprintf(brightness, sizeof(brightness), "%u", (unsigned)settings_.brightness);
  values[0] = brightness;

  for (uint8_t i = settingsScroll_; i < 6 && i < settingsScroll_ + 4; ++i) {
    int y = 20 + (int)(i - settingsScroll_) * 9;
    bool selected = i == settingsIndex_;
    if (selected) {
      display_->g().drawBox(0, y - 7, 128, 9);
      display_->g().setDrawColor(0);
    }
    char line[32];
    snprintf(line, sizeof(line), "%s%s", selected ? "> " : "  ", labels[i]);
    display_->g().drawStr(3, y, line);
    display_->rightAligned(values[i], 125, y);
    display_->g().setDrawColor(1);
  }

  if (settingsEditing_) {
    display_->footer("SEL save", "<> change");
  } else {
    display_->footer("SEL edit", "<> move");
  }
}

void UI::drawDiagnostics() {
  drawHeader("DIAGNOSTICS");
  char age[16];
  formatAge(lastSyncAt_, age, sizeof(age));
  char ip[20];
  AgnesUtil::copyString(ip, sizeof(ip), wifi_->connected() ? wifi_->ip().toString().c_str() : "-");
  char buttons[16];
  snprintf(buttons, sizeof(buttons), "%d/%d/%d",
           buttons_->rawPressed(ButtonId::Previous) ? 1 : 0,
           buttons_->rawPressed(ButtonId::Select) ? 1 : 0,
           buttons_->rawPressed(ButtonId::Next) ? 1 : 0);

  char text[1040];
  int written = snprintf(
    text, sizeof(text),
    "Firmware: %s\nBoard: %s\nOLED: %s  I2C: 0x%02X\n"
    "Paired: %s\nName: %s\nDevice: %s\nApplied settings: v%lu\n"
    "Battery: %umV (%u%%)\nWi-Fi: %s %s\nRSSI: %d dBm\nIP: %s\n"
    "Heap free: %lu\nHeap min: %lu\nUptime: %lu s\n"
    "Event queue: %u (dropped %lu)\nCloud queue: %u  busy: %s\nLast cloud job: %s\n"
    "Sync: %s\nVerify: %s\nLast error: %s\n"
    "Buttons P/S/N: %s\nReset reason: %s\n"
    "URL configured: %s\nCloud memory: %s\nNotifications: %s",
    AGNES_VERSION,
    AGNES_BOARD,
    AGNES_OLED_SH1106 ? "SH1106" : "SSD1306",
    (unsigned)AGNES_OLED_I2C_ADDRESS,
    storage_->hasDevice() ? "yes" : "no",
    storage_->deviceName(),
    storage_->hasDevice() ? storage_->deviceId() : "-",
    (unsigned long)appliedVersion_,
    (unsigned)battery_->millivolts(), (unsigned)battery_->percent(),
    AgnesUtil::wifiStateName((uint8_t)wifi_->state()),
    wifi_->connected() ? "connected" : "offline",
    (int)wifi_->rssi(),
    ip,
    (unsigned long)ESP.getFreeHeap(),
    (unsigned long)ESP.getMinFreeHeap(),
    (unsigned long)(millis() / 1000UL),
    (unsigned)events_->depth(), (unsigned long)events_->dropped(),
    (unsigned)cloud_->queueDepth(), cloud_->busy() ? "yes" : "no",
    cloudJobName(cloud_->lastJobType()),
    age,
    verified_ ? "ok" : (verifyRequested_ ? "pending" : "not yet"),
    lastError_[0] ? lastError_ : "none",
    buttons,
    resetReasonName(esp_reset_reason()),
    strstr(AGNES_SUPABASE_URL, "REPLACE-WITH") ? "no" : "yes",
    settings_.cloudMemoryEnabled ? "on" : "off",
    settings_.notificationsEnabled ? "on" : "off");
  if (written < 0) text[0] = '\0';

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(text, 120, 4);
  if (pages < 1) pages = 1;
  if (diagPage_ >= pages) diagPage_ = (uint8_t)(pages - 1);
  display_->drawTextPage(text, diagPage_, 2, 20, 124, 9, 4);
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(diagPage_ + 1), (unsigned)pages);
  display_->footer("hold SEL reset", right);
}

void UI::drawWifiSetup() {
  drawHeader("WI-FI SETUP");
  char text[760];
  char portal[96] = "";
  if (wifi_->portalActive()) {
    snprintf(portal, sizeof(portal),
             "Setup network: %s\nPassword: %s\nOpen http://192.168.4.1\n"
             "Portal closes in %u min.\n",
             wifi_->portalSsid(), wifi_->portalPassword(),
             (unsigned)((wifi_->portalSecondsLeft() + 59) / 60));
  }
  int written = snprintf(
    text, sizeof(text),
    "%sWi-Fi: %s\nSSID: %s\nIP: %s\n"
    "Paired: %s\nDevice name: %s\n\n"
    "To set up Wi-Fi:\n1. Press SEL to start the setup network.\n"
    "2. Join the AGNES network on your phone.\n"
    "3. Open http://192.168.4.1 and enter your 2.4 GHz Wi-Fi.\n"
    "4. Paste a pairing code from the dashboard (optional for Wi-Fi only).\n"
    "5. Save; the device restarts and connects.\n\n"
    "The setup network is local only and uses WPA2. It is never exposed to "
    "the internet.\n\nCloud URL configured: %s",
    portal,
    AgnesUtil::wifiStateName((uint8_t)wifi_->state()),
    wifi_->ssid()[0] ? wifi_->ssid() : "(none)",
    wifi_->connected() ? wifi_->ip().toString().c_str() : "-",
    storage_->hasDevice() ? "yes" : "no",
    storage_->deviceName(),
    strstr(AGNES_SUPABASE_URL, "REPLACE-WITH") ? "no" : "yes");
  if (written < 0) text[0] = '\0';

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(text, 120, 4);
  if (pages < 1) pages = 1;
  if (wifiPage_ >= pages) wifiPage_ = (uint8_t)(pages - 1);
  display_->drawTextPage(text, wifiPage_, 2, 20, 124, 9, 4);
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(wifiPage_ + 1), (unsigned)pages);
  display_->footer(wifi_->portalActive() ? "SEL stop" : "SEL setup", right);
}

void UI::drawAbout() {
  drawHeader("ABOUT");
  char text[860];
  int written = snprintf(
    text, sizeof(text),
    "AGNES OS %s\nBoard: %s\n"
    "Open-source firmware for ESP32-C3 Super Mini.\n\n"
    "Cloud AI: OpenRouter and NVIDIA NIM, called by the Supabase backend. "
    "The device does not run an LLM on-chip. Cloud AI requires Wi-Fi and pairing.\n\n"
    "Offline apps: Pet, Notes, Memories, Clock (after time sync), Timer, "
    "Stopwatch, Calculator, Dice, Coin Flip, Mood Log, Settings, Diagnostics, "
    "About.\n\n"
    "The 3-button chat uses exactly three short choices generated by the AI. "
    "Without a question the only action is the explicit canned continuation, "
    "not a fourth option.\n\n"
    "Hardware: 128x64 I2C OLED (%s at 0x%02X), three buttons on GPIO %d/%d/%d, "
    "battery ADC on GPIO %d.\n\n"
    "No provider keys or service-role keys are stored in firmware. Paid models "
    "are disabled unless enabled in the dashboard. NVIDIA models are not "
    "labelled free unless the catalogue says so.\n\n"
    "Limitations: deep sleep on ESP32-C3 cannot wake from these button GPIOs; "
    "the firmware uses timer wake for deep sleep and screen-off light sleep "
    "where appropriate.",
    AGNES_VERSION, AGNES_BOARD,
    AGNES_OLED_SH1106 ? "SH1106" : "SSD1306", (unsigned)AGNES_OLED_I2C_ADDRESS,
    AGNES_PIN_BTN_PREV, AGNES_PIN_BTN_SELECT, AGNES_PIN_BTN_NEXT,
    AGNES_PIN_BATTERY_ADC);
  if (written < 0) text[0] = '\0';

  display_->g().setFont(u8g2_font_5x7_tf);
  uint16_t pages = display_->textPageCount(text, 120, 4);
  if (pages < 1) pages = 1;
  if (aboutPage_ >= pages) aboutPage_ = (uint8_t)(pages - 1);
  display_->drawTextPage(text, aboutPage_, 2, 20, 124, 9, 4);
  char right[12];
  snprintf(right, sizeof(right), "%u/%u", (unsigned)(aboutPage_ + 1), (unsigned)pages);
  display_->footer("SEL next", right);
}

void UI::drawConfirm() {
  U8G2& g = display_->g();
  g.setDrawColor(1);
  g.drawBox(0, 0, 128, 64);
  g.setDrawColor(0);
  g.setFont(u8g2_font_6x10_tf);
  g.drawStr(4, 12, "CONFIRM");
  g.drawHLine(0, 15, 128);
  g.setFont(u8g2_font_5x7_tf);
  const char* text = confirm_ == UiConfirm::FactoryReset
    ? "Factory reset erases pairing, Wi-Fi, settings, local caches and queues. "
      "The device will restart and must be paired again."
    : "Clear the local mood history? Chat history on the server is not deleted.";
  display_->drawWrapped(text, 4, 26, 120, 8, 4);
  g.drawHLine(0, 54, 128);
  g.drawStr(3, 62, "SEL yes");
  display_->rightAligned("PREV no", 126, 62);
  g.setDrawColor(1);
}

void UI::drawToast() {
  U8G2& g = display_->g();
  char line[22];
  AgnesUtil::copyString(line, sizeof(line), toast_);
  g.setDrawColor(1);
  g.drawBox(0, 48, 128, 16);
  g.setDrawColor(0);
  g.setFont(u8g2_font_5x7_tf);
  g.drawStr(2, 59, line);
  g.setDrawColor(1);
}

void UI::drawEmpty(const char* line1, const char* line2) {
  if (!display_) return;
  display_->g().setFont(u8g2_font_6x10_tf);
  display_->centered(line1, 30);
  display_->g().setFont(u8g2_font_5x7_tf);
  if (line2 && line2[0]) display_->drawWrapped(line2, 4, 42, 120, 8, 2);
}
