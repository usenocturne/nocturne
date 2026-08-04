import { describe, expect, it } from "bun:test";
import deviceWireSnapshot from "../../test/wire_snapshots/device.json";
import {
  createBluetoothDiscoveryCoordinator,
  getBtReconnectState,
  getWsRequestError,
  getBluetoothPairingUiUpdate,
  getBluetoothPresentationState,
  hasConnectedMacosConnector,
  isConnectResponsePending,
  isConnectorPlatform,
  isMacosConnectorDevice,
  mergeAppEntitlementUpdate,
  normalizeAppEntitlementState,
  normalizeDeviceInfoResponse,
  normalizeDeviceVersionResponse,
  markBtReconnectSocketClosed,
  scheduleInitialBtReconnect,
  shouldAutomaticallyReconnectPlatform,
  stopBtReconnect,
} from "./useNocturned";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("Bluetooth pairing presentation", () => {
  it("keeps the disconnected device screen mounted behind a PIN overlay", () => {
    expect(
      getBluetoothPresentationState({
        showTutorial: false,
        pairingRequest: { pairingKey: "123456" },
        showTetheringScreen: false,
        hasActiveSession: false,
        hasFetchedInitialDevices: true,
        isReconnectPending: false,
        showExhaustedReconnectScreen: false,
      }),
    ).toEqual({
      showConnectionLostScreen: true,
      showPairingOverlay: true,
    });
  });

  it("keeps Now Playing visible during a cold-start reconnect", () => {
    expect(
      getBluetoothPresentationState({
        showTutorial: false,
        pairingRequest: null,
        showTetheringScreen: false,
        hasActiveSession: false,
        hasFetchedInitialDevices: true,
        isReconnectPending: true,
        showExhaustedReconnectScreen: false,
      }),
    ).toEqual({
      showConnectionLostScreen: false,
      showPairingOverlay: false,
    });
  });

  it("shows Phone Disconnected after startup reconnect exhaustion", () => {
    expect(
      getBluetoothPresentationState({
        showTutorial: false,
        pairingRequest: null,
        showTetheringScreen: false,
        hasActiveSession: false,
        hasFetchedInitialDevices: true,
        isReconnectPending: true,
        showExhaustedReconnectScreen: true,
      }),
    ).toEqual({
      showConnectionLostScreen: true,
      showPairingOverlay: false,
    });
  });

  it("clears both canonical and legacy pairing success events", () => {
    expect(
      getBluetoothPairingUiUpdate("bluetooth.pairing", {
        event: "paired",
      }),
    ).toEqual({ action: "clear" });
    expect(
      getBluetoothPairingUiUpdate("bluetooth.pairing", {
        type: "pairing_succeeded",
      }),
    ).toEqual({ action: "clear" });
  });

  it("clears cancelled agent prompts without treating generic links as ready", () => {
    expect(
      getBluetoothPairingUiUpdate("bluetooth.agent", { event: "cancel" }),
    ).toEqual({ action: "clear" });
    expect(
      getBluetoothPairingUiUpdate("bluetooth.device", {
        event: "connected",
      }),
    ).toBeNull();
  });
});

describe("Bluetooth reconnect presentation lifecycle", () => {
  it("publishes pending state during the cold-start reconnect delay", () => {
    scheduleInitialBtReconnect("AA:BB:CC:DD:EE:FF");

    expect(getBtReconnectState().pending).toBe(true);
    stopBtReconnect();
  });

  it("clears pending state when there is no saved reconnect target", () => {
    scheduleInitialBtReconnect(null);

    expect(getBtReconnectState().pending).toBe(false);
  });

  it("keeps Now Playing mounted across a daemon socket interruption", () => {
    stopBtReconnect();
    markBtReconnectSocketClosed("AA:BB:CC:DD:EE:FF");

    expect(getBtReconnectState().pending).toBe(true);
    stopBtReconnect();
  });
});

describe("Bluetooth discovery coordinator", () => {
  it("opens for the first owner and closes after the final release", async () => {
    const transitions = [];
    const coordinator = createBluetoothDiscoveryCoordinator(async (enabled) => {
      transitions.push(enabled);
    });
    const first = Symbol("first");
    const second = Symbol("second");

    await coordinator.acquire(first);
    await coordinator.acquire(second);
    await coordinator.release(first);
    expect(transitions).toEqual([true]);

    await coordinator.release(second);
    expect(transitions).toEqual([true, false]);
  });

  it("closes a stale pairing window on an ownerless initial connection", async () => {
    const transitions = [];
    const coordinator = createBluetoothDiscoveryCoordinator(async (enabled) => {
      transitions.push(enabled);
    });

    await coordinator.connected();

    expect(transitions).toEqual([false]);
  });

  it("preserves a new owner across an in-flight release", async () => {
    const transitions = [];
    const enable = deferred();
    const coordinator = createBluetoothDiscoveryCoordinator(async (enabled) => {
      transitions.push(enabled);
      if (enabled && transitions.length === 1) await enable.promise;
    });
    const first = Symbol("first");
    const second = Symbol("second");

    const opening = coordinator.acquire(first);
    await Promise.resolve();
    const closing = coordinator.release(first);
    const reopening = coordinator.acquire(second);
    enable.resolve();
    await Promise.all([opening, closing, reopening]);

    expect(transitions).toEqual([true]);
    await coordinator.release(second);
    expect(transitions).toEqual([true, false]);
  });

  it("reapplies an active lease after a WebSocket reconnect", async () => {
    const transitions = [];
    const coordinator = createBluetoothDiscoveryCoordinator(async (enabled) => {
      transitions.push(enabled);
    });
    const owner = Symbol("owner");

    await coordinator.acquire(owner);
    coordinator.disconnected();
    await coordinator.connected();

    expect(transitions).toEqual([true, true]);
  });

  it("retries a failed transition after reconnect", async () => {
    const transitions = [];
    let fail = true;
    const coordinator = createBluetoothDiscoveryCoordinator(async (enabled) => {
      transitions.push(enabled);
      if (fail) {
        fail = false;
        throw new Error("socket closed");
      }
    });
    const owner = Symbol("owner");

    await expect(coordinator.acquire(owner)).rejects.toThrow("socket closed");
    coordinator.disconnected();
    await coordinator.connected();

    expect(transitions).toEqual([true, true]);
  });
});

describe("app entitlement normalization", () => {
  it("reads canonical daemon fields", () => {
    expect(
      normalizeAppEntitlementState({
        subscribed: true,
        subscription_status: "none",
        has_lifetime: true,
        is_admin: true,
        entitlements_verified: true,
      }),
    ).toEqual({
      subscribed: true,
      status: "none",
      hasLifetime: true,
      isAdmin: true,
      entitlementsVerified: true,
    });
  });

  it("reads compatible companion camel-case fields", () => {
    expect(
      normalizeAppEntitlementState({
        subscribed: true,
        subscriptionStatus: "trialing",
        hasLifetime: false,
        isAdmin: false,
        entitlementsVerified: true,
      }),
    ).toEqual({
      subscribed: true,
      status: "trialing",
      hasLifetime: false,
      isAdmin: false,
      entitlementsVerified: true,
    });
  });

  it("fails closed when admin verification fields are missing", () => {
    expect(
      normalizeAppEntitlementState({
        subscribed: true,
        subscription_status: "active",
      }),
    ).toMatchObject({ isAdmin: false, entitlementsVerified: false });
  });

  it("preserves fields omitted by partial subscription updates", () => {
    const current = normalizeAppEntitlementState({
      subscribed: true,
      subscription_status: "none",
      has_lifetime: true,
      is_admin: true,
      entitlements_verified: true,
    });

    expect(mergeAppEntitlementUpdate(current, { has_lifetime: false })).toEqual(
      {
        subscribed: true,
        status: "none",
        hasLifetime: false,
        isAdmin: true,
        entitlementsVerified: true,
      },
    );
  });
});

describe("device info normalization", () => {
  it("normalizes the daemon's canonical snake_case fields", () => {
    const response = deviceWireSnapshot["device.info"].response;

    expect(normalizeDeviceInfoResponse(response)).toMatchObject({
      device: "Nocturne (1234)",
      version: "2.0.5+20260727010101",
      fullVersion: "2.0.5+20260727010101",
      imageVersion: "2.0.4+20260726010101",
      bandaidVersion: "2.0.5+20260727010101",
      buildDate: "2026-05-28",
      gitHash: "abc123",
      serialNumber: "SERIAL1234",
    });
  });

  it("normalizes each OTA version lane from snake_case fields", () => {
    const response = deviceWireSnapshot["device.version"].response;

    expect(normalizeDeviceVersionResponse(response)).toEqual({
      version: "4.1.1+20260727010101",
      shortVersion: "4.1.1+20260727010101",
      imageVersion: "4.1.0+20260726010101",
      bandaidVersion: "4.1.1+20260727010101",
    });
  });

  it("keeps camelCase fields from compatible daemon versions", () => {
    expect(
      normalizeDeviceInfoResponse({
        serialNumber: "camel",
        serial_number: "snake",
      }),
    ).toMatchObject({ serialNumber: "camel" });
  });
});

describe("Bluetooth connect responses", () => {
  it("automatically reconnects every remembered phone platform", () => {
    expect(shouldAutomaticallyReconnectPlatform("android")).toBe(true);
    expect(shouldAutomaticallyReconnectPlatform("ios")).toBe(true);
    expect(shouldAutomaticallyReconnectPlatform("macos")).toBe(true);
    expect(shouldAutomaticallyReconnectPlatform(null)).toBe(true);
  });

  it("keeps every asynchronous platform handoff in the settling state", () => {
    expect(isConnectResponsePending({ status: "waiting_for_ios" })).toBe(true);
    expect(
      isConnectResponsePending({ status: "waiting_for_macos_connector" }),
    ).toBe(true);
    expect(isConnectResponsePending({ status: "waiting_for_android" })).toBe(
      true,
    );
  });

  it("does not treat terminal or unknown responses as pending", () => {
    expect(isConnectResponsePending({ status: "connected" })).toBe(false);
    expect(isConnectResponsePending({ status: "failed" })).toBe(false);
    expect(isConnectResponsePending()).toBe(false);
  });
});

describe("phone presentation connector detection", () => {
  it("recognizes Pi and macOS app-ready platforms", () => {
    expect(isConnectorPlatform("web")).toBe(true);
    expect(isConnectorPlatform("macos")).toBe(true);
    expect(isConnectorPlatform("ios")).toBe(false);
    expect(isConnectorPlatform("android")).toBe(false);
    expect(isConnectorPlatform(null)).toBe(false);
  });

  it("accepts daemon snake-case and compatible camel-case Mac metadata", () => {
    expect(isMacosConnectorDevice({ device_type: "macos_connector" })).toBe(
      true,
    );
    expect(isMacosConnectorDevice({ connectionType: "macos_connector" })).toBe(
      true,
    );
    expect(isMacosConnectorDevice({ device_type: "iphone" })).toBe(false);
  });

  it("locks only for an actively connected annotated Mac", () => {
    expect(
      hasConnectedMacosConnector([
        {
          address: "AA:BB",
          connected: false,
          device_type: "macos_connector",
        },
        { address: "CC:DD", connected: true, device_type: "iphone" },
      ]),
    ).toBe(false);
    expect(
      hasConnectedMacosConnector([
        { address: "AA:BB", connected: true, isConnector: true },
      ]),
    ).toBe(true);
  });
});

describe("WebSocket request errors", () => {
  it("surfaces native daemon error frames immediately", () => {
    const message = {
      type: "error",
      id: "call-action",
      error: "Call is no longer ringing",
    };

    expect(getWsRequestError(message, message)).toBe(
      "Call is no longer ringing",
    );
  });

  it("preserves response-wrapped errors from compatible daemons", () => {
    expect(
      getWsRequestError(
        { type: "response", id: "legacy-call-action" },
        { error: { message: "Phone unavailable" } },
      ),
    ).toBe("Phone unavailable");
  });

  it("does not reject successful responses", () => {
    expect(
      getWsRequestError(
        { type: "response", id: "call-action" },
        { status: "ok" },
      ),
    ).toBeNull();
  });
});
