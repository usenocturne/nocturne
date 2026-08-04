import { makeAutoObservable } from "mobx";

export const WIND_NOISE_ALERT_DISMISSED_KEY = "wind_noise_alert_dismissed-date";

const DISMISS_TIME_HOURS = 24;

class AirVentInterferenceUiState {
  declare rootStore: UiLooseData;
  airVentContainerScrollStep = 0;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  get airVentAlertsDisabled() {
    return this.rootStore.windLevelStore.alertDisabled;
  }

  get highlightOption() {
    return (
      this.airVentContainerScrollStep === 0 &&
      this.rootStore.hardwareStore.dialPressed
    );
  }

  get isNotificationStep() {
    return this.airVentContainerScrollStep === 0;
  }

  setAirVentInterferenceScrollStep(newStep: number) {
    this.rootStore.overlayController.showSettings();
    if (newStep > 2.7) this.airVentContainerScrollStep = 2;
    else if (newStep < 0.4) this.airVentContainerScrollStep = 0;
    else this.airVentContainerScrollStep = newStep;
  }

  toggleNotification() {
    this.rootStore.windLevelStore.toggleAlertDisabledByUser();
  }

  handleDialPress() {
    if (this.airVentContainerScrollStep === 0) this.toggleNotification();
  }

  handleDialRight() {
    this.setAirVentInterferenceScrollStep(this.airVentContainerScrollStep + 1);
  }

  handleDialLeft() {
    this.setAirVentInterferenceScrollStep(this.airVentContainerScrollStep - 1);
  }

  resetAirVentContainerScrollStep() {
    this.airVentContainerScrollStep = 0;
  }
}

class WindAlertBannerUiState {
  declare rootStore: UiLooseData;
  isUiActive = false;
  showingAlert = false;
  dismissed: boolean;
  declare _thresholdCleanup: () => void;
  declare _recoveryCleanup: () => void;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    this.dismissed = this.getStoredDismissedStatus();
    makeAutoObservable(this, {
      rootStore: false,
      _thresholdCleanup: false,
      _recoveryCleanup: false,
    });

    this._thresholdCleanup = rootStore.windLevelStore.onWindLvlOverThreshold(
      () => {
        this.dismissed = this.getStoredDismissedStatus();
        if (
          !this.dismissed &&
          !rootStore.windLevelStore.alertDisabled &&
          !rootStore.voiceStore.isMicMuted
        ) {
          this.showAlertBanner();
        }
      },
    );
    this._recoveryCleanup = rootStore.windLevelStore.onWindLvlUnderThreshold(
      () => {
        this.hideAlertBanner();
      },
    );
  }

  showAlertBanner() {
    this.showingAlert = true;
  }

  setUiActive(isActive: boolean) {
    this.isUiActive = isActive;
  }

  hideAlertBanner() {
    this.showingAlert = false;
  }

  get shouldShowIcon() {
    return (
      this.rootStore.windLevelStore.currentWindLevel >=
        this.rootStore.windLevelStore.windAlertOnThreshold &&
      !this.rootStore.voiceStore.isMicMuted
    );
  }

  get shouldShowAlert() {
    return (
      this.isUiActive &&
      this.showingAlert &&
      !this.dismissed &&
      !this.rootStore.windLevelStore.alertDisabled &&
      !this.rootStore.voiceStore.isMicMuted
    );
  }

  handleClickHowToFix() {
    this.rootStore.settingsStore.showOnlyAirVentInterference();
    this.rootStore.overlayController.showSettings();
    this.removeAlertBanner();
  }

  handleClickHide() {
    this.rootStore.persistentStorage.setItem(
      WIND_NOISE_ALERT_DISMISSED_KEY,
      JSON.stringify(Date.now()),
    );
    this.removeAlertBanner();
  }

  removeAlertBanner() {
    this.dismissed = true;
    this.hideAlertBanner();
  }

  getStoredDismissedStatus() {
    const dismissedDate = this.rootStore.persistentStorage.getItem(
      WIND_NOISE_ALERT_DISMISSED_KEY,
    );
    if (dismissedDate === null) return false;

    const timestamp = Number.parseInt(dismissedDate, 10);
    if (!Number.isFinite(timestamp)) return false;

    return timestamp + DISMISS_TIME_HOURS * 60 * 60 * 1000 >= Date.now();
  }

  logImpression() {}

  dispose() {
    this._thresholdCleanup();
    this._recoveryCleanup();
  }
}

export default class AirVentInterferenceController {
  declare rootStore: UiLooseData;
  airVentInterferenceUiState: AirVentInterferenceUiState;
  windAlertBannerUiState: WindAlertBannerUiState;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    this.airVentInterferenceUiState = new AirVentInterferenceUiState(rootStore);
    this.windAlertBannerUiState = new WindAlertBannerUiState(rootStore);
  }

  handleDialPress() {
    this.airVentInterferenceUiState.handleDialPress();
  }

  handleDialRight() {
    this.airVentInterferenceUiState.handleDialRight();
  }

  handleDialLeft() {
    this.airVentInterferenceUiState.handleDialLeft();
  }
}
