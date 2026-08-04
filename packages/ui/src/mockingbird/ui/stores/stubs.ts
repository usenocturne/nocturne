import { makeAutoObservable, reaction, runInAction } from "mobx";
import { SwipeHandlerClass } from "../components/Views/Npv/SwipeHandler/SwipeHandler";

export class NpvStore {
  declare carThingStores: UiLooseData;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  tipsUiState = {
    dismissVisibleTip: () => {},
    tipToShow: null,
  };

  playingInfoUiState = {
    currentItem: {
      uid: "",
      uri: "",
      image_uri: "",
    },
    title: "",
    subtitle: "",
    contextHeaderTitle: "",
    handlePlayingInfoHeaderClick: () => {
      const rootStore = window.carThingRootStore;
      if (
        rootStore?.queueStore?.queueUiState &&
        rootStore.queueStore.next.length > 0
      ) {
        rootStore.queueStore.queueUiState.displayQueue();
      }
    },
    swipeHandler: {
      swipeDirection: "NONE",
      handleSwipedLeft: () => {
        const rootStore = window.carThingRootStore;
        if (rootStore?.npvStore?.npvController?.next) {
          rootStore.npvStore.npvController.next();
        }
      },
      handleSwipedRight: () => {
        const rootStore = window.carThingRootStore;
        if (rootStore?.npvStore?.npvController?.previous) {
          rootStore.npvStore.npvController.previous();
        }
      },
      setSwipeDirection: (direction) => {
        this.playingInfoUiState.swipeHandler.swipeDirection = direction;
      },
    },
    handleArtistClick: () => {},
    handleArtworkClick: () => {},
    loadPrevAndNextImage: () => {},
    previousItem: null,
    nextItem: null,
    showWindLevelIcon: false,
    isPlayingSpotify: true,
    onRepeat: false,
    onRepeatOnce: false,
  };

  volumeUiState = {
    volumeTimeoutId: null,
    carMode: null,
    isPlayingSpotify: true,
    displayVolume: 0.5,
    volume: 0.5,
    isVolumeAbove0: true,
    get colorChannels() {
      return (
        this.parentStore?.carThingStores?.imageStore?.colors?.get(
          this.parentStore?.playingInfoUiState?.currentItem?.image_uri,
        ) || [0, 0, 0]
      );
    },
    shouldShowVolume: false,

    resetShowVolumeTimer() {
      window.clearTimeout(this.volumeTimeoutId);
      this.volumeTimeoutId = window.setTimeout(() => {
        runInAction(() => this.clearVolumeTimer());
      }, 2000);
      this.shouldShowVolume = true;
    },

    clearVolumeTimer() {
      this.volumeTimeoutId = undefined;
      this.shouldShowVolume = false;
    },
  };

  controlButtonsUiState = {
    controlButtonSet: "music",
    showOtherMediaControls: false,
    showPodcastControls: false,
    isPlaying: false,
    isSaved: false,
    isShuffled: false,
    canSeek: true,
    isPlayingAd: false,
    podcastSpeed: 1.0,
    handlePlayClick: () => {},
    handlePauseClick: () => {},
    handleSkipNextClick: () => {},
    handleSkipPrevClick: () => {},
    handleLikeClick: () => {},
    handleUnlikeClick: () => {},
    handleShuffleClick: () => {},
    handleUnshuffleClick: () => {},
    handleSeekBackClick: () => {},
    handleSeekForwardClick: () => {},
    handleAddToSavedEpisodesClick: () => {},
    handleRemoveFromSavedEpisodesClick: () => {},
    handleBlockClick: () => {},
    handlePodcastSpeedClick: () => {},
  };

  scrubbingUiState = {
    isScrubbing: false,
    isScrubbingEnabled: true,
    get colorChannels() {
      return (
        this.parentStore?.carThingStores?.imageStore?.colors?.get(
          this.parentStore?.playingInfoUiState?.currentItem?.image_uri,
        ) || [0, 0, 0]
      );
    },
    trackPlayedPercent: 0,
    trackPlayedTime: "0:00",
    trackLeftTime: "0:00",
    scrubbingTimeoutId: null,

    startScrubbing() {
      this.isScrubbing = true;
      this.resetScrubbingViewTimer();
    },

    stopScrubbing() {
      this.isScrubbing = false;
      if (this.scrubbingTimeoutId) {
        window.clearTimeout(this.scrubbingTimeoutId);
        this.scrubbingTimeoutId = null;
      }
    },

    resetScrubbingViewTimer() {
      if (this.scrubbingTimeoutId) {
        window.clearTimeout(this.scrubbingTimeoutId);
      }
      this.scrubbingTimeoutId = window.setTimeout(() => {
        if (
          window.scrubbingHardwareDialHandler &&
          window.scrubbingTimeoutShouldSeek
        ) {
          const scrubbingProgress = window.scrubbingProgressValue;
          const playbackProgress = window.scrubbingPlaybackProgress;
          const onSeek = window.scrubbingOnSeek;

          if (
            scrubbingProgress !== null &&
            playbackProgress?.duration &&
            onSeek
          ) {
            const seekMs = Math.floor(
              scrubbingProgress * playbackProgress.duration,
            );
            if (seekMs >= playbackProgress.duration - 1000) {
              const rootStore = window.carThingRootStore;
              rootStore?.npvStore?.npvController?.next?.();
            } else {
              onSeek(seekMs);
            }
          }
        }
        this.stopScrubbing();
      }, 3000);
    },

    handleScrubberClick() {
      this.startScrubbing();
    },

    handleOnTouchMove(e) {
      this.startScrubbing();
      const x = e.touches[0].clientX;
      const percent = x / 800;
      this.trackPlayedPercent = Math.max(0, Math.min(1, percent));
    },
  };

  npvController = {
    next: () => {},
    previous: () => {},
    goToContentShelf: () => {
      const viewStore = this.rootStore?.viewStore;
      if (viewStore) {
        viewStore.showContentShelf?.();
      }
    },
    goToQueue: () => {
      const viewStore = this.rootStore?.viewStore;
      if (viewStore) {
        viewStore.showQueue?.();
      }
    },

    handleDialPress: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const npvStore = rootStore?.npvStore;

      if (!npvStore?.scrubbingUiState?.isScrubbing) {
        const playerStore = rootStore?.playerStore;
        if (playerStore?.state?.is_playing) {
          playerStore.pause?.();
        } else {
          playerStore.play?.();
        }
      } else {
        npvStore.scrubbingUiState.stopScrubbing();
      }
    },

    handleDialLongPress: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const queueStore = rootStore?.queueStore;
      if (queueStore?.queueUiState?.displayQueue) {
        queueStore.queueUiState.displayQueue();
      }
    },

    handleDialLeft: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const npvStore = rootStore?.npvStore;

      if (npvStore?.scrubbingUiState?.isScrubbing) {
        if (window.scrubbingHardwareDialHandler) {
          window.scrubbingHardwareDialHandler("left");
        }
      } else {
        const volumeStore = rootStore?.volumeStore;
        volumeStore?.decreaseVolume?.();
      }
    },

    handleDialRight: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const npvStore = rootStore?.npvStore;

      if (npvStore?.scrubbingUiState?.isScrubbing) {
        if (window.scrubbingHardwareDialHandler) {
          window.scrubbingHardwareDialHandler("right");
        }
      } else {
        const volumeStore = rootStore?.volumeStore;
        volumeStore?.increaseVolume?.();
      }
    },

    handleBackButton: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const viewStore = rootStore?.viewStore;
      if (viewStore) {
        viewStore.showContentShelf?.();
      }
    },
  };

  constructor(rootStore: UiLooseData, middlewareActions: UiLooseData) {
    this.rootStore = rootStore;
    this.carThingStores = rootStore;
    makeAutoObservable(this, { rootStore: false });

    if (this.scrubbingUiState) {
      this.scrubbingUiState.parentStore = this;
    }
    if (this.volumeUiState) {
      this.volumeUiState.parentStore = this;
    }

    Object.defineProperty(this.playingInfoUiState, "isMicMuted", {
      get: () => rootStore?.voiceStore?.isMicMuted ?? false,
      configurable: true,
    });

    Object.defineProperty(this.playingInfoUiState, "showWindLevelIcon", {
      get: () =>
        rootStore?.airVentInterferenceController?.windAlertBannerUiState
          ?.shouldShowIcon ?? false,
      configurable: true,
    });

    this.playingInfoUiState.showSettings = () => {
      rootStore?.overlayController?.toggleSettings();
    };

    this.initializeSwipeHandler();
  }

  initializeSwipeHandler() {
    const playerStoreInterface = {
      get currentTrack() {
        return this.rootStore?.playerStore?.currentTrack || {};
      },
      get currentTrackPosition() {
        return this.rootStore?.playerStore?.state?.progress_ms || 0;
      },
      skipNext: () => {
        if (window.carThingSkipNext) {
          window.carThingSkipNext();
        }
      },
      skipPrevForce: () => {
        if (window.carThingSkipPrev) {
          window.carThingSkipPrev();
        }
      },
    };

    playerStoreInterface.rootStore = this.rootStore;

    const swipeHandler = new SwipeHandlerClass(playerStoreInterface);

    this.playingInfoUiState.swipeHandler = swipeHandler;
  }
}

export class BluetoothStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    socket: UiLooseData,
    middlewareActions: UiLooseData,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class RemoteControlStore {
  declare interappConnected: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, socket: UiLooseData) {
    this.rootStore = rootStore;
    this.interappConnected = true;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class OtaStore {
  declare criticalUpdate: boolean;
  declare updateSuccess: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, socket: UiLooseData) {
    this.rootStore = rootStore;
    this.criticalUpdate = false;
    this.updateSuccess = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class SettingsStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    middlewareActions: UiLooseData,
    socket: UiLooseData,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
  resetSubCategoryIndexes() {}
  handleSettingsButtonLongPress() {}
}

export class SessionStateStore {
  declare isLoggedIn: boolean;
  declare phoneHasNetwork: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, socket: UiLooseData) {
    this.rootStore = rootStore;
    this.isLoggedIn = true;
    this.phoneHasNetwork = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class TracklistStore {
  declare tracklistUiState: TracklistUiState;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    this.tracklistUiState = new TracklistUiState(rootStore);
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {
    this.tracklistUiState.reset();
  }
}

export class TracklistUiState {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  loadCurrentContext() {}
  initializeTracklist() {}
  reset() {}
}

export class TimerStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DevOptionsStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class HardwareStore {
  declare rebooting: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(socket: UiLooseData, middlewareActions: UiLooseData) {
    this.rebooting = false;
    makeAutoObservable(this);
  }
}

export class SetupStore {
  declare hasStatusMessage: boolean;
  declare shouldShowSetup: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, socket: UiLooseData) {
    this.rootStore = rootStore;
    this.hasStatusMessage = true;
    this.shouldShowSetup = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PhoneConnectionStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, middlewareActions: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PermissionsStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    overlayController,
    socket: UiLooseData,
    interappActions: UiLooseData,
    errorHandler,
  ) {
    makeAutoObservable(this);
  }
}

export class RemoteConfigStore {
  declare messageReceived: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    socket: UiLooseData,
    middlewareActions: UiLooseData,
  ) {
    this.rootStore = rootStore;
    this.messageReceived = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class VolumeStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    socket: UiLooseData,
    interappActions: UiLooseData,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  increaseVolume() {}
  decreaseVolume() {}
}

export class RadioStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class ChildItemStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, interappActions: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class HomeItemsStore {
  declare items: UiLooseData[];
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, interappActions: UiLooseData) {
    this.rootStore = rootStore;
    this.items = [];
    makeAutoObservable(this, { rootStore: false });
  }

  async loadHomeItems() {}

  reset() {
    this.items = [];
  }
}

export class PodcastSpeedStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    interappActions: UiLooseData,
    socket: UiLooseData,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PodcastStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(interappActions: UiLooseData, remoteConfigStore, errorHandler) {
    makeAutoObservable(this);
  }

  reset() {}
}

export class SavedStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(playerStore, interappActions: UiLooseData, errorHandler) {
    makeAutoObservable(this);
  }
}

export class PresetsDataStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    interappActions: UiLooseData,
    errorHandler,
    imageStore,
    remoteConfigStore,
    versionStatusStore,
  ) {
    makeAutoObservable(this);
  }

  loadPresets() {}
  reset() {}
}

export class TipsStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(interappActions: UiLooseData, errorHandler) {
    makeAutoObservable(this);
  }

  clearTip() {}
}

export class VersionStatusStore {
  declare serial: string;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(socket: UiLooseData, middlewareActions: UiLooseData) {
    this.serial = "STUB-SERIAL-123";
    makeAutoObservable(this);
  }
}

export class ErrorHandler {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  logUnexpectedError(error, message) {
    console.error(message, error);
  }
}

export class UbiLogger {
  declare onboardingUbiLogger: OnboardingUbiLogger;
  declare presetsUbiLogger: PresetsUbiLogger;
  declare queueUbiLogger: QueueUbiLogger;
  declare settingsUbiLogger: SettingsUbiLogger;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(interappActions: UiLooseData, remoteConfigStore, hardwareStore) {
    this.onboardingUbiLogger = new OnboardingUbiLogger();
    this.settingsUbiLogger = new SettingsUbiLogger();
    this.queueUbiLogger = new QueueUbiLogger();
    this.presetsUbiLogger = new PresetsUbiLogger();
  }

  clearQueue() {}
}

export class OnboardingUbiLogger {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  logStartClicked() {}
  logNoInteractionContinueButtonDialPress() {}
  logNoInteractionEndButtonDialPress() {}
  logNoInteractionBackButtonPress() {}
}

export class SettingsUbiLogger {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  logSettingsButtonHide() {}
  logSettingsButtonShow() {}
  logMainMenuBackButton() {}
  logPowerOffTutorialSettingsLongPress() {}
}

export class QueueUbiLogger {}
export class PresetsUbiLogger {}

export class SwipeDownHandleUiState {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(overlayController, presetsController, presetsUbiLogger) {
    makeAutoObservable(this);
  }
}

export class PhoneCallController {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(
    rootStore: UiLooseData,
    socket: UiLooseData,
    middlewareActions: UiLooseData,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class PresetsController {
  declare presetsUiState: PresetsUiState;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, interappActions: UiLooseData) {
    this.rootStore = rootStore;
    this.presetsUiState = new PresetsUiState();
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class PresetsUiState {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  reset() {}
  highlightPreset() {}
}

export class PromoController {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, middlewareActions: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DisconnectedLogger {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor(rootStore: UiLooseData, middlewareActions: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export function createOverlayController(rootStore: UiLooseData, ubiLogger) {
  const controller = makeAutoObservable({
    isSettingsShowing: false,
    currentOverlay: undefined,

    get anyOverlayIsShowing() {
      return this.currentOverlay !== undefined;
    },

    get shouldShowNoContext() {
      const playerStore = rootStore?.playerStore;
      const viewStore = rootStore?.viewStore;
      const hasContext = Boolean(playerStore?.contextUri);
      const isOnboarding = Boolean(viewStore?.isOnboarding);
      return !hasContext && !isOnboarding && !this.isShowing("settings");
    },

    maybeShowAModal() {
      return false;
    },
    resetAndMaybeShowAModal() {
      this.hideSettings();
      this.hideLetsDrive();
    },

    showPresets() {},

    showSettings() {
      this.isSettingsShowing = true;
      this.currentOverlay = "settings";
    },

    hideSettings() {
      if (this.currentOverlay !== "settings") return;
      this.isSettingsShowing = false;
      this.currentOverlay = undefined;
    },

    showVoice() {
      this.isSettingsShowing = false;
      this.currentOverlay = "voice";
    },

    hideVoice() {
      if (this.currentOverlay !== "voice") return;
      this.currentOverlay = undefined;
    },

    showLetsDrive() {
      if (this.shouldShowNoContext) {
        this.currentOverlay = "lets_drive";
      }
    },

    hideLetsDrive() {
      if (this.currentOverlay !== "lets_drive") return;
      this.currentOverlay = undefined;
    },

    maybeShowLetsDrive() {
      if (this.shouldShowNoContext) {
        this.showLetsDrive();
        return true;
      }
      if (!this.shouldShowNoContext && this.isShowing("lets_drive")) {
        this.hideLetsDrive();
      }
      return false;
    },

    toggleSettings() {
      if (this.isSettingsShowing) {
        this.hideSettings();
        if (rootStore?.settingsStore) {
          rootStore.settingsStore.reset();
        }
      } else {
        this.showSettings();
      }
    },

    showStandby() {},

    handleBackButton() {
      if (this.currentOverlay === "voice") {
        rootStore?.voiceStore?.cancel();
      } else if (this.currentOverlay === "lets_drive") {
        this.hideLetsDrive();
      } else if (this.isSettingsShowing && rootStore?.settingsStore) {
        rootStore.settingsStore.handleBack();
      }
    },

    isShowing(name) {
      return this.currentOverlay === name;
    },

    get overlayUiState() {
      const self = this;
      const isDismissibleFor = (overlay) => {
        switch (overlay) {
          case "non_supported_type":
          case "standby":
          case "save_preset_error":
            return true;
          default:
            return false;
        }
      };
      return {
        get currentOverlay() {
          return self.currentOverlay;
        },
        get isDismissible() {
          return isDismissibleFor(self.currentOverlay);
        },
        maybeShowAModal: () => self.maybeShowAModal(),
        handleBackdropOnClick: () => {
          if (isDismissibleFor(self.currentOverlay)) {
            self.maybeShowAModal();
          }
        },
      };
    },

    reset() {
      this.isSettingsShowing = false;
      this.currentOverlay = undefined;
    },
  });

  reaction(
    () => controller.shouldShowNoContext,
    (shouldShow) => {
      if (!shouldShow && controller.isShowing("lets_drive")) {
        controller.hideLetsDrive();
      }
    },
  );

  return controller;
}

export class MockPersistentStorage {
  declare seeded: boolean;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  constructor() {
    this.seeded = true;
  }

  getItem(key) {
    return localStorage.getItem(key);
  }

  setItem(key, value) {
    localStorage.setItem(key, value);
  }
}
