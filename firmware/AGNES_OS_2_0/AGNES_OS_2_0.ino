#include <Arduino.h>

#include "src/Battery.h"
#include "src/Buttons.h"
#include "src/Cloud.h"
#include "src/Config.h"
#include "src/Display.h"
#include "src/EventBus.h"
#include "src/Face.h"
#include "src/MoodEngine.h"
#include "src/PetEngine.h"
#include "src/Power.h"
#include "src/Storage.h"
#include "src/Types.h"
#include "src/UI.h"
#include "src/WifiManager.h"

Storage gStorage;
EventBus gEvents;
Buttons gButtons;
Display gDisplay;
Face gFace;
Battery gBattery;
Power gPower;
MoodEngine gMood;
PetEngine gPet;
WifiManager gWifi;
Cloud gCloud;
UI gUi;

void setup() {
  Serial.begin(115200);
  delay(200);

  AGNES_LOG("AGNES OS %s booting on %s", AGNES_VERSION, AGNES_BOARD);

  gStorage.begin();
  gEvents.begin();
  gButtons.begin();
  gDisplay.begin();
  gBattery.begin();
  gPower.begin();
  gMood.begin(gStorage);
  gPet.begin(gStorage);
  gWifi.begin(gStorage, gEvents);
  gCloud.begin(gEvents, gWifi, gStorage);

  if (!gUi.begin(gDisplay, gFace, gButtons, gBattery, gPower, gWifi, gCloud,
                 gStorage, gMood, gPet, gEvents)) {
    AGNES_LOG("UI initialization failed");
  }

  AGNES_LOG("Ready: heap=%lu paired=%s wifi=%s",
            (unsigned long)ESP.getFreeHeap(),
            gStorage.hasDevice() ? "yes" : "no",
            gStorage.hasWifi() ? "saved" : "none");
}

void loop() {
  gUi.update();
  delay(1);
}
