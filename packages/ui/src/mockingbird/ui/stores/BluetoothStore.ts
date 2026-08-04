import { makeAutoObservable, runInAction } from "mobx";
import {
  acquireBluetoothDiscovery,
  releaseBluetoothDiscovery,
  sendNocturneWsRequest,
} from "../../../hooks/useNocturned";

const DISCOVERY_OWNER = Symbol("mockingbird-bluetooth-discovery");

class BluetoothStore {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  bluetoothDeviceList: UiLooseData[] = [];
  currentDevice = null;
  localDevice = null;
  pin = "";

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });
  }

  async triggerBTDeviceList() {
    try {
      /** @type {import("@schema/bluetooth").BluetoothDevicesListRequest} */
      const request = {};
      const resp = await sendNocturneWsRequest(
        "bluetooth.devices.list",
        request,
        { timeoutMs: 5000 },
      );
      /** @type {import("@schema/bluetooth").BluetoothDevicesListResponse | undefined} */
      const typedResp = resp?.payload ? resp : resp?.result;
      const list = (typedResp && typedResp.payload) || [];
      runInAction(() => {
        this.bluetoothDeviceList = list;
        const connected = list.find((d) => d.connected);
        this.currentDevice = connected || null;

        if (connected?.address) {
          localStorage.setItem(
            "lastConnectedBluetoothDevice",
            connected.address,
          );
        }
        this.rootStore.presetsDataStore?.setActiveDeviceId(
          connected?.address ||
            localStorage.getItem("lastConnectedBluetoothDevice"),
        );
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
      /** @type {import("@schema/bluetooth").BluetoothDeviceConnectRequest} */
      const request = { address };
      await sendNocturneWsRequest("bluetooth.device.connect", request, {
        timeoutMs: 15000,
      });
      localStorage.setItem("lastConnectedBluetoothDevice", address);
      this.rootStore.presetsDataStore?.setActiveDeviceId(address);
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
      /** @type {import("@schema/bluetooth").BluetoothDeviceDisconnectRequest} */
      const request = { address };
      await sendNocturneWsRequest("bluetooth.device.disconnect", request, {
        timeoutMs: 10000,
      });
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
      /** @type {import("@schema/bluetooth").BluetoothDeviceUnpairRequest} */
      const request = { address };
      await sendNocturneWsRequest("bluetooth.device.unpair", request, {
        timeoutMs: 10000,
      });
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
      await acquireBluetoothDiscovery(DISCOVERY_OWNER);
      return true;
    } catch (e) {
      console.error("Failed to start discovery:", e);
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await releaseBluetoothDiscovery(DISCOVERY_OWNER);
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
