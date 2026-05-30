import { createLogger } from "../utils/logger";

const log = createLogger("PairingAgent");

export interface PairingPinEvent {
  address: string;
  name: string;
  pin: string;
  type: "bluetooth_pin";
}

export class PairingAgent {
  private bus: any = null;
  private dbusModule: any = null;
  private agentPath = "/com/usenocturne/agent";
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: any) => void) | null = null;
  private _pendingPin: PairingPinEvent | null = null;
  private onPinDisplay: ((event: PairingPinEvent) => void) | null = null;
  private onPairingCancelled: (() => void) | null = null;

  setOnPinDisplay(handler: (event: PairingPinEvent) => void): void {
    this.onPinDisplay = handler;
  }

  setOnPairingCancelled(handler: () => void): void {
    this.onPairingCancelled = handler;
  }

  get pendingPin(): PairingPinEvent | null {
    return this._pendingPin;
  }

  confirmPairing(): void {
    if (this.pendingResolve) {
      log.info("User confirmed pairing");
      this.pendingResolve();
      this.pendingResolve = null;
      this.pendingReject = null;
      this._pendingPin = null;
    }
  }

  rejectPairing(): void {
    if (this.pendingReject && this.dbusModule) {
      log.info("User rejected pairing");
      this.pendingReject(new this.dbusModule.DBusError("org.bluez.Error.Rejected", "User rejected pairing"));
      this.pendingResolve = null;
      this.pendingReject = null;
      this._pendingPin = null;
    }
  }

  private devicePathToAddress(path: string): string {
    const match = path.match(/dev_([\w_]+)$/);
    if (match) return match[1].replace(/_/g, ":");
    return path;
  }

  private async getDeviceName(devicePath: string): Promise<string> {
    if (!this.bus) return "";
    try {
      const obj = await this.bus.getProxyObject("org.bluez", devicePath);
      const props = obj.getInterface("org.freedesktop.DBus.Properties");
      const nameVariant = await props.Get("org.bluez.Device1", "Name");
      return nameVariant?.value ?? "";
    } catch {
      return "";
    }
  }

  async register(): Promise<void> {
    try {
      const dbus = await import("dbus-next");
      this.dbusModule = dbus;
      this.bus = dbus.systemBus();

      const DbusInterface = dbus.interface.Interface;
      const agent = this;

      class Agent1 extends DbusInterface {
        Release() {
          log.info("Agent released");
        }
        RequestPinCode(_device: string) {
          log.info(`PIN requested for ${_device}, returning 0000`);
          return "0000";
        }
        DisplayPinCode(devicePath: string, pincode: string) {
          log.info(`PIN code for ${devicePath}: ${pincode}`);
        }
        RequestPasskey(_device: string) {
          log.info(`Passkey requested for ${_device}`);
          return 0;
        }
        DisplayPasskey(devicePath: string, passkey: number, _entered: number) {
          log.info(`Passkey for ${devicePath}: ${passkey}`);
        }
        RequestConfirmation(devicePath: string, passkey: number) {
          const address = agent.devicePathToAddress(devicePath);
          const pin = String(passkey).padStart(6, "0");
          log.info(`RequestConfirmation: ${pin} for device: ${devicePath}`);

          return new Promise<void>((resolve, reject) => {
            agent.pendingResolve = resolve;
            agent.pendingReject = reject;

            const event: PairingPinEvent = { address, name: "", pin, type: "bluetooth_pin" };
            agent._pendingPin = event;

            agent.getDeviceName(devicePath).then((name) => {
              event.name = name;
              agent._pendingPin = event;
              agent.onPinDisplay?.(event);
            });
          });
        }
        RequestAuthorization(_device: string) {
          log.info(`Auto-authorizing ${_device}`);
        }
        AuthorizeService(_device: string, _uuid: string) {
          log.info(`Auto-authorizing service ${_uuid} for ${_device}`);
        }
        Cancel() {
          log.info("Pairing cancelled");
          agent.pendingResolve = null;
          agent.pendingReject = null;
          agent._pendingPin = null;
          agent.onPairingCancelled?.();
        }
      }

      Agent1.configureMembers({
        methods: {
          Release: { inSignature: "", outSignature: "" },
          RequestPinCode: { inSignature: "o", outSignature: "s" },
          DisplayPinCode: { inSignature: "os", outSignature: "" },
          RequestPasskey: { inSignature: "o", outSignature: "u" },
          DisplayPasskey: { inSignature: "ouu", outSignature: "" },
          RequestConfirmation: { inSignature: "ou", outSignature: "" },
          RequestAuthorization: { inSignature: "o", outSignature: "" },
          AuthorizeService: { inSignature: "os", outSignature: "" },
          Cancel: { inSignature: "", outSignature: "" },
        },
      });

      const agentInstance = new Agent1("org.bluez.Agent1");
      this.bus.export(this.agentPath, agentInstance);

      const obj = await this.bus.getProxyObject("org.bluez", "/org/bluez");
      const agentManager = obj.getInterface("org.bluez.AgentManager1");
      await agentManager.RegisterAgent(this.agentPath, "KeyboardDisplay");
      await agentManager.RequestDefaultAgent(this.agentPath);

      log.info("Pairing agent registered as default (KeyboardDisplay)");
    } catch (err) {
      log.warn(`Pairing agent not available: ${err}`);
    }
  }

  async unregister(): Promise<void> {
    if (!this.bus) return;
    try {
      const obj = await this.bus.getProxyObject("org.bluez", "/org/bluez");
      const agentManager = obj.getInterface("org.bluez.AgentManager1");
      await agentManager.UnregisterAgent(this.agentPath);
    } catch {}
  }
}
