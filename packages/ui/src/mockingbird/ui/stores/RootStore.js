import PlayerStore from './PlayerStore';
import ImageStore from './ImageStore';
import ViewStore from './ViewStore';
import ShelfStore from './ShelfStore';
import OnboardingStore from './OnboardingStore';
import BannerStore from './BannerStore';
import UbiLogger from './UbiLogger';
import HardwareStore from './HardwareStore';
import HardwareEvents from '../helpers/HardwareEvents';
import HardwareEventHandler from '../eventhandlers/HardwareEventHandler';
import TracklistStore from './TracklistStore';
import QueueStore from './QueueStore';
import PresetsController, { PresetsDataStore } from './PresetsStore';
import SettingsStore from './SettingsStore';
import BluetoothStore from './BluetoothStore';
import PhoneConnectionStore from './PhoneConnectionStore';
import {
  NpvStore,
  RemoteControlStore,
  WindLevelStore,
  OtaStore,
  VoiceStore,
  SessionStateStore,
  TimerStore,
  DevOptionsStore,
  SetupStore,
  PermissionsStore,
  RemoteConfigStore,
  VolumeStore,
  RadioStore,
  ChildItemStore,
  HomeItemsStore,
  PodcastSpeedStore,
  PodcastStore,
  SavedStore,
  TipsStore,
  VersionStatusStore,
  ErrorHandler,
  SwipeDownHandleUiState,
  PhoneCallController,
  NightModeController,
  AirVentInterferenceController,
  PromoController,
  DisconnectedLogger,
  createOverlayController,
  MockPersistentStorage,
} from './stubs';
import { reaction, extendObservable } from 'mobx';

export class RootStore {
  versionStatusStore;
  bluetoothStore;
  childItemStore;
  devOptionsStore;
  errorHandler;
  hardwareStore;
  hardwareEvents;
  homeItemsStore;
  imageStore;
  interappActions;
  npvStore;
  onboardingStore;
  otaStore;
  overlayController;
  permissionsStore;
  phoneConnectionStore;
  playerStore;
  podcastSpeedStore;
  podcastStore;
  presetsDataStore;
  presetsController;
  promoController;
  queueStore;
  radioStore;
  remoteConfigStore;
  remoteControlStore;
  savedStore;
  sessionStateStore;
  settingsStore;
  setupStore;
  shelfStore;
  timerStore;
  tracklistStore;
  ubiLogger;
  disconnectedLogger;
  viewStore;
  voiceStore;
  volumeStore;
  windLevelStore;
  swipeDownUiState;
  tipsStore;
  phoneCallController;
  nightModeController;
  airVentInterferenceController;
  bannerStore;
  ubiLogger;
  persistentStorage;

  constructor(
    interappActions,
    middlewareActions,
    persistentStorage,
    socket,
    errorHandler,
  ) {
    this.persistentStorage = persistentStorage;

    this.interappActions = interappActions;
    this.errorHandler = errorHandler;

    this.remoteConfigStore = new RemoteConfigStore(
      this,
      socket,
      middlewareActions,
    );
    this.hardwareStore = new HardwareStore(this);
    this.ubiLogger = new UbiLogger(
      interappActions,
      this.remoteConfigStore,
      this.hardwareStore,
    );

    this.sessionStateStore = new SessionStateStore(this, socket);
    this.versionStatusStore = new VersionStatusStore(socket, middlewareActions);
    this.imageStore = new ImageStore(this, interappActions);
    this.otaStore = new OtaStore(this, socket);

    this.playerStore = new PlayerStore(this, interappActions, socket);
    this.timerStore = new TimerStore(this);
    this.remoteControlStore = new RemoteControlStore(this, socket);
    this.disconnectedLogger = new DisconnectedLogger(this, middlewareActions);

    this.bluetoothStore = new BluetoothStore(this);
    this.voiceStore = new VoiceStore(this, socket, middlewareActions);
    this.windLevelStore = new WindLevelStore(this, socket, interappActions);

    this.onboardingStore = new OnboardingStore(
      this,
      socket,
      interappActions,
      middlewareActions,
    );
    this.tracklistStore = new TracklistStore(this);
    this.devOptionsStore = new DevOptionsStore(this);
    this.overlayController = createOverlayController(this, this.ubiLogger);
    this.airVentInterferenceController = new AirVentInterferenceController(
      this,
    );
    this.volumeStore = new VolumeStore(this, socket, interappActions);
    this.setupStore = new SetupStore(this, socket);
    this.viewStore = new ViewStore(this);
    this.queueStore = new QueueStore(
      socket,
      this.playerStore,
      this.imageStore,
      this.viewStore,
      this.hardwareStore,
      this.ubiLogger.queueUbiLogger,
      interappActions,
    );
    this.childItemStore = new ChildItemStore(this, interappActions);
    this.homeItemsStore = new HomeItemsStore(this, interappActions);

    this.tipsStore = new TipsStore(interappActions, errorHandler);
    this.presetsDataStore = new PresetsDataStore();
    this.presetsController = new PresetsController(this, interappActions);
    this.podcastSpeedStore = new PodcastSpeedStore(
      this,
      interappActions,
      socket,
    );
    this.phoneCallController = new PhoneCallController(
      this,
      socket,
      middlewareActions,
    );
    this.savedStore = new SavedStore(
      this.playerStore,
      interappActions,
      errorHandler,
    );
    this.permissionsStore = new PermissionsStore(
      this.overlayController,
      socket,
      interappActions,
      errorHandler,
    );
    this.npvStore = new NpvStore(this, middlewareActions);
    this.shelfStore = new ShelfStore(this, interappActions);
    this.nightModeController = new NightModeController(this);
    this.settingsStore = new SettingsStore(this);
    this.promoController = new PromoController(this, middlewareActions);
    this.presetsController = new PresetsController(this, interappActions);
    this.phoneConnectionStore = new PhoneConnectionStore(this);

    this.radioStore = new RadioStore(this);
    this.podcastStore = new PodcastStore(
      interappActions,
      this.remoteConfigStore,
      errorHandler,
    );
    this.swipeDownUiState = new SwipeDownHandleUiState(
      this.overlayController,
      this.presetsController,
      this.ubiLogger.presetsUbiLogger,
    );

    this.bannerStore = new BannerStore(this);

    try {
      this.hardwareEvents = new HardwareEvents();
      HardwareEventHandler.handleEvents(this.hardwareEvents, this);
    } catch (error) {
    }

    extendObservable(this, {
      spotifyData: null,
    });

    window.carThingRootStore = this;
    window.testShelf = this.shelfStore;
    window.testPresets = this.presetsController;
    window.showPresets = () => {
      if (this.presetsController) {
        this.presetsController.presetsUiState.showPresets();
      } else {
        // nothing
      }
    };

    window.testHardware = {
      dialPress: () => {
        this.shelfStore.shelfController.handleDialPress();
      },
      dialLeft: () => {
        this.shelfStore.shelfController.handleDialLeft();
      },
      dialRight: () => {
        this.shelfStore.shelfController.handleDialRight();
      },
      getCurrentSelection: () => {
        const uiState = this.shelfStore.shelfController.swiperUiState;
        const selectedItem = uiState.allShelfItems[uiState.selectedItemIndex];
        return selectedItem;
      }
    };

    this.fetchAppState();
  }

  resetAppState() {
    this.tracklistStore.reset();
    this.presetsController.reset();
    this.presetsDataStore.reset();
    this.queueStore.reset();
    this.shelfStore.reset();
    this.childItemStore.reset();
    this.podcastStore.reset();
    this.homeItemsStore.reset();
    this.viewStore.reset();
    this.tipsStore.clearTip();
    this.ubiLogger.clearQueue();
    this.playerStore.reset();
    this.remoteConfigStore.reset();
    this.sessionStateStore.reset();
    this.phoneCallController.reset();
  }

  fetchAppState() {
    reaction(
      () =>
        this.sessionStateStore.isLoggedIn &&
        this.sessionStateStore.phoneHasNetwork &&
        this.versionStatusStore.serial &&
        this.remoteConfigStore.messageReceived,
      (shouldReload) => {
        if (shouldReload) {
          this.shelfStore.getShelfData();
          this.presetsDataStore.loadPresets();
        }
      },
    );
  }
}