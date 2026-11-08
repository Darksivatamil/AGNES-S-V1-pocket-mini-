#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "Config.h"
#include "EventBus.h"
#include "Storage.h"

class WifiManager {
 public:
  void begin(Storage& storage, EventBus& events);
  void loop();

  void startPortal();
  void stopPortal();
  bool portalActive() const { return portalActive_; }
  bool restartRequested() const { return restartRequested_; }
  const char* portalSsid() const { return portalSsid_; }
  const char* portalPassword() const { return portalPassword_; }
  uint16_t portalSecondsLeft() const;

  void connectNow();
  void disconnect();
  bool connected() const { return WiFi.status() == WL_CONNECTED; }
  WifiState state() const { return state_; }
  int8_t rssi() const { return connected() ? (int8_t)WiFi.RSSI() : 0; }
  IPAddress ip() const { return WiFi.localIP(); }
  const char* lastError() const { return lastError_; }
  const char* ssid() const { return ssid_; }

 private:
  Storage* storage_ = nullptr;
  EventBus* events_ = nullptr;
  WebServer server_{80};
  DNSServer dns_;
  bool serverStarted_ = false;
  bool portalActive_ = false;
  bool restartRequested_ = false;
  WifiState state_ = WifiState::Unprovisioned;
  char ssid_[33] = {0};
  char password_[65] = {0};
  char portalSsid_[24] = {0};
  char portalPassword_[20] = {0};
  char lastError_[64] = {0};
  uint32_t stateSince_ = 0;
  uint32_t retryAt_ = 0;
  uint32_t backoffMs_ = AGNES_WIFI_BACKOFF_MIN_MS;
  uint32_t portalStartedAt_ = 0;
  uint32_t portalSavedAt_ = 0;

  void setState(WifiState state);
  void beginConnect();
  void configurePortalRoutes();
  void sendPortalPage(const char* message);
  void handleRoot();
  void handleSave();
  void handleNotFound();
  void makePortalIdentity();
};
