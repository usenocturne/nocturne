import { makeAutoObservable } from "mobx";

export const NIGHT_MODE_USER_ENABLED_KEY = "night_mode_user_enabled";

const NIGHT_MODE_STRENGTH = 30;
const NIGHT_MODE_SLOPE = 1.4;

const readStoredBoolean = (storage: UiLooseData, key: string) => {
  const stored = storage.getItem(key);
  if (stored === null) return false;

  try {
    return JSON.parse(stored) === true;
  } catch (error) {
    console.warn(`Ignoring invalid Mockingbird setting ${key}:`, error);
    return false;
  }
};

const roundToTwoDecimals = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export default class NightModeController {
  declare rootStore: UiLooseData;
  userEnabled: boolean;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    this.userEnabled = readStoredBoolean(
      rootStore.persistentStorage,
      NIGHT_MODE_USER_ENABLED_KEY,
    );
    makeAutoObservable(this, { rootStore: false });
  }

  get isNightMode() {
    return this.userEnabled;
  }

  toggleNightMode() {
    this.userEnabled = !this.userEnabled;
    this.rootStore.persistentStorage.setItem(
      NIGHT_MODE_USER_ENABLED_KEY,
      JSON.stringify(this.userEnabled),
    );
  }

  get appOpacity() {
    const ambientLight = this.isNightMode
      ? this.rootStore.hardwareStore.ambientLightValue
      : 0;
    const opacity =
      1 - (NIGHT_MODE_SLOPE * ambientLight + NIGHT_MODE_STRENGTH - 100) / 100;

    return roundToTwoDecimals(opacity);
  }
}
