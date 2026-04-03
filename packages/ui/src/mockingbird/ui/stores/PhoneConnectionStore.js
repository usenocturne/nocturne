import { makeAutoObservable, runInAction } from "mobx";

export const PhoneConnectionModalView = {
  ADD_NEW_PHONE: "ADD_NEW_PHONE",
  ADD_NEW_PAIRING: "ADD_NEW_PAIRING",
  FORGET_PHONE_CONFIRM: "FORGET_PHONE_CONFIRM",
  FORGET_PHONE_PROGRESS: "FORGET_PHONE_PROGRESS",
  FORGET_PHONE_FAILURE: "FORGET_PHONE_FAILURE",
  FORGET_PHONE_SUCCESS: "FORGET_PHONE_SUCCESS",
  SELECT_PHONE_PROGRESS: "SELECT_PHONE_PROGRESS",
  PHONE_SWITCH_SUCCESS: "PHONE_SWITCH_SUCCESS",
  SELECT_PHONE_FAILURE: "SELECT_PHONE_FAILURE",
};

class PhoneConnectionStore {
  phoneConnectionModal = undefined;
  phoneToConnectOrForget = null;
  forgetConfirmationIsActive = true;
  phoneConnectionContextMenuUiState;
  _dismissTimeout = null;

  constructor(rootStore) {
    this.rootStore = rootStore;
    this.phoneConnectionContextMenuUiState =
      new PhoneConnectionContextMenuUiState(this);
    makeAutoObservable(this, {
      rootStore: false,
      _dismissTimeout: false,
    });
  }

  getPhoneConnectionDisplayStatus(device) {
    const { bluetoothStore } = this.rootStore;
    const isConnected = bluetoothStore.isDeviceConnected(device.address);
    if (isConnected) return "Connected";
    if (
      bluetoothStore.currentDevice?.address === device.address &&
      !isConnected
    ) {
      return "Connecting...";
    }
    return "Not connected";
  }

  handleSelectPhoneClick(device) {
    const { bluetoothStore } = this.rootStore;
    const isConnected = bluetoothStore.isDeviceConnected(device.address);
    if (isConnected) return;

    this.phoneToConnectOrForget = device;
    this.phoneConnectionModal = PhoneConnectionModalView.SELECT_PHONE_PROGRESS;
    this._connectToDevice(device.address);
  }

  handleSelectPhoneDialPress() {
    const { settingsStore, bluetoothStore } = this.rootStore;
    const index = settingsStore.currentView.index;
    const device = bluetoothStore.bluetoothDeviceList[index];
    if (device) {
      this.phoneConnectionContextMenuUiState.handleContextMenuClick({
        name: bluetoothStore.getDeviceName(device),
        address: device.address,
      });
    }
  }

  async _connectToDevice(address) {
    const { bluetoothStore } = this.rootStore;
    const success = await bluetoothStore.connectDevice(address);
    runInAction(() => {
      if (success) {
        this.phoneConnectionModal =
          PhoneConnectionModalView.PHONE_SWITCH_SUCCESS;
        this._autoDismiss(2000);
      } else {
        this.phoneConnectionModal =
          PhoneConnectionModalView.SELECT_PHONE_FAILURE;
        this._autoDismiss(3000);
      }
    });
  }

  handleAddNewPhoneClick() {
    const { bluetoothStore } = this.rootStore;
    bluetoothStore.startDiscovery();
    this.phoneConnectionModal = PhoneConnectionModalView.ADD_NEW_PHONE;
  }

  handleAddNewPhoneDialPress() {
    this.handleAddNewPhoneClick();
  }

  handlePhoneForgetConfirmClick() {
    if (!this.phoneToConnectOrForget) return;
    this.phoneConnectionModal = PhoneConnectionModalView.FORGET_PHONE_PROGRESS;
    this._forgetDevice(this.phoneToConnectOrForget.address);
  }

  async _forgetDevice(address) {
    const { bluetoothStore } = this.rootStore;
    const success = await bluetoothStore.forgetDevice(address);
    runInAction(() => {
      if (success) {
        this.phoneConnectionModal =
          PhoneConnectionModalView.FORGET_PHONE_SUCCESS;
        this._autoDismiss(2000);
      } else {
        this.phoneConnectionModal =
          PhoneConnectionModalView.FORGET_PHONE_FAILURE;
        this._autoDismiss(3000);
      }
    });
  }

  setForgetConfirmationIsActive(isActive) {
    this.forgetConfirmationIsActive = isActive;
  }

  dismissModal() {
    if (this._dismissTimeout) {
      clearTimeout(this._dismissTimeout);
      this._dismissTimeout = null;
    }
    this.phoneConnectionModal = undefined;
    this.phoneToConnectOrForget = null;
    this.forgetConfirmationIsActive = true;
    const { bluetoothStore } = this.rootStore;
    bluetoothStore.stopDiscovery();
  }

  _autoDismiss(ms) {
    if (this._dismissTimeout) clearTimeout(this._dismissTimeout);
    this._dismissTimeout = setTimeout(() => {
      runInAction(() => {
        this.dismissModal();
      });
    }, ms);
  }

  unmountPhoneConnectionView = () => {
    this.dismissModal();
    this.phoneConnectionContextMenuUiState.dismissMenu();
  };

  logDialogImpression() {}
}

class PhoneConnectionContextMenuUiState {
  phoneMenuShowing = false;
  selectedItemIndex = 0;
  phoneName = "";
  phoneAddress = "";
  isConnected = false;
  displayConnectionStatus = "";
  isDialPressed = false;

  constructor(phoneConnectionStore) {
    this.phoneConnectionStore = phoneConnectionStore;
    makeAutoObservable(this, {
      phoneConnectionStore: false,
    });
  }

  get menuItems() {
    if (this.isConnected) {
      return ["Forget"];
    }
    return ["Connect", "Forget"];
  }

  get phoneMenuItem() {
    return this.menuItems[this.selectedItemIndex];
  }

  isActive(index) {
    return this.selectedItemIndex === index;
  }

  handleContextMenuClick(device) {
    const { rootStore } = this.phoneConnectionStore;
    const { bluetoothStore } = rootStore;
    const connected = bluetoothStore.isDeviceConnected(device.address);
    this.phoneName = device.name || bluetoothStore.getDeviceName(device);
    this.phoneAddress = device.address;
    this.isConnected = connected;
    this.displayConnectionStatus = connected ? "Connected" : "Not connected";
    this.selectedItemIndex = 0;
    this.phoneMenuShowing = true;
  }

  handleActionMenuItemClick(item) {
    this._executeAction(item);
  }

  handleActionMenuItemDialPress(item) {
    this._executeAction(item);
  }

  _executeAction(item) {
    const store = this.phoneConnectionStore;
    const device = { name: this.phoneName, address: this.phoneAddress };

    if (item === "Connect") {
      this.dismissMenu();
      store.phoneToConnectOrForget = device;
      store.phoneConnectionModal =
        PhoneConnectionModalView.SELECT_PHONE_PROGRESS;
      store._connectToDevice(this.phoneAddress);
    } else if (item === "Forget") {
      this.dismissMenu();
      store.phoneToConnectOrForget = device;
      store.forgetConfirmationIsActive = true;
      store.phoneConnectionModal =
        PhoneConnectionModalView.FORGET_PHONE_CONFIRM;
    }
  }

  setNewMenuIndex(index) {
    if (index >= 0 && index < this.menuItems.length) {
      this.selectedItemIndex = index;
    }
  }

  goToNextItem() {
    if (this.selectedItemIndex < this.menuItems.length - 1) {
      this.selectedItemIndex++;
    }
  }

  goToPreviousItem() {
    if (this.selectedItemIndex > 0) {
      this.selectedItemIndex--;
    }
  }

  dismissMenu() {
    this.phoneMenuShowing = false;
    this.selectedItemIndex = 0;
  }
}

export default PhoneConnectionStore;
