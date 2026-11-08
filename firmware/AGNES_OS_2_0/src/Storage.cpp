#include "Storage.h"
#include "Config.h"
#include "Util.h"
#include <Preferences.h>
#include <LittleFS.h>
#include <esp_system.h>

namespace {
const char* kIdNamespace = "agnes_id";
const char* kNetNamespace = "agnes_net";
const char* kCfgNamespace = "agnes_cfg";

const char* kChatPath = "/chat.json";
const char* kNotesPath = "/notes.json";
const char* kMemoriesPath = "/memories.json";
const char* kPetPath = "/pet.json";
const char* kMoodsPath = "/moods.json";
const char* kNotificationsPath = "/notifs.json";
const char* kReadPath = "/readq.json";
const char* kPetEventsPath = "/petq.json";
const char* kAcksPath = "/ackq.json";
}

bool Storage::begin() {
  loadIdentity();

  if (!LittleFS.begin(false)) {
    AGNES_LOG("LittleFS mount failed; formatting (local caches will be empty)");
    if (!LittleFS.begin(true)) {
      AGNES_LOG("LittleFS unavailable; caches disabled");
    }
  }

  Preferences prefs;
  if (prefs.begin(kNetNamespace, true)) {
    wifiSaved = prefs.isKey("ssid");
    prefs.end();
  }
  return true;
}

void Storage::loadIdentity() {
  Preferences prefs;
  if (!prefs.begin(kIdNamespace, false)) return;
  paired = prefs.getBool("paired", false);
  String id = prefs.getString("dev_id", "");
  String token = prefs.getString("dev_tok", "");
  String hardware = prefs.getString("hw_id", "");
  String name = prefs.getString("dev_name", "AGNES");
  AgnesUtil::copyString(deviceId_, sizeof(deviceId_), id.c_str());
  AgnesUtil::copyString(token_, sizeof(token_), token.c_str());
  AgnesUtil::copyString(deviceName_, sizeof(deviceName_), name.c_str());

  if (hardware.length() == 0) {
    uint64_t mac = ESP.getEfuseMac();
    snprintf(hardwareId_, sizeof(hardwareId_), "agnes-%04x%08x",
             (unsigned)((mac >> 32) & 0xFFFF), (unsigned)(mac & 0xFFFFFFFF));
    prefs.putString("hw_id", hardwareId_);
  } else {
    AgnesUtil::copyString(hardwareId_, sizeof(hardwareId_), hardware.c_str());
  }

  if (paired && (strlen(deviceId_) != 36 || strlen(token_) != 64)) {
    // Corrupt or incomplete identity: never present half a credential.
    paired = false;
    deviceId_[0] = '\0';
    token_[0] = '\0';
    prefs.putBool("paired", false);
    prefs.remove("dev_id");
    prefs.remove("dev_tok");
  }
  prefs.end();
}

bool Storage::saveDevice(const char* id, const char* token, const char* name) {
  if (!id || !token || strlen(id) != 36 || strlen(token) != 64) return false;
  Preferences prefs;
  if (!prefs.begin(kIdNamespace, false)) return false;
  prefs.putString("dev_id", id);
  prefs.putString("dev_tok", token);
  if (name && name[0]) prefs.putString("dev_name", name);
  prefs.putBool("paired", true);
  prefs.end();

  AgnesUtil::copyString(deviceId_, sizeof(deviceId_), id);
  AgnesUtil::copyString(token_, sizeof(token_), token);
  if (name && name[0]) AgnesUtil::copyString(deviceName_, sizeof(deviceName_), name);
  paired = true;
  return true;
}

void Storage::clearDevice() {
  Preferences prefs;
  if (prefs.begin(kIdNamespace, false)) {
    prefs.remove("dev_id");
    prefs.remove("dev_tok");
    prefs.remove("paired");
    prefs.end();
  }
  paired = false;
  deviceId_[0] = '\0';
  token_[0] = '\0';
}

void Storage::saveDeviceName(const char* name) {
  if (!name || !name[0]) return;
  Preferences prefs;
  if (!prefs.begin(kIdNamespace, false)) return;
  prefs.putString("dev_name", name);
  prefs.end();
  AgnesUtil::copyString(deviceName_, sizeof(deviceName_), name);
}

bool Storage::saveWifi(const char* ssid, const char* password) {
  if (!ssid || !ssid[0] || strlen(ssid) > 32 || strlen(password) > 64) return false;
  Preferences prefs;
  if (!prefs.begin(kNetNamespace, false)) return false;
  prefs.putString("ssid", ssid);
  prefs.putString("pass", password ? password : "");
  prefs.end();
  wifiSaved = true;
  return true;
}

bool Storage::loadWifi(char* ssid, size_t ssidCap, char* password, size_t passCap) {
  Preferences prefs;
  if (!prefs.begin(kNetNamespace, true)) return false;
  String value = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();
  if (value.length() == 0) return false;
  AgnesUtil::copyString(ssid, ssidCap, value.c_str());
  AgnesUtil::copyString(password, passCap, pass.c_str());
  return true;
}

void Storage::clearWifi() {
  Preferences prefs;
  if (prefs.begin(kNetNamespace, false)) {
    prefs.remove("ssid");
    prefs.remove("pass");
    prefs.end();
  }
  wifiSaved = false;
}

bool Storage::savePairingCode(const char* code) {
  if (!code || strlen(code) < 6) return false;
  Preferences prefs;
  if (!prefs.begin(kNetNamespace, false)) return false;
  prefs.putString("pair_code", code);
  prefs.end();
  return true;
}

bool Storage::hasPairingCode() {
  Preferences prefs;
  if (!prefs.begin(kNetNamespace, true)) return false;
  bool present = prefs.isKey("pair_code") && prefs.getString("pair_code", "").length() > 0;
  prefs.end();
  return present;
}

bool Storage::takePairingCode(char* out, size_t capacity) {
  Preferences prefs;
  if (!prefs.begin(kNetNamespace, false)) return false;
  String value = prefs.getString("pair_code", "");
  prefs.remove("pair_code");
  prefs.end();
  if (value.length() == 0) return false;
  AgnesUtil::copyString(out, capacity, value.c_str());
  return true;
}

bool Storage::loadSettings(AgnesSettings& out) {
  Preferences prefs;
  if (!prefs.begin(kCfgNamespace, true)) return false;
  String personality = prefs.getString("pers", "friendly");
  String theme = prefs.getString("theme", "cyber");
  out.brightness = prefs.getUChar("bright", AGNES_BRIGHTNESS_DEFAULT);
  out.idleAnimations = prefs.getBool("idle", true);
  out.sleepTimeoutSeconds = prefs.getUShort("sleep", AGNES_SLEEP_TIMEOUT_DEFAULT_S);
  out.cloudMemoryEnabled = prefs.getBool("cmem", true);
  out.notificationsEnabled = prefs.getBool("notif", true);
  String tz = prefs.getString("tz", "UTC0");
  out.hasLocation = prefs.getBool("hasloc", false);
  out.latitude = prefs.getFloat("lat", 0.0f);
  out.longitude = prefs.getFloat("lon", 0.0f);
  prefs.end();

  AgnesUtil::copyString(out.personality, sizeof(out.personality), personality.c_str());
  AgnesUtil::copyString(out.theme, sizeof(out.theme), theme.c_str());
  AgnesUtil::copyString(out.timezonePosix, sizeof(out.timezonePosix), tz.c_str());
  if (out.sleepTimeoutSeconds < 30 || out.sleepTimeoutSeconds > 3600) {
    out.sleepTimeoutSeconds = AGNES_SLEEP_TIMEOUT_DEFAULT_S;
  }
  if (out.brightness < 1) out.brightness = 1;
  return true;
}

bool Storage::saveSettings(const AgnesSettings& settings) {
  Preferences prefs;
  if (!prefs.begin(kCfgNamespace, false)) return false;
  prefs.putString("pers", settings.personality);
  prefs.putString("theme", settings.theme);
  prefs.putUChar("bright", settings.brightness);
  prefs.putBool("idle", settings.idleAnimations);
  prefs.putUShort("sleep", settings.sleepTimeoutSeconds);
  prefs.putBool("cmem", settings.cloudMemoryEnabled);
  prefs.putBool("notif", settings.notificationsEnabled);
  prefs.putString("tz", settings.timezonePosix);
  prefs.putBool("hasloc", settings.hasLocation);
  prefs.putFloat("lat", settings.latitude);
  prefs.putFloat("lon", settings.longitude);
  prefs.end();
  return true;
}

uint32_t Storage::loadAppliedVersion() {
  Preferences prefs;
  if (!prefs.begin(kCfgNamespace, true)) return 0;
  uint32_t value = prefs.getUInt("sync_v", 0);
  prefs.end();
  return value;
}

void Storage::saveAppliedVersion(uint32_t version) {
  Preferences prefs;
  if (!prefs.begin(kCfgNamespace, false)) return;
  prefs.putUInt("sync_v", version);
  prefs.end();
}

void Storage::clearSettings() {
  Preferences prefs;
  if (prefs.begin(kCfgNamespace, false)) {
    prefs.clear();
    prefs.end();
  }
}

bool Storage::writeJson(const char* path, JsonDocument& doc) {
  String temp = String(path) + ".tmp";
  File file = LittleFS.open(temp.c_str(), "w");
  if (!file) return false;
  size_t written = serializeJson(doc, file);
  file.close();
  if (written == 0) {
    LittleFS.remove(temp.c_str());
    return false;
  }
  // LittleFS rename replaces an existing target on ESP32 Arduino core 3.x.
  if (!LittleFS.rename(temp.c_str(), path)) {
    LittleFS.remove(path);
    if (!LittleFS.rename(temp.c_str(), path)) {
      LittleFS.remove(temp.c_str());
      return false;
    }
  }
  return true;
}

bool Storage::readJson(const char* path, JsonDocument& doc) {
  File file = LittleFS.open(path, "r");
  if (!file) return false;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  return !error;
}

static void copyJsonString(JsonVariantConst value, char* out, size_t capacity) {
  const char* text = value.is<const char*>() ? value.as<const char*>() : "";
  AgnesUtil::copyString(out, capacity, text ? text : "");
}

bool Storage::saveChat(const ChatReply& reply) {
  JsonDocument doc;
  doc["conversation_id"] = reply.conversationId;
  doc["question_id"] = reply.questionId;
  doc["reply"] = reply.reply;
  doc["question"] = reply.question;
  doc["emotion"] = reply.emotion;
  doc["animation"] = reply.animation;
  doc["intensity"] = reply.intensity;
  doc["mood_delta"] = reply.moodDelta;
  doc["provider"] = reply.provider;
  doc["model"] = reply.model;
  doc["warning"] = reply.warning;
  doc["has_question"] = reply.hasQuestion;
  doc["question_expires"] = reply.questionExpiresEpoch;
  JsonArray options = doc["options"].to<JsonArray>();
  for (uint8_t i = 0; i < reply.optionCount; ++i) {
    JsonObject option = options.add<JsonObject>();
    option["id"] = reply.options[i].id;
    option["label"] = reply.options[i].label;
  }
  return writeJson(kChatPath, doc);
}

bool Storage::loadChat(ChatReply& out) {
  JsonDocument doc;
  if (!readJson(kChatPath, doc)) return false;
  out = ChatReply();
  copyJsonString(doc["conversation_id"], out.conversationId, sizeof(out.conversationId));
  copyJsonString(doc["question_id"], out.questionId, sizeof(out.questionId));
  copyJsonString(doc["reply"], out.reply, sizeof(out.reply));
  copyJsonString(doc["question"], out.question, sizeof(out.question));
  copyJsonString(doc["emotion"], out.emotion, sizeof(out.emotion));
  copyJsonString(doc["animation"], out.animation, sizeof(out.animation));
  copyJsonString(doc["provider"], out.provider, sizeof(out.provider));
  copyJsonString(doc["model"], out.model, sizeof(out.model));
  copyJsonString(doc["warning"], out.warning, sizeof(out.warning));
  out.intensity = (uint8_t)AgnesUtil::clampInt(doc["intensity"] | 1, 1, 3);
  out.moodDelta = (int8_t)AgnesUtil::clampInt(doc["mood_delta"] | 0, -3, 3);
  out.hasQuestion = doc["has_question"] | false;
  out.questionExpiresEpoch = doc["question_expires"] | 0UL;
  JsonArrayConst options = doc["options"].as<JsonArrayConst>();
  out.optionCount = 0;
  for (JsonVariantConst value : options) {
    if (out.optionCount >= 3) break;
    copyJsonString(value["id"], out.options[out.optionCount].id, sizeof(out.options[0].id));
    copyJsonString(value["label"], out.options[out.optionCount].label, sizeof(out.options[0].label));
    if (out.options[out.optionCount].id[0] && out.options[out.optionCount].label[0]) {
      out.optionCount++;
    }
  }
  if (out.optionCount != 3) out.hasQuestion = false;
  return out.reply[0] != '\0' || out.hasQuestion;
}

void Storage::clearChat() {
  LittleFS.remove(kChatPath);
}

bool Storage::saveNotes(const CloudNote* notes, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["notes"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["id"] = notes[i].id;
    item["title"] = notes[i].title;
    item["body"] = notes[i].body;
    item["pinned"] = notes[i].pinned;
    item["version"] = notes[i].version;
  }
  return writeJson(kNotesPath, doc);
}

uint8_t Storage::loadNotes(CloudNote* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kNotesPath, doc)) return 0;
  JsonArrayConst array = doc["notes"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    CloudNote& note = out[count];
    note = CloudNote();
    copyJsonString(value["id"], note.id, sizeof(note.id));
    copyJsonString(value["title"], note.title, sizeof(note.title));
    copyJsonString(value["body"], note.body, sizeof(note.body));
    note.pinned = value["pinned"] | false;
    note.version = value["version"] | 1UL;
    if (note.id[0]) count++;
  }
  return count;
}

bool Storage::saveMemories(const CloudMemory* memories, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["memories"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["id"] = memories[i].id;
    item["category"] = memories[i].category;
    item["content"] = memories[i].content;
    item["pinned"] = memories[i].pinned;
  }
  return writeJson(kMemoriesPath, doc);
}

uint8_t Storage::loadMemories(CloudMemory* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kMemoriesPath, doc)) return 0;
  JsonArrayConst array = doc["memories"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    CloudMemory& memory = out[count];
    memory = CloudMemory();
    copyJsonString(value["id"], memory.id, sizeof(memory.id));
    copyJsonString(value["category"], memory.category, sizeof(memory.category));
    copyJsonString(value["content"], memory.content, sizeof(memory.content));
    memory.pinned = value["pinned"] | false;
    if (memory.id[0]) count++;
  }
  return count;
}

bool Storage::savePet(const PetState& pet) {
  JsonDocument doc;
  doc["name"] = pet.name;
  doc["happiness"] = pet.happiness;
  doc["energy"] = pet.energy;
  doc["hunger"] = pet.hunger;
  doc["friendship_xp"] = pet.friendshipXp;
  doc["level"] = pet.level;
  doc["stage"] = pet.stage;
  doc["last_decay"] = pet.lastDecayEpoch;
  doc["version"] = pet.version;
  return writeJson(kPetPath, doc);
}

bool Storage::loadPet(PetState& out) {
  JsonDocument doc;
  if (!readJson(kPetPath, doc)) return false;
  out = PetState();
  copyJsonString(doc["name"], out.name, sizeof(out.name));
  out.happiness = (uint8_t)AgnesUtil::clampInt(doc["happiness"] | 70, 0, 100);
  out.energy = (uint8_t)AgnesUtil::clampInt(doc["energy"] | 80, 0, 100);
  out.hunger = (uint8_t)AgnesUtil::clampInt(doc["hunger"] | 20, 0, 100);
  out.friendshipXp = (uint16_t)AgnesUtil::clampInt(doc["friendship_xp"] | 0, 0, 65535);
  out.level = (uint8_t)AgnesUtil::clampInt(doc["level"] | 1, 1, 255);
  copyJsonString(doc["stage"], out.stage, sizeof(out.stage));
  out.lastDecayEpoch = doc["last_decay"] | 0UL;
  out.version = doc["version"] | 1UL;
  return true;
}

bool Storage::saveMoods(const MoodEntry* moods, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["moods"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["emotion"] = moods[i].emotion;
    item["at"] = moods[i].at;
  }
  return writeJson(kMoodsPath, doc);
}

uint8_t Storage::loadMoods(MoodEntry* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kMoodsPath, doc)) return 0;
  JsonArrayConst array = doc["moods"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    out[count].emotion = (uint8_t)AgnesUtil::clampInt(value["emotion"] | 0, 0, 14);
    out[count].at = value["at"] | 0UL;
    count++;
  }
  return count;
}

bool Storage::saveNotifications(const CloudNotification* notifications, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["notifications"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["id"] = notifications[i].id;
    item["title"] = notifications[i].title;
    item["body"] = notifications[i].body;
    item["kind"] = notifications[i].kind;
  }
  return writeJson(kNotificationsPath, doc);
}

uint8_t Storage::loadNotifications(CloudNotification* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kNotificationsPath, doc)) return 0;
  JsonArrayConst array = doc["notifications"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    CloudNotification& item = out[count];
    item = CloudNotification();
    copyJsonString(value["id"], item.id, sizeof(item.id));
    copyJsonString(value["title"], item.title, sizeof(item.title));
    copyJsonString(value["body"], item.body, sizeof(item.body));
    copyJsonString(value["kind"], item.kind, sizeof(item.kind));
    if (item.id[0]) count++;
  }
  return count;
}

bool Storage::saveReadNotifications(const char ids[][40], uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["ids"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    if (ids[i][0]) array.add(ids[i]);
  }
  return writeJson(kReadPath, doc);
}

uint8_t Storage::loadReadNotifications(char out[][40], uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kReadPath, doc)) return 0;
  JsonArrayConst array = doc["ids"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    const char* id = value.is<const char*>() ? value.as<const char*>() : "";
    AgnesUtil::copyString(out[count], 40, id);
    if (out[count][0]) count++;
  }
  return count;
}

bool Storage::savePetEvents(const PendingPetEvent* events, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["events"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["id"] = events[i].id;
    item["type"] = events[i].type;
  }
  return writeJson(kPetEventsPath, doc);
}

uint8_t Storage::loadPetEvents(PendingPetEvent* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kPetEventsPath, doc)) return 0;
  JsonArrayConst array = doc["events"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    copyJsonString(value["id"], out[count].id, sizeof(out[count].id));
    copyJsonString(value["type"], out[count].type, sizeof(out[count].type));
    if (out[count].id[0]) count++;
  }
  return count;
}

bool Storage::saveAcks(const PendingAck* acks, uint8_t count) {
  JsonDocument doc;
  JsonArray array = doc["acks"].to<JsonArray>();
  for (uint8_t i = 0; i < count; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["id"] = acks[i].id;
    item["status"] = acks[i].status;
    item["error"] = acks[i].error;
  }
  return writeJson(kAcksPath, doc);
}

uint8_t Storage::loadAcks(PendingAck* out, uint8_t maxCount) {
  JsonDocument doc;
  if (!readJson(kAcksPath, doc)) return 0;
  JsonArrayConst array = doc["acks"].as<JsonArrayConst>();
  uint8_t count = 0;
  for (JsonVariantConst value : array) {
    if (count >= maxCount) break;
    copyJsonString(value["id"], out[count].id, sizeof(out[count].id));
    copyJsonString(value["status"], out[count].status, sizeof(out[count].status));
    copyJsonString(value["error"], out[count].error, sizeof(out[count].error));
    if (out[count].id[0]) count++;
  }
  return count;
}

void Storage::factoryResetLocal() {
  clearDevice();
  clearWifi();
  clearSettings();
  clearChat();
  LittleFS.remove(kNotesPath);
  LittleFS.remove(kMemoriesPath);
  LittleFS.remove(kPetPath);
  LittleFS.remove(kMoodsPath);
  LittleFS.remove(kNotificationsPath);
  LittleFS.remove(kReadPath);
  LittleFS.remove(kPetEventsPath);
  LittleFS.remove(kAcksPath);
  Preferences prefs;
  if (prefs.begin(kNetNamespace, false)) {
    prefs.remove("pair_code");
    prefs.end();
  }
}
