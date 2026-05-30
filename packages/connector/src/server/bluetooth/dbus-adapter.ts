import { createLogger } from "../utils/logger";

const log = createLogger("BlueZAdapter");

export interface BluetoothDevice {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  rssi: number;
  icon: string;
}

const ADDRESS_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

export function propsToDevice(props: any, existing?: BluetoothDevice): BluetoothDevice {
  const address = props.Address?.value ?? existing?.address ?? "";
  const name = props.Name?.value || null;
  const alias = props.Alias?.value || null;
  const icon = props.Icon?.value ?? existing?.icon ?? "";

  let resolvedName: string;
  if (alias && !ADDRESS_RE.test(alias)) {
    resolvedName = alias;
  } else if (name) {
    resolvedName = name;
  } else if (existing && existing.name !== "Unknown Device") {
    resolvedName = existing.name;
  } else if (icon && icon !== "device") {
    resolvedName = icon.charAt(0).toUpperCase() + icon.slice(1).replace(/-/g, " ");
  } else {
    resolvedName = "Unknown Device";
  }

  return {
    address,
    name: resolvedName,
    paired: props.Paired?.value ?? existing?.paired ?? false,
    connected: props.Connected?.value ?? existing?.connected ?? false,
    trusted: props.Trusted?.value ?? existing?.trusted ?? false,
    rssi: props.RSSI?.value ?? existing?.rssi ?? -100,
    icon: icon || "device",
  };
}

export class BlueZAdapter {
  private bus: any = null;
  private dbus: any = null;
  private adapter: any = null;
  private adapterPath = "/org/bluez/hci0";
  private deviceCache = new Map<string, BluetoothDevice>();
  private signalsConnected = false;

  async initialize(): Promise<void> {
    try {
      const dbus = await import("dbus-next");
      this.dbus = dbus;
      this.bus = dbus.systemBus();
      const obj = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      this.adapter = obj.getInterface("org.bluez.Adapter1");

      await this.setupSignalListeners();
      await this.setAlias("Nocturne Connector");

      log.info("BlueZ adapter initialized");
    } catch (err) {
      log.warn(`BlueZ not available (expected on dev machines): ${err}`);
    }
  }

  private async setupSignalListeners(): Promise<void> {
    if (!this.bus || this.signalsConnected) return;

    try {
      const obj = await this.bus.getProxyObject("org.bluez", "/");
      const manager = obj.getInterface("org.freedesktop.DBus.ObjectManager");

      manager.on("InterfacesAdded", (path: string, interfaces: any) => {
        const device = interfaces["org.bluez.Device1"];
        if (device) {
          const wasInCache = this.deviceCache.has(path);
          const existing = this.deviceCache.get(path);
          this.deviceCache.set(path, propsToDevice(device, existing));
          this.watchDeviceProperties(path);
          if (!wasInCache) {
            const cached = this.deviceCache.get(path);
            if (cached) this.onDeviceFound?.(cached);
          }
        }
      });

      manager.on("InterfacesRemoved", (path: string, interfaces: string[]) => {
        if (interfaces.includes("org.bluez.Device1")) {
          this.deviceCache.delete(path);
          this.watchedPaths.delete(path);
        }
      });

      const objects = await manager.GetManagedObjects();
      for (const [path, ifaces] of Object.entries(objects as Record<string, any>)) {
        const device = ifaces["org.bluez.Device1"];
        if (device) {
          this.deviceCache.set(path, propsToDevice(device));
          this.watchDeviceProperties(path);
        }
      }

      this.signalsConnected = true;
      log.info(`Signal listeners connected, ${this.deviceCache.size} devices cached`);
    } catch (err) {
      log.error(`Failed to setup signal listeners: ${err}`);
    }
  }

  private async watchDeviceProperties(path: string): Promise<void> {
    if (this.watchedPaths.has(path)) return;
    this.watchedPaths.add(path);
    try {
      const obj = await this.bus.getProxyObject("org.bluez", path);
      const props = obj.getInterface("org.freedesktop.DBus.Properties");

      props.on("PropertiesChanged", (iface: string, changed: any) => {
        if (iface === "org.bluez.Device1") {
          const prev = this.deviceCache.get(path);
          const wasConnected = prev?.connected ?? false;
          const next = propsToDevice(changed, prev);
          this.deviceCache.set(path, next);

          if (changed.Connected?.value === true && !wasConnected) {
            if (next.paired && next.trusted) {
              log.info(`Paired device ${next.address} connected at ACL level`);
              this.onDeviceConnected?.(next.address);
            }
          }

          const userVisibleChanged =
            !prev ||
            prev.name !== next.name ||
            prev.paired !== next.paired ||
            prev.connected !== next.connected ||
            prev.trusted !== next.trusted;
          if (userVisibleChanged) {
            this.onDeviceUpdated?.(next);
          }
        }
      });
    } catch (err) {
      this.watchedPaths.delete(path);
      log.warn(`Failed to watch properties for ${path}: ${err}`);
    }
  }

  async setAlias(name: string): Promise<void> {
    if (!this.bus || !this.dbus) return;
    try {
      const obj = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const propsIface = obj.getInterface("org.freedesktop.DBus.Properties");
      await propsIface.Set("org.bluez.Adapter1", "Alias", new this.dbus.Variant("s", name));
      log.info(`Adapter alias set to "${name}"`);
    } catch (err) {
      log.error(`Failed to set alias: ${err}`);
    }
  }

  async powerOn(): Promise<void> {
    if (!this.adapter) return;
    try {
      const props = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const propsIface = props.getInterface("org.freedesktop.DBus.Properties");
      await propsIface.Set("org.bluez.Adapter1", "Powered", new this.dbus.Variant("b", true));
      log.info("Adapter powered on");
    } catch (err) {
      log.error(`Failed to power on: ${err}`);
    }
  }

  async powerOff(): Promise<void> {
    if (!this.adapter) return;
    try {
      const props = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const propsIface = props.getInterface("org.freedesktop.DBus.Properties");
      await propsIface.Set("org.bluez.Adapter1", "Powered", new this.dbus.Variant("b", false));
    } catch (err) {
      log.error(`Failed to power off: ${err}`);
    }
  }

  async setDiscoverable(enabled: boolean): Promise<void> {
    if (!this.bus || !this.dbus) return;
    try {
      const obj = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const propsIface = obj.getInterface("org.freedesktop.DBus.Properties");
      await propsIface.Set("org.bluez.Adapter1", "DiscoverableTimeout", new this.dbus.Variant("u", 0));
      await propsIface.Set("org.bluez.Adapter1", "Discoverable", new this.dbus.Variant("b", enabled));
      log.info(`Adapter discoverable: ${enabled}`);
    } catch (err) {
      log.error(`Failed to set discoverable: ${err}`);
    }
  }

  async setPairable(enabled: boolean): Promise<void> {
    if (!this.bus || !this.dbus) return;
    try {
      const obj = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const propsIface = obj.getInterface("org.freedesktop.DBus.Properties");
      await propsIface.Set("org.bluez.Adapter1", "PairableTimeout", new this.dbus.Variant("u", 0));
      await propsIface.Set("org.bluez.Adapter1", "Pairable", new this.dbus.Variant("b", enabled));
      log.info(`Adapter pairable: ${enabled}`);
    } catch (err) {
      log.error(`Failed to set pairable: ${err}`);
    }
  }

  async startDiscovery(): Promise<void> {
    if (!this.adapter) return;
    try {
      try {
        await this.adapter.SetDiscoveryFilter({
          Transport: { value: "auto", type: "s" },
          DuplicateData: { value: true, type: "b" },
          RSSI: { value: -100, type: "n" },
        });
      } catch {}
      await this.adapter.StartDiscovery();
      log.info("Discovery started (Transport=auto, DuplicateData=true, RSSI≥-100)");
    } catch (err) {
      log.error(`Failed to start discovery: ${err}`);
    }
  }

  async stopDiscovery(): Promise<void> {
    if (!this.adapter) return;
    try {
      await this.adapter.StopDiscovery();
    } catch {}
  }

  async getDevices(): Promise<BluetoothDevice[]> {
    if (!this.bus) return [];

    if (!this.signalsConnected) {
      return this.fetchDevices();
    }

    return Array.from(this.deviceCache.values()).sort((a, b) => {
      const aKnown = a.name !== "Unknown Device" ? 0 : 1;
      const bKnown = b.name !== "Unknown Device" ? 0 : 1;
      return aKnown - bKnown;
    });
  }

  private async fetchDevices(): Promise<BluetoothDevice[]> {
    try {
      const obj = await this.bus.getProxyObject("org.bluez", "/");
      const manager = obj.getInterface("org.freedesktop.DBus.ObjectManager");
      const objects = await manager.GetManagedObjects();
      const devices: BluetoothDevice[] = [];

      for (const [, interfaces] of Object.entries(objects as Record<string, any>)) {
        const device = interfaces["org.bluez.Device1"];
        if (device) {
          devices.push(propsToDevice(device));
        }
      }

      return devices;
    } catch (err) {
      log.error(`Failed to get devices: ${err}`);
      return [];
    }
  }

  private onDeviceConnected: ((address: string) => void) | null = null;
  private onPairComplete: ((address: string) => void) | null = null;
  private onDeviceFound: ((device: BluetoothDevice) => void) | null = null;
  private onDeviceUpdated: ((device: BluetoothDevice) => void) | null = null;
  private watchedPaths = new Set<string>();

  setOnDeviceConnected(handler: (address: string) => void): void {
    this.onDeviceConnected = handler;
  }

  setOnPairComplete(handler: (address: string) => void): void {
    this.onPairComplete = handler;
  }

  setOnDeviceFound(handler: (device: BluetoothDevice) => void): void {
    this.onDeviceFound = handler;
  }

  setOnDeviceUpdated(handler: (device: BluetoothDevice) => void): void {
    this.onDeviceUpdated = handler;
  }

  async pairDevice(address: string): Promise<void> {
    if (!this.bus) throw new Error("BlueZ not available");
    const path = `/org/bluez/hci0/dev_${address.replace(/:/g, "_")}`;
    const obj = await this.bus.getProxyObject("org.bluez", path);
    const device = obj.getInterface("org.bluez.Device1");
    device.Pair().then(async () => {
      log.info(`Paired with ${address}, auto-trusting`);
      await this.trustDevice(address);
      this.onPairComplete?.(address);
    }).catch((err: any) => {
      log.error(`Pairing failed for ${address}: ${err}`);
    });
  }

  async trustDevice(address: string): Promise<void> {
    if (!this.bus) throw new Error("BlueZ not available");
    const path = `/org/bluez/hci0/dev_${address.replace(/:/g, "_")}`;
    const obj = await this.bus.getProxyObject("org.bluez", path);
    const props = obj.getInterface("org.freedesktop.DBus.Properties");
    await props.Set("org.bluez.Device1", "Trusted", new this.dbus.Variant("b", true));
    log.info(`Trusted ${address}`);
  }

  async removeDevice(address: string): Promise<void> {
    if (!this.adapter) throw new Error("BlueZ not available");
    const path = `/org/bluez/hci0/dev_${address.replace(/:/g, "_")}`;
    await this.adapter.RemoveDevice(path);
    log.info(`Removed device ${address}`);
  }

  async getAdapterStatus(): Promise<{ powered: boolean; discovering: boolean; address: string }> {
    if (!this.bus) return { powered: false, discovering: false, address: "" };
    try {
      const obj = await this.bus.getProxyObject("org.bluez", this.adapterPath);
      const props = obj.getInterface("org.freedesktop.DBus.Properties");
      const powered = await props.Get("org.bluez.Adapter1", "Powered");
      const discovering = await props.Get("org.bluez.Adapter1", "Discovering");
      const address = await props.Get("org.bluez.Adapter1", "Address");
      return { powered: powered.value, discovering: discovering.value, address: address.value };
    } catch {
      return { powered: false, discovering: false, address: "" };
    }
  }
}
