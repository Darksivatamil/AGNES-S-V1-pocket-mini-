#pragma once
#include <Arduino.h>
#include "Battery.h"
#include "Buttons.h"
#include "Chat.h"
#include "Cloud.h"
#include "Config.h"
#include "Display.h"
#include "EventBus.h"
#include "Face.h"
#include "MoodEngine.h"
#include "PetEngine.h"
#include "Power.h"
#include "Storage.h"
#include "Types.h"
#include "WifiManager.h"

enum class AppId : uint8_t {
  Chat = 0,
  Pet,
  Memories,
  Notes,
  Notifications,
  Weather,
  Clock,
  Timer,
  Stopwatch,
  Calculator,
  Dice,
  Coin,
  MoodLog,
  Sync,
  Settings,
  Diagnostics,
  WifiSetup,
  About,
  Count,
};

enum class UiConfirm : uint8_t {
  None = 0,
  FactoryReset,
  ClearMoods,
};

class UI {
 public:
  bool begin(Display& display, Face& face, Buttons& buttons, Battery& battery,
             Power& power, WifiManager& wifi, Cloud& cloud, Storage& storage,
             MoodEngine& mood, PetEngine& pet, EventBus& events);
  void update();

 private:
  Display* display_ = nullptr;
  Face* face_ = nullptr;
  Buttons* buttons_ = nullptr;
  Battery* battery_ = nullptr;
  Power* power_ = nullptr;
  WifiManager* wifi_ = nullptr;
  Cloud* cloud_ = nullptr;
  Storage* storage_ = nullptr;
  MoodEngine* mood_ = nullptr;
  PetEngine* pet_ = nullptr;
  EventBus* events_ = nullptr;

  Chat chat_;
  AgnesSettings settings_;
  uint32_t appliedVersion_ = 0;

  Screen screen_ = Screen::Boot;
  AppId app_ = AppId::Chat;
  uint8_t menuIndex_ = 0;
  uint8_t menuScroll_ = 0;
  uint8_t homeCard_ = 0;
  uint8_t settingsIndex_ = 0;
  uint8_t settingsScroll_ = 0;
  bool settingsEditing_ = false;
  uint8_t diagPage_ = 0;
  uint8_t wifiPage_ = 0;
  uint8_t aboutPage_ = 0;
  uint8_t syncPage_ = 0;
  uint8_t moodPage_ = 0;
  UiConfirm confirm_ = UiConfirm::None;

  CloudNote notes_[AGNES_LOCAL_NOTES_MAX];
  uint8_t noteCount_ = 0;
  uint8_t noteIndex_ = 0;
  uint8_t noteScroll_ = 0;
  bool noteReading_ = false;
  uint8_t notePage_ = 0;

  CloudMemory memories_[AGNES_LOCAL_MEMORY_MAX];
  uint8_t memoryCount_ = 0;
  uint8_t memoryIndex_ = 0;
  uint8_t memoryScroll_ = 0;
  bool memoryReading_ = false;
  uint8_t memoryPage_ = 0;

  CloudNotification notifications_[AGNES_NOTIFICATION_CACHE_MAX];
  uint8_t notificationCount_ = 0;
  uint8_t notificationIndex_ = 0;
  uint8_t notificationScroll_ = 0;
  bool notificationReading_ = false;
  uint8_t notificationPage_ = 0;
  char readIds_[AGNES_NOTIFICATION_READ_MAX][40] = {};
  uint8_t readCount_ = 0;

  PendingAck acks_[20];
  uint8_t ackCount_ = 0;

  CloudToolResult weather_;
  bool weatherValid_ = false;
  bool weatherLoading_ = false;
  uint8_t weatherPage_ = 0;

  bool screenOn_ = true;
  bool verified_ = false;
  bool verifyRequested_ = false;
  bool pairingAttempted_ = false;
  bool restartPending_ = false;
  uint32_t restartAt_ = 0;
  uint32_t bootUntil_ = 0;
  uint32_t lastInputAt_ = 0;
  uint32_t lastDrawAt_ = 0;
  uint32_t nextSyncAt_ = 0;
  uint32_t nextStatusAt_ = 0;
  uint32_t nextVerifyAt_ = 0;
  uint32_t nextPairCheckAt_ = 0;
  uint32_t lastSyncAt_ = 0;
  uint32_t lastErrorAt_ = 0;
  uint32_t toastUntil_ = 0;
  char toast_[72] = {0};
  char lastError_[128] = {0};
  char pairCodeInFlight_[32] = {0};

  uint32_t sentPetCount_ = 0;
  uint32_t sentAckCount_ = 0;
  uint32_t sentReadCount_ = 0;

  uint8_t timerPresetIndex_ = 2;
  uint32_t timerEndMs_ = 0;
  uint32_t timerRemainingMs_ = 0;
  enum class TimerPhase : uint8_t { Set = 0, Running, Paused, Done };
  TimerPhase timerPhase_ = TimerPhase::Set;

  bool stopwatchRunning_ = false;
  uint32_t stopwatchStartMs_ = 0;
  uint32_t stopwatchAccumMs_ = 0;

  enum class CalcPhase : uint8_t { A = 0, Operator, B, Result };
  CalcPhase calcPhase_ = CalcPhase::A;
  int16_t calcA_ = 0;
  int16_t calcB_ = 0;
  uint8_t calcOperator_ = 0;
  long calcResult_ = 0;
  bool calcError_ = false;

  uint8_t diceValue_ = 0;
  uint8_t diceHistory_[5] = {};
  uint8_t diceCount_ = 0;
  uint8_t diceSidesIndex_ = 1;
  bool coinValid_ = false;
  bool coinHeads_ = false;
  bool coinCallHeads_ = true;
  uint16_t coinHeadsCount_ = 0;
  uint16_t coinTailsCount_ = 0;

  uint8_t petAction_ = 0;
  bool clockShowSeconds_ = true;
  bool clockUtc_ = false;
  CloudNotification notificationOpen_;

  // ---- lifecycle / scheduling ----
  void handleEvent(const Event& event);
  void handleButton(const ButtonEvent& event);
  void handleWake();
  void updateIdle(uint32_t now);
  void updateTimer(uint32_t now);
  void requestSync();
  void requestStatus();
  void maybePair();
  void maybeVerify();
  void onWifiConnected();
  void onChatReply(const ChatReply& reply);
  void onChatError(const CloudError& error);
  void handleSyncResult();
  void handlePairResult();
  void handleAuthResult();
  void applyCloudSettings(const CloudSettings& cloud, bool initial);
  void applyLocalSettings();
  void buildStatus(DeviceStatus& status) const;
  void executeCommand(const CloudCommand& command);
  void queueAck(const char* id, const char* status, const char* error = nullptr);
  void removeSentAcks();
  void removeSentReads();
  void addReadId(const char* id);
  bool hasReadId(const char* id) const;
  void refreshNotes();
  void refreshMemories();
  void refreshNotifications();
  void saveReadQueue();
  void markNotificationRead(uint8_t index);
  void markAllNotificationsRead();
  void startWeather();
  void showToast(const char* message);
  void describeCloudError(const CloudError& error);

  // ---- navigation ----
  void openApp(uint8_t index);
  void leaveApp();
  void adjustMenuScroll();
  void openConfirm(UiConfirm kind);
  void confirmAction();
  void cancelConfirm();

  // ---- draw ----
  void draw();
  void drawHeader(const char* title, const char* right = nullptr);
  void drawHome();
  void drawMenu();
  void drawChat();
  void drawPet();
  void drawNotes();
  void drawMemories();
  void drawNotifications();
  void drawAppRun();
  void drawWeather();
  void drawClock();
  void drawTimer();
  void drawStopwatch();
  void drawCalculator();
  void drawDice();
  void drawCoin();
  void drawMoodLog();
  void drawSync();
  void drawSettings();
  void drawDiagnostics();
  void drawWifiSetup();
  void drawAbout();
  void drawConfirm();
  void drawToast();
  void drawEmpty(const char* line1, const char* line2);

  // ---- per-screen buttons ----
  void buttonHome(const ButtonEvent& event);
  void buttonMenu(const ButtonEvent& event);
  void buttonChat(const ButtonEvent& event);
  void buttonPet(const ButtonEvent& event);
  void buttonNotes(const ButtonEvent& event);
  void buttonMemories(const ButtonEvent& event);
  void buttonNotifications(const ButtonEvent& event);
  void buttonAppRun(const ButtonEvent& event);
  void buttonSettings(const ButtonEvent& event);
  void buttonDiagnostics(const ButtonEvent& event);
  void buttonWifiSetup(const ButtonEvent& event);

  static const char* appName(uint8_t index);
};
