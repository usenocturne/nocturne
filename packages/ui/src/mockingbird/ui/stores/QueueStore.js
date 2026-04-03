import { makeAutoObservable, get } from 'mobx';

export class QueueItem {
  constructor(data) {
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
  playerStore;
  queueStore;
  imageStore;
  viewStore;
  hardwareStore;
  interappActions;
  queueUbiLogger;
  animateSliding = false;
  selectedItem = undefined;

  constructor(
    playerStore,
    queueStore,
    imageStore,
    viewStore,
    hardwareStore,
    queueUbiLogger,
    interappActions,
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
    return this.selectedItem?.provider === 'queue';
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
      return 'Next in Queue:';
    } else if (this.queueStore.current.provider === 'queue') {
      if (!this.playerStore.contextTitle) {
        return 'Next Up:';
      }
      return `Next From: ${this.playerStore.contextTitle}`;
    }
    return `Next From: ${this.titleBasedOnType()}`;
  }

  titleBasedOnType() {
    const rootStore = window.carThingRootStore;
    const contextTitle = rootStore?.npvStore?.playingInfoUiState?.contextHeaderTitle ||
      this.playerStore.contextTitle;

    if (contextTitle) {
      return contextTitle;
    }

    return 'Queue';
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
      ',',
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

  handleDraggedToIndex(index) {
    const userDraggedToItem = this.queue.find(
      (_, itemIndex) => index === itemIndex,
    );
    if (userDraggedToItem) {
      this.viewStore.showQueue();
      this.updateSelectedItem(userDraggedToItem);
    }
  }

  updateSelectedItem(item, withAnimation = true) {
    this.animateSliding = withAnimation;
    this.selectedItem = item;
  }

  playItem(queueItem) {
    this.playerStore.skipToIndex(queueItem.queue_index, queueItem.uid);
  }

  handleItemClicked(item) {
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
  current = {
    image_uri: '',
    uid: '',
    uri: '',
    provider: '',
  };

  next = [];
  queueUiState;
  queueUpdateCurrentCallback = null;

  constructor(socket, playerStore, imageStore, viewStore, hardwareStore, ubiLogger, interappActions) {
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

  updateCurrent(imageUri, uid, uri, provider = '') {
    this.current = {
      image_uri: imageUri || '',
      uid: uid || '',
      uri: uri || '',
      provider: provider,
    };
    if (this.queueUpdateCurrentCallback) {
      this.queueUpdateCurrentCallback();
    }
  }

  updateQueue(queueData) {
    this.next = queueData.map(item => new QueueItem(item));
  }

  onQueueUpdateCurrent(callback) {
    this.queueUpdateCurrentCallback = callback;
  }

  isNewCurrent(selectedItem) {
    return this.current.uri === selectedItem?.uri;
  }

  reset() {
    this.current = {
      image_uri: '',
      uid: '',
      uri: '',
      provider: '',
    };
    this.next = [];
    this.queueUiState.selectedItem = undefined;
  }
}

export default QueueStore;