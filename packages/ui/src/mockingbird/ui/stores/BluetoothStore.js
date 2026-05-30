import { makeAutoObservable, runInAction } from "mobx";
import { sendNocturneWsRequest } from "../../../hooks/useNocturned";

class BluetoothStore {
  bluetoothDeviceList = [];
  currentDevice = null;
  localDevice = null;
  pin = "";

  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  async triggerBTDeviceList() {
    try {
      const resp = await sendNocturneWsRequest(
        "bluetooth.devices.list",
        {},
        { timeoutMs: 5000 },
      );
      const list =
        (resp && resp.payload) ||
        (resp && resp.result && resp.result.payload) ||
        [];
      runInAction(() => {
        this.bluetoothDeviceList = list;
        const connected = list.find((d) => d.connected);
        if (connected) {
          this.currentDevice = connected;
        }
      });
    } catch (e) {
      console.error("Failed to fetch bluetooth devices:", e);
      runInAction(() => {
        this.bluetoothDeviceList = [];
      });
    }
  }

  async connectDevice(address) {
    try {
      runInAction(() => {
        this.currentDevice = this.bluetoothDeviceList.find(
          (d) => d.address === address,
        ) || { address };
      });
      await sendNocturneWsRequest(
        "bluetooth.device.connect",
        { address },
        { timeoutMs: 15000 },
      );
      localStorage.setItem("lastConnectedBluetoothDevice", address);
      await this.triggerBTDeviceList();
      return true;
    } catch (e) {
      console.error("Failed to connect device:", e);
      runInAction(() => {
        this.currentDevice = null;
      });
      return false;
    }
  }

  async disconnectDevice(address) {
    try {
      await sendNocturneWsRequest(
        "bluetooth.device.disconnect",
        { address },
        { timeoutMs: 10000 },
      );
      if (localStorage.getItem("lastConnectedBluetoothDevice") === address) {
        localStorage.removeItem("lastConnectedBluetoothDevice");
      }
      await this.triggerBTDeviceList();
      return true;
    } catch (e) {
      console.error("Failed to disconnect device:", e);
      return false;
    }
  }

  async forgetDevice(address) {
    try {
      await sendNocturneWsRequest(
        "bluetooth.device.unpair",
        { address },
        { timeoutMs: 10000 },
      );
      if (localStorage.getItem("lastConnectedBluetoothDevice") === address) {
        localStorage.removeItem("lastConnectedBluetoothDevice");
      }
      await this.triggerBTDeviceList();
      return true;
    } catch (e) {
      console.error("Failed to forget device:", e);
      return false;
    }
  }

  async startDiscovery() {
    try {
      await sendNocturneWsRequest(
        "bluetooth.discoverable",
        { discoverable: true },
        { timeoutMs: 5000 },
      );
      return true;
    } catch (e) {
      console.error("Failed to start discovery:", e);
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await sendNocturneWsRequest(
        "bluetooth.discoverable",
        { discoverable: false },
        { timeoutMs: 5000 },
      );
    } catch (e) {
      console.error("Failed to stop discovery:", e);
    }
  }

  isDeviceConnected(address) {
    const device = this.bluetoothDeviceList.find((d) => d.address === address);
    return device?.connected || false;
  }

  getDeviceName(device) {
    return (
      device?.device_info?.name ||
      device?.name ||
      device?.alias ||
      device?.address ||
      ""
    );
  }
}

export default BluetoothStore;
