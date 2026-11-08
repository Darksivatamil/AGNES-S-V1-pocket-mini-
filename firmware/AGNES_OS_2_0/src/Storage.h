#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Types.h"

// NVS-backed identity/settings plus LittleFS-backed bounded caches.
// No secret is ever logged. Wi-Fi credentials are stored in plain NVS, which
// protects against accidental disclosure over the network but not against
// physical flash extraction. See docs/SECURITY.md.
class Storage {
 public:
  bool begin();

  // ---- device identity (NVS) ----
  bool hasDevice() const { return paired; }
  const char* deviceId() const { return deviceId_; }
  const char* token() const { return token_; }
  const char* hardwareId() const { return hardwareId_; }
  const char* deviceName() const { return deviceName_; }
  bool saveDevice(const char* id, const char* token, const char* name);
  void clearDevice();
  void saveDeviceName(const char* name);

  // ---- Wi-Fi (NVS) ----
  bool hasWifi() const { return wifiSaved; }
  bool saveWifi(const char* ssid, const char* password);
  bool loadWifi(char* ssid, size_t ssidCap, char* password, size_t passCap);
  void clearWifi();

  // ---- one-shot pairing code (NVS) ----
  bool savePairingCode(const char* code);
  bool hasPairingCode();
  bool takePairingCode(char* out, size_t capacity);

  // ---- settings (NVS) ----
  bool loadSettings(AgnesSettings& out);
  bool saveSettings(const AgnesSettings& settings);
  uint32_t loadAppliedVersion();
  void saveAppliedVersion(uint32_t version);
  void clearSettings();

  // ---- local notes / memory cache (LittleFS) ----
  bool saveNotes(const CloudNote* notes, uint8_t count);
  uint8_t loadNotes(CloudNote* out, uint8_t maxCount);
  bool saveMemories(const CloudMemory* memories, uint8_t count);
  uint8_t loadMemories(CloudMemory* out, uint8_t maxCount);

  // ---- chat cache (LittleFS) ----
  bool saveChat(const ChatReply& reply);
  bool loadChat(ChatReply& out);
  void clearChat();

  // ---- pet (LittleFS) ----
  bool savePet(const PetState& pet);
  bool loadPet(PetState& out);

  // ---- mood history (LittleFS) ----
  bool saveMoods(const MoodEntry* moods, uint8_t count);
  uint8_t loadMoods(MoodEntry* out, uint8_t maxCount);

  // ---- notifications and read acknowledgements (LittleFS) ----
  bool saveNotifications(const CloudNotification* notifications, uint8_t count);
  uint8_t loadNotifications(CloudNotification* out, uint8_t maxCount);
  bool saveReadNotifications(const char ids[][40], uint8_t count);
  uint8_t loadReadNotifications(char out[][40], uint8_t maxCount);

  // ---- offline queues (LittleFS) ----
  bool savePetEvents(const PendingPetEvent* events, uint8_t count);
  uint8_t loadPetEvents(PendingPetEvent* out, uint8_t maxCount);
  bool saveAcks(const PendingAck* acks, uint8_t count);
  uint8_t loadAcks(PendingAck* out, uint8_t maxCount);

  void factoryResetLocal();

 private:
  bool paired = false;
  bool wifiSaved = false;
  char deviceId_[40] = {0};
  char token_[72] = {0};
  char hardwareId_[40] = {0};
  char deviceName_[40] = "AGNES";

  void loadIdentity();
  bool writeJson(const char* path, JsonDocument& doc);
  bool readJson(const char* path, JsonDocument& doc);
};
