import { BlueZAdapter, type BluetoothDevice } from "../bluetooth/dbus-adapter";
import { RFCOMMServer, type RFCOMMConnection } from "../bluetooth/rfcomm-server";
import { RFCOMMClient } from "../bluetooth/rfcomm-client";
import { PairingAgent, type PairingPinEvent } from "../bluetooth/pairing-agent";
import { createLogger } from "../utils/logger";

const log = createLogger("BluetoothService");

export type BluetoothEventType =
  | "deviceFound"
  | "deviceUpdated"
  | "devicePaired"
  | "deviceConnected"
  | "deviceDisconnected"
  | "agent"
  | "pairingCancelled";

export class BluetoothService {
  private adapter = new BlueZAdapter();
  private rfcomm = new RFCOMMServer();
  private rfcommClient = new RFCOMMClient();
  private agent = new PairingAgent();
  private eventListeners: ((event: BluetoothEventType, data: any) => void)[] = [];
  private _initialized = false;
  private autoConnectTimer: ReturnType<typeof setTimeout> | null = null;

  get rfcommServer(): RFCOMMServer {
    return this.rfcomm;
  }

  get rfcommOutbound(): RFCOMMClient {
    return this.rfcommClient;
  }

  onEvent(listener: (event: BluetoothEventType, data: any) => void): void {
    this.eventListeners.push(listener);
  }

  private emit(event: BluetoothEventType, data: any): void {
    for (const listener of this.eventListeners) listener(event, data);
  }

  get pendingPairingPin(): PairingPinEvent | null {
    return this.agent.pendingPin;
  }

  confirmPairing(): void {
    this.agent.confirmPairing();
  }

  rejectPairing(): void {
    this.agent.rejectPairing();
  }

  async initialize(): Promise<void> {
    try {
      await this.adapter.initialize();
      await this.adapter.powerOn();
      await this.adapter.setDiscoverable(true);
      await this.adapter.setPairable(true);

      this.agent.setOnPinDisplay((event) => {
        log.info(`PIN display: ${event.address} (${event.name}) pin=${event.pin}`);
        this.emit("agent", event);
      });
      this.agent.setOnPairingCancelled(() => {
        log.info("Pairing cancelled by remote device");
        this.emit("pairingCancelled", {});
      });

      await this.agent.register();

      this.adapter.setOnPairComplete((address) => {
        log.info(`Pairing complete for ${address}, will auto-connect RFCOMM in 3s`);
        setTimeout(async () => {
          if (this.rfcommClient.connected) return;
          try {
            await this.connect(address);
          } catch (err) {
            log.error(`Auto-connect RFCOMM failed for ${address}: ${err}`);
          }
        }, 3000);
      });

      this.adapter.setOnDeviceConnected((address) => {
        if (this.rfcommClient.connected && this.rfcommClient.address === address) return;
        if (this.autoConnectTimer) clearTimeout(this.autoConnectTimer);
        log.info(`Paired device ${address} connected, auto-connecting RFCOMM channel 2 in 2s`);
        this.autoConnectTimer = setTimeout(async () => {
          this.autoConnectTimer = null;
          if (this.rfcommClient.connected) return;
          try {
            await this.connect(address, 2);
          } catch (err) {
            log.warn(`Auto-connect to ${address} channel 2 failed: ${err}`);
          }
        }, 2000);
      });

      this.adapter.setOnDeviceFound((device) => {
        this.emit("deviceFound", device);
      });
      this.adapter.setOnDeviceUpdated((device) => {
        this.emit("deviceUpdated", device);
      });

      this.rfcomm.setConnectionHandler((conn) => {
        log.info(`Inbound RFCOMM from ${conn.address}`);
        this.emit("deviceConnected", { address: conn.address, devicePath: conn.devicePath });
      });

      this.rfcomm.setDisconnectionHandler((devicePath) => {
        log.info(`Inbound RFCOMM disconnected: ${devicePath}`);
        this.emit("deviceDisconnected", { devicePath });
      });

      this.rfcommClient.setDisconnectHandler(() => {
        log.info(`Outbound RFCOMM disconnected from ${this.rfcommClient.address}`);
        this.emit("deviceDisconnected", { devicePath: `rfcomm-client:${this.rfcommClient.address}` });
      });

      await this.rfcomm.register();
      this._initialized = true;
      log.info("Bluetooth service initialized");
    } catch (err) {
      log.warn(`Bluetooth init failed (expected on dev): ${err}`);
    }
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async getStatus() {
    return this.adapter.getAdapterStatus();
  }

  async powerOn(): Promise<void> {
    await this.adapter.powerOn();
  }

  async powerOff(): Promise<void> {
    await this.adapter.powerOff();
  }

  async startScan(): Promise<void> {
    await this.adapter.startDiscovery();
  }

  async stopScan(): Promise<void> {
    await this.adapter.stopDiscovery();
  }

  async getDevices(): Promise<BluetoothDevice[]> {
    return this.adapter.getDevices();
  }

  async pair(address: string): Promise<void> {
    await this.adapter.pairDevice(address);
  }

  async connect(address: string, channel?: number): Promise<void> {
    if (this.autoConnectTimer) {
      clearTimeout(this.autoConnectTimer);
      this.autoConnectTimer = null;
    }
    await this.rfcommClient.connect(address, channel);
    this.emit("deviceConnected", {
      address,
      devicePath: `rfcomm-client:${address}`,
    });
  }

  async trust(address: string): Promise<void> {
    await this.adapter.trustDevice(address);
  }

  async unpair(address: string): Promise<void> {
    await this.adapter.removeDevice(address);
  }

  getConnections(): Map<string, RFCOMMConnection> {
    return this.rfcomm.getConnections();
  }
}
