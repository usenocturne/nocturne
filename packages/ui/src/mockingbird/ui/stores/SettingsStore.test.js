import { beforeAll, describe, expect, test } from "bun:test";
import SettingsStore, { OptionsMenuItemId } from "./SettingsStore";

beforeAll(() => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    send() {}
    close() {}
  };
});

const createStore = () =>
  new SettingsStore({
    overlayController: { hideSettings: () => {} },
    phoneConnectionStore: {},
    bluetoothStore: { bluetoothDeviceList: [] },
    voiceStore: { isMicLocked: false, toggleMic: () => {} },
  });

describe("Mockingbird phone display settings", () => {
  test("mirrors and independently updates both shared preferences", () => {
    const updates = [];
    const store = createStore();
    store.syncSharedPhoneDisplaySettings({
      phoneCallsEnabled: true,
      notificationsEnabled: false,
      locked: false,
      updateSetting: (key, value) => updates.push([key, value]),
    });

    expect(store.submenuUiState.isToggleOn(store.phoneCallsView.rows[0])).toBe(
      true,
    );
    expect(
      store.submenuUiState.isToggleOn(store.notificationsView.rows[0]),
    ).toBe(false);

    store.submenuUiState.handleSubmenuItemClicked(store.phoneCallsView.rows[0]);
    store.submenuUiState.handleSubmenuItemClicked(
      store.notificationsView.rows[0],
    );

    expect(updates).toEqual([
      ["nativePhoneCallsEnabled", false],
      ["nativeNotificationsEnabled", true],
    ]);
  });

  test("dial press toggles the active call and notification rows", () => {
    const updates = [];
    const store = createStore();
    store.syncSharedPhoneDisplaySettings({
      phoneCallsEnabled: true,
      notificationsEnabled: true,
      locked: false,
      updateSetting: (key, value) => updates.push([key, value]),
    });

    store.viewStack.push(store.phoneCallsView);
    store.handleDialPress();
    store.viewStack.pop();
    store.viewStack.push(store.notificationsView);
    store.handleDialPress();

    expect(updates).toEqual([
      ["nativePhoneCallsEnabled", false],
      ["nativeNotificationsEnabled", false],
    ]);
  });

  test("connector lock shows both toggles off without changing preferences", () => {
    const updates = [];
    const store = createStore();
    store.syncSharedPhoneDisplaySettings({
      phoneCallsEnabled: true,
      notificationsEnabled: true,
      locked: true,
      lockedMessage: "Connect a phone directly to change this setting.",
      updateSetting: (key, value) => updates.push([key, value]),
    });

    expect(store.submenuUiState.isToggleOn(store.phoneCallsView.rows[0])).toBe(
      false,
    );
    expect(
      store.submenuUiState.isToggleOn(store.notificationsView.rows[0]),
    ).toBe(false);

    store.togglePhoneDisplaySetting(OptionsMenuItemId.PHONE_CALLS_TOGGLE);
    store.togglePhoneDisplaySetting(OptionsMenuItemId.NOTIFICATIONS_TOGGLE);

    expect(updates).toEqual([]);
    expect(store.phoneCallsEnabled).toBe(true);
    expect(store.notificationsEnabled).toBe(true);
    expect(store.unavailableSettingsBannerUiState.message).toBe(
      "Connect a phone directly to change this setting.",
    );
    store.unavailableSettingsBannerUiState.hideUnavailableBanner();
  });

  test("Nocturne+ lock preserves preferences and uses its message for touch feedback", () => {
    const updates = [];
    const store = createStore();
    const lockedMessage =
      "Subscribe to Nocturne+ to use phone calls and notifications.";
    store.syncSharedPhoneDisplaySettings({
      phoneCallsEnabled: true,
      notificationsEnabled: true,
      locked: true,
      lockedMessage,
      updateSetting: (key, value) => updates.push([key, value]),
    });

    expect(store.submenuUiState.isToggleOn(store.phoneCallsView.rows[0])).toBe(
      false,
    );
    expect(
      store.submenuUiState.isToggleOn(store.notificationsView.rows[0]),
    ).toBe(false);

    store.submenuUiState.handleSubmenuItemClicked(store.phoneCallsView.rows[0]);
    expect(store.unavailableSettingsBannerUiState.message).toBe(lockedMessage);
    store.unavailableSettingsBannerUiState.hideUnavailableBanner();

    expect(updates).toEqual([]);
    expect(store.phoneCallsEnabled).toBe(true);
    expect(store.notificationsEnabled).toBe(true);
    store.unavailableSettingsBannerUiState.hideUnavailableBanner();
  });

  test.each([
    ["phone calls", 0],
    ["notifications", 1],
  ])(
    "dial navigation uses the live Nocturne+ message for %s",
    (_label, optionIndex) => {
      const updates = [];
      const store = createStore();
      const lockedMessage =
        "Subscribe to Nocturne+ to use phone calls and notifications.";
      store.syncSharedPhoneDisplaySettings({
        phoneCallsEnabled: true,
        notificationsEnabled: true,
        locked: true,
        lockedMessage,
        updateSetting: (key, value) => updates.push([key, value]),
      });

      store.currentView.index = 2;
      store.handleDialPress();
      store.currentView.index = optionIndex;
      store.handleDialPress();
      store.handleDialPress();

      expect(store.unavailableSettingsBannerUiState.message).toBe(
        lockedMessage,
      );
      expect(updates).toEqual([]);
      expect(store.phoneCallsEnabled).toBe(true);
      expect(store.notificationsEnabled).toBe(true);
      store.unavailableSettingsBannerUiState.hideUnavailableBanner();
    },
  );
});
