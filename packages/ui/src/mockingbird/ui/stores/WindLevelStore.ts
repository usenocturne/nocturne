import { makeAutoObservable, reaction } from "mobx";
import { addGlobalWsListener } from "../../../hooks/useNocturned";
import type { WsMessage } from "../../../types";

export const WIND_NOISE_ALERT_DISABLED_KEY = "wind_noise_alert_disabled";

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

export const windLevelFromMessage = (message: WsMessage) => {
  if (message.type !== "event" || message.topic !== "wind_level") return null;

  const data = message.data;
  const value =
    typeof data === "number"
      ? data
      : data !== null && typeof data === "object"
        ? ((data as Record<string, unknown>).level ??
          (data as Record<string, unknown>).value)
        : undefined;

  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
};

export default class WindLevelStore {
  declare rootStore: UiLooseData;
  declare _wsCleanup: () => void;
  currentWindLevel = 0;
  windAlertOnThreshold = 3;
  isOverThreshold = false;
  alertDisabled: boolean;

  constructor(
    rootStore: UiLooseData,
    _socket: UiLooseData,
    _interappActions: UiLooseData,
  ) {
    this.rootStore = rootStore;
    this.alertDisabled = readStoredBoolean(
      rootStore.persistentStorage,
      WIND_NOISE_ALERT_DISABLED_KEY,
    );
    makeAutoObservable(this, { rootStore: false, _wsCleanup: false });

    this._wsCleanup = addGlobalWsListener("mockingbird-wind-level", {
      onMessage: (message) => {
        const level = windLevelFromMessage(message);
        if (level !== null) this.onWindLevel(level);
      },
    });
  }

  onWindLevel(newWindLevel: number) {
    const oldWindLevel = this.currentWindLevel;
    this.currentWindLevel = newWindLevel;
    this.isOverThreshold =
      oldWindLevel < this.windAlertOnThreshold &&
      newWindLevel >= this.windAlertOnThreshold;
  }

  toggleAlertDisabledByUser() {
    this.alertDisabled = !this.alertDisabled;
    this.rootStore.persistentStorage.setItem(
      WIND_NOISE_ALERT_DISABLED_KEY,
      String(this.alertDisabled),
    );
  }

  setWindLevelAlertThreshold(thresholdNumber: number) {
    this.windAlertOnThreshold = thresholdNumber;
  }

  onWindLvlOverThreshold(callback: () => void) {
    return reaction(
      () => this.isOverThreshold,
      (isOverThreshold) => {
        if (isOverThreshold) callback();
      },
    );
  }

  onWindLvlUnderThreshold(callback: () => void) {
    return reaction(
      () => this.currentWindLevel < this.windAlertOnThreshold,
      (isUnderThreshold) => {
        if (isUnderThreshold) callback();
      },
    );
  }

  dispose() {
    this._wsCleanup();
  }
}
