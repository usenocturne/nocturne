import type {
  PlayingInfoState,
  VolumeUiState,
  ScrubbingUiState,
  ControlButtonsState,
} from "./NpvModels";
import type { OverlayController } from "./StoreContracts";
import type { ShelfItem } from "./ShelfModels";
import type { TracklistItem } from "./TracklistModels";
import type { RootStore } from "./RootStore";
import type {
  InterappActions,
  MiddlewareActions,
  MiddlewareSocket,
} from "./StoreContracts";
import { makeAutoObservable, reaction, runInAction } from "mobx";
import { SwipeHandlerClass } from "../components/Views/Npv/SwipeHandler/SwipeHandler";
import {
  SCRUB_IDLE_TIMEOUT_MS,
  SCRUB_SETTLE_TIMEOUT_MS,
} from "../components/Views/Npv/Scrubbing/scrubbingConstants";

export class NpvStore {
  declare carThingStores: RootStore;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  tipsUiState = {
    dismissVisibleTip: () => {},
    tipToShow: null,
  };

  playingInfoUiState: PlayingInfoState = {
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

  volumeUiState: VolumeUiState = {
    volumeTimeoutId: undefined,
    carMode: null,
    isPlayingSpotify: true,
    displayVolume: 0.5,
    volume: 0.5,
    isVolumeAbove0: true,
    get colorChannels() {
      return (
        this.parentStore?.carThingStores?.imageStore?.colors?.get(
          this.parentStore?.playingInfoUiState?.currentItem?.image_uri ?? "",
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

  controlButtonsUiState: ControlButtonsState = {
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

  scrubbingUiState: ScrubbingUiState = {
    isScrubbing: false,
    isScrubbingEnabled: true,
    get colorChannels() {
      return (
        this.parentStore?.carThingStores?.imageStore?.colors?.get(
          this.parentStore?.playingInfoUiState?.currentItem?.image_uri ?? "",
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
        this.stopScrubbing();
      }, SCRUB_IDLE_TIMEOUT_MS);
    },

    resetScrubbingCommitTimer() {
      if (this.scrubbingTimeoutId) {
        window.clearTimeout(this.scrubbingTimeoutId);
      }
      this.scrubbingTimeoutId = window.setTimeout(() => {
        window.scrubbingCommit?.();
      }, SCRUB_SETTLE_TIMEOUT_MS);
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
          playerStore?.play();
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

      const knobSeeksPlayback =
        localStorage.getItem("knobSeeksPlaybackEnabled") === "true";
      if (
        (npvStore?.scrubbingUiState?.isScrubbing || knobSeeksPlayback) &&
        window.scrubbingHardwareDialHandler
      ) {
        window.scrubbingHardwareDialHandler("left");
      } else {
        const volumeStore = rootStore?.volumeStore;
        volumeStore?.decreaseVolume?.();
      }
    },

    handleDialRight: () => {
      const rootStore = window.carThingRootStore || document.rootStore;
      const npvStore = rootStore?.npvStore;

      const knobSeeksPlayback =
        localStorage.getItem("knobSeeksPlaybackEnabled") === "true";
      if (
        (npvStore?.scrubbingUiState?.isScrubbing || knobSeeksPlayback) &&
        window.scrubbingHardwareDialHandler
      ) {
        window.scrubbingHardwareDialHandler("right");
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

  constructor(rootStore: RootStore, middlewareActions: MiddlewareActions) {
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
    const rootStore = this.rootStore;
    const playerStoreInterface = {
      get currentTrack() {
        return rootStore.playerStore.currentTrack;
      },
      get currentTrackPosition() {
        return rootStore.playerStore.state.progress_ms;
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

    const swipeHandler = new SwipeHandlerClass(playerStoreInterface);

    this.playingInfoUiState.swipeHandler = swipeHandler;
  }
}

export class BluetoothStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    socket: MiddlewareSocket,
    middlewareActions: MiddlewareActions,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class RemoteControlStore {
  declare interappConnected: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, socket: MiddlewareSocket) {
    this.rootStore = rootStore;
    this.interappConnected = true;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class OtaStore {
  declare criticalUpdate: boolean;
  declare updateSuccess: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, socket: MiddlewareSocket) {
    this.rootStore = rootStore;
    this.criticalUpdate = false;
    this.updateSuccess = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class SettingsStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    middlewareActions: MiddlewareActions,
    socket: MiddlewareSocket,
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
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, socket: MiddlewareSocket) {
    this.rootStore = rootStore;
    this.isLoggedIn = true;
    this.phoneHasNetwork = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class TracklistStore {
  declare tracklistUiState: TracklistUiState;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    this.tracklistUiState = new TracklistUiState(rootStore);
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {
    this.tracklistUiState.reset();
  }
}

export class TracklistUiState {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  loadCurrentContext() {}
  initializeTracklist() {}
  reset() {}
}

export class TimerStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DevOptionsStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class HardwareStore {
  declare rebooting: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(socket: MiddlewareSocket, middlewareActions: MiddlewareActions) {
    this.rebooting = false;
    makeAutoObservable(this);
  }
}

export class SetupStore {
  declare hasStatusMessage: boolean;
  declare shouldShowSetup: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, socket: MiddlewareSocket) {
    this.rootStore = rootStore;
    this.hasStatusMessage = true;
    this.shouldShowSetup = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PhoneConnectionStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, middlewareActions: MiddlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PermissionsStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    overlayController: OverlayController,
    socket: MiddlewareSocket,
    interappActions: InterappActions,
    errorHandler: ErrorHandler,
  ) {
    makeAutoObservable(this);
  }
}

export class RemoteConfigStore {
  declare messageReceived: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    socket: MiddlewareSocket,
    middlewareActions: MiddlewareActions,
  ) {
    this.rootStore = rootStore;
    this.messageReceived = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class VolumeStore {
  declare localVolume: number | undefined;
  declare receivedVolume: number | undefined;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    socket: MiddlewareSocket,
    interappActions: InterappActions,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  increaseVolume() {}
  decreaseVolume() {}
}

export class RadioStore {
  declare currentRadioTracks: TracklistItem[] | undefined;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class ChildItemStore {
  declare isError: ((uri: string) => boolean) | undefined;
  declare getTotal: ((uri: string) => number) | undefined;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, interappActions: InterappActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class HomeItemsStore {
  declare items: ShelfItem[];
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, interappActions: InterappActions) {
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
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    interappActions: InterappActions,
    socket: MiddlewareSocket,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PodcastStore {
  declare isError: ((uri: string) => boolean) | undefined;
  declare getTotalNumberOfItems: ((uri: string) => number) | undefined;
  declare shouldShowLatestPlayedEpisode: ((uri: string) => boolean) | undefined;
  declare getLatestPlayedUri: ((uri: string) => string) | undefined;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    interappActions: InterappActions,
    remoteConfigStore: RootStore["remoteConfigStore"],
    errorHandler: ErrorHandler,
  ) {
    makeAutoObservable(this);
  }

  reset() {}
}

export class SavedStore {
  declare isSaved: ((uri: string) => boolean) | undefined;
  declare setSaved: ((uri: string, saved: boolean) => void) | undefined;
  declare loadSavedState: ((uri: string) => void) | undefined;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    playerStore: RootStore["playerStore"],
    interappActions: InterappActions,
    errorHandler: ErrorHandler,
  ) {
    makeAutoObservable(this);
  }
}

export class PresetsDataStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    interappActions: InterappActions,
    errorHandler: ErrorHandler,
    imageStore: RootStore["imageStore"],
    remoteConfigStore: RootStore["remoteConfigStore"],
    versionStatusStore: RootStore["versionStatusStore"],
  ) {
    makeAutoObservable(this);
  }

  loadPresets() {}
  reset() {}
}

export class TipsStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(interappActions: InterappActions, errorHandler: ErrorHandler) {
    makeAutoObservable(this);
  }

  clearTip() {}
}

export class VersionStatusStore {
  declare serial: string;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(socket: MiddlewareSocket, middlewareActions: MiddlewareActions) {
    this.serial = "STUB-SERIAL-123";
    makeAutoObservable(this);
  }
}

export class ErrorHandler {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  logUnexpectedError(error: unknown, message: string) {
    console.error(message, error);
  }
}

export class UbiLogger {
  declare onboardingUbiLogger: OnboardingUbiLogger;
  declare presetsUbiLogger: PresetsUbiLogger;
  declare queueUbiLogger: QueueUbiLogger;
  declare settingsUbiLogger: SettingsUbiLogger;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    interappActions: InterappActions,
    remoteConfigStore: RootStore["remoteConfigStore"],
    hardwareStore: RootStore["hardwareStore"],
  ) {
    this.onboardingUbiLogger = new OnboardingUbiLogger();
    this.settingsUbiLogger = new SettingsUbiLogger();
    this.queueUbiLogger = new QueueUbiLogger();
    this.presetsUbiLogger = new PresetsUbiLogger();
  }

  clearQueue() {}
}

export class OnboardingUbiLogger {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  logStartClicked() {}
  logNoInteractionContinueButtonDialPress() {}
  logNoInteractionEndButtonDialPress() {}
  logNoInteractionBackButtonPress() {}
}

export class SettingsUbiLogger {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  logSettingsButtonHide() {}
  logSettingsButtonShow() {}
  logMainMenuBackButton() {}
  logPowerOffTutorialSettingsLongPress() {}
}

export class QueueUbiLogger {}
export class PresetsUbiLogger {}

export class SwipeDownHandleUiState {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    overlayController: OverlayController,
    presetsController: RootStore["presetsController"],
    presetsUbiLogger: RootStore["ubiLogger"]["presetsUbiLogger"],
  ) {
    makeAutoObservable(this);
  }
}

export class PhoneCallController {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    socket: MiddlewareSocket,
    middlewareActions: MiddlewareActions,
  ) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class PresetsController {
  declare presetsUiState: PresetsUiState;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, interappActions: InterappActions) {
    this.rootStore = rootStore;
    this.presetsUiState = new PresetsUiState();
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {}
}

export class PresetsUiState {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  reset() {}
  highlightPreset() {}
}

export class PromoController {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, middlewareActions: MiddlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DisconnectedLogger {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, middlewareActions: MiddlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export function createOverlayController(
  rootStore: RootStore,
  ubiLogger: RootStore["ubiLogger"],
): OverlayController {
  const controller = makeAutoObservable<OverlayController>({
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
      const isDismissibleFor = (overlay: string | undefined) => {
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
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor() {
    this.seeded = true;
  }

  getItem(key: string) {
    return localStorage.getItem(key);
  }

  setItem(key: string, value: string) {
    localStorage.setItem(key, value);
  }
}
