import type { RootStore } from "./RootStore";
import type { InterappActions, MiddlewareActions } from "./StoreContracts";
import { makeAutoObservable } from "mobx";
import { addGlobalWsListener } from "../../../hooks/useNocturned";
import type { WsMessage } from "../../../types";

export const ambientLightFromMessage = (message: WsMessage) => {
  if (message.type !== "event" || message.topic !== "ambient_light_update") {
    return null;
  }

  const data = message.data;
  const value =
    typeof data === "number"
      ? data
      : data !== null && typeof data === "object"
        ? ((data as Record<string, unknown>).normalized_value ??
          (data as Record<string, unknown>).normalizedValue)
        : undefined;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

class HardwareStore {
  declare _handleAmbientLight: (event: Event) => void;
  declare ambientLightValue: number;
  declare dialPressed: boolean;
  declare rebooting: boolean;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  declare _wsCleanup: () => void;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    this.dialPressed = false;
    this.rebooting = false;
    this.ambientLightValue = 0;

    makeAutoObservable(this, {
      rootStore: false,
      _wsCleanup: false,
    });

    this._handleAmbientLight = (e) => {
      if (!(e instanceof CustomEvent)) return;
      const detail: unknown = e.detail;
      if (
        detail &&
        typeof detail === "object" &&
        "value" in detail &&
        typeof detail.value === "number"
      ) {
        this.ambientLightValue = detail.value;
      }
    };
    window.addEventListener("ambientLightUpdate", this._handleAmbientLight);
    this._wsCleanup = addGlobalWsListener("mockingbird-ambient-light", {
      onMessage: (message) => {
        const value = ambientLightFromMessage(message);
        if (value !== null) this.setAmbientLightValue(value);
      },
    });
  }

  setDialPressed(dialPressed: boolean) {
    this.dialPressed = dialPressed;
  }

  setRebooting(rebooting: boolean) {
    this.rebooting = rebooting;
  }

  setAmbientLightValue(value: number) {
    this.ambientLightValue = value;
  }

  get isDialPressed() {
    return this.dialPressed;
  }

  get isRebooting() {
    return this.rebooting;
  }

  get currentAmbientLight() {
    return this.ambientLightValue;
  }

  async reboot() {
    this.setRebooting(true);
    try {
      const { sendNocturneWsRequest } =
        await import("../../../hooks/useNocturned");
      /** @type {import("@schema/device").DevicePowerRebootRequest} */
      const request = {};
      await sendNocturneWsRequest("device.power.reboot", request);
    } catch (e) {
      console.error("Reboot failed:", e);
      this.setRebooting(false);
    }
  }

  async factoryReset() {
    try {
      const { sendNocturneWsRequest } =
        await import("../../../hooks/useNocturned");
      /** @type {import("@schema/device").DeviceFactoryResetRequest} */
      const request = {};
      await sendNocturneWsRequest("device.factoryreset", request);
    } catch (e) {
      console.error("Factory reset failed:", e);
    }
  }

  async powerOff() {
    try {
      const { sendNocturneWsRequest } =
        await import("../../../hooks/useNocturned");
      /** @type {import("@schema/device").DevicePowerOffRequest} */
      const request = {};
      await sendNocturneWsRequest("device.power.off", request);
    } catch (e) {
      console.error("Power off failed:", e);
    }
  }

  reset() {
    this.dialPressed = false;
    this.rebooting = false;
    this.ambientLightValue = 0;
  }

  dispose() {
    window.removeEventListener("ambientLightUpdate", this._handleAmbientLight);
    this._wsCleanup();
  }
}

export default HardwareStore;
