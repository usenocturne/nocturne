import { makeAutoObservable, runInAction } from 'mobx';
import { SwipeHandlerClass } from '../components/Views/Npv/SwipeHandler/SwipeHandler';

export class NpvStore {

  tipsUiState = {
    dismissVisibleTip: () => { },
    tipToShow: null,
  };

  playingInfoUiState = {
    currentItem: {
      uid: '',
      uri: '',
      image_uri: '',
    },
    title: '',
    subtitle: '',
    contextHeaderTitle: '',
    handlePlayingInfoHeaderClick: () => {
      const rootStore = window.carThingRootStore;
      if (rootStore?.queueStore?.queueUiState && rootStore.queueStore.next.length > 0) {
        rootStore.queueStore.queueUiState.displayQueue();
      }
    },
    swipeHandler: {
      swipeDirection: 'NONE',
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
    handleArtistClick: () => { },
    handleArtworkClick: () => { },
    loadPrevAndNextImage: () => { },
    previousItem: null,
    nextItem: null,
    showWindLevelIcon: false,
    isPlayingSpotify: true,
    onRepeat: false,
    onRepeatOnce: false,
    isMicMuted: false,
    showSettings: () => { },
  };

  volumeUiState = {
    volumeTimeoutId: null,
    carMode: null,
    isPlayingSpotify: true,
    displayVolume: 0.5,
    volume: 0.5,
    isVolumeAbove0: true,
    get colorChannels() {
      return this.parentStore?.carThingStores?.imageStore?.colors?.get(this.parentStore?.playingInfoUiState?.currentItem?.image_uri) || [0, 0, 0];
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
    controlButtonSet: 'music',
    showOtherMediaControls: false,
    showPodcastControls: false,
    isPlaying: false,
    isSaved: false,
    isShuffled: false,
    canSeek: true,
    isPlayingAd: false,
    podcastSpeed: 1.0,
    handlePlayClick: () => { },
    handlePauseClick: () => { },
    handleSkipNextClick: () => { },
    handleSkipPrevClick: () => { },
    handleLikeClick: () => { },
    handleUnlikeClick: () => { },
    handleShuffleClick: () => { },
    handleUnshuffleClick: () => { },
    handleSeekBackClick: () => { },
    handleSeekForwardClick: () => { },
    handleAddToSavedEpisodesClick: () => { },
    handleRemoveFromSavedEpisodesClick: () => { },
    handleBlockClick: () => { },
    handlePodcastSpeedClick: () => { },
  };

  scrubbingUiState = {
    isScrubbing: false,
    isScrubbingEnabled: true,
    get colorChannels() {
      return this.parentStore?.carThingStores?.imageStore?.colors?.get(this.parentStore?.playingInfoUiState?.currentItem?.image_uri) || [0, 0, 0];
    },
    trackPlayedPercent: 0,
    trackPlayedTime: '0:00',
    trackLeftTime: '0:00',
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
        if (window.scrubbingHardwareDialHandler && window.scrubbingTimeoutShouldSeek) {
          const scrubbingProgress = window.scrubbingProgressValue;
          const playbackProgress = window.scrubbingPlaybackProgress;
          const onSeek = window.scrubbingOnSeek;

          if (scrubbingProgress !== null && playbackProgress?.duration && onSeek) {
            const seekMs = Math.floor(scrubbingProgress * playbackProgress.duration);
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
    next: () => { },
    previous: () => { },
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
        if (playerStore?.isPlayingSpotify) {
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
          window.scrubbingHardwareDialHandler('left');
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
          window.scrubbingHardwareDialHandler('right');
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

  constructor(rootStore, middlewareActions) {
    this.rootStore = rootStore;
    this.carThingStores = rootStore;
    makeAutoObservable(this, { rootStore: false });

    if (this.scrubbingUiState) {
      this.scrubbingUiState.parentStore = this;
    }
    if (this.volumeUiState) {
      this.volumeUiState.parentStore = this;
    }

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
      }
    };

    playerStoreInterface.rootStore = this.rootStore;

    const swipeHandler = new SwipeHandlerClass(playerStoreInterface);

    this.playingInfoUiState.swipeHandler = swipeHandler;
  }
}

export class BluetoothStore {
  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class RemoteControlStore {
  constructor(rootStore, socket) {
    this.rootStore = rootStore;
    this.interappConnected = true;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class WindLevelStore {
  constructor(rootStore, socket, interappActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class OtaStore {
  constructor(rootStore, socket) {
    this.rootStore = rootStore;
    this.criticalUpdate = false;
    this.updateSuccess = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class SettingsStore {
  constructor(rootStore, middlewareActions, socket) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
  resetSubCategoryIndexes() { }
  handleSettingsButtonLongPress() { }
}

export class VoiceStore {
  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    this.error = null;
    this.intent = null;
    makeAutoObservable(this, { rootStore: false });
  }

  resetVoiceSessionState() { }
}

export class SessionStateStore {
  constructor(rootStore, socket) {
    this.rootStore = rootStore;
    this.isLoggedIn = true;
    this.phoneHasNetwork = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
}

export class TracklistStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    this.tracklistUiState = new TracklistUiState(rootStore);
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {
    this.tracklistUiState.reset();
  }
}

export class TracklistUiState {
  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  loadCurrentContext() { }
  initializeTracklist() { }
  reset() { }
}

export class TimerStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DevOptionsStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class HardwareStore {
  constructor(socket, middlewareActions) {
    this.rebooting = false;
    makeAutoObservable(this);
  }
}

export class SetupStore {
  constructor(rootStore, socket) {
    this.rootStore = rootStore;
    this.hasStatusMessage = true;
    this.shouldShowSetup = false;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PhoneConnectionStore {
  constructor(rootStore, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PermissionsStore {
  constructor(overlayController, socket, interappActions, errorHandler) {
    makeAutoObservable(this);
  }
}

export class RemoteConfigStore {
  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    this.messageReceived = true;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
}

export class VolumeStore {
  constructor(rootStore, socket, interappActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  increaseVolume() {}
  decreaseVolume() {}
}

export class RadioStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class ChildItemStore {
  constructor(rootStore, interappActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
}

export class HomeItemsStore {
  constructor(rootStore, interappActions) {
    this.rootStore = rootStore;
    this.items = [];
    makeAutoObservable(this, { rootStore: false });
  }

  async loadHomeItems() {
  }

  reset() {
    this.items = [];
  }
}

export class PodcastSpeedStore {
  constructor(rootStore, interappActions, socket) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class PodcastStore {
  constructor(interappActions, remoteConfigStore, errorHandler) {
    makeAutoObservable(this);
  }

  reset() { }
}

export class SavedStore {
  constructor(playerStore, interappActions, errorHandler) {
    makeAutoObservable(this);
  }
}

export class PresetsDataStore {
  constructor(interappActions, errorHandler, imageStore, remoteConfigStore, versionStatusStore) {
    makeAutoObservable(this);
  }

  loadPresets() { }
  reset() { }
}

export class TipsStore {
  constructor(interappActions, errorHandler) {
    makeAutoObservable(this);
  }

  clearTip() { }
}

export class VersionStatusStore {
  constructor(socket, middlewareActions) {
    this.serial = 'STUB-SERIAL-123';
    makeAutoObservable(this);
  }
}

export class ErrorHandler {
  logUnexpectedError(error, message) {
    console.error(message, error);
  }
}

export class UbiLogger {
  constructor(interappActions, remoteConfigStore, hardwareStore) {
    this.onboardingUbiLogger = new OnboardingUbiLogger();
    this.settingsUbiLogger = new SettingsUbiLogger();
    this.queueUbiLogger = new QueueUbiLogger();
    this.presetsUbiLogger = new PresetsUbiLogger();
  }

  clearQueue() { }
}

export class OnboardingUbiLogger {
  logStartClicked() { }
  logNoInteractionContinueButtonDialPress() { }
  logNoInteractionEndButtonDialPress() { }
  logNoInteractionBackButtonPress() { }
}

export class SettingsUbiLogger {
  logSettingsButtonHide() { }
  logSettingsButtonShow() { }
  logMainMenuBackButton() { }
  logPowerOffTutorialSettingsLongPress() { }
}

export class QueueUbiLogger { }
export class PresetsUbiLogger { }

export class SwipeDownHandleUiState {
  constructor(overlayController, presetsController, presetsUbiLogger) {
    makeAutoObservable(this);
  }
}

export class PhoneCallController {
  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
}

export class NightModeController {
  isNightMode = localStorage.getItem('night_mode_user_enabled') === 'true';

  nightModeStrength = 30;
  nightModeSlope = 1.4; 

  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  toggleNightMode() {
    this.isNightMode = !this.isNightMode;
    localStorage.setItem('night_mode_user_enabled', this.isNightMode.toString());
  }

  get appOpacity() {
    if (!this.isNightMode) return 1;

    const ambientLight = this.rootStore.hardwareStore?.ambientLightValue ?? 0;
    const raw = 1 - ((this.nightModeSlope * ambientLight + this.nightModeStrength - 100) / 100);
    
    return Math.round(Math.max(0.1, Math.min(1, raw)) * 100) / 100;
  }
}

export class AirVentInterferenceController {
  alertDisabled = false;

  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  toggleAlertDisabled() {
    this.alertDisabled = !this.alertDisabled;
  }
}

export class PresetsController {
  constructor(rootStore, interappActions) {
    this.rootStore = rootStore;
    this.presetsUiState = new PresetsUiState();
    makeAutoObservable(this, { rootStore: false });
  }

  reset() { }
}

export class PresetsUiState {
  reset() { }
  highlightPreset() { }
}

export class PromoController {
  constructor(rootStore, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export class DisconnectedLogger {
  constructor(rootStore, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }
}

export function createOverlayController(rootStore, ubiLogger) {
  const controller = makeAutoObservable({
    isSettingsShowing: false,
    currentOverlay: undefined,

    get anyOverlayIsShowing() {
      return this.isSettingsShowing;
    },

    maybeShowAModal() { },
    resetAndMaybeShowAModal() {
      this.hideSettings();
    },

    showPresets() { },

    showSettings() {
      this.isSettingsShowing = true;
      this.currentOverlay = 'settings';
    },

    hideSettings() {
      this.isSettingsShowing = false;
      this.currentOverlay = undefined;
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

    showStandby() { },

    handleBackButton() {
      if (this.isSettingsShowing && rootStore?.settingsStore) {
        rootStore.settingsStore.handleBack();
      }
    },

    isShowing(name) {
      return this.currentOverlay === name;
    },

    get overlayUiState() {
      return { currentOverlay: this.currentOverlay };
    },

    reset() {
      this.isSettingsShowing = false;
      this.currentOverlay = undefined;
    },
  });
  return controller;
}

export class MockPersistentStorage {
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
