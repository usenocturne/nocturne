import { describe, expect, test } from "bun:test";
import NightModeController, {
  NIGHT_MODE_USER_ENABLED_KEY,
} from "./NightModeController";
import AirVentInterferenceController, {
  WIND_NOISE_ALERT_DISMISSED_KEY,
} from "./AirVentInterferenceController";
import { ambientLightFromMessage } from "./HardwareStore";
import { windLevelFromMessage } from "./WindLevelStore";

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
};

describe("Mockingbird Night Mode", () => {
  test("persists the stock preference and applies the recovered opacity curve", () => {
    const persistentStorage = createStorage();
    const rootStore = {
      persistentStorage,
      hardwareStore: { ambientLightValue: 92 },
    };
    const controller = new NightModeController(rootStore);

    expect(controller.isNightMode).toBe(false);
    expect(controller.appOpacity).toBe(1.7);

    controller.toggleNightMode();
    expect(controller.isNightMode).toBe(true);
    expect(controller.appOpacity).toBe(0.41);
    expect(persistentStorage.values.get(NIGHT_MODE_USER_ENABLED_KEY)).toBe(
      "true",
    );

    const curve = [
      [0, 1.7],
      [25, 1.35],
      [50, 1],
      [57.14, 0.9],
      [64.29, 0.8],
      [71.43, 0.7],
      [78.57, 0.6],
      [85.71, 0.5],
      [92.86, 0.4],
      [100, 0.3],
    ];

    for (const [ambientLightValue, opacity] of curve) {
      rootStore.hardwareStore.ambientLightValue = ambientLightValue;
      expect(controller.appOpacity).toBe(opacity);
    }
  });

  test("restores a saved preference and ignores malformed storage", () => {
    const enabled = new NightModeController({
      persistentStorage: createStorage({
        [NIGHT_MODE_USER_ENABLED_KEY]: "true",
      }),
      hardwareStore: { ambientLightValue: 50 },
    });
    expect(enabled.isNightMode).toBe(true);

    const malformed = new NightModeController({
      persistentStorage: createStorage({
        [NIGHT_MODE_USER_ENABLED_KEY]: "not-json",
      }),
      hardwareStore: { ambientLightValue: 50 },
    });
    expect(malformed.isNightMode).toBe(false);
  });

  test("uses the producer-side disabled value without changing the stock curve", () => {
    const persistentStorage = createStorage({
      [NIGHT_MODE_USER_ENABLED_KEY]: "true",
    });
    const controller = new NightModeController({
      persistentStorage,
      hardwareStore: { ambientLightValue: 92 },
    });

    expect(controller.isNightMode).toBe(true);
    expect(controller.appOpacity).toBe(0.41);

    controller.toggleNightMode();
    expect(controller.isNightMode).toBe(false);
    expect(controller.appOpacity).toBe(1.7);
    expect(persistentStorage.values.get(NIGHT_MODE_USER_ENABLED_KEY)).toBe(
      "false",
    );

    controller.toggleNightMode();
    expect(controller.isNightMode).toBe(true);
    expect(controller.appOpacity).toBe(0.41);
  });

  test("accepts only normalized daemon readings from object events", () => {
    expect(
      ambientLightFromMessage({
        type: "event",
        topic: "ambient_light_update",
        data: { value: 1, normalized_value: 92 },
      }),
    ).toBe(92);
    expect(
      ambientLightFromMessage({
        type: "event",
        topic: "ambient_light_update",
        data: { value: 1 },
      }),
    ).toBeNull();
    expect(
      ambientLightFromMessage({
        type: "event",
        topic: "ambient_light_update",
        data: 67,
      }),
    ).toBe(67);
  });
});

describe("Mockingbird Air Vent Interference", () => {
  const createController = (storageValues = {}) => {
    let thresholdCallback = () => {};
    let recoveryCallback = () => {};
    const persistentStorage = createStorage(storageValues);
    const windLevelStore = {
      alertDisabled: false,
      currentWindLevel: 0,
      windAlertOnThreshold: 3,
      toggleAlertDisabledByUser() {
        this.alertDisabled = !this.alertDisabled;
      },
      onWindLvlOverThreshold(callback) {
        thresholdCallback = callback;
        return () => {};
      },
      onWindLvlUnderThreshold(callback) {
        recoveryCallback = callback;
        return () => {};
      },
    };
    const rootStore = {
      persistentStorage,
      windLevelStore,
      voiceStore: { isMicMuted: false },
      hardwareStore: { dialPressed: false },
      overlayController: {
        showSettingsCalls: 0,
        showSettings() {
          this.showSettingsCalls += 1;
        },
      },
      settingsStore: {
        showAirCalls: 0,
        showOnlyAirVentInterference() {
          this.showAirCalls += 1;
        },
      },
    };
    const controller = new AirVentInterferenceController(rootStore);
    return {
      controller,
      rootStore,
      persistentStorage,
      crossThreshold() {
        windLevelStore.currentWindLevel = 3;
        thresholdCallback();
      },
      stayAboveThreshold() {
        windLevelStore.currentWindLevel = 4;
      },
      recoverBelowThreshold() {
        windLevelStore.currentWindLevel = 2;
        recoveryCallback();
      },
    };
  };

  test("parses canonical and legacy wind event payloads", () => {
    expect(
      windLevelFromMessage({
        type: "event",
        topic: "wind_level",
        data: { level: 3, stat: 72 },
      }),
    ).toBe(3);
    expect(
      windLevelFromMessage({
        type: "event",
        topic: "wind_level",
        data: 4,
      }),
    ).toBe(4);
    expect(
      windLevelFromMessage({ type: "event", topic: "other", data: 4 }),
    ).toBeNull();
  });

  test("stays visible above the threshold and clears after wind recovery", () => {
    const {
      controller,
      crossThreshold,
      stayAboveThreshold,
      recoverBelowThreshold,
    } = createController();
    const banner = controller.windAlertBannerUiState;
    banner.setUiActive(true);

    expect(banner.shouldShowAlert).toBe(false);
    crossThreshold();
    expect(banner.shouldShowAlert).toBe(true);
    expect(banner.shouldShowIcon).toBe(true);

    stayAboveThreshold();
    expect(banner.shouldShowAlert).toBe(true);
    expect(banner.shouldShowIcon).toBe(true);

    recoverBelowThreshold();
    expect(banner.shouldShowAlert).toBe(false);
    expect(banner.shouldShowIcon).toBe(false);

    crossThreshold();
    expect(banner.shouldShowAlert).toBe(true);
    banner.dispose();
  });

  test("alert preference suppresses the banner but never the wind icon", () => {
    const { controller, rootStore, crossThreshold } = createController();
    controller.windAlertBannerUiState.setUiActive(true);
    rootStore.windLevelStore.alertDisabled = true;
    crossThreshold();

    expect(controller.windAlertBannerUiState.shouldShowAlert).toBe(false);
    expect(controller.windAlertBannerUiState.shouldShowIcon).toBe(true);
  });

  test("Hide suppresses alerts for 24 hours and How to fix deep-links", () => {
    const { controller, rootStore, persistentStorage, crossThreshold } =
      createController();
    const banner = controller.windAlertBannerUiState;
    banner.setUiActive(true);
    crossThreshold();
    banner.handleClickHide();

    expect(banner.shouldShowAlert).toBe(false);
    expect(
      Number.parseInt(
        persistentStorage.values.get(WIND_NOISE_ALERT_DISMISSED_KEY),
        10,
      ),
    ).toBeGreaterThan(0);

    const another = createController({
      [WIND_NOISE_ALERT_DISMISSED_KEY]: String(
        Date.now() - 23 * 60 * 60 * 1000,
      ),
    });
    another.controller.windAlertBannerUiState.setUiActive(true);
    another.crossThreshold();
    expect(another.controller.windAlertBannerUiState.shouldShowAlert).toBe(
      false,
    );

    const learnMore = createController();
    learnMore.controller.windAlertBannerUiState.setUiActive(true);
    learnMore.crossThreshold();
    learnMore.controller.windAlertBannerUiState.handleClickHowToFix();
    expect(learnMore.rootStore.settingsStore.showAirCalls).toBe(1);
    expect(learnMore.rootStore.overlayController.showSettingsCalls).toBe(1);
  });

  test("suppresses a pending wind banner outside Mockingbird", () => {
    const { controller, crossThreshold } = createController();
    const banner = controller.windAlertBannerUiState;

    banner.setUiActive(true);
    crossThreshold();
    expect(banner.shouldShowAlert).toBe(true);

    banner.setUiActive(false);
    expect(banner.shouldShowAlert).toBe(false);

    banner.setUiActive(true);
    expect(banner.shouldShowAlert).toBe(true);
    banner.dispose();
  });

  test("dial press toggles only while the notification row is selected", () => {
    const { controller, rootStore } = createController();
    const settings = controller.airVentInterferenceUiState;

    controller.handleDialPress();
    expect(rootStore.windLevelStore.alertDisabled).toBe(true);

    controller.handleDialRight();
    controller.handleDialPress();
    expect(rootStore.windLevelStore.alertDisabled).toBe(true);

    controller.handleDialLeft();
    controller.handleDialPress();
    expect(rootStore.windLevelStore.alertDisabled).toBe(false);
    expect(settings.airVentContainerScrollStep).toBe(0);
  });
});
