import { makeAutoObservable, runInAction } from "mobx";
import { sendNocturneWsRequest } from "../../../hooks/useNocturned";

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

class SettingsStore {
  factoryResetConfirmationIsActive = true;
  aboutInfo = null;
  tipsEnabled = localStorage.getItem("tipsEnabled") !== "false";

  constructor(rootStore) {
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
            {
              id: OptionsMenuItemId.PHONE_CALLS,
              label: "Phone calls",
              index: 0,
              visible: () => true,
              type: "parent",
            },
            {
              id: OptionsMenuItemId.AIR_VENT_INTERFERENCE,
              label: "Air vent interference",
              index: 0,
              visible: () => true,
              type: "parent",
            },
            {
              id: OptionsMenuItemId.DISPLAY_AND_BRIGHTNESS,
              label: "Display and brightness",
              index: 0,
              visible: () => true,
              type: "parent",
            },
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
    });

    this.fetchAboutInfo();
  }

  _createSubmenuUiState() {
    const store = this;
    return {
      isToggleOn(item) {
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
            return "YX5H6679"
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
        if (item.disabledOffline) {
          store.unavailableSettingsBannerUiState.showUnavailableBanner();
        } else if (item.id === OptionsMenuItemId.TIPS_TOGGLE) {
          store.toggleTips();
        } else {
          store.gotoView(item);
        }
      },

      showUnavailableBanner() {
        store.unavailableSettingsBannerUiState.showUnavailableBanner();
      },
    };
  }

  _createBannerUiState() {
    const uiState = makeAutoObservable(
      {
        shouldShowAlert: false,
        _timeoutId: null,

        showUnavailableBanner() {
          if (this._timeoutId) {
            clearTimeout(this._timeoutId);
          }
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
        this.rootStore.nightModeController.toggleNightMode();
        break;
      case OptionsMenuItemId.AIR_VENT_INTERFERENCE:
        this.rootStore.airVentInterferenceController.toggleAlertDisabled();
        break;
      case OptionsMenuItemId.PHONE_CALLS:
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
          this.rootStore.voiceStore.toggleMic();
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
    if (this.currentIsFactoryReset) {
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
    if (this.currentIsFactoryReset) {
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
      this.rootStore.voiceStore.toggleMic();
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

  switchToModernUI() {
    localStorage.setItem("mockingbirdUiEnabled", "false");
    window.location.reload();
  }

  async doReboot() {
    try {
      await sendNocturneWsRequest("device.power.reboot", {});
    } catch (e) {
      console.error("Reboot failed:", e);
    }
  }

  async doFactoryReset() {
    try {
      await sendNocturneWsRequest("device.factoryreset", {});
      setTimeout(() => {
        sendNocturneWsRequest("device.power.reboot", {}).catch(() => {});
      }, 2000);
    } catch (e) {
      console.error("Factory reset failed:", e);
    }
  }

  async fetchAboutInfo() {
    try {
      const info = await sendNocturneWsRequest(
        "device.info",
        {},
        { timeoutMs: 5000 },
      );
      runInAction(() => {
        this.aboutInfo = info || {};
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

  reset() {
    this.viewStack = [this.settings];
    this.currentView.index = 0;
  }
}

export default SettingsStore;
