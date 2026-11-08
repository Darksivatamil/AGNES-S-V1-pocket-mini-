#include "WifiManager.h"
#include "Util.h"
#include <esp_system.h>

namespace {
const char* kPortalCss =
  "body{background:#070b12;color:#d9f7ff;font-family:system-ui,sans-serif;"
  "margin:0;padding:24px}main{max-width:420px;margin:auto}h1{font-size:22px}"
  "p{color:#8fb3c4;line-height:1.45}label{display:block;margin:18px 0 6px;font-size:13px;"
  "color:#8fb3c4}input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;"
  "border:1px solid #1f3a4a;background:#0d1520;color:#eaffff;font-size:16px}"
  "button{width:100%;margin-top:24px;padding:14px;border:0;border-radius:8px;"
  "background:#20d9c8;color:#041014;font-weight:700;font-size:16px}"
  ".note{margin-top:22px;padding:12px;border-left:3px solid #20d9c8;background:#0d1a22;"
  "font-size:13px;color:#9fc7d4}.err{border-left-color:#ff6b6b;color:#ffb4b4}";
}

void WifiManager::begin(Storage& storage, EventBus& events) {
  storage_ = &storage;
  events_ = &events;
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);

  if (storage.loadWifi(ssid_, sizeof(ssid_), password_, sizeof(password_))) {
    beginConnect();
  } else {
    state_ = WifiState::Unprovisioned;
  }
}

void WifiManager::setState(WifiState state) {
  state_ = state;
  stateSince_ = millis();
}

void WifiManager::beginConnect() {
  if (ssid_[0] == '\0') {
    setState(WifiState::Unprovisioned);
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  WiFi.begin(ssid_, password_);
  setState(WifiState::Connecting);
  AgnesUtil::copyString(lastError_, sizeof(lastError_), "");
}

void WifiManager::connectNow() {
  if (!storage_) return;
  if (ssid_[0] == '\0') {
    storage_->loadWifi(ssid_, sizeof(ssid_), password_, sizeof(password_));
  }
  if (ssid_[0] == '\0') {
    setState(WifiState::Unprovisioned);
    return;
  }
  backoffMs_ = AGNES_WIFI_BACKOFF_MIN_MS;
  retryAt_ = 0;
  WiFi.disconnect(true);
  beginConnect();
}

void WifiManager::disconnect() {
  WiFi.disconnect(true);
  setState(WifiState::Backoff);
  retryAt_ = millis() + backoffMs_;
}

void WifiManager::makePortalIdentity() {
  const char* hardware = storage_ ? storage_->hardwareId() : "agnes-0000";
  size_t length = strlen(hardware);
  const char* suffix = length >= 4 ? hardware + length - 4 : hardware;
  snprintf(portalSsid_, sizeof(portalSsid_), "AGNES-%s", suffix);
  for (char* c = portalSsid_; *c; ++c) {
    if (*c >= 'a' && *c <= 'z') *c = (char)(*c - 32);
  }
  snprintf(portalPassword_, sizeof(portalPassword_), "agnes-%08x", (unsigned)esp_random());
}

void WifiManager::sendPortalPage(const char* message) {
  String html;
  html.reserve(3200);
  html += "<!doctype html><html><head><meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AGNES setup</title><style>";
  html += kPortalCss;
  html += "</style></head><body><main><h1>AGNES setup</h1>";
  html += "<p>Connect this device to your 2.4 GHz Wi-Fi. The password is shown on the "
          "AGNES display while setup mode is active.</p>";
  if (message && message[0]) {
    html += "<div class='note err'>";
    html += message;
    html += "</div>";
  }
  html += "<form method='POST' action='/save'>";
  html += "<label for='ssid'>Wi-Fi name (2.4 GHz)</label>";
  html += "<input id='ssid' name='ssid' maxlength='32' required autocomplete='off'>";
  html += "<label for='pass'>Wi-Fi password</label>";
  html += "<input id='pass' name='password' type='password' maxlength='64' "
          "autocomplete='off'>";
  html += "<label for='pair'>Pairing code from the dashboard (optional for Wi-Fi only)</label>";
  html += "<input id='pair' name='pair' maxlength='32' placeholder='AGN-XXXXX-XXXXX' "
          "autocomplete='off'>";
  html += "<button type='submit'>Save and restart</button></form>";
  html += "<div class='note'>Hardware ID: ";
  html += storage_ ? storage_->hardwareId() : "unknown";
  html += "<br>This page is served only on the local setup network. It is not exposed "
          "to the internet.</div></main></body></html>";
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/html; charset=utf-8", html);
}

void WifiManager::handleRoot() {
  sendPortalPage(nullptr);
}

void WifiManager::handleSave() {
  String ssid = server_.arg("ssid");
  String password = server_.arg("password");
  String pair = server_.arg("pair");
  ssid.trim();
  pair.trim();

  if (ssid.length() == 0 || ssid.length() > 32) {
    sendPortalPage("Enter a Wi-Fi name between 1 and 32 characters.");
    return;
  }
  if (password.length() > 64) {
    sendPortalPage("That Wi-Fi password is too long for this firmware.");
    return;
  }
  if (pair.length() > 0 && (pair.length() < 10 || pair.length() > 32)) {
    sendPortalPage("That pairing code does not look right. Copy it exactly from the dashboard.");
    return;
  }
  if (!storage_) {
    sendPortalPage("Internal storage is unavailable; restart the device and retry.");
    return;
  }

  if (!storage_->saveWifi(ssid.c_str(), password.c_str())) {
    sendPortalPage("Could not save the Wi-Fi settings. Restart and retry.");
    return;
  }
  if (pair.length() > 0) storage_->savePairingCode(pair.c_str());

  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/html; charset=utf-8",
               "<!doctype html><html><head><meta charset='utf-8'>"
               "<meta name='viewport' content='width=device-width,initial-scale=1'>"
               "<style>body{background:#070b12;color:#d9f7ff;font-family:system-ui;"
               "padding:32px;text-align:center}h1{font-size:22px}p{color:#8fb3c4}"
               "</style></head><body><h1>Saved</h1><p>AGNES is restarting and will join "
               "your Wi-Fi. You can close this page.</p></body></html>");
  restartRequested_ = true;
  portalSavedAt_ = millis();
}

void WifiManager::handleNotFound() {
  server_.sendHeader("Location", "http://192.168.4.1/");
  server_.send(302, "text/plain", "");
}

void WifiManager::configurePortalRoutes() {
  server_.on("/", HTTP_GET, [this]() { handleRoot(); });
  server_.on("/save", HTTP_POST, [this]() { handleSave(); });
  server_.on("/save", HTTP_GET, [this]() { handleRoot(); });
  server_.onNotFound([this]() { handleNotFound(); });
}

void WifiManager::startPortal() {
  if (portalActive_) return;
  if (storage_) {
    storage_->loadWifi(ssid_, sizeof(ssid_), password_, sizeof(password_));
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  makePortalIdentity();
  if (!WiFi.softAP(portalSsid_, portalPassword_, 1, false, 2)) {
    AgnesUtil::copyString(lastError_, sizeof(lastError_), "could not start setup network");
    setState(WifiState::Unprovisioned);
    return;
  }
  IPAddress ap = WiFi.softAPIP();
  dns_.setErrorReplyCode(DNSReplyCode::NoError);
  dns_.start(53, "*", ap);
  configurePortalRoutes();
  server_.begin();
  serverStarted_ = true;
  portalActive_ = true;
  restartRequested_ = false;
  portalStartedAt_ = millis();
  portalSavedAt_ = 0;
  setState(WifiState::Provisioning);
  AGNES_LOG("Setup portal %s started at %s", portalSsid_, ap.toString().c_str());
}

void WifiManager::stopPortal() {
  if (!portalActive_) return;
  if (serverStarted_) {
    server_.stop();
    serverStarted_ = false;
  }
  dns_.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalActive_ = false;
  if (ssid_[0] != '\0') {
    beginConnect();
  } else {
    setState(WifiState::Unprovisioned);
  }
}

uint16_t WifiManager::portalSecondsLeft() const {
  if (!portalActive_) return 0;
  uint32_t elapsed = millis() - portalStartedAt_;
  if (elapsed >= AGNES_PROVISION_TIMEOUT_MS) return 0;
  return (uint16_t)((AGNES_PROVISION_TIMEOUT_MS - elapsed) / 1000UL);
}

void WifiManager::loop() {
  if (portalActive_) {
    dns_.processNextRequest();
    server_.handleClient();
    if (restartRequested_ && (uint32_t)(millis() - portalSavedAt_) > 1500) {
      AGNES_LOG("Restarting after setup portal save");
      ESP.restart();
    }
    if ((uint32_t)(millis() - portalStartedAt_) > AGNES_PROVISION_TIMEOUT_MS) {
      AGNES_LOG("Setup portal timed out");
      stopPortal();
    }
    return;
  }

  uint32_t now = millis();

  if (state_ == WifiState::Connecting) {
    if (WiFi.status() == WL_CONNECTED) {
      backoffMs_ = AGNES_WIFI_BACKOFF_MIN_MS;
      setState(WifiState::Connected);
      if (events_) events_->push(EventType::WifiConnected, 0, (int32_t)WiFi.RSSI());
      return;
    }
    if ((uint32_t)(now - stateSince_) > AGNES_WIFI_CONNECT_TIMEOUT_MS) {
      WiFi.disconnect(true);
      AgnesUtil::copyString(lastError_, sizeof(lastError_), "connect timed out");
      setState(WifiState::Backoff);
      retryAt_ = now + backoffMs_;
      backoffMs_ = backoffMs_ * 2 > AGNES_WIFI_BACKOFF_MAX_MS
        ? AGNES_WIFI_BACKOFF_MAX_MS : backoffMs_ * 2;
      if (events_) events_->push(EventType::WifiDisconnected, 1);
    }
    return;
  }

  if (state_ == WifiState::Connected) {
    if (WiFi.status() != WL_CONNECTED) {
      AgnesUtil::copyString(lastError_, sizeof(lastError_), "connection lost");
      setState(WifiState::Backoff);
      retryAt_ = now + backoffMs_;
      backoffMs_ = backoffMs_ * 2 > AGNES_WIFI_BACKOFF_MAX_MS
        ? AGNES_WIFI_BACKOFF_MAX_MS : backoffMs_ * 2;
      if (events_) events_->push(EventType::WifiDisconnected, 2);
    }
    return;
  }

  if (state_ == WifiState::Backoff && (int32_t)(now - retryAt_) >= 0) {
    beginConnect();
  }
}
