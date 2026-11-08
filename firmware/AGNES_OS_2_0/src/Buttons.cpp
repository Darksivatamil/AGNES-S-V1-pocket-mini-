#include "Buttons.h"
#include "Config.h"

bool Buttons::begin() {
  const uint8_t pins[3] = {
    AGNES_PIN_BTN_PREV,
    AGNES_PIN_BTN_SELECT,
    AGNES_PIN_BTN_NEXT,
  };
  for (uint8_t i = 0; i < 3; ++i) {
    states_[i].pin = pins[i];
    pinMode(pins[i], INPUT_PULLUP);
    states_[i].stable = false;
    states_[i].reading = false;
    states_[i].longSent = false;
  }
  return true;
}

bool Buttons::rawPressed(ButtonId id) const {
  uint8_t index = (uint8_t)id;
  if (index > 2) return false;
  return digitalRead(states_[index].pin) == LOW;
}

bool Buttons::poll(ButtonEvent& out) {
  uint32_t now = millis();
  for (uint8_t i = 0; i < 3; ++i) {
    State& state = states_[i];
    bool raw = digitalRead(state.pin) == LOW;
    if (raw != state.reading) {
      state.reading = raw;
      state.changedAt = now;
      continue;
    }
    if ((uint32_t)(now - state.changedAt) < AGNES_BUTTON_DEBOUNCE_MS) continue;

    if (raw != state.stable) {
      state.stable = raw;
      if (state.stable) {
        state.pressedAt = now;
        state.longSent = false;
        state.nextRepeatAt = now + AGNES_REPEAT_DELAY_MS;
      } else if (!state.longSent) {
        out.id = (ButtonId)i;
        out.longPress = false;
        out.repeat = false;
        return true;
      }
      continue;
    }

    if (!state.stable) continue;

    // Long press fires once at the threshold. Holding longer repeats as a
    // navigation event, which is useful for long menus and value adjustment.
    if (!state.longSent && (uint32_t)(now - state.pressedAt) >= AGNES_LONG_PRESS_MS) {
      state.longSent = true;
      out.id = (ButtonId)i;
      out.longPress = true;
      out.repeat = false;
      return true;
    }
    if (state.longSent && (int32_t)(now - state.nextRepeatAt) >= 0) {
      out.id = (ButtonId)i;
      out.longPress = false;
      out.repeat = true;
      state.nextRepeatAt = now + AGNES_REPEAT_RATE_MS;
      return true;
    }
  }
  return false;
}
