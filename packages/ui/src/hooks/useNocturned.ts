import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { useUpdateCheck } from "./useUpdateCheck";
import type { BluetoothDevice, PairingRequest, WsMessage } from "../types";

type Listener<T> = (state: T) => void;
type AppReadyState = {
  ready: boolean;
  platform: string | null;
  generation: number;
};
type SubscribedState = {
  subscribed: boolean;
  status: string | null;
  hasLifetime: boolean;
  isAdmin: boolean;
  entitlementsVerified: boolean;
};
type BluetoothConnectionSnapshot = {
  connected: boolean;
  devices: Array<
    Pick<BluetoothDevice, "address" | "connected"> & { isConnector: boolean }
  >;
};
type BluetoothDevicesListResponse = {
  payload?: BluetoothDevice[];
  result?: {
    payload?: BluetoothDevice[];
  };
};
type BluetoothPairingUiUpdate =
  | { action: "show"; request: PairingRequest }
  | { action: "clear" }
  | null;
type BluetoothPresentationStateOptions = {
  showTutorial: boolean;
  pairingRequest: PairingRequest | null;
  showTetheringScreen: boolean;
  hasActiveSession: boolean;
  hasFetchedInitialDevices: boolean;
  isReconnectPending: boolean;
  showExhaustedReconnectScreen: boolean;
};
type GlobalWsListener = {
  id: string;
  onMessage?: (data: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
};
type PendingWsRequest<T = UiLooseData> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  method: string;
};
type ConnectQueueEntry = {
  deviceAddress: string;
  options: Record<string, unknown>;
  resolve: (value) => void;
  reject: (reason?: unknown) => void;
};
type BluetoothDiscoverySender = (discoverable: boolean) => Promise<void>;

export const createBluetoothDiscoveryCoordinator = (
  send: BluetoothDiscoverySender,
) => {
  const owners = new Set<symbol>();
  let desired = false;
  let applied: boolean | null = null;
  let transition: Promise<void> = Promise.resolve();

  const reconcile = () => {
    transition = transition
      .catch(() => undefined)
      .then(async () => {
        while (applied !== desired) {
          const next = desired;
          await send(next);
          applied = next;
        }
      });
    return transition;
  };

  return {
    acquire(owner: symbol) {
      owners.add(owner);
      desired = true;
      return reconcile();
    },
    release(owner: symbol) {
      if (!owners.delete(owner)) return transition;
      desired = owners.size > 0;
      return reconcile();
    },
    disconnected() {
      applied = null;
    },
    connected() {
      return reconcile();
    },
  };
};

const API_BASE = "http://localhost:5000";

/** @typedef {import("@schema/bt_only").AppReadyEvent} AppReadyEvent */
/** @typedef {import("@schema/bt_only").SubscriptionUpdatedEvent} SubscriptionUpdatedEvent */
/** @typedef {import("@schema/bt_only").NetworkStatusEvent} NetworkStatusEvent */
/** @typedef {import("@schema/bt_only").NotificationShowEvent} NotificationShowEvent */

const firstDefined = (...values: unknown[]) =>
  values.find((value) => value !== undefined);

const asUnknownRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

export const normalizeAppEntitlementState = (
  value: unknown,
): SubscribedState => {
  const data = asUnknownRecord(value) ?? {};
  const status = firstDefined(
    data.subscriptionStatus,
    data.subscription_status,
  );
  const hasLifetime = firstDefined(data.hasLifetime, data.has_lifetime);
  const isAdmin = firstDefined(data.isAdmin, data.is_admin);
  const entitlementsVerified = firstDefined(
    data.entitlementsVerified,
    data.entitlements_verified,
  );

  return {
    subscribed: data.subscribed === true,
    status: typeof status === "string" && status.length > 0 ? status : null,
    hasLifetime: hasLifetime === true,
    isAdmin: isAdmin === true,
    entitlementsVerified: entitlementsVerified === true,
  };
};

export const mergeAppEntitlementUpdate = (
  current: SubscribedState,
  value: unknown,
): SubscribedState => {
  const data = asUnknownRecord(value) ?? {};
  const status = firstDefined(
    data.subscriptionStatus,
    data.subscription_status,
  );
  const hasLifetime = firstDefined(data.hasLifetime, data.has_lifetime);
  const isAdmin = firstDefined(data.isAdmin, data.is_admin);
  const entitlementsVerified = firstDefined(
    data.entitlementsVerified,
    data.entitlements_verified,
  );

  return {
    subscribed: Object.prototype.hasOwnProperty.call(data, "subscribed")
      ? data.subscribed === true
      : current.subscribed,
    status:
      status === undefined
        ? current.status
        : typeof status === "string" && status.length > 0
          ? status
          : null,
    hasLifetime:
      hasLifetime === undefined ? current.hasLifetime : hasLifetime === true,
    isAdmin: isAdmin === undefined ? current.isAdmin : isAdmin === true,
    entitlementsVerified:
      entitlementsVerified === undefined
        ? current.entitlementsVerified
        : entitlementsVerified === true,
  };
};

export const getWsRequestError = (
  message: WsMessage,
  result: unknown,
): string | null => {
  const resultError = asUnknownRecord(result)?.error;
  const error = message.type === "error" ? message.error : resultError;
  const candidate = error ?? message.error;
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate === "string") return candidate;
  const detail = asUnknownRecord(candidate)?.message;
  return typeof detail === "string" ? detail : "Request failed";
};

export const normalizeDeviceInfoResponse = (
  info: UiLooseData | null | undefined,
): UiLooseData | null => {
  if (!info) return null;

  return {
    ...info,
    fullVersion: info.fullVersion ?? info.full_version,
    imageVersion: info.imageVersion ?? info.image_version,
    bandaidVersion: info.bandaidVersion ?? info.bandaid_version,
    buildDate: info.buildDate ?? info.build_date,
    gitHash: info.gitHash ?? info.git_hash,
    serialNumber: info.serialNumber ?? info.serial_number,
  };
};

const cleanDeviceVersion = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const version = value.trim().replace(/^v/, "");
  return version || null;
};

export const normalizeDeviceVersionResponse = (
  info: UiLooseData | null | undefined,
) => ({
  version: cleanDeviceVersion(info?.version),
  shortVersion: cleanDeviceVersion(info?.shortVersion ?? info?.short_version),
  imageVersion: cleanDeviceVersion(info?.imageVersion ?? info?.image_version),
  bandaidVersion: cleanDeviceVersion(
    info?.bandaidVersion ?? info?.bandaid_version,
  ),
});

export const isConnectorPlatform = (platform: string | null | undefined) =>
  platform === "web" || platform === "macos";

export const shouldAutomaticallyReconnectPlatform = (
  _platform: string | null | undefined,
) => true;

export const getBluetoothPairingUiUpdate = (
  topic: unknown,
  value: unknown,
): BluetoothPairingUiUpdate => {
  const event = asUnknownRecord(value) ?? {};

  if (topic === "bluetooth.agent") {
    if (event.event === "cancel" || event.event === "release") {
      return { action: "clear" };
    }

    if (event.type === "bluetooth_pin" || event.event === "request_pin_code") {
      const pin = firstDefined(event.pin, event.pincode);
      return {
        action: "show",
        request: {
          pairingKey: typeof pin === "string" ? pin : "",
          address:
            typeof event.address === "string" ? event.address : undefined,
          name: typeof event.name === "string" ? event.name : undefined,
        },
      };
    }
  }

  if (
    topic === "bluetooth.pairing" &&
    (event.type === "pairing_succeeded" || event.event === "paired")
  ) {
    return { action: "clear" };
  }

  return null;
};

export const getBluetoothPresentationState = ({
  showTutorial,
  pairingRequest,
  showTetheringScreen,
  hasActiveSession,
  hasFetchedInitialDevices,
  isReconnectPending,
  showExhaustedReconnectScreen,
}: BluetoothPresentationStateOptions) => ({
  showConnectionLostScreen:
    !showTutorial &&
    ((!hasActiveSession && hasFetchedInitialDevices && !isReconnectPending) ||
      showExhaustedReconnectScreen),
  showPairingOverlay:
    !showTetheringScreen && !showTutorial && pairingRequest !== null,
});

export const isMacosConnectorDevice = (
  device: BluetoothDevice | null | undefined,
) => {
  if (!device) return false;
  const connectionTypes = [
    device.device_type,
    device.deviceType,
    device.connection_type,
    device.connectionType,
  ];
  return connectionTypes.some(
    (value) =>
      typeof value === "string" && value.toLowerCase() === "macos_connector",
  );
};

export const hasConnectedMacosConnector = (devices: BluetoothDevice[] = []) =>
  devices.some(
    (device) =>
      device?.connected === true &&
      (device.isConnector === true || isMacosConnectorDevice(device)),
  );

const generateUUID = () => crypto.randomUUID();

let globalWsRef: WebSocket | null = null;
let globalWsListeners: GlobalWsListener[] = [];
let wsInitialized = false;
const pendingWsRequests = new Map<string, PendingWsRequest>();
let appReady = false;
let appReadyPlatform: string | null = null; // ios, android, web, or macos
let appReadyGeneration = 0;
const appReadySubscribers = new Set<Listener<AppReadyState>>();
let appSubscribed = true;
let appSubscriptionStatus: string | null = null;
let appHasLifetime = true;
let appIsAdmin = false;
let appEntitlementsVerified = false;
const appSubscribedSubscribers = new Set<Listener<SubscribedState>>();
let spotifyAuthenticated = false;
const spotifyAuthSubscribers = new Set<Listener<boolean>>();
let spotifySkipped = false;
const spotifySkippedSubscribers = new Set<Listener<boolean>>();

let wsReconnectAttempts = 0;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectInProgress = false;
const WS_RECONNECT_BASE_INTERVAL = 1000;
const WS_RECONNECT_MAX_INTERVAL = 30000;

let isDevicesFetching = false;
let pendingDevicesFetchPromise: Promise<UiLooseData> | null = null;
let pendingDevicesListWsPromise: Promise<UiLooseData> | null = null;
let lastDevicesListCache: { resp: UiLooseData; timestamp: number } | null =
  null;
const DEVICES_LIST_CACHE_TTL_MS = 3000;
let isConnectRequestInProgress = false;
let connectRequestQueue: ConnectQueueEntry[] = [];

let bluetoothConnectionState: BluetoothConnectionSnapshot = {
  connected: false,
  devices: [],
};

let reconnectionExhausted = false;
let manualDisconnectInProgress = false;

const bluetoothConnectionSubscribers = new Set<
  Listener<BluetoothConnectionSnapshot>
>();
let btReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let btReconnectAttempts = 0;
let btReconnectInProgress = false;
let btReconnectCancelled = false;
let btReconnectPending = false;
const BT_RECONNECT_BASE_INTERVAL = 2000;
const BT_RECONNECT_MAX_INTERVAL = 60000;
const BT_RECONNECT_INITIAL_DELAY = 1000;
const BT_RECONNECT_EXP_CAP = 30;
const btReconnectSubscribers = new Set<Listener<UiLooseData>>();
const BT_RECONNECT_SETTLE_MS = 5000;
const BT_RECONNECT_WATCHDOG_MS = 10000;
let btReconnectSettleTimer: ReturnType<typeof setTimeout> | null = null;
let btReconnectSettleDevice: string | null = null;
let btReconnectSettleStartedAt = 0;
let btReconnectWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let btReconnectCycleSignature: string | null = null;
let btReconnectCycle: string[] = [];
let btReconnectCycleIndex = 0;
const btConnectionTypeByDevice = new Map<string, string>();
let lastAppReadyAt = 0;
const btActiveSessions = new Set<string>();
let lastBtSessionClosedAt = 0;
let lastBtLinkDownAt = 0;
let appLaunchRequested = false;
const APP_RELAUNCH_NEW_DRIVE_GAP_MS = 600000;
const DEVICE_PLATFORM_STORAGE_PREFIX = "nocturneBluetoothPlatform:";

const devicePlatformStorageKey = (address: string) =>
  `${DEVICE_PLATFORM_STORAGE_PREFIX}${address.toUpperCase()}`;

const rememberDevicePlatform = (address: string, platform: string) => {
  localStorage.setItem(devicePlatformStorageKey(address), platform);
};

const getRememberedDevicePlatform = (address: string) =>
  localStorage.getItem(devicePlatformStorageKey(address));

const activeAddressForPlatform = (platform: string) => {
  const expectedConnectionType =
    platform === "ios" ? "iap2" : platform === "android" ? "spp" : null;
  const candidates = [...btActiveSessions].filter(
    (address) =>
      expectedConnectionType === null ||
      btConnectionTypeByDevice.get(address) === expectedConnectionType,
  );
  if (candidates.length === 1) return candidates[0];

  const lastAddress = localStorage.getItem("lastConnectedBluetoothDevice");
  if (candidates.length === 0) return lastAddress;
  return lastAddress && candidates.includes(lastAddress) ? lastAddress : null;
};

const rememberActiveDevicePlatform = (platform: string | null) => {
  if (!platform) return;
  const activeAddress = activeAddressForPlatform(platform);
  if (activeAddress) rememberDevicePlatform(activeAddress, platform);
};

const hasLiveBtSessionEvidence = (address: string) =>
  btActiveSessions.has(address) ||
  (lastAppReadyAt > 0 && lastAppReadyAt >= lastBtSessionClosedAt);

const getDevicesFromListResponse = (
  resp: BluetoothDevicesListResponse | UiLooseData | null | undefined,
): BluetoothDevice[] => {
  const response = resp as BluetoothDevicesListResponse | null | undefined;
  return response?.payload || response?.result?.payload || [];
};

const findDeviceByAddress = (
  devices: BluetoothDevice[],
  address: string | null,
): BluetoothDevice | null =>
  (Array.isArray(devices) ? devices : []).find(
    (device) => device?.address === address,
  ) || null;

const getDeviceConnectOptions = (
  device: BluetoothDevice | null,
): Record<string, unknown> => {
  if (!device) {
    return {};
  }

  const options: Record<string, unknown> = {};
  const channel = Number(device.channel);
  if (Number.isInteger(channel) && channel > 0) {
    options.channel = channel;
  }

  const deviceType = device.device_type || device.deviceType;
  if (deviceType) {
    options.device_type = deviceType;
  }

  return options;
};

const getReconnectableDeviceAddresses = (devices: BluetoothDevice[] = []) => {
  const seen = new Set<string>();
  const addresses: string[] = [];

  (Array.isArray(devices) ? devices : []).forEach((device) => {
    const address = device?.address;
    if (!address || address === "unknown" || seen.has(address)) {
      return;
    }
    seen.add(address);
    addresses.push(address);
  });

  return addresses;
};

const buildBtReconnectCycle = (
  devices: BluetoothDevice[],
  lastDeviceAddress: string | null,
) => {
  const addresses = getReconnectableDeviceAddresses(devices);
  const signatureAddresses = [...addresses].sort();
  const lastDeviceIsReconnectable =
    !!lastDeviceAddress && addresses.includes(lastDeviceAddress);
  const cycle = lastDeviceIsReconnectable
    ? [
        lastDeviceAddress,
        lastDeviceAddress,
        ...addresses.filter((address) => address !== lastDeviceAddress),
      ]
    : addresses;

  return {
    cycle,
    signature: `${lastDeviceAddress || ""}|${signatureAddresses.join("|")}`,
  };
};

const resetBtReconnectCycle = () => {
  btReconnectCycleSignature = null;
  btReconnectCycle = [];
  btReconnectCycleIndex = 0;
};

const getNextBtReconnectAddress = (
  devices: BluetoothDevice[],
  lastDeviceAddress: string | null,
) => {
  const { cycle, signature } = buildBtReconnectCycle(
    devices,
    lastDeviceAddress,
  );

  if (btReconnectCycleSignature !== signature) {
    btReconnectCycleSignature = signature;
    btReconnectCycle = cycle;
    btReconnectCycleIndex = 0;
  } else if (btReconnectCycle.length === 0) {
    btReconnectCycle = cycle;
  }

  if (btReconnectCycleIndex >= btReconnectCycle.length) {
    btReconnectCycleIndex = 0;
  }

  if (btReconnectCycle.length === 0) {
    return null;
  }

  const address = btReconnectCycle[btReconnectCycleIndex];
  btReconnectCycleIndex = (btReconnectCycleIndex + 1) % btReconnectCycle.length;
  return address;
};

const normalizeDevicesForState = (devices: BluetoothDevice[] = []) =>
  (Array.isArray(devices) ? devices : []).map((device) => ({
    address: device?.address,
    connected: Boolean(device?.connected),
    isConnector: isMacosConnectorDevice(device),
  }));

const didBluetoothStateChange = (
  nextDevices: BluetoothConnectionSnapshot["devices"],
) => {
  const prev = bluetoothConnectionState.devices;
  if (prev.length !== nextDevices.length) return true;
  for (let i = 0; i < nextDevices.length; i += 1) {
    if (
      prev[i]?.address !== nextDevices[i]?.address ||
      Boolean(prev[i]?.connected) !== Boolean(nextDevices[i]?.connected) ||
      prev[i]?.isConnector !== nextDevices[i]?.isConnector
    ) {
      return true;
    }
  }
  return (
    bluetoothConnectionState.connected !==
    nextDevices.some((device) => device.connected)
  );
};

const emitBluetoothConnectionState = () => {
  bluetoothConnectionSubscribers.forEach((listener) => {
    try {
      listener({ ...bluetoothConnectionState });
    } catch (err) {
      console.error("Bluetooth connection listener error:", err);
    }
  });
};

const updateBluetoothConnectionState = (devices: BluetoothDevice[] = []) => {
  const normalized = normalizeDevicesForState(devices);
  if (!didBluetoothStateChange(normalized)) {
    return;
  }

  bluetoothConnectionState = {
    connected: normalized.some((device) => device.connected),
    devices: normalized,
  };

  emitBluetoothConnectionState();
};

export const getBluetoothConnectionState = () => ({
  ...bluetoothConnectionState,
});

export const isReconnectionExhausted = () => reconnectionExhausted;

export const resetReconnectionExhausted = () => {
  reconnectionExhausted = false;
};

export const getAppReadyState = () => ({
  ready: appReady,
  platform: appReadyPlatform,
  generation: appReadyGeneration,
});

const emitAppReadyState = () => {
  appReadySubscribers.forEach((listener) => {
    try {
      listener({
        ready: appReady,
        platform: appReadyPlatform,
        generation: appReadyGeneration,
      });
    } catch (err) {
      console.error("App ready listener error:", err);
    }
  });
};

export const subscribeAppReadyState = (listener: Listener<AppReadyState>) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  appReadySubscribers.add(listener);
  listener({
    ready: appReady,
    platform: appReadyPlatform,
    generation: appReadyGeneration,
  });

  return () => {
    appReadySubscribers.delete(listener);
  };
};

export const getAppSubscribedState = () => ({
  subscribed: appSubscribed,
  status: appSubscriptionStatus,
  hasLifetime: appHasLifetime,
  isAdmin: appIsAdmin,
  entitlementsVerified: appEntitlementsVerified,
});

const emitAppSubscribedState = () => {
  appSubscribedSubscribers.forEach((listener) => {
    try {
      listener({
        subscribed: appSubscribed,
        status: appSubscriptionStatus,
        hasLifetime: appHasLifetime,
        isAdmin: appIsAdmin,
        entitlementsVerified: appEntitlementsVerified,
      });
    } catch (err) {
      console.error("App subscribed listener error:", err);
    }
  });
};

export const subscribeAppSubscribedState = (
  listener: Listener<SubscribedState>,
) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  appSubscribedSubscribers.add(listener);
  listener({
    subscribed: appSubscribed,
    status: appSubscriptionStatus,
    hasLifetime: appHasLifetime,
    isAdmin: appIsAdmin,
    entitlementsVerified: appEntitlementsVerified,
  });

  return () => {
    appSubscribedSubscribers.delete(listener);
  };
};

export const getSpotifyAuthState = () => spotifyAuthenticated;

const emitSpotifyAuthState = () => {
  spotifyAuthSubscribers.forEach((listener) => {
    try {
      listener(spotifyAuthenticated);
    } catch (err) {
      console.error("Spotify auth listener error:", err);
    }
  });
};

export const subscribeSpotifyAuthState = (listener: Listener<boolean>) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  spotifyAuthSubscribers.add(listener);
  listener(spotifyAuthenticated);

  return () => {
    spotifyAuthSubscribers.delete(listener);
  };
};

export const getSpotifySkippedState = () => spotifySkipped;

const emitSpotifySkippedState = () => {
  spotifySkippedSubscribers.forEach((listener) => {
    try {
      listener(spotifySkipped);
    } catch (err) {
      console.error("Spotify skipped listener error:", err);
    }
  });
};

export const subscribeSpotifySkippedState = (listener: Listener<boolean>) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  spotifySkippedSubscribers.add(listener);
  listener(spotifySkipped);

  return () => {
    spotifySkippedSubscribers.delete(listener);
  };
};

export const subscribeBluetoothConnectionState = (
  listener: Listener<BluetoothConnectionSnapshot>,
) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  bluetoothConnectionSubscribers.add(listener);

  listener({ ...bluetoothConnectionState });

  return () => {
    bluetoothConnectionSubscribers.delete(listener);
  };
};

const clearConnectQueue = () => {
  while (connectRequestQueue.length > 0) {
    const pendingRequest = connectRequestQueue.shift();
    pendingRequest.reject(
      new Error("Connection already established to another device"),
    );
  }
};

const cleanupWsReconnection = () => {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  wsReconnectAttempts = 0;
  wsReconnectInProgress = false;
};

export const cleanupGlobalWebSocket = () => {
  cleanupWsReconnection();
  clearBtReconnectWatchdog();
  clearBtReconnectSettle();
  resetBtReconnectCycle();
  if (globalWsRef) {
    globalWsRef.close(1000);
    globalWsRef = null;
  }
  wsInitialized = false;
};

export const getGlobalWebSocket = () => globalWsRef;

export const addGlobalWsListener = (
  id: string,
  handlers: Omit<GlobalWsListener, "id">,
) => {
  const listener: GlobalWsListener = {
    id,
    ...handlers,
  };
  globalWsListeners.push(listener);

  if (!wsInitialized) {
    setupGlobalWebSocket();
    wsInitialized = true;
  }

  return () => {
    globalWsListeners = globalWsListeners.filter((l) => l.id !== id);
  };
};

let retryIsCancelled = false;
let isNetworkPollingActive = false;
let otaApplyTriggered = false;

const queueConnectRequest = async (
  deviceAddress: string,
  options: Record<string, unknown> = {},
) => {
  return new Promise<UiLooseData>((resolve, reject) => {
    const cachedDevice = findDeviceByAddress(
      getDevicesFromListResponse(lastDevicesListCache?.resp),
      deviceAddress,
    );
    const inferredOptions = getDeviceConnectOptions(cachedDevice);
    const request = {
      deviceAddress,
      options: {
        ...inferredOptions,
        ...options,
      },
      resolve,
      reject,
    };

    connectRequestQueue.push(request);
    processConnectQueue();
  });
};

const processConnectQueue = async () => {
  if (isConnectRequestInProgress || connectRequestQueue.length === 0) {
    return;
  }

  isConnectRequestInProgress = true;
  const request = connectRequestQueue.shift();

  try {
    let result;
    try {
      const options = request.options || {};
      /** @type {import("@schema/bluetooth").BluetoothDeviceConnectRequest} */
      const connectRequest = {
        address: request.deviceAddress,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.device_type ? { device_type: options.device_type } : {}),
      };
      result = await sendWsRequest("bluetooth.device.connect", connectRequest);
    } catch (err) {
      result = { error: err?.message || "Connection failed" };
    }

    let connectionSuccessful = false;
    if (result && result.status === "connected") {
      connectionSuccessful = true;
      while (connectRequestQueue.length > 0) {
        const pendingRequest = connectRequestQueue.shift();
        pendingRequest.reject(
          new Error("Connection already established to another device"),
        );
      }
    }

    const facade = {
      ok: !result?.error,
      json: async () => ({
        connected: connectionSuccessful,
        ...(result || {}),
      }),
    };
    request.resolve(facade);

    if (!connectionSuccessful && connectRequestQueue.length > 0) {
      setTimeout(processConnectQueue, 100);
    }
  } catch (error) {
    request.reject(error);
    if (connectRequestQueue.length > 0) {
      setTimeout(processConnectQueue, 100);
    }
  } finally {
    isConnectRequestInProgress = false;
  }
};

const readConnectResponseJson = async (response) => {
  if (!response || typeof response.json !== "function") {
    return {};
  }
  return response.json().catch(() => ({}));
};

const isConnectResponseConnected = (data) =>
  data?.connected === true || data?.status === "connected";

export const isConnectResponsePending = (data) =>
  data?.status === "waiting_for_ios" ||
  data?.status === "waiting_for_macos_connector" ||
  data?.status === "waiting_for_android";

const attemptWsReconnection = () => {
  if (wsReconnectInProgress) {
    return;
  }

  wsReconnectInProgress = true;
  wsReconnectAttempts++;

  const delay = Math.min(
    WS_RECONNECT_BASE_INTERVAL * Math.pow(2, wsReconnectAttempts - 1),
    WS_RECONNECT_MAX_INTERVAL,
  );

  console.log(
    `WebSocket reconnection attempt ${wsReconnectAttempts} (next in ${delay}ms)`,
  );

  wsReconnectTimer = setTimeout(() => {
    wsReconnectInProgress = false;
    setupGlobalWebSocket();
  }, delay);
};

const setupGlobalWebSocket = async () => {
  if (globalWsRef && globalWsRef.readyState === WebSocket.CONNECTING) return;

  try {
    console.log("Connecting to WebSocket...");
    const socket = new WebSocket(`ws://${API_BASE.replace("http://", "")}`);
    globalWsRef = socket;

    socket.onopen = async () => {
      console.log("Connected to WebSocket");
      cleanupWsReconnection();

      bluetoothDiscoveryCoordinator.connected().catch((err) => {
        console.error("Failed to restore Bluetooth discovery state:", err);
      });

      try {
        const messageId = generateUUID();
        const resetBootCounterMessage = {
          type: "request",
          id: messageId,
          method: "reset_boot_counter",
          params: {},
        };
        socket.send(JSON.stringify(resetBootCounterMessage));
      } catch (err) {
        console.error("Failed to send reset_boot_counter request:", err);
      }

      globalWsListeners.forEach(
        (listener) => listener.onOpen && listener.onOpen(socket),
      );
    };

    socket.onclose = (event) => {
      console.log("Disconnected from WebSocket");
      bluetoothDiscoveryCoordinator.disconnected();

      appReady = false;
      appReadyPlatform = null;
      emitAppReadyState();

      appSubscribed = true;
      appSubscriptionStatus = null;
      appHasLifetime = true;
      appIsAdmin = false;
      appEntitlementsVerified = false;
      emitAppSubscribedState();

      spotifyAuthenticated = false;
      emitSpotifyAuthState();

      spotifySkipped = false;
      emitSpotifySkippedState();

      globalWsListeners.forEach(
        (listener) => listener.onClose && listener.onClose(),
      );
      globalWsRef = null;

      if (event.code !== 1000 && event.code !== 1001) {
        console.log(
          "WebSocket closed unexpectedly, attempting reconnection...",
        );
        attemptWsReconnection();
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data && data.type === "event" && data.topic === "app.ready") {
          /** @type {AppReadyEvent | undefined} */
          const readyData = data.data;
          const pendingPlatform = readyData?.platform || null;

          rememberActiveDevicePlatform(pendingPlatform);

          if (pendingPlatform === "ios" && !appLaunchRequested) {
            appLaunchRequested = true;
            /** @type {import("@schema/device").DeviceLaunchAppRequest} */
            const request = {
              bundleId: "com.usenocturne.nocturne",
            };
            sendWsRequest("device.launchApp", request).catch((err) => {
              console.warn("Failed to send device.launchApp:", err);
            });
          }

          const pendingSpotifySkipped = !!firstDefined(
            readyData?.spotifySkipped,
            readyData?.spotify_skipped,
          );
          const entitlementState = normalizeAppEntitlementState(readyData);
          appSubscribed = entitlementState.subscribed;
          appSubscriptionStatus = entitlementState.status;
          appHasLifetime = entitlementState.hasLifetime;
          appIsAdmin = entitlementState.isAdmin;
          appEntitlementsVerified = entitlementState.entitlementsVerified;
          emitAppSubscribedState();

          if (pendingSpotifySkipped) {
            spotifySkipped = true;
            emitSpotifySkippedState();
          }

          const syncDeviceTime = async () => {
            while (true) {
              try {
                /** @type {import("@schema/device").DeviceTimeGetRequest} */
                const request = {};
                await sendWsRequest("device.time.get", request, {
                  timeoutMs: 5000,
                });
                break;
              } catch (err) {
                console.error("Failed to sync device time, retrying...", err);
              }
            }

            rememberActiveDevicePlatform(pendingPlatform);
            appReady = true;
            appReadyPlatform = pendingPlatform;
            appReadyGeneration += 1;
            lastAppReadyAt = Date.now();
            emitAppReadyState();
            if (
              btReconnectSettleDevice &&
              lastAppReadyAt >= btReconnectSettleStartedAt
            ) {
              completeBtReconnectSuccess();
            }
          };

          syncDeviceTime();
        }

        if (
          data &&
          data.type === "event" &&
          data.topic === "subscription.updated"
        ) {
          /** @type {SubscriptionUpdatedEvent} */
          const updateData = data.data || {};
          const entitlementState = mergeAppEntitlementUpdate(
            getAppSubscribedState(),
            updateData,
          );
          appSubscribed = entitlementState.subscribed;
          appSubscriptionStatus = entitlementState.status;
          appHasLifetime = entitlementState.hasLifetime;
          appIsAdmin = entitlementState.isAdmin;
          appEntitlementsVerified = entitlementState.entitlementsVerified;
          emitAppSubscribedState();
        }

        if (
          data &&
          data.type === "event" &&
          (data.topic === "spotify.auth.status" ||
            data.topic === "spotify.auth.completed")
        ) {
          const authData = data.data || {};
          const isAuthenticated =
            authData.authenticated === true ||
            authData.authenticated === 1 ||
            authData.authenticated === "1";
          spotifyAuthenticated = isAuthenticated;
          emitSpotifyAuthState();

          const isSkipped = authData.skipped === true;
          if (spotifySkipped !== isSkipped) {
            spotifySkipped = isSkipped;
            emitSpotifySkippedState();
          }
        }

        if (data && data.type === "event" && data.topic === "network.status") {
          /** @type {NetworkStatusEvent} */
          const statusData = data.data || {};
          if (statusData.status === "disconnected") {
            window.dispatchEvent(new Event("networkBannerShow"));
          } else if (statusData.status === "connected") {
            window.dispatchEvent(new Event("networkBannerHide"));
          }
        }

        if (
          data &&
          (data.type === "response" || data.type === "error") &&
          typeof data.id === "string"
        ) {
          const pending = pendingWsRequests.get(data.id);
          if (pending) {
            pendingWsRequests.delete(data.id);
            const result = data.result ?? data;

            if (pending.method && !data.method) {
              data.method = pending.method;
            }

            if (result && result.authenticated !== undefined) {
              const isAuthenticated =
                result.authenticated === true ||
                result.authenticated === 1 ||
                result.authenticated === "1";
              spotifyAuthenticated = isAuthenticated;
              emitSpotifyAuthState();

              const isSkipped = result.skipped === true;
              if (spotifySkipped !== isSkipped) {
                spotifySkipped = isSkipped;
                emitSpotifySkippedState();
              }
            }

            const requestError = getWsRequestError(data, result);
            if (requestError) {
              pending.reject(new Error(requestError));
            } else {
              pending.resolve(result);
            }
          }
        }
        globalWsListeners.forEach(
          (listener) => listener.onMessage && listener.onMessage(data),
        );
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      globalWsListeners.forEach(
        (listener) => listener.onError && listener.onError(err),
      );
    };
  } catch (error) {
    console.error("Error setting up WebSocket:", error);
    attemptWsReconnection();
  }
};

const sendWsRequest = <T = UiLooseData>(
  method: string,
  params: object = {},
  { timeoutMs = 30000 }: { timeoutMs?: number } = {},
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const start = Date.now();

    const ensureInitialized = () => {
      if (!wsInitialized) {
        try {
          setupGlobalWebSocket();
          wsInitialized = true;
        } catch (err) {
          console.error("Failed to initialize WebSocket:", err);
        }
      }
    };

    const attemptSend = () => {
      const ws = globalWsRef;

      if (!ws) {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("WebSocket not available"));
          return;
        }
        setTimeout(attemptSend, 100);
        return;
      }

      if (ws.readyState === WebSocket.CONNECTING) {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("WebSocket connection timeout"));
          return;
        }
        setTimeout(attemptSend, 100);
        return;
      }

      if (
        ws.readyState === WebSocket.CLOSING ||
        ws.readyState === WebSocket.CLOSED
      ) {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("WebSocket is closed"));
          return;
        }
        attemptWsReconnection();
        setTimeout(attemptSend, 200);
        return;
      }

      const id = generateUUID();
      const payload = { type: "request", id, method, params };
      pendingWsRequests.set(id, { resolve, reject, method });

      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        pendingWsRequests.delete(id);
        reject(err);
        return;
      }

      if (timeoutMs > 0) {
        setTimeout(() => {
          if (pendingWsRequests.has(id)) {
            pendingWsRequests.delete(id);
            reject(new Error("Request timeout"));
          }
        }, timeoutMs);
      }
    };

    ensureInitialized();
    attemptSend();
  });
};

export const sendNocturneWsRequest = <T = UiLooseData>(
  method: string,
  params: object = {},
  options: { timeoutMs?: number } = {},
) => sendWsRequest<T>(method, params, options);

const bluetoothDiscoveryCoordinator = createBluetoothDiscoveryCoordinator(
  async (discoverable) => {
    /** @type {import("@schema/bluetooth").BluetoothDiscoverableRequest} */
    const request = { discoverable };
    const response = await sendWsRequest("bluetooth.discoverable", request, {
      timeoutMs: 5000,
    });
    if (!response || (response.status && response.status !== "requested")) {
      throw new Error(
        `Failed to ${discoverable ? "start" : "stop"} Bluetooth discovery`,
      );
    }
  },
);

export const acquireBluetoothDiscovery = (owner: symbol) =>
  bluetoothDiscoveryCoordinator.acquire(owner);

export const releaseBluetoothDiscovery = (owner: symbol) =>
  bluetoothDiscoveryCoordinator.release(owner);

const requestDevicesListDeduped = async (force = false) => {
  const now = Date.now();
  if (
    !force &&
    lastDevicesListCache &&
    now - lastDevicesListCache.timestamp < DEVICES_LIST_CACHE_TTL_MS
  ) {
    return lastDevicesListCache.resp;
  }
  if (pendingDevicesListWsPromise) return pendingDevicesListWsPromise;
  /** @type {import("@schema/bluetooth").BluetoothDevicesListRequest} */
  const request = {};
  pendingDevicesListWsPromise = sendWsRequest("bluetooth.devices.list", request)
    .then((resp) => {
      lastDevicesListCache = { resp, timestamp: Date.now() };
      return resp;
    })
    .catch((err) => {
      throw err;
    })
    .finally(() => {
      pendingDevicesListWsPromise = null;
    });
  return pendingDevicesListWsPromise;
};

const emitBtReconnectState = () => {
  const snapshot = {
    attempts: btReconnectAttempts,
    inProgress: btReconnectInProgress,
    pending: btReconnectPending,
    exhausted: reconnectionExhausted,
  };
  btReconnectSubscribers.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("BT reconnect subscriber error:", err);
    }
  });
};

export const subscribeBtReconnect = (listener) => {
  btReconnectSubscribers.add(listener);
  return () => {
    btReconnectSubscribers.delete(listener);
  };
};

export const getBtReconnectState = () => ({
  attempts: btReconnectAttempts,
  inProgress: btReconnectInProgress,
  pending: btReconnectPending,
  exhausted: reconnectionExhausted,
});

const clearBtReconnectTimer = () => {
  if (btReconnectTimer) {
    clearTimeout(btReconnectTimer);
    btReconnectTimer = null;
  }
};

export const stopBtReconnect = () => {
  btReconnectCancelled = true;
  clearBtReconnectTimer();
  clearBtReconnectSettle();
  resetBtReconnectCycle();
  btReconnectInProgress = false;
  btReconnectPending = false;
  btReconnectAttempts = 0;
  reconnectionExhausted = false;
  emitBtReconnectState();
};

const scheduleBtReconnectRetry = () => {
  btReconnectInProgress = false;
  btReconnectPending = !btReconnectCancelled;
  emitBtReconnectState();
  if (btReconnectCancelled) return;
  const exp = Math.min(
    Math.max(btReconnectAttempts - 1, 0),
    BT_RECONNECT_EXP_CAP,
  );
  const delayTime = Math.min(
    BT_RECONNECT_BASE_INTERVAL * Math.pow(2, exp),
    BT_RECONNECT_MAX_INTERVAL,
  );
  clearBtReconnectTimer();
  btReconnectTimer = setTimeout(() => {
    btReconnectTimer = null;
    attemptBtReconnect();
  }, delayTime);
};

const clearBtReconnectSettle = () => {
  if (btReconnectSettleTimer) {
    clearTimeout(btReconnectSettleTimer);
    btReconnectSettleTimer = null;
  }
  btReconnectSettleDevice = null;
  btReconnectSettleStartedAt = 0;
};

const completeBtReconnectSuccess = () => {
  clearBtReconnectTimer();
  clearBtReconnectSettle();
  resetBtReconnectCycle();
  btReconnectAttempts = 0;
  btReconnectInProgress = false;
  btReconnectCancelled = true;
  btReconnectPending = false;
  retryIsCancelled = true;
  reconnectionExhausted = false;
  emitBtReconnectState();
  window.dispatchEvent(new Event("networkBannerHide"));
  window.dispatchEvent(new Event("networkScreenHide"));
};

const failBtReconnectSettle = () => {
  clearBtReconnectSettle();
  btReconnectInProgress = false;
  btReconnectCancelled = false;
  retryIsCancelled = true;
  scheduleBtReconnectRetry();
};

const verifyBtReconnectSettled = async (address: string) => {
  if (btReconnectSettleDevice !== address) return;
  if (
    btReconnectSettleStartedAt > 0 &&
    lastAppReadyAt >= btReconnectSettleStartedAt
  ) {
    completeBtReconnectSuccess();
    return;
  }
  try {
    await requestDevicesListDeduped(true);
    if (btReconnectSettleDevice !== address) return;
    failBtReconnectSettle();
  } catch {
    if (btReconnectSettleDevice !== address) return;
    failBtReconnectSettle();
  }
};

const beginBtReconnectSettle = (address: string) => {
  if (!address) return;
  if (btReconnectSettleTimer && btReconnectSettleDevice === address) {
    return;
  }
  clearBtReconnectTimer();
  clearBtReconnectSettle();
  btReconnectSettleDevice = address;
  btReconnectSettleStartedAt = Date.now();
  btReconnectInProgress = true;
  btReconnectCancelled = false;
  btReconnectPending = true;
  emitBtReconnectState();
  btReconnectSettleTimer = setTimeout(() => {
    btReconnectSettleTimer = null;
    verifyBtReconnectSettled(address);
  }, BT_RECONNECT_SETTLE_MS);
};

const clearBtReconnectWatchdog = () => {
  if (btReconnectWatchdogTimer) {
    clearInterval(btReconnectWatchdogTimer);
    btReconnectWatchdogTimer = null;
  }
};

const startBtReconnectWatchdog = () => {
  if (btReconnectWatchdogTimer) return;
  btReconnectWatchdogTimer = setInterval(() => {
    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );
    if (!lastDeviceAddress) return;
    if (!globalWsRef || globalWsRef.readyState !== WebSocket.OPEN) return;
    if (
      btReconnectInProgress ||
      btReconnectTimer ||
      btReconnectSettleDevice ||
      manualDisconnectInProgress
    ) {
      return;
    }

    if (hasLiveBtSessionEvidence(lastDeviceAddress)) {
      return;
    }
    btReconnectCancelled = false;
    retryIsCancelled = true;
    attemptBtReconnect();
  }, BT_RECONNECT_WATCHDOG_MS);
};

export async function attemptBtReconnect() {
  if (btReconnectInProgress || btReconnectTimer) {
    return;
  }

  if (!globalWsRef || globalWsRef.readyState !== WebSocket.OPEN) {
    clearBtReconnectTimer();
    btReconnectPending = true;
    btReconnectTimer = setTimeout(() => {
      btReconnectTimer = null;
      attemptBtReconnect();
    }, BT_RECONNECT_BASE_INTERVAL);
    emitBtReconnectState();
    return;
  }

  const lastDeviceAddress = localStorage.getItem(
    "lastConnectedBluetoothDevice",
  );

  btReconnectCancelled = false;

  try {
    btReconnectInProgress = true;
    emitBtReconnectState();

    let devices: BluetoothDevice[] = [];
    let fetchedDevices = false;
    try {
      const deviceListResp = await requestDevicesListDeduped(true);
      devices = getDevicesFromListResponse(deviceListResp);
      fetchedDevices = true;
    } catch (err) {
      console.warn(
        "Failed to refresh Bluetooth devices before reconnect:",
        err,
      );
    }

    const deviceAddress =
      getNextBtReconnectAddress(devices, lastDeviceAddress) ||
      (!fetchedDevices ? lastDeviceAddress : null);

    if (!deviceAddress) {
      clearBtReconnectTimer();
      resetBtReconnectCycle();
      btReconnectAttempts = 0;
      btReconnectInProgress = false;
      btReconnectPending = false;
      reconnectionExhausted = false;
      emitBtReconnectState();
      window.dispatchEvent(new Event("networkBannerHide"));
      return;
    }

    const rememberedPlatform = getRememberedDevicePlatform(deviceAddress);
    if (!shouldAutomaticallyReconnectPlatform(rememberedPlatform)) {
      clearBtReconnectTimer();
      clearBtReconnectSettle();
      resetBtReconnectCycle();
      btReconnectAttempts = 0;
      btReconnectInProgress = false;
      btReconnectCancelled = true;
      btReconnectPending = false;
      reconnectionExhausted = false;
      emitBtReconnectState();
      return;
    }

    const isAlreadyConnected = devices.some(
      (device) => device.address === deviceAddress && device.connected,
    );

    if (isAlreadyConnected && hasLiveBtSessionEvidence(deviceAddress)) {
      const connType = btConnectionTypeByDevice.get(deviceAddress);
      if (connType === "iap2") {
        completeBtReconnectSuccess();
      } else {
        beginBtReconnectSettle(deviceAddress);
      }
      return;
    }

    if (btReconnectCancelled) {
      btReconnectInProgress = false;
      btReconnectPending = false;
      emitBtReconnectState();
      return;
    }

    btReconnectPending = true;
    btReconnectAttempts++;
    emitBtReconnectState();

    if (btReconnectAttempts >= 10 && !reconnectionExhausted) {
      reconnectionExhausted = true;
      emitBtReconnectState();
      window.dispatchEvent(new Event("networkScreenShow"));
    }

    const device = findDeviceByAddress(devices, deviceAddress);
    const response = await queueConnectRequest(
      deviceAddress,
      getDeviceConnectOptions(device),
    );

    if (btReconnectCancelled) {
      btReconnectInProgress = false;
      btReconnectPending = false;
      emitBtReconnectState();
      return;
    }

    if (response && response.ok) {
      const data = await readConnectResponseJson(response);
      if (isConnectResponseConnected(data)) {
        localStorage.setItem("lastConnectedBluetoothDevice", deviceAddress);
        btActiveSessions.add(deviceAddress);
        const connType = btConnectionTypeByDevice.get(deviceAddress);
        if (connType === "iap2") {
          completeBtReconnectSuccess();
        } else {
          beginBtReconnectSettle(deviceAddress);
        }
        return;
      }

      if (isConnectResponsePending(data)) {
        localStorage.setItem("lastConnectedBluetoothDevice", deviceAddress);
        beginBtReconnectSettle(deviceAddress);
        return;
      }
    }

    scheduleBtReconnectRetry();
  } catch (error) {
    console.error("BT reconnect attempt failed:", error);
    if (btReconnectCancelled) {
      btReconnectInProgress = false;
      btReconnectPending = false;
      emitBtReconnectState();
      return;
    }
    btReconnectAttempts++;
    emitBtReconnectState();
    if (btReconnectAttempts >= 10 && !reconnectionExhausted) {
      reconnectionExhausted = true;
      emitBtReconnectState();
      window.dispatchEvent(new Event("networkScreenShow"));
    }
    scheduleBtReconnectRetry();
  }
}

const handleBluetoothSingletonMessage = (data) => {
  if (data?.type !== "event") return;

  if (data.topic === "bluetooth.device") {
    /** @type {import("@schema/bluetooth").BluetoothDeviceEvent} */
    const ev = data.data || {};
    if (ev.event === "disconnected" && ev.device) {
      btActiveSessions.delete(ev.device);
      if (ev.device === localStorage.getItem("lastConnectedBluetoothDevice")) {
        lastBtSessionClosedAt = Date.now();
        lastBtLinkDownAt = Date.now();
      }
    }
    return;
  }

  if (data.topic !== "bluetooth.connection") return;
  /** @type {import("@schema/bluetooth").BluetoothConnectionEvent} */
  const ev = data.data || {};

  if (ev.event === "connection_established") {
    const connType = ev.connection_type || "unknown";
    btConnectionTypeByDevice.set(ev.device, connType);
    if (
      lastBtLinkDownAt > 0 &&
      Date.now() - lastBtLinkDownAt >= APP_RELAUNCH_NEW_DRIVE_GAP_MS
    ) {
      appLaunchRequested = false;
    }
    btActiveSessions.add(ev.device);
    if (connType === "iap2") {
      completeBtReconnectSuccess();
    } else {
      beginBtReconnectSettle(ev.device);
    }
  } else if (ev.event === "connection_closed") {
    btActiveSessions.delete(ev.device);
    lastBtSessionClosedAt = Date.now();
    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );
    if (!lastDeviceAddress || ev.device !== lastDeviceAddress) {
      return;
    }
    if (manualDisconnectInProgress) {
      manualDisconnectInProgress = false;
      return;
    }
    lastBtLinkDownAt = Date.now();
    const reconnectWasActive =
      btReconnectInProgress || btReconnectTimer || btReconnectSettleDevice;
    if (btReconnectSettleDevice === ev.device) {
      clearBtReconnectSettle();
    }
    if (reconnectWasActive) {
      btReconnectInProgress = false;
      btReconnectCancelled = false;
      if (!btReconnectTimer) {
        scheduleBtReconnectRetry();
      } else {
        btReconnectPending = true;
        emitBtReconnectState();
      }
      return;
    }
    clearBtReconnectTimer();
    resetBtReconnectCycle();
    btReconnectAttempts = 0;
    btReconnectInProgress = false;
    btReconnectCancelled = false;
    btReconnectPending = true;
    reconnectionExhausted = false;
    emitBtReconnectState();
    btReconnectTimer = setTimeout(() => {
      btReconnectTimer = null;
      attemptBtReconnect();
    }, BT_RECONNECT_INITIAL_DELAY);
  }
};

export const scheduleInitialBtReconnect = (
  lastDeviceAddress: string | null,
) => {
  if (!lastDeviceAddress) {
    stopBtReconnect();
    return;
  }
  clearBtReconnectTimer();
  resetBtReconnectCycle();
  btReconnectAttempts = 0;
  btReconnectInProgress = false;
  btReconnectCancelled = false;
  btReconnectPending = true;
  emitBtReconnectState();
  btReconnectTimer = setTimeout(() => {
    btReconnectTimer = null;
    attemptBtReconnect();
  }, BT_RECONNECT_INITIAL_DELAY);
};

export const markBtReconnectSocketClosed = (
  lastDeviceAddress: string | null,
) => {
  if (!lastDeviceAddress) {
    stopBtReconnect();
    return;
  }
  btReconnectPending = true;
  emitBtReconnectState();
};

const handleBluetoothSingletonOpen = () => {
  btActiveSessions.clear();
  lastBtSessionClosedAt = Date.now();
  startBtReconnectWatchdog();
  scheduleInitialBtReconnect(
    localStorage.getItem("lastConnectedBluetoothDevice"),
  );
};

const handleBluetoothSingletonClose = () => {
  markBtReconnectSocketClosed(
    localStorage.getItem("lastConnectedBluetoothDevice"),
  );
};

globalWsListeners.push({
  id: "bt-singleton-reconnect",
  onMessage: handleBluetoothSingletonMessage,
  onOpen: handleBluetoothSingletonOpen,
  onClose: handleBluetoothSingletonClose,
});

export const useNocturned = () => {
  const [wsConnected, setWsConnected] = useState(false);
  const listenerIdRef = useRef(null);

  useEffect(() => {
    if (!wsInitialized) {
      setupGlobalWebSocket();
      wsInitialized = true;
    }

    const listenerId = `nocturned-${Date.now()}`;
    listenerIdRef.current = listenerId;

    globalWsListeners.push({
      id: listenerId,
      onOpen: () => {
        setWsConnected(true);
      },
      onClose: () => {
        setWsConnected(false);
      },
      onError: () => {
        setWsConnected(false);
      },
    });

    if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
      setWsConnected(true);
    }

    return () => {
      globalWsListeners = globalWsListeners.filter(
        (listener) => listener.id !== listenerId,
      );

      if (globalWsListeners.length === 0) {
        cleanupGlobalWebSocket();
      }
    };
  }, []);

  const apiRequest = useCallback(
    async (endpoint, method = "GET", body = null) => {
      const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`;

      try {
        const options = {
          method,
          headers: {},
        };

        if (body) {
          options.headers["Content-Type"] = "application/json";
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Request failed: ${response.status}`,
          );
        }

        return await response.json();
      } catch (error) {
        console.error(`API request failed: ${url}`, error);
        throw error;
      }
    },
    [],
  );

  const addMessageListener = useCallback(
    (id: string, messageHandler: (message: WsMessage) => void) => {
      const listenerId = `${id}-${Date.now()}`;

      globalWsListeners.push({
        id: listenerId,
        onMessage: messageHandler,
      });

      return listenerId;
    },
    [],
  );

  const removeMessageListener = useCallback((listenerId: string) => {
    globalWsListeners = globalWsListeners.filter(
      (listener) => listener.id !== listenerId,
    );
  }, []);

  return {
    wsConnected,
    apiRequest,
    addMessageListener,
    removeMessageListener,
  };
};

export const useNocturneInfo = () => {
  const [version, setVersion] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState<string | null>(null);
  const [bandaidVersion, setBandaidVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      /** @type {import("@schema/device").DeviceVersionRequest} */
      const request = {};
      const data = await sendWsRequest("device.version", request);

      const normalized = normalizeDeviceVersionResponse(data);
      setVersion(normalized.shortVersion ?? normalized.version);
      setImageVersion(normalized.imageVersion);
      setBandaidVersion(normalized.bandaidVersion);
    } catch (err) {
      console.error("Failed to fetch info from nocturned:", err);
      setError(err.message);
      setVersion(null);
      setImageVersion(null);
      setBandaidVersion(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  return {
    version,
    imageVersion,
    bandaidVersion,
    isLoading,
    error,
    refetch: fetchInfo,
  };
};

export const useDeviceInfo = () => {
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDeviceInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      /** @type {import("@schema/device").DeviceInfoRequest} */
      const request = {};
      const data = await sendWsRequest("device.info", request);

      if (data) {
        setDeviceInfo(normalizeDeviceInfoResponse(data));
      } else {
        setDeviceInfo(null);
      }
    } catch (err) {
      console.error("Failed to fetch device info from nocturned:", err);
      setError(err.message);
      setDeviceInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeviceInfo();
  }, [fetchDeviceInfo]);

  return {
    deviceInfo,
    isLoading,
    error,
    refetch: fetchDeviceInfo,
  };
};

export const useSystemUpdate = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [updateStatus, setUpdateStatus] = useState({
    inProgress: false,
    stage: "",
    error: "",
  });
  const [progress, setProgress] = useState({
    bytesComplete: 0,
    bytesTotal: 0,
    speed: 0,
    percent: 0,
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isApplyComplete, setIsApplyComplete] = useState(false);
  const listenerIdRef = useRef(null);
  const lastSuccessfulStageRef = useRef(null);
  const postCommandsRef = useRef([]);

  const execCommands = useCallback(
    async (commands) => {
      if (!commands || commands.length === 0) return;
      try {
        await apiRequest("/device/exec", "POST", { commands });
      } catch (err) {
        console.error("Command execution failed:", err);
      }
    },
    [apiRequest],
  );

  const startUpdate = useCallback(
    async (currentVersion, targetVersion, commands = {}) => {
      try {
        const pre = commands.pre || [];
        const post = commands.post || [];
        if (pre.length) {
          await execCommands(pre);
        }

        otaApplyTriggered = false;

        setIsUpdating(true);
        setIsError(false);
        setErrorMessage("");
        setIsApplyComplete(false);

        setProgress({
          bytesComplete: 0,
          bytesTotal: 0,
          speed: 0,
          percent: 0,
        });

        setUpdateStatus({
          inProgress: true,
          stage: "downloading",
          error: "",
        });

        const currentVersionWithPrefix = currentVersion?.startsWith("v")
          ? currentVersion
          : `v${currentVersion}`;
        const targetVersionWithPrefix = targetVersion?.startsWith("v")
          ? targetVersion
          : `v${targetVersion}`;

        const data = await sendWsRequest(
          "device.ota.download",
          {
            currentVersion: currentVersionWithPrefix,
            targetVersion: targetVersionWithPrefix,
          },
          { timeoutMs: 0 },
        );

        postCommandsRef.current = post;

        return data;
      } catch (error) {
        console.error("Error starting update:", error);
        setIsUpdating(false);
        setIsError(true);
        setErrorMessage(`Failed to start update: ${error.message}`);
        return null;
      }
    },
    [execCommands],
  );

  const handleWsMessage = useCallback(
    async (data) => {
      if (
        data.type === "response" &&
        (data.method === "device.ota.apply" ||
          (otaApplyTriggered &&
            data.result &&
            (data.result.current !== undefined ||
              data.result.ota !== undefined)))
      ) {
        const result = data.result ?? data;

        if (
          result &&
          result.current === "in_progress" &&
          result.ota === "started"
        ) {
          setUpdateStatus((prev) => ({
            ...prev,
            stage: "installing",
            inProgress: true,
          }));
          return;
        }

        if (
          result &&
          (result.success ||
            (result.current === "finished" && result.ota === "complete"))
        ) {
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            stage: "complete",
          }));
          setIsUpdating(false);
          setIsApplyComplete(true);
          otaApplyTriggered = false;

          if (postCommandsRef.current && postCommandsRef.current.length) {
            execCommands(postCommandsRef.current);
            postCommandsRef.current = [];
          }
        } else if (
          result &&
          result.current === "finished" &&
          result.ota === "failed"
        ) {
          const message =
            result?.message || result?.error || "Update apply failed";
          setIsError(true);
          setErrorMessage(`Failed to apply update: ${message}`);
          setIsUpdating(false);
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            error: message,
          }));
          setIsApplyComplete(false);
          otaApplyTriggered = false;
        } else if (!result || (!result.success && !result.current)) {
          const message =
            result?.message || result?.error || "Update apply failed";
          setIsError(true);
          setErrorMessage(`Failed to apply update: ${message}`);
          setIsUpdating(false);
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            error: message,
          }));
          setIsApplyComplete(false);
          otaApplyTriggered = false;
        }

        return;
      }

      if (data.type === "event" && data.topic === "device.ota.complete") {
        const eventData = data.data || {};

        if (eventData.status !== "complete") {
          console.error("OTA download failed with status:", eventData.status);
          setIsError(true);
          setErrorMessage("Download failed");
          setIsUpdating(false);
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            error: "Download failed",
          }));
          setIsApplyComplete(false);
          return;
        }

        if (otaApplyTriggered) {
          return;
        }

        otaApplyTriggered = true;

        setUpdateStatus((prev) => ({
          ...prev,
          stage: "installing",
          inProgress: true,
        }));

        try {
          await sendWsRequest("device.ota.apply", {}, { timeoutMs: 0 });
        } catch (error) {
          console.error("Failed to apply OTA update:", error);
          setIsError(true);
          setErrorMessage(`Failed to apply update: ${error.message}`);
          setIsUpdating(false);
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            error: error.message,
          }));
          setIsApplyComplete(false);
          otaApplyTriggered = false;
        }
      } else if (data.type === "event" && data.topic === "device.ota.status") {
        window.dispatchEvent(
          new CustomEvent("nocturne-ws-message", {
            detail: {
              topic: "device.ota.status",
              data: data.data,
            },
          }),
        );
      } else if (data.type === "update_progress" && data.payload) {
        const payload = data.payload;

        if (payload.type === "progress") {
          setIsUpdating(true);
          setProgress({
            bytesComplete: payload.bytes_complete,
            bytesTotal: payload.bytes_total,
            speed: payload.speed,
            percent: payload.percent,
          });

          if (payload.stage) {
            lastSuccessfulStageRef.current = payload.stage;
            setUpdateStatus((prev) => ({
              ...prev,
              stage: payload.stage,
              inProgress: true,
            }));
          }
        }
      } else if (data.type === "update_completion" && data.payload) {
        const payload = data.payload;

        if (payload.type === "completion") {
          if (payload.success) {
            setUpdateStatus((prev) => ({
              ...prev,
              inProgress: false,
              stage: "complete",
            }));
            setIsUpdating(false);
            setIsApplyComplete(true);
            if (postCommandsRef.current && postCommandsRef.current.length) {
              execCommands(postCommandsRef.current);
              postCommandsRef.current = [];
            }
          } else {
            setIsError(true);
            setErrorMessage(payload.error || "Update failed");
            setIsUpdating(false);
            setUpdateStatus((prev) => ({
              ...prev,
              inProgress: false,
              error: payload.error || "Update failed",
            }));
            setIsApplyComplete(false);
          }
        }
      }
    },
    [execCommands],
  );

  useEffect(() => {
    const listenerId = addMessageListener("system-update", handleWsMessage);
    listenerIdRef.current = listenerId;

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [addMessageListener, removeMessageListener, handleWsMessage]);

  return {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage,
    wsConnected,
    startUpdate,
    isApplyComplete,
  };
};

// Protocol-v2 auto-update now lives in `OTAContext` (`OTAProvider`), which owns
// both the scheduled background check and the silent auto-install so the check
// (`ota.request_check`) and install (`ota.request_install`) stay one concern.

export const useBluetooth = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [pairingRequest, setPairingRequest] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState<UiContentItem[]>([]);
  const [activeSessionDevices, setActiveSessionDevices] = useState<
    UiContentItem[]
  >([]);
  const [hasFetchedInitialDevices, setHasFetchedInitialDevices] =
    useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null);
  const [devices, setDevices] = useState<UiContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(
    () => getBtReconnectState().attempts,
  );
  const [isReconnectPending, setIsReconnectPending] = useState(
    () => getBtReconnectState().pending,
  );

  const networkStartRef = useRef(null);
  const networkPollRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  const listenerIdRef = useRef(null);
  const discoveryOwner = useRef(Symbol("bluetooth-discovery"));
  const retryDeviceAddressRef = useRef(null);

  useEffect(() => {
    updateBluetoothConnectionState(connectedDevices);
  }, [connectedDevices]);

  useEffect(() => {
    if (!wsConnected) {
      setActiveSessionDevices([]);
    }
  }, [wsConnected]);

  useEffect(() => {
    const state = getBtReconnectState();
    setReconnectAttempt(state.attempts);
    setIsReconnectPending(state.pending);
    const unsubscribe = subscribeBtReconnect((snapshot) => {
      setReconnectAttempt(snapshot.attempts);
      setIsReconnectPending(snapshot.pending);
    });
    return unsubscribe;
  }, []);

  const stopNetworkPolling = useCallback(() => {
    isNetworkPollingActive = false;

    if (networkPollRef.current) {
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }
    if (networkStartRef.current) {
      clearInterval(networkStartRef.current);
      networkStartRef.current = null;
    }
  }, []);

  const stopRetrying = useCallback(() => {
    retryIsCancelled = true;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    retryDeviceAddressRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    stopNetworkPolling();
    stopRetrying();
  }, [stopNetworkPolling, stopRetrying]);

  const fetchDevices = useCallback(async (force = false) => {
    if (pendingDevicesFetchPromise) {
      return pendingDevicesFetchPromise;
    }

    if (isDevicesFetching && !force) {
      return [];
    }

    setLoading(true);

    pendingDevicesFetchPromise = (async () => {
      try {
        isDevicesFetching = true;
        const resp = await requestDevicesListDeduped(force);
        const list =
          (resp && resp.payload) ||
          (resp && resp.result && resp.result.payload) ||
          [];
        setDevices(list);

        const connectedList = list.filter((device) => device?.connected);
        setConnectedDevices(connectedList);
        if (connectedList.length > 0) {
          setLastConnectedDevice((prev) => {
            if (prev && connectedList.some((d) => d.address === prev.address)) {
              return prev;
            }
            const primaryDevice = connectedList[0];
            if (primaryDevice?.address) {
              localStorage.setItem(
                "lastConnectedBluetoothDevice",
                primaryDevice.address,
              );
            }
            return primaryDevice || prev;
          });
        }
        setHasFetchedInitialDevices(true);
        return list;
      } catch (err) {
        setError(err.message);
        setHasFetchedInitialDevices(true);
        return [];
      } finally {
        setLoading(false);
        isDevicesFetching = false;
        pendingDevicesFetchPromise = null;
      }
    })();

    return pendingDevicesFetchPromise;
  }, []);

  useEffect(() => {
    fetchDevices(true);
  }, [fetchDevices]);

  const startNetworkPolling = useCallback(async (deviceAddress) => {
    if (!deviceAddress) return;

    let isPolling = true;

    const attemptNetworkConnection = async () => {
      if (!isPolling) return false;

      try {
        const response = await queueConnectRequest(deviceAddress);

        if (response.ok) {
          const data = await readConnectResponseJson(response);

          if (!isConnectResponseConnected(data)) {
            if (data.status === "waiting_for_android") {
              console.log(
                "Android wake pending, continuing reconnect attempts",
              );
            }
            return false;
          }

          console.log("Network connection established successfully");

          isPolling = false;
          clearInterval(networkPollRef.current);
          networkPollRef.current = null;
          isNetworkPollingActive = false;
          return true;
        }
      } catch {
        if (isPolling) {
          console.log("Network connection attempt failed, retrying...");
        }
      }
      return false;
    };

    networkPollRef.current = setInterval(async () => {
      if (!isPolling) {
        clearInterval(networkPollRef.current);
        networkPollRef.current = null;
        return;
      }
      const success = await attemptNetworkConnection();
      if (success) {
        isPolling = false;
      }
    }, 5000);

    const success = await attemptNetworkConnection();
    if (success) {
      isPolling = false;
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }

    networkStartRef.current = Date.now();
  }, []);

  const connectDeviceNoRetry = useCallback(
    async (deviceAddress) => {
      try {
        setLoading(true);
        manualDisconnectInProgress = false;
        stopRetrying();
        retryIsCancelled = true;
        reconnectionExhausted = false;
        retryDeviceAddressRef.current = null;

        const response = await queueConnectRequest(deviceAddress);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setError(errorData.error || "Failed to connect device");
          return false;
        }

        localStorage.setItem("lastConnectedBluetoothDevice", deviceAddress);
        await fetchDevices(true);
        window.dispatchEvent(new Event("networkBannerHide"));
        window.dispatchEvent(new Event("networkScreenHide"));
        reconnectionExhausted = false;
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fetchDevices, stopRetrying],
  );

  const connectDevice = useCallback(
    async (deviceAddress) => {
      try {
        setLoading(true);
        manualDisconnectInProgress = false;
        stopRetrying();
        retryIsCancelled = false;
        reconnectionExhausted = false;
        retryDeviceAddressRef.current = deviceAddress;

        const response = await queueConnectRequest(deviceAddress);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));

          if (
            errorData.error === "Failed to connect to device: exit status 4"
          ) {
            const retryConnection = () => {
              if (retryIsCancelled) return;

              queueConnectRequest(deviceAddress)
                .then((retryResponse) => {
                  if (retryIsCancelled) return;

                  if (retryResponse.ok) {
                    localStorage.setItem(
                      "lastConnectedBluetoothDevice",
                      deviceAddress,
                    );
                    fetchDevices(true);
                    retryIsCancelled = true;
                    reconnectionExhausted = false;
                    window.dispatchEvent(new Event("networkBannerHide"));
                    window.dispatchEvent(new Event("networkScreenHide"));
                  } else {
                    if (!retryIsCancelled) {
                      window.dispatchEvent(new Event("networkBannerShow"));
                      const newTimeout = setTimeout(retryConnection, 5000);
                      retryTimeoutRef.current = newTimeout;
                    }
                  }
                })
                .catch(() => {
                  if (!retryIsCancelled) {
                    window.dispatchEvent(new Event("networkBannerShow"));
                    const newTimeout = setTimeout(retryConnection, 5000);
                    retryTimeoutRef.current = newTimeout;
                  }
                });
            };

            window.dispatchEvent(new Event("networkBannerShow"));
            const timeout = setTimeout(retryConnection, 5000);
            retryTimeoutRef.current = timeout;

            return false;
          }
          window.dispatchEvent(new Event("networkBannerShow"));
          throw new Error(errorData.error || "Failed to connect device");
        }

        localStorage.setItem("lastConnectedBluetoothDevice", deviceAddress);
        await fetchDevices(true);
        window.dispatchEvent(new Event("networkBannerHide"));
        window.dispatchEvent(new Event("networkScreenHide"));
        return true;
      } catch (err) {
        window.dispatchEvent(new Event("networkBannerShow"));
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fetchDevices, stopRetrying],
  );

  const disconnectDevice = useCallback(
    async (address) => {
      try {
        manualDisconnectInProgress = true;

        setTimeout(() => {
          manualDisconnectInProgress = false;
        }, 3000);

        stopNetworkPolling();
        stopRetrying();
        clearBtReconnectSettle();
        retryIsCancelled = true;
        isNetworkPollingActive = false;

        /** @type {import("@schema/bluetooth").BluetoothDeviceDisconnectRequest} */
        const request = {
          address,
        };
        const resp = await sendWsRequest(
          "bluetooth.device.disconnect",
          request,
        );
        if (!resp || resp.status !== "disconnected") {
          throw new Error("Failed to disconnect device");
        }

        stopBtReconnect();
        localStorage.removeItem("lastConnectedBluetoothDevice");

        setTimeout(() => {
          stopNetworkPolling();
          stopRetrying();
        }, 100);

        await fetchDevices(true);
        return true;
      } catch (error) {
        console.error("Error disconnecting:", error);
        manualDisconnectInProgress = false;
        return false;
      }
    },
    [fetchDevices, stopNetworkPolling, stopRetrying],
  );

  const forgetDevice = useCallback(
    async (deviceAddress) => {
      try {
        setLoading(true);
        stopNetworkPolling();
        stopRetrying();
        retryDeviceAddressRef.current = null;

        /** @type {import("@schema/bluetooth").BluetoothDeviceUnpairRequest} */
        const request = {
          address: deviceAddress,
        };
        const resp = await sendWsRequest("bluetooth.device.unpair", request);
        if (!resp || (resp.error && resp.error.message)) {
          throw new Error(resp?.error?.message || "Failed to remove device");
        }

        if (
          localStorage.getItem("lastConnectedBluetoothDevice") === deviceAddress
        ) {
          stopBtReconnect();
          localStorage.removeItem("lastConnectedBluetoothDevice");
        }

        await fetchDevices(true);
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fetchDevices, stopNetworkPolling, stopRetrying],
  );

  const handleWsMessage = useCallback(
    (data) => {
      if (data?.type === "event") {
        const topic = data.topic;
        const ev = data.data || {};
        const pairingUiUpdate = getBluetoothPairingUiUpdate(topic, ev);

        if (pairingUiUpdate?.action === "show") {
          setPairingRequest(pairingUiUpdate.request);
        } else if (pairingUiUpdate?.action === "clear") {
          setPairingRequest(null);
        }

        if (topic === "bluetooth.agent") {
          return;
        } else if (topic === "bluetooth.pairing") {
          return;
        } else if (topic === "bluetooth.connection") {
          /** @type {import("@schema/bluetooth").BluetoothConnectionEvent} */
          const connectionEvent = ev;
          if (connectionEvent.event === "connection_established") {
            const address = connectionEvent.device;
            localStorage.setItem("lastConnectedBluetoothDevice", address);

            setPairingRequest(null);
            setIsConnecting(false);

            setConnectedDevices((prev) => {
              const exists = (prev || []).some((d) => d.address === address);
              if (exists) {
                return prev;
              }
              return [...prev, { address, connected: true }];
            });
            setActiveSessionDevices((prev) => {
              const exists = (prev || []).some((d) => d.address === address);
              if (exists) {
                return prev;
              }
              return [...prev, { address, connected: true }];
            });
            setLastConnectedDevice(
              (prev) => prev || { address, connected: true },
            );
            setDevices((prev) => {
              const idx = (prev || []).findIndex((d) => d.address === address);
              if (idx === -1) {
                return [...prev, { address, connected: true }];
              }
              const next = [...prev];
              next[idx] = { ...next[idx], connected: true };
              return next;
            });

            window.dispatchEvent(new Event("networkBannerHide"));
            window.dispatchEvent(new Event("networkScreenHide"));
          } else if (connectionEvent.event === "connection_closed") {
            const address = connectionEvent.device;
            setConnectedDevices((prev) =>
              (prev || []).filter((d) => d.address !== address),
            );
            setActiveSessionDevices((prev) =>
              (prev || []).filter((d) => d.address !== address),
            );
            let wasLastConnectedDevice = false;
            setLastConnectedDevice((prev) => {
              if (prev?.address === address) {
                wasLastConnectedDevice = true;
                return null;
              }
              return prev;
            });
            if (wasLastConnectedDevice) {
              stopNetworkPolling();
              stopRetrying();
            }
          } else if (connectionEvent.event === "connection_failed") {
            window.dispatchEvent(new Event("networkBannerShow"));
          }
        }
        return;
      }
    },
    [stopNetworkPolling, startNetworkPolling, stopRetrying, fetchDevices],
  );

  const startDiscovery = useCallback(async () => {
    try {
      await acquireBluetoothDiscovery(discoveryOwner.current);
      return true;
    } catch (err) {
      console.error("Error starting discovery:", err);
      return false;
    }
  }, []);

  const stopDiscovery = useCallback(async () => {
    try {
      await releaseBluetoothDiscovery(discoveryOwner.current);
    } catch (err) {
      console.error("Failed to stop discovery:", err);
    }
  }, []);

  const setDiscoverable = useCallback(
    async (enabled) => {
      return enabled ? startDiscovery() : stopDiscovery();
    },
    [startDiscovery, stopDiscovery],
  );

  const acceptPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      setIsConnecting(true);
      setPairingRequest(null);
    } catch (error) {
      console.error("Error accepting pair:", error);
      setPairingRequest(null);
    } finally {
      setIsConnecting(false);
    }
  }, [pairingRequest]);

  const denyPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      setPairingRequest(null);
    } catch (error) {
      console.error("Error denying pair:", error);
      setPairingRequest(null);
    }
  }, [pairingRequest]);

  const enableNetworking = useCallback(async () => {
    if (!lastConnectedDevice) return;
    startNetworkPolling(lastConnectedDevice.address);
  }, [lastConnectedDevice, startNetworkPolling]);

  useEffect(() => {
    const listenerId = addMessageListener("bluetooth", handleWsMessage);
    listenerIdRef.current = listenerId;

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
      cleanup();
    };
  }, [addMessageListener, removeMessageListener, handleWsMessage, cleanup]);

  return {
    devices,
    loading,
    error,
    fetchDevices,
    pairingRequest,
    connectedDevices,
    activeSessionDevices,
    isConnecting,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    startDiscovery,
    stopDiscovery,
    setDiscoverable,
    connectDevice,
    connectDeviceNoRetry,
    disconnectDevice,
    forgetDevice,
    enableNetworking,
    wsConnected,
    stopRetrying,
    reconnectAttempt,
    isReconnectPending,
    attemptReconnect: attemptBtReconnect,
    hasFetchedInitialDevices,
  };
};
