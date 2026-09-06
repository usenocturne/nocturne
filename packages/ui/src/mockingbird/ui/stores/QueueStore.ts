import type PlayerStore from "./PlayerStore";
import type ImageStore from "./ImageStore";
import type ViewStore from "./ViewStore";
import type HardwareStore from "./HardwareStore";
import type { QueueLogger } from "./UbiLogger";
import type { RootStore } from "./RootStore";
import type {
  InterappActions,
  MiddlewareActions,
  MiddlewareSocket,
} from "./StoreContracts";
import { makeAutoObservable, get } from "mobx";

export class QueueItem {
  declare explicit: boolean | undefined;
  declare artist_name: string;
  declare identifier: string;
  declare image_uri: string;
  declare name: string;
  declare provider: string;
  declare queue_index: number;
  declare uid: string;
  declare uri: string;
  declare rootStore: RootStore;
  declare middlewareActions: MiddlewareActions;
  constructor(data: QueueItemData) {
    this.explicit = data.explicit;
    this.queue_index = data.queue_index;
    this.uid = data.uid;
    this.uri = data.uri;
    this.name = data.name;
    this.artist_name = data.artist_name;
    this.image_uri = data.image_uri;
    this.provider = data.provider;
    this.identifier = data.identifier;
    makeAutoObservable(this);
  }
}

export class QueueUiState {
  declare rootStore: RootStore;
  declare middlewareActions: MiddlewareActions;
  playerStore;
  queueStore;
  imageStore;
  viewStore;
  hardwareStore;
  interappActions;
  queueUbiLogger;
  animateSliding = false;
  selectedItem: QueueItem | undefined = undefined;

  constructor(
    playerStore: PlayerStore,
    queueStore: QueueStore,
    imageStore: ImageStore,
    viewStore: ViewStore,
    hardwareStore: HardwareStore,
    queueUbiLogger: QueueLogger,
    interappActions: InterappActions,
  ) {
    this.playerStore = playerStore;
    this.queueStore = queueStore;
    this.imageStore = imageStore;
    this.viewStore = viewStore;
    this.hardwareStore = hardwareStore;
    this.interappActions = interappActions;
    this.queueUbiLogger = queueUbiLogger;

    makeAutoObservable(this, {
      playerStore: false,
      queueStore: false,
      viewStore: false,
      hardwareStore: false,
      interappActions: false,
      animateSliding: false,
    });

    this.queueStore.onQueueUpdateCurrent(() => {
      this.setSelectedItemOnQueueChange();
    });
  }

  get selectedItemIndex() {
    return this.queue.findIndex(
      (item) => this.selectedItem?.queue_index === item.queue_index,
    );
  }

  get selectedItemFromManualQueue() {
    return this.selectedItem?.provider === "queue";
  }

  get isSelectingFirst() {
    return this.selectedItemIndex === 0;
  }

  get showGradientBackground() {
    return this.isSelectingFirst || this.isEmptyQueue;
  }

  get queue() {
    return this.queueStore.next;
  }

  get currentPlayingImageId() {
    return this.playerStore.currentImageId;
  }

  get colors() {
    return this.imageStore.colors;
  }

  get isDialPressed() {
    return this.hardwareStore.dialPressed;
  }

  get shouldShowSmallHeader() {
    return this.queue.length > 0 && !this.isSelectingFirst;
  }

  get headerText() {
    if (this.selectedItemFromManualQueue || this.isEmptyQueue) {
      return "Next in Queue:";
    } else if (this.queueStore.current.provider === "queue") {
      if (!this.playerStore.contextTitle) {
        return "Next Up:";
      }
      return `Next From: ${this.playerStore.contextTitle}`;
    }
    return `Next From: ${this.titleBasedOnType()}`;
  }

  titleBasedOnType() {
    const rootStore = window.carThingRootStore;
    const contextTitle =
      rootStore?.npvStore?.playingInfoUiState?.contextHeaderTitle ||
      this.playerStore.contextTitle;

    if (contextTitle) {
      return contextTitle;
    }

    return "Queue";
  }

  get leftItem() {
    if (this.selectedItemIndex <= 0) {
      return this.selectedItem;
    }
    return this.queue[this.selectedItemIndex - 1];
  }

  get rightItem() {
    if (
      this.selectedItemIndex === this.queue.length - 1 ||
      this.selectedItemIndex < 0
    ) {
      return this.selectedItem;
    }
    return this.queue[this.selectedItemIndex + 1];
  }

  get headerBackground() {
    const colorChannels = get(this.colors, this.currentPlayingImageId) || [
      0, 0, 0,
    ];
    return `linear-gradient(180deg, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.84) 100%), rgb(${colorChannels.join(
      ",",
    )})`;
  }

  get isEmptyQueue() {
    return this.queue.length === 0;
  }

  resetDialDown() {
    this.hardwareStore.setDialPressed(false);
  }

  displayQueue() {
    this.updateSelectedItem(this.queueStore.next[0]);
    this.viewStore.showQueue();
  }

  setSelectedItemOnQueueChange() {
    const previousInNewQueue = this.queue.find(
      (item) => item.identifier === this.selectedItem?.identifier,
    );
    if (this.selectedItemIndex === 0 || this.selectedItem === undefined) {
      this.updateSelectedItem(this.queueStore.next[0]);
    } else if (
      this.selectedItemIndex > 0 &&
      this.queueStore.isNewCurrent(this.selectedItem)
    ) {
      this.updateSelectedItem(this.queueStore.next[0]);
    } else if (previousInNewQueue) {
      if (previousInNewQueue) {
        this.updateSelectedItem(previousInNewQueue, false);
      }
    }
  }

  handleDraggedToIndex(index: number) {
    const userDraggedToItem = this.queue.find(
      (_, itemIndex) => index === itemIndex,
    );
    if (userDraggedToItem) {
      this.viewStore.showQueue();
      this.updateSelectedItem(userDraggedToItem);
    }
  }

  updateSelectedItem(item: QueueItem | undefined, withAnimation = true) {
    this.animateSliding = withAnimation;
    this.selectedItem = item;
  }

  playItem(queueItem: QueueItem) {
    this.playerStore.skipToIndex(queueItem.queue_index, queueItem.uid);
  }

  handleItemClicked(item: QueueItem) {
    this.queueUbiLogger?.logTrackRowClicked?.(item.queue_index, item.uri);
    this.playItem(item);
    this.selectedItem = undefined;
    this.viewStore.showNpv();
  }

  handleDialPress() {
    if (this.selectedItem) {
      this.queueUbiLogger?.logDialPressTrackRow?.(
        this.selectedItemIndex,
        this.selectedItem.uri,
      );
      this.playItem(this.selectedItem);
      this.viewStore.showNpv();
    }
  }

  handleBack() {
    if (this.selectedItemIndex >= 1) {
      this.updateSelectedItem(this.queueStore.next[0]);
      this.viewStore.showQueue();
    } else {
      this.queueUbiLogger?.logBackButtonPressed?.();
      this.viewStore.back();
    }
  }

  handleDialRight() {
    this.viewStore.showQueue();
    if (this.rightItem) {
      this.updateSelectedItem(this.rightItem);
    }
  }

  handleDialLeft() {
    this.viewStore.showQueue();
    if (this.leftItem) {
      this.updateSelectedItem(this.leftItem);
    }
  }

  logQueueImpression = () => {
    this.queueUbiLogger?.logImpression?.();
  };
}

class QueueStore {
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  current = {
    image_uri: "",
    uid: "",
    uri: "",
    provider: "",
  };

  next: QueueItem[] = [];
  queueUiState: QueueUiState;
  declare playerStore: PlayerStore;
  declare imageStore: ImageStore;
  declare viewStore: ViewStore;
  declare hardwareStore: HardwareStore;
  declare queueUbiLogger: QueueLogger;
  queueUpdateCurrentCallback: (() => void) | null = null;

  constructor(
    socket: MiddlewareSocket,
    playerStore: PlayerStore,
    imageStore: ImageStore,
    viewStore: ViewStore,
    hardwareStore: HardwareStore,
    ubiLogger: QueueLogger,
    interappActions: InterappActions,
  ) {
    this.playerStore = playerStore;
    this.imageStore = imageStore;
    this.viewStore = viewStore;
    this.hardwareStore = hardwareStore;
    this.interappActions = interappActions;
    this.queueUbiLogger = ubiLogger;

    this.queueUiState = new QueueUiState(
      playerStore,
      this,
      imageStore,
      viewStore,
      hardwareStore,
      ubiLogger,
      interappActions,
    );

    makeAutoObservable(this, {
      playerStore: false,
      imageStore: false,
      viewStore: false,
      hardwareStore: false,
      interappActions: false,
      queueUbiLogger: false,
    });
  }

  updateCurrent(
    imageUri: string | undefined,
    uid: string | undefined,
    uri: string | undefined,
    provider = "",
  ) {
    this.current = {
      image_uri: imageUri || "",
      uid: uid || "",
      uri: uri || "",
      provider: provider,
    };
    if (this.queueUpdateCurrentCallback) {
      this.queueUpdateCurrentCallback();
    }
  }

  updateQueue(queueData: QueueItemData[]) {
    this.next = queueData.map((item) => new QueueItem(item));
  }

  onQueueUpdateCurrent(callback: () => void) {
    this.queueUpdateCurrentCallback = callback;
  }

  isNewCurrent(selectedItem: QueueItem | undefined) {
    return this.current.uri === selectedItem?.uri;
  }

  reset() {
    this.current = {
      image_uri: "",
      uid: "",
      uri: "",
      provider: "",
    };
    this.next = [];
    this.queueUiState.selectedItem = undefined;
  }
}

export default QueueStore;

export type QueueItemData = Pick<
  QueueItem,
  | "queue_index"
  | "uid"
  | "uri"
  | "name"
  | "artist_name"
  | "image_uri"
  | "provider"
  | "identifier"
> & { explicit?: boolean };
