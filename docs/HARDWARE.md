# Hardware — AGNES pocket mini

## Confirmed hardware in the brief

- ESP32-C3 Super Mini, Arduino framework, C++.
- 0.93-inch 128×64 monochrome I2C OLED (controller **not yet verified**).
- 3.7 V 500 mAh LiPo.
- USB-C TP4056 charging module (**protection and current must be verified**).
- Three momentary push buttons.
- Planned pins: SDA GPIO4, SCL GPIO5, PREV GPIO6, SELECT GPIO7, NEXT GPIO8
  (GPIO10 is preferred).
- Battery sense on GPIO0 through a divider.

No microphone or speaker is present. Version 2.0 does not require sensors.

## Mandatory checks before final assembly

### OLED controller

0.93"/0.96" modules are commonly SSD1306; 1.3" modules are commonly SH1106, but clones
vary. Check the controller marking or run the two-driver test.

Firmware supports both at compile time:

```cpp
// Config.h
#define AGNES_OLED_SH1106 0  // 0 = SSD1306 (default), 1 = SH1106
```

U8g2 is used for both. If the display is blank after flashing, verify I2C address
(usually 0x3C or 0x3D) and try the other driver. Address is configurable in `Config.h`.

### NEXT button / GPIO8 strapping

GPIO8 participates in ESP32-C3 boot strapping. It can work after boot, but a button
held low during reset can prevent normal boot. It is also the onboard LED pin on many
Super Mini clones.

- Firmware default is GPIO8 so the currently wired device works.
- Recommended final wiring: move NEXT to GPIO10 and compile with
  `-DAGNES_BUTTON_NEXT_PIN=10`, or edit `Config.h`.
- Verify GPIO10 is actually exposed on your clone. Some clones omit it.
- All buttons: one side to GPIO, other side to GND, `INPUT_PULLUP`, active LOW.
  100 nF from each GPIO to GND is recommended for noise.
- Do not use GPIO9 for a button (BOOT strapping).

### Battery measurement

Use a divider so the ADC never sees more than 3.1 V.

Recommended: 100 kΩ top, 100 kΩ bottom, 100 nF from GPIO0 to GND.
Battery voltage range 3.0–4.2 V maps to 1.5–2.1 V at the ADC, within the 11 dB
attenuation range. High-value resistors reduce standby drain but require the capacitor
for the ADC sample-and-hold.

Firmware defaults:

```cpp
#define AGNES_BATTERY_DIVIDER_RATIO 2.0f
#define AGNES_BATTERY_CALIBRATION  1.0f
```

Calibrate against a multimeter:

1. Measure pack voltage `Vbat`.
2. Read the firmware's raw calculated voltage `Vfw`.
3. Set `AGNES_BATTERY_CALIBRATION = Vbat / Vfw`.

Repeat near 3.7 V and 4.1 V. Do not connect the LiPo directly to 3.3 V or 5 V.

### Charger and power path

TP4056 modules vary:

- Many are **1 A** default. A 500 mAh LiPo should generally charge at ≤0.5C = 250 mA.
  Fit/verify `RPROG ≈ 4.7 kΩ` (about 255 mA) and confirm the cell datasheet allows it.
- Some modules have DW01+FS8205 protection, many do not. Use a protected cell or add a
  proper protection circuit (over-charge, over-discharge, over-current).
- TP4056 has **no power path**. Running the ESP32 from the battery while charging can
  confuse charge termination and is unsafe without load sharing. Use a charger with a
  power-path feature (e.g. BQ24074-class) or a correctly designed load-sharing circuit.
- Add a power switch and a resettable fuse if possible.
- USB-C CC resistors and data lines must follow the module design; verify 5 V/current.

### 3.3 V regulator

Use a **buck-boost** regulator that stays in regulation across 3.0–4.2 V and supplies
ESP32 Wi-Fi bursts (≥500 mA peak, preferably 1 A). A plain buck (e.g. AMS1117) is not
acceptable: it drops out as the battery falls. Suggested classes: TPS63020, TPS63802,
or a verified Pololu S7V8F3-class module. Add 22–100 µF bulk capacitance near the
ESP32.

Approximate current budget (must be measured, not assumed):

| State | Typical |
|---|---|
| Deep sleep (module dependent) | tens of µA to ~1 mA |
| Idle display on, Wi-Fi off | 15–30 mA |
| Wi-Fi connected, light use | 40–100 mA |
| Active HTTPS request bursts | 120–250 mA peak |

A 500 mAh pack therefore gives hours, not days, with the display and Wi-Fi active.
Do not publish runtime claims until measured.

## Pin map (firmware defaults)

| Function | GPIO | Notes |
|---|---|---|
| OLED SDA | 4 | I2C |
| OLED SCL | 5 | I2C |
| PREV | 6 | active LOW, pull-up |
| SELECT | 7 | active LOW, pull-up |
| NEXT | 8 | active LOW; prefer GPIO10 |
| Battery ADC | 0 | ADC1_CH0, divider |
| Onboard LED (many clones) | 8 | conflicts with NEXT default |

## Firmware build requirement

The 2.0.0 firmware image is about 1.53 MB, larger than the default 1.2 MB app
partition. Build with **Huge APP (3 MB No OTA / 1 MB SPIFFS)**:

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  firmware/AGNES_OS_2_0
```

There is no OTA path in 2.0.0; updates are over USB.

## Power behavior in 2.0.0

- The OLED turns off after the idle timeout.
- With Wi-Fi connected, the device stays awake to sync even when the screen is off.
- Light sleep is entered only when the screen is off and Wi-Fi is disconnected.
- The timer-only deep-sleep helper is not scheduled automatically because the button
  GPIOs are not RTC wake sources on the ESP32-C3.
- Measure real current. Do not quote battery runtime until measured.

## Safe bring-up order

1. Inspect the board for regulator and pin labels; do not trust clone markings.
2. Power from a current-limited bench supply at 3.3 V (100 mA limit) with no battery.
3. Verify 3.3 V rail and OLED I2C with a scanner; OLED only.
4. Add buttons and check serial events.
5. Add battery divider and calibrate ADC.
6. Add LiPo, charger and power path last; measure temperature and current.
7. Run a 24-hour stability test before closing the enclosure.

## Known limitations

- Physical hardware was not available to this build environment, so controller,
  divider values and charging behavior are **not verified**.
- GPIO8 being the default NEXT pin is a compromise for the existing wiring, not the
  recommended final design.
