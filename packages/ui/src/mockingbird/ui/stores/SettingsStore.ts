import { makeAutoObservable, runInAction } from "mobx";
import {
  normalizeDeviceInfoResponse,
  sendNocturneWsRequest,
} from "../../../hooks/useNocturned";

export const MainMenuItemId = {
  SETTINGS_ROOT: "SETTINGS_ROOT",
  MIC: "MIC",
  PHONE_CONNECTION: "PHONE_CONNECTION",
  OPTIONS: "OPTIONS",
  ABOUT: "ABOUT",
  TIPS: "TIPS",
  RESTART: "RESTART",
  SWITCH_UI: "SWITCH_UI",
};

export const OptionsMenuItemId = {
  PHONE_CALLS: "PHONE_CALLS",
  PHONE_CALLS_TOGGLE: "PHONE_CALLS_TOGGLE",
  NOTIFICATIONS: "NOTIFICATIONS",
  NOTIFICATIONS_TOGGLE: "NOTIFICATIONS_TOGGLE",
  AIR_VENT_INTERFERENCE: "AIR_VENT_INTERFERENCE",
  DISPLAY_AND_BRIGHTNESS: "DISPLAY_AND_BRIGHTNESS",
  TIPS_TOGGLE: "TIPS_TOGGLE",
};

export const AboutMenuItemId = {
  SERIAL: "SERIAL",
  APP_VERSION: "APP_VERSION",
  OS_VERSION: "OS_VERSION",
  MODEL_NAME: "MODEL_NAME",
  COUNTRY: "COUNTRY",
  FCC_ID_MODEL_NAME: "FCC_ID_MODEL_NAME",
  IC_ID_MODEL_NAME: "IC_ID_MODEL_NAME",
  HVIN: "HVIN",
  LICENSE: "LICENSE",
};

export const RestartMenuItemId = {
  POWER_OFF_TUTORIAL: "power_off_tutorial",
  RESTART_CONFIRM: "restart_confirm",
  FACTORY_RESET: "factory_reset",
};

export const AnimationType = {
  BOTTOM_UP: 0,
  FADE_IN: 1,
};

const DIRECT_PHONE_REQUIRED_MESSAGE =
  "Connect a phone directly to change this setting.";

type SettingsMenuItem = {
  id: string;
  label: string;
  index: number;
  type?: string;
  title?: string;
  subtitle?: string;
  value?: string | number | boolean | null;
  visible?: () => boolean;
  handler?: () => void;
  children?: SettingsMenuItem[];
  rows?: SettingsMenuItem[];
  disabled?: boolean | (() => boolean);
  disabledOffline?: boolean;
  disabledMessage?: string;
  [key: string]: unknown;
};

class SettingsStore {
  declare aboutInfoView: SettingsMenuItem[];
  declare licenseView: SettingsMenuItem;
  declare phoneConnectionView: SettingsMenuItem;
  declare phoneCallsView: SettingsMenuItem;
  declare notificationsView: SettingsMenuItem;
  declare airVentInterferenceView: SettingsMenuItem;
  declare displayAndBrightnessView: SettingsMenuItem;
  declare displayAndBrightnessUiState: UiLooseData;
  declare settings: SettingsMenuItem;
  declare viewStack: SettingsMenuItem[];
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  factoryResetConfirmationIsActive = true;
  aboutInfo = null;
  tipsEnabled = localStorage.getItem("tipsEnabled") !== "false";
  phoneCallsEnabled = true;
  notificationsEnabled = true;
  phonePresentationLocked = false;
  phonePresentationLockedMessage = DIRECT_PHONE_REQUIRED_MESSAGE;
  sharedSettingsUpdater: ((key: string, value: boolean) => void) | null = null;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;

    this.licenseView = {
      id: AboutMenuItemId.LICENSE,
      label: "Third party software",
      index: 0,
      type: "parent",
      visible: () => true,
    };

    this.phoneConnectionView = {
      id: MainMenuItemId.PHONE_CONNECTION,
      label: "Phone connection",
      index: 0,
      visible: () => true,
      type: "parent",
    };

    this.phoneCallsView = {
      id: OptionsMenuItemId.PHONE_CALLS,
      label: "Phone calls",
      index: 0,
      visible: () => true,
      type: "parent",
      rows: [
        {
          id: OptionsMenuItemId.PHONE_CALLS_TOGGLE,
          label: "Phone calls onscreen",
          index: 0,
          visible: () => true,
          type: "toggle",
          disabled: () => this.phonePresentationLocked,
          disabledMessage: this.phonePresentationLockedMessage,
        },
      ],
    };

    this.notificationsView = {
      id: OptionsMenuItemId.NOTIFICATIONS,
      label: "Notifications",
      index: 0,
      visible: () => true,
      type: "parent",
      rows: [
        {
          id: OptionsMenuItemId.NOTIFICATIONS_TOGGLE,
          label: "Notifications onscreen",
          index: 0,
          visible: () => true,
          type: "toggle",
          disabled: () => this.phonePresentationLocked,
          disabledMessage: this.phonePresentationLockedMessage,
        },
      ],
    };

    this.airVentInterferenceView = {
      id: OptionsMenuItemId.AIR_VENT_INTERFERENCE,
      label: "Air vent interference",
      index: 0,
      visible: () => true,
      type: "parent",
    };

    this.displayAndBrightnessView = {
      id: OptionsMenuItemId.DISPLAY_AND_BRIGHTNESS,
      label: "Display and brightness",
      index: 0,
      visible: () => true,
      type: "parent",
    };

    const nightModeController = rootStore.nightModeController;
    this.displayAndBrightnessUiState = {
      get isNightMode() {
        return nightModeController.isNightMode;
      },
      handleDialPress() {
        nightModeController.toggleNightMode();
      },
      handleClickToggle() {
        nightModeController.toggleNightMode();
      },
      logImpression() {},
    };

    this.aboutInfoView = [
      {
        id: AboutMenuItemId.SERIAL,
        label: "Serial No.",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.OS_VERSION,
        label: "OS Version",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.MODEL_NAME,
        label: "Device",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.COUNTRY,
        label: "Country",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.FCC_ID_MODEL_NAME,
        label: "FCC ID",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.IC_ID_MODEL_NAME,
        label: "IC ID",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      {
        id: AboutMenuItemId.HVIN,
        label: "HVIN",
        index: 0,
        visible: () => true,
        type: "key-value",
      },
      this.licenseView,
    ];

    this.settings = {
      id: MainMenuItemId.SETTINGS_ROOT,
      label: "Main menu",
      index: 0,
      visible: () => true,
      type: "parent",
      rows: [
        {
          id: MainMenuItemId.MIC,
          label: "Microphone",
          index: 0,
          disabledOffline: false,
          visible: () => true,
          type: "toggle",
        },
        this.phoneConnectionView,
        {
          id: MainMenuItemId.OPTIONS,
          label: "Options",
          index: 0,
          rows: [
            this.phoneCallsView,
            this.notificationsView,
            this.airVentInterferenceView,
            this.displayAndBrightnessView,
            {
              id: OptionsMenuItemId.TIPS_TOGGLE,
              label: "Onscreen tips",
              index: 0,
              visible: () => true,
              type: "toggle",
            },
          ],
          visible: () => true,
          type: "parent",
        },
        {
          id: MainMenuItemId.TIPS,
          label: "Tips",
          index: 0,
          visible: () => true,
          type: "parent",
        },
        {
          id: MainMenuItemId.ABOUT,
          label: "About",
          index: 0,
          rows: this.aboutInfoView,
          visible: () => true,
          type: "parent",
        },
        {
          id: MainMenuItemId.RESTART,
          label: "Power and Reset",
          index: 0,
          rows: [
            {
              id: RestartMenuItemId.POWER_OFF_TUTORIAL,
              label: "Power off/on",
              index: 0,
              animationType: AnimationType.FADE_IN,
              visible: () => true,
              type: "parent",
            },
            {
              id: RestartMenuItemId.RESTART_CONFIRM,
              label: "Restart",
              index: 0,
              animationType: AnimationType.FADE_IN,
              visible: () => true,
              type: "parent",
            },
            {
              id: RestartMenuItemId.FACTORY_RESET,
              label: "Factory reset",
              index: 0,
              animationType: AnimationType.FADE_IN,
              visible: () => true,
              type: "parent",
            },
          ],
          visible: () => true,
          type: "parent",
        },
        {
          id: MainMenuItemId.SWITCH_UI,
          label: "Switch to Nocturne UI",
          index: 0,
          visible: () => true,
          type: "parent",
        },
      ],
    };

    this.viewStack = [this.settings];

    this.submenuUiState = this._createSubmenuUiState();
    this.unavailableSettingsBannerUiState = this._createBannerUiState();

    makeAutoObservable(this, {
      rootStore: false,
      submenuUiState: false,
      unavailableSettingsBannerUiState: false,
      sharedSettingsUpdater: false,
      displayAndBrightnessUiState: false,
    });

    this.fetchAboutInfo();
  }

  _createSubmenuUiState() {
    const store = this;
    return {
      isToggleOn(item) {
        if (item.id === OptionsMenuItemId.PHONE_CALLS_TOGGLE) {
          return store.phoneCallsEnabled && !store.phonePresentationLocked;
        }
        if (item.id === OptionsMenuItemId.NOTIFICATIONS_TOGGLE) {
          return store.notificationsEnabled && !store.phonePresentationLocked;
        }
        if (item.id === OptionsMenuItemId.TIPS_TOGGLE) {
          return store.tipsEnabled;
        }
        return false;
      },

      getKeyValue(item) {
        const info = store.aboutInfo;
        if (!info) return "...";

        switch (item.id) {
          case AboutMenuItemId.SERIAL:
            return info.serialNumber || "";
          case AboutMenuItemId.OS_VERSION:
            return info.version || "";
          case AboutMenuItemId.MODEL_NAME:
            return info.device || "";
          case AboutMenuItemId.COUNTRY:
            return "United States";
          case AboutMenuItemId.FCC_ID_MODEL_NAME:
            return "2AP3D-YX5H6679";
          case AboutMenuItemId.IC_ID_MODEL_NAME:
            return "24262-YX5H6679";
          case AboutMenuItemId.HVIN:
            return "YX5H6679";
          default:
            return "";
        }
      },

      handleSubmenuItemClicked(item) {
        this.handleSubmenuItemSelected(item);
      },

      handleSubmenuItemDialPressed(item) {
        this.handleSubmenuItemSelected(item);
      },

      handleSubmenuItemSelected(item) {
        if (store.isSettingItemDisabled(item)) {
          store.unavailableSettingsBannerUiState.showUnavailableBanner(
            store.getSettingDisabledMessage(item),
          );
        } else if (
          item.id === OptionsMenuItemId.PHONE_CALLS_TOGGLE ||
          item.id === OptionsMenuItemId.NOTIFICATIONS_TOGGLE
        ) {
          store.togglePhoneDisplaySetting(item.id);
        } else if (item.id === OptionsMenuItemId.TIPS_TOGGLE) {
          store.toggleTips();
        } else {
          store.gotoView(item);
        }
      },

      showUnavailableBanner(message) {
        store.unavailableSettingsBannerUiState.showUnavailableBanner(message);
      },
    };
  }

  _createBannerUiState() {
    const uiState = makeAutoObservable(
      {
        shouldShowAlert: false,
        message: "This setting is unavailable in Mockingbird UI mode.",
        _timeoutId: null,

        showUnavailableBanner(message) {
          if (this._timeoutId) {
            clearTimeout(this._timeoutId);
          }
          this.message =
            message || "This setting is unavailable in Mockingbird UI mode.";
          this.shouldShowAlert = true;
          this._timeoutId = setTimeout(() => {
            runInAction(() => {
              this.shouldShowAlert = false;
              this._timeoutId = null;
            });
          }, 5000);
        },

        hideUnavailableBanner() {
          if (this._timeoutId) {
            clearTimeout(this._timeoutId);
            this._timeoutId = null;
          }
          this.shouldShowAlert = false;
        },

        logImpression() {},
      },
      {
        _timeoutId: false,
      },
    );
    return uiState;
  }

  get rows() {
    if (this.settings.rows) return this.filterOutNonVisible(this.settings.rows);
    return [];
  }

  get currentView() {
    return this.viewStack[this.viewStack.length - 1];
  }

  get isMainMenu() {
    return this.currentView.id === MainMenuItemId.SETTINGS_ROOT;
  }

  get isPowerTutorial() {
    return this.currentView.id === RestartMenuItemId.POWER_OFF_TUTORIAL;
  }

  get currentIsFactoryReset() {
    return this.currentView.id === RestartMenuItemId.FACTORY_RESET;
  }

  get currentIsPhoneConnection() {
    return this.currentView.id === MainMenuItemId.PHONE_CONNECTION;
  }

  get currentIsAirVentInterference() {
    return this.currentView.id === OptionsMenuItemId.AIR_VENT_INTERFERENCE;
  }

  get currentIsPhoneCalls() {
    return this.currentView.id === OptionsMenuItemId.PHONE_CALLS;
  }

  get currentIsNotifications() {
    return this.currentView.id === OptionsMenuItemId.NOTIFICATIONS;
  }

  get currentIsDisplayAndBrightness() {
    return this.currentView.id === OptionsMenuItemId.DISPLAY_AND_BRIGHTNESS;
  }

  get currentIsTipsOndemand() {
    return this.currentView.id === MainMenuItemId.TIPS;
  }

  get highlightedItem() {
    return this.currentView.rows
      ? this.currentView.rows[this.currentView.index]
      : undefined;
  }

  isMainMenuItemDisabled(disabledOffline) {
    return disabledOffline === true;
  }

  gotoView(view) {
    if (view.type === "parent") {
      this.viewStack.push(view);
    }
  }

  handleBack() {
    const { phoneConnectionStore } = this.rootStore;

    if (this.currentIsPhoneConnection) {
      if (phoneConnectionStore.phoneConnectionModal !== undefined) {
        phoneConnectionStore.dismissModal();
        return;
      }
      if (
        phoneConnectionStore.phoneConnectionContextMenuUiState.phoneMenuShowing
      ) {
        phoneConnectionStore.phoneConnectionContextMenuUiState.dismissMenu();
        return;
      }
    }

    if (this.viewStack.length === 1) {
      this.rootStore.overlayController.hideSettings();
      this.reset();
    } else {
      this.viewStack.pop();
      this.currentView.rows?.forEach((row) => (row.index = 0));
    }
  }

  handleDialPress() {
    const { phoneConnectionStore, bluetoothStore } = this.rootStore;
    switch (this.currentView.id) {
      case MainMenuItemId.ABOUT:
        if (this.highlightedItem?.id === AboutMenuItemId.LICENSE) {
          this.gotoView(this.licenseView);
        }
        break;
      case RestartMenuItemId.RESTART_CONFIRM:
        this.doReboot();
        break;
      case RestartMenuItemId.FACTORY_RESET:
        if (this.factoryResetConfirmationIsActive) {
          this.doFactoryReset();
        } else {
          this.handleBack();
        }
        break;
      case OptionsMenuItemId.DISPLAY_AND_BRIGHTNESS:
        this.displayAndBrightnessUiState.handleDialPress();
        break;
      case OptionsMenuItemId.AIR_VENT_INTERFERENCE:
        this.rootStore.airVentInterferenceController.handleDialPress();
        break;
      case OptionsMenuItemId.PHONE_CALLS:
      case OptionsMenuItemId.NOTIFICATIONS:
        if (this.highlightedItem) {
          this.submenuUiState.handleSubmenuItemDialPressed(
            this.highlightedItem,
          );
        }
        break;
      case MainMenuItemId.OPTIONS:
        if (this.highlightedItem?.id === OptionsMenuItemId.TIPS_TOGGLE) {
          this.toggleTips();
        } else if (this.highlightedItem) {
          this.gotoView(this.highlightedItem);
        }
        break;
      case MainMenuItemId.PHONE_CONNECTION:
        if (
          phoneConnectionStore.phoneConnectionContextMenuUiState
            .phoneMenuShowing
        ) {
          phoneConnectionStore.phoneConnectionContextMenuUiState.handleActionMenuItemDialPress(
            phoneConnectionStore.phoneConnectionContextMenuUiState
              .phoneMenuItem,
          );
        } else if (
          this.currentView.index === bluetoothStore.bluetoothDeviceList.length
        ) {
          phoneConnectionStore.handleAddNewPhoneDialPress();
        } else {
          phoneConnectionStore.handleSelectPhoneDialPress();
        }
        break;
      case MainMenuItemId.SETTINGS_ROOT:
        if (this.highlightedItem?.id === MainMenuItemId.MIC) {
          if (!this.rootStore.voiceStore.isMicLocked) {
            this.rootStore.voiceStore.toggleMic();
          }
        } else if (this.highlightedItem) {
          this.handleMainMenuItemSelected(this.highlightedItem);
        }
        break;
      default:
        if (this.highlightedItem) {
          this.submenuUiState.handleSubmenuItemDialPressed(
            this.highlightedItem,
          );
        }
    }
  }

  handleDialRight() {
    const { phoneConnectionStore, bluetoothStore } = this.rootStore;
    const nextIndex = this.currentView.index + 1;
    if (this.currentIsAirVentInterference) {
      this.rootStore.airVentInterferenceController.handleDialRight();
    } else if (this.currentIsFactoryReset) {
      this.setFactoryResetConfirmationIsActive(false);
    } else if (this.currentIsPhoneConnection) {
      if (
        phoneConnectionStore.phoneConnectionContextMenuUiState.phoneMenuShowing
      ) {
        phoneConnectionStore.phoneConnectionContextMenuUiState.goToNextItem();
      } else if (nextIndex < bluetoothStore.bluetoothDeviceList.length + 1) {
        this.currentView.index = nextIndex;
      }
    } else if (
      this.currentView.rows &&
      nextIndex < this.currentView.rows.length
    ) {
      this.currentView.index = nextIndex;
    }
  }

  handleDialLeft() {
    const { phoneConnectionStore } = this.rootStore;
    if (this.currentIsAirVentInterference) {
      this.rootStore.airVentInterferenceController.handleDialLeft();
    } else if (this.currentIsFactoryReset) {
      this.setFactoryResetConfirmationIsActive(true);
    } else if (this.currentIsPhoneConnection) {
      if (
        phoneConnectionStore.phoneConnectionContextMenuUiState.phoneMenuShowing
      ) {
        phoneConnectionStore.phoneConnectionContextMenuUiState.goToPreviousItem();
      } else {
        const prevIndex = this.currentView.index - 1;
        if (prevIndex >= 0) {
          this.currentView.index = prevIndex;
        }
      }
    } else {
      const prevIndex = this.currentView.index - 1;
      if (prevIndex >= 0) {
        this.currentView.index = prevIndex;
      }
    }
  }

  handleMainMenuItemSelected(row) {
    const disabled = this.isMainMenuItemDisabled(row.disabledOffline);
    if (disabled) {
      this.unavailableSettingsBannerUiState.showUnavailableBanner();
    } else if (row.id === MainMenuItemId.MIC) {
      if (!this.rootStore.voiceStore.isMicLocked) {
        this.rootStore.voiceStore.toggleMic();
      }
    } else if (row.id === MainMenuItemId.SWITCH_UI) {
      this.switchToModernUI();
    } else {
      this.gotoView(row);
    }
  }

  handleSettingSetNewIndex(index) {
    this.currentView.index = index;
  }

  handleSettingsButtonLongPress() {}

  setFactoryResetConfirmationIsActive(isActive) {
    this.factoryResetConfirmationIsActive = isActive;
  }

  handleFactoryResetClicked() {
    this.handleBack();
  }

  toggleTips() {
    this.tipsEnabled = !this.tipsEnabled;
    localStorage.setItem("tipsEnabled", this.tipsEnabled.toString());
  }

  syncSharedPhoneDisplaySettings(settings) {
    if (!settings) return;
    this.phoneCallsEnabled = settings.phoneCallsEnabled !== false;
    this.notificationsEnabled = settings.notificationsEnabled !== false;
    this.phonePresentationLocked = settings.locked === true;
    this.phonePresentationLockedMessage =
      typeof settings.lockedMessage === "string" &&
      settings.lockedMessage.trim()
        ? settings.lockedMessage
        : DIRECT_PHONE_REQUIRED_MESSAGE;
    this.sharedSettingsUpdater =
      typeof settings.updateSetting === "function"
        ? settings.updateSetting
        : null;
  }

  getSettingDisabledMessage(item) {
    if (
      item.id === OptionsMenuItemId.PHONE_CALLS_TOGGLE ||
      item.id === OptionsMenuItemId.NOTIFICATIONS_TOGGLE
    ) {
      return this.phonePresentationLockedMessage;
    }
    return item.disabledMessage;
  }

  isSettingItemDisabled(item) {
    const disabled =
      typeof item.disabled === "function" ? item.disabled() : item.disabled;
    return disabled === true || item.disabledOffline === true;
  }

  togglePhoneDisplaySetting(itemId) {
    if (this.phonePresentationLocked) {
      this.unavailableSettingsBannerUiState.showUnavailableBanner(
        this.phonePresentationLockedMessage,
      );
      return;
    }

    if (itemId === OptionsMenuItemId.PHONE_CALLS_TOGGLE) {
      const nextValue = !this.phoneCallsEnabled;
      this.phoneCallsEnabled = nextValue;
      this.sharedSettingsUpdater?.("nativePhoneCallsEnabled", nextValue);
      return;
    }

    if (itemId === OptionsMenuItemId.NOTIFICATIONS_TOGGLE) {
      const nextValue = !this.notificationsEnabled;
      this.notificationsEnabled = nextValue;
      this.sharedSettingsUpdater?.("nativeNotificationsEnabled", nextValue);
    }
  }

  switchToModernUI() {
    localStorage.setItem("mockingbirdUiEnabled", "false");
    window.location.reload();
  }

  async doReboot() {
    try {
      /** @type {import("@schema/device").DevicePowerRebootRequest} */
      const request = {};
      await sendNocturneWsRequest("device.power.reboot", request);
    } catch (e) {
      console.error("Reboot failed:", e);
    }
  }

  async doFactoryReset() {
    try {
      /** @type {import("@schema/device").DeviceFactoryResetRequest} */
      const request = {};
      await sendNocturneWsRequest("device.factoryreset", request);
      setTimeout(() => {
        /** @type {import("@schema/device").DevicePowerRebootRequest} */
        const rebootRequest = {};
        sendNocturneWsRequest("device.power.reboot", rebootRequest).catch(
          () => {},
        );
      }, 2000);
    } catch (e) {
      console.error("Factory reset failed:", e);
    }
  }

  async fetchAboutInfo() {
    try {
      /** @type {import("@schema/device").DeviceInfoRequest} */
      const request = {};
      const info = await sendNocturneWsRequest("device.info", request, {
        timeoutMs: 5000,
      });
      runInAction(() => {
        this.aboutInfo = normalizeDeviceInfoResponse(info) || {};
      });
    } catch (e) {
      runInAction(() => {
        this.aboutInfo = {
          device: "Unknown",
          version: "Unknown",
          serialNumber: "Unknown",
        };
      });
    }
  }

  filterOutNonVisible(items) {
    const visibleItems = [];
    items.forEach((item) => {
      if (item.visible()) {
        const i = { ...item };
        visibleItems.push(i);
        if (i.rows) {
          i.rows = this.filterOutNonVisible(i.rows);
        }
      }
    });
    return visibleItems;
  }

  resetSubCategoryIndexes() {
    this.settings.rows?.forEach((row) => (row.index = 0));
  }

  showOnlyAirVentInterference() {
    this.viewStack = [this.airVentInterferenceView];
  }

  reset() {
    this.viewStack = [this.settings];
    this.currentView.index = 0;
  }
}

export default SettingsStore;
