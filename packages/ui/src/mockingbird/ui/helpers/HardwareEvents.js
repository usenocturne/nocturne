export const HardwareEvent = {
  BACK: "back",
  DIAL_LEFT: "dial_left",
  DIAL_PRESS: "dial_press",
  DIAL_LONG_PRESS: "dial_long_press",
  DIAL_BUTTON_DOWN: "dial_button_down",
  DIAL_BUTTON_UP: "dial_button_up",
  DIAL_RIGHT: "dial_right",
  SETTINGS: "settings",
  PRESET_1: "preset_1",
  PRESET_2: "preset_2",
  PRESET_3: "preset_3",
  PRESET_4: "preset_4",
  PRESET_1_LONG_PRESS: "preset_1_long_press",
  PRESET_2_LONG_PRESS: "preset_2_long_press",
  PRESET_3_LONG_PRESS: "preset_3_long_press",
  PRESET_4_LONG_PRESS: "preset_4_long_press",
  SETTINGS_LONG_PRESS: "settings_long_press",
};

export const EventCode = {
  ENTER: "Enter",
  ESCAPE: "Escape",
  DIGIT_1: "Digit1",
  DIGIT_2: "Digit2",
  DIGIT_3: "Digit3",
  DIGIT_4: "Digit4",
  KEY_M: "KeyM",
};

class LongPressHandler {
  constructor() {
    this.DEFAULT_LONG_PRESS_TIMEOUT = 1000;
    this.activeTimeouts = new Map();
  }

  startLongPressTimer(pressedKey, longPressCallback) {
    this.clearTimeoutForKey(pressedKey);

    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(pressedKey);
      longPressCallback();
    }, this.DEFAULT_LONG_PRESS_TIMEOUT);

    this.activeTimeouts.set(pressedKey, timeoutId);
  }

  fireShortPressAndAbortLongPress(pressedKey, shortPressCallback) {
    if (this.activeTimeouts.has(pressedKey)) {
      this.clearTimeoutForKey(pressedKey);
      shortPressCallback();
      return true;
    }
    return false;
  }

  clearTimeoutForKey(pressedKey) {
    if (this.activeTimeouts.has(pressedKey)) {
      clearTimeout(this.activeTimeouts.get(pressedKey));
      this.activeTimeouts.delete(pressedKey);
    }
  }

  clearAllTimeouts() {
    this.activeTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.activeTimeouts.clear();
  }
}

export class HardwareEvents {
  constructor() {
    this.listeners = new Map();
    this.keysDown = new Set();
    this.longPressHandler = new LongPressHandler();
    this.wheelEventHandler = this.wheelEventHandler.bind(this);
    this.keyDownEventHandler = this.keyDownEventHandler.bind(this);
    this.keyUpEventHandler = this.keyUpEventHandler.bind(this);
    this.startListening();
  }

  startListening() {
    document.addEventListener("wheel", this.wheelEventHandler, {
      passive: false,
    });
    document.addEventListener("keydown", this.keyDownEventHandler, {
      capture: true,
    });
    document.addEventListener("keyup", this.keyUpEventHandler, {
      capture: true,
    });
  }

  stopListening() {
    document.removeEventListener("wheel", this.wheelEventHandler);
    document.removeEventListener("keydown", this.keyDownEventHandler, true);
    document.removeEventListener("keyup", this.keyUpEventHandler, true);
    this.longPressHandler.clearAllTimeouts();
  }

  onDialPress(listener) {
    this.listeners.set(HardwareEvent.DIAL_PRESS, listener);
  }
  onDialLongPress(listener) {
    this.listeners.set(HardwareEvent.DIAL_LONG_PRESS, listener);
  }
  onDialButtonDown(listener) {
    this.listeners.set(HardwareEvent.DIAL_BUTTON_DOWN, listener);
  }
  onDialButtonUp(listener) {
    this.listeners.set(HardwareEvent.DIAL_BUTTON_UP, listener);
  }
  onDialLeft(listener) {
    this.listeners.set(HardwareEvent.DIAL_LEFT, listener);
  }
  onDialRight(listener) {
    this.listeners.set(HardwareEvent.DIAL_RIGHT, listener);
  }
  onBack(listener) {
    this.listeners.set(HardwareEvent.BACK, listener);
  }
  onSettings(listener) {
    this.listeners.set(HardwareEvent.SETTINGS, listener);
  }
  onSettingsLongPress(listener) {
    this.listeners.set(HardwareEvent.SETTINGS_LONG_PRESS, listener);
  }
  onPreset1(listener) {
    this.listeners.set(HardwareEvent.PRESET_1, listener);
  }
  onPreset2(listener) {
    this.listeners.set(HardwareEvent.PRESET_2, listener);
  }
  onPreset3(listener) {
    this.listeners.set(HardwareEvent.PRESET_3, listener);
  }
  onPreset4(listener) {
    this.listeners.set(HardwareEvent.PRESET_4, listener);
  }
  onPreset1LongPress(listener) {
    this.listeners.set(HardwareEvent.PRESET_1_LONG_PRESS, listener);
  }
  onPreset2LongPress(listener) {
    this.listeners.set(HardwareEvent.PRESET_2_LONG_PRESS, listener);
  }
  onPreset3LongPress(listener) {
    this.listeners.set(HardwareEvent.PRESET_3_LONG_PRESS, listener);
  }
  onPreset4LongPress(listener) {
    this.listeners.set(HardwareEvent.PRESET_4_LONG_PRESS, listener);
  }

  dispatch(event, ...args) {
    const listener = this.listeners.get(event);
    if (listener) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in hardware event listener for ${event}:`, error);
      }
    }
  }

  wheelEventHandler(event) {
    event.preventDefault();
    event.stopPropagation();

    const deltaX = event.deltaX;

    if (deltaX < 0) {
      this.dispatch(HardwareEvent.DIAL_LEFT);
    } else if (deltaX > 0) {
      this.dispatch(HardwareEvent.DIAL_RIGHT);
    }
  }

  keyDownEventHandler(event) {
    const code = event.code;

    if (this.keysDown.has(code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    this.keysDown.add(code);

    switch (code) {
      case EventCode.ENTER:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dispatch(HardwareEvent.DIAL_BUTTON_DOWN);
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.DIAL_LONG_PRESS);
        });
        break;

      case EventCode.ESCAPE:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dispatch(HardwareEvent.BACK);
        break;

      case EventCode.KEY_M:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.SETTINGS_LONG_PRESS);
        });
        break;

      case EventCode.DIGIT_1:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.PRESET_1_LONG_PRESS);
        });
        break;

      case EventCode.DIGIT_2:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.PRESET_2_LONG_PRESS);
        });
        break;

      case EventCode.DIGIT_3:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.PRESET_3_LONG_PRESS);
        });
        break;

      case EventCode.DIGIT_4:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.startLongPressTimer(code, () => {
          this.dispatch(HardwareEvent.PRESET_4_LONG_PRESS);
        });
        break;
    }
  }

  keyUpEventHandler(event) {
    const code = event.code;

    if (!this.keysDown.has(code)) {
      return;
    }

    this.keysDown.delete(code);

    switch (code) {
      case EventCode.ENTER:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dispatch(HardwareEvent.DIAL_BUTTON_UP);
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.DIAL_PRESS);
        });
        break;

      case EventCode.KEY_M:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.SETTINGS);
        });
        break;

      case EventCode.DIGIT_1:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.PRESET_1);
        });
        break;

      case EventCode.DIGIT_2:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.PRESET_2);
        });
        break;

      case EventCode.DIGIT_3:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.PRESET_3);
        });
        break;

      case EventCode.DIGIT_4:
        event.preventDefault();
        event.stopImmediatePropagation();
        this.longPressHandler.fireShortPressAndAbortLongPress(code, () => {
          this.dispatch(HardwareEvent.PRESET_4);
        });
        break;
    }
  }

  destroy() {
    this.stopListening();
    this.listeners.clear();
  }
}

export default HardwareEvents;
