import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { useUpdateCheck } from "./useUpdateCheck";

const API_BASE = "http://localhost:5000";

const generateUUID = () => {
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;
const pendingWsRequests = new Map();
let appReady = false;
let appReadyPlatform = null; // "ios" or "android"
const appReadySubscribers = new Set();
let appSubscribed = true;
let appSubscriptionStatus = null;
const appSubscribedSubscribers = new Set();
let spotifyAuthenticated = false;
const spotifyAuthSubscribers = new Set();
let spotifySkipped = false;
const spotifySkippedSubscribers = new Set();

let wsReconnectAttempts = 0;
let wsReconnectTimer = null;
let wsReconnectInProgress = false;
const WS_RECONNECT_BASE_INTERVAL = 1000;
const WS_RECONNECT_MAX_INTERVAL = 30000;

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;
let pendingDevicesFetchPromise = null;
let pendingDevicesListWsPromise = null;
let lastDevicesListCache = null; // { resp, timestamp }
const DEVICES_LIST_CACHE_TTL_MS = 3000;
let isConnectRequestInProgress = false;
let connectRequestQueue = [];

let bluetoothConnectionState = {
  connected: false,
  devices: [],
};

let reconnectionExhausted = false;
let manualDisconnectInProgress = false;

const bluetoothConnectionSubscribers = new Set();

const normalizeDevicesForState = (devices = []) =>
  (Array.isArray(devices) ? devices : []).map((device) => ({
    address: device?.address,
    connected: Boolean(device?.connected),
  }));

const didBluetoothStateChange = (nextDevices) => {
  const prev = bluetoothConnectionState.devices;
  if (prev.length !== nextDevices.length) return true;
  for (let i = 0; i < nextDevices.length; i += 1) {
    if (
      prev[i]?.address !== nextDevices[i]?.address ||
      Boolean(prev[i]?.connected) !== Boolean(nextDevices[i]?.connected)
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

const updateBluetoothConnectionState = (devices = []) => {
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
});

const emitAppReadyState = () => {
  appReadySubscribers.forEach((listener) => {
    try {
      listener({ ready: appReady, platform: appReadyPlatform });
    } catch (err) {
      console.error("App ready listener error:", err);
    }
  });
};

export const subscribeAppReadyState = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  appReadySubscribers.add(listener);
  listener({ ready: appReady, platform: appReadyPlatform });

  return () => {
    appReadySubscribers.delete(listener);
  };
};

export const getAppSubscribedState = () => ({
  subscribed: appSubscribed,
  status: appSubscriptionStatus,
});

const emitAppSubscribedState = () => {
  appSubscribedSubscribers.forEach((listener) => {
    try {
      listener({ subscribed: appSubscribed, status: appSubscriptionStatus });
    } catch (err) {
      console.error("App subscribed listener error:", err);
    }
  });
};

export const subscribeAppSubscribedState = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  appSubscribedSubscribers.add(listener);
  listener({ subscribed: appSubscribed, status: appSubscriptionStatus });

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

export const subscribeSpotifyAuthState = (listener) => {
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

export const subscribeSpotifySkippedState = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  spotifySkippedSubscribers.add(listener);
  listener(spotifySkipped);

  return () => {
    spotifySkippedSubscribers.delete(listener);
  };
};

export const subscribeBluetoothConnectionState = (listener) => {
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
  if (globalWsRef) {
    globalWsRef.close(1000);
    globalWsRef = null;
  }
  wsInitialized = false;
};

export const getGlobalWebSocket = () => globalWsRef;

export const addGlobalWsListener = (id, handlers) => {
  const listener = {
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

const queueConnectRequest = async (deviceAddress, options = {}) => {
  return new Promise((resolve, reject) => {
    const request = {
      deviceAddress,
      options,
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
      result = await sendWsRequest("bluetooth.device.connect", {
        address: request.deviceAddress,
        ...(request.options && request.options.channel
          ? { channel: request.options.channel }
          : {}),
      });
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

      appReady = false;
      appReadyPlatform = null;
      emitAppReadyState();

      appSubscribed = true;
      appSubscriptionStatus = null;
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
          const pendingPlatform = data.data?.platform || null;
          const pendingSpotifySkipped = data.data?.spotifySkipped === true;
          const pendingSubscribed = data.data?.subscribed === true;
          const pendingSubscriptionStatus =
            data.data?.subscriptionStatus || null;

          const syncDeviceTime = async () => {
            while (true) {
              try {
                await sendWsRequest("device.time.get", {}, { timeoutMs: 5000 });
                break;
              } catch (err) {
                console.error("Failed to sync device time, retrying...", err);
              }
            }

            appReady = true;
            appReadyPlatform = pendingPlatform;
            emitAppReadyState();

            appSubscribed = pendingSubscribed;
            appSubscriptionStatus = pendingSubscriptionStatus;
            emitAppSubscribedState();

            if (pendingSpotifySkipped) {
              spotifySkipped = true;
              emitSpotifySkippedState();
            }
          };

          syncDeviceTime();
        }

        if (
          data &&
          data.type === "event" &&
          data.topic === "subscription.updated"
        ) {
          appSubscribed = data.data?.subscribed === true;
          appSubscriptionStatus = data.data?.subscriptionStatus || null;
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
          const statusData = data.data || {};
          if (statusData.status === "disconnected") {
            window.dispatchEvent(new Event("networkBannerShow"));
          } else if (statusData.status === "connected") {
            window.dispatchEvent(new Event("networkBannerHide"));
          }
        }

        if (data && data.type === "response" && data.id) {
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

            if (result && (result.error || data.error)) {
              const message =
                (result && result.error) ||
                (data.error && (data.error.message || data.error)) ||
                "Request failed";
              pending.reject(new Error(message));
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

const sendWsRequest = (method, params = {}, { timeoutMs = 30000 } = {}) => {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const ensureInitialized = () => {
      if (!wsInitialized) {
        try {
          setupGlobalWebSocket();
          wsInitialized = true;
        } catch (_) {}
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

export const sendNocturneWsRequest = (method, params = {}, options = {}) =>
  sendWsRequest(method, params, options);

const requestDevicesListDeduped = async () => {
  const now = Date.now();
  if (
    lastDevicesListCache &&
    now - lastDevicesListCache.timestamp < DEVICES_LIST_CACHE_TTL_MS
  ) {
    return lastDevicesListCache.resp;
  }
  if (pendingDevicesListWsPromise) return pendingDevicesListWsPromise;
  pendingDevicesListWsPromise = sendWsRequest("bluetooth.devices.list", {})
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

  const addMessageListener = useCallback((id, messageHandler) => {
    const listenerId = `${id}-${Date.now()}`;

    globalWsListeners.push({
      id: listenerId,
      onMessage: messageHandler,
    });

    return listenerId;
  }, []);

  const removeMessageListener = useCallback((listenerId) => {
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
  const [version, setVersion] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const data = await sendWsRequest("device.version", {});

      if (data && (data.version || data.shortVersion)) {
        const versionString = data.shortVersion || data.version;
        const cleanVersion = versionString.replace(/^v/, "");
        setVersion(cleanVersion);
      } else {
        setVersion(null);
      }
    } catch (err) {
      console.error("Failed to fetch info from nocturned:", err);
      setError(err.message);
      setVersion(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  return {
    version,
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

      const data = await sendWsRequest("device.info", {});

      if (data) {
        setDeviceInfo(data);
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

const AUTO_UPDATE_DELAY_MS = 60000;

export const AutoUpdateManager = () => {
  const { settings } = useSettings();
  const { version: currentVersion, isLoading: isInfoLoading } =
    useNocturneInfo();
  const { updateStatus, isUpdating, isError, startUpdate, isApplyComplete } =
    useSystemUpdate();
  const { updateInfo, isChecking, checkForUpdates } =
    useUpdateCheck(currentVersion);

  const autoUpdateTimerRef = useRef(null);
  const autoUpdateTriggeredRef = useRef(false);

  const sessionCompleted =
    (updateStatus.stage === "complete" && !isUpdating && !isError) ||
    isApplyComplete;
  const hasNocturneUpdate = updateInfo?.hasUpdate || false;
  const canUpdate = updateInfo?.canUpdate !== false;

  const clearAutoUpdateTimer = useCallback(() => {
    if (autoUpdateTimerRef.current) {
      clearTimeout(autoUpdateTimerRef.current);
      autoUpdateTimerRef.current = null;
    }
  }, []);

  const handleNocturneUpdate = useCallback(async () => {
    if (!updateInfo?.version || !currentVersion) return;

    try {
      await startUpdate(
        currentVersion,
        updateInfo.version,
        updateInfo?.commands || {},
      );
    } catch (error) {
      console.error("Auto-update installation failed:", error);
    }
  }, [currentVersion, startUpdate, updateInfo]);

  useEffect(() => {
    if (
      !settings?.autoUpdateEnabled ||
      autoUpdateTriggeredRef.current ||
      !hasNocturneUpdate
    ) {
      return;
    }

    autoUpdateTriggeredRef.current = true;
  }, [settings?.autoUpdateEnabled, hasNocturneUpdate]);

  useEffect(() => {
    if (!settings?.autoUpdateEnabled) {
      autoUpdateTriggeredRef.current = false;
      clearAutoUpdateTimer();
      return;
    }

    if (
      autoUpdateTriggeredRef.current ||
      isInfoLoading ||
      !currentVersion ||
      sessionCompleted ||
      isUpdating ||
      isError
    ) {
      return;
    }

    autoUpdateTimerRef.current = setTimeout(async () => {
      try {
        autoUpdateTriggeredRef.current = true;
        await checkForUpdates();
      } catch (error) {
        console.error("Auto-update check failed:", error);
      }
    }, AUTO_UPDATE_DELAY_MS);

    return clearAutoUpdateTimer;
  }, [
    settings?.autoUpdateEnabled,
    isInfoLoading,
    currentVersion,
    sessionCompleted,
    isUpdating,
    isError,
    checkForUpdates,
    clearAutoUpdateTimer,
  ]);

  useEffect(() => {
    if (
      !settings?.autoUpdateEnabled ||
      !autoUpdateTriggeredRef.current ||
      !hasNocturneUpdate ||
      isUpdating ||
      isError ||
      sessionCompleted ||
      !canUpdate ||
      isChecking
    ) {
      return;
    }

    handleNocturneUpdate();
  }, [
    settings?.autoUpdateEnabled,
    hasNocturneUpdate,
    isUpdating,
    isError,
    sessionCompleted,
    canUpdate,
    isChecking,
    handleNocturneUpdate,
  ]);

  useEffect(() => clearAutoUpdateTimer, [clearAutoUpdateTimer]);

  return null;
};

export const useBluetooth = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [pairingRequest, setPairingRequest] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [hasFetchedInitialDevices, setHasFetchedInitialDevices] =
    useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const networkStartRef = useRef(null);
  const networkPollRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  const isReconnecting = useRef(false);
  const listenerIdRef = useRef(null);
  const discoveryActive = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const retryDeviceAddressRef = useRef(null);
  const reconnectInitTriggeredRef = useRef(false);

  const RECONNECT_BASE_INTERVAL = 2000;
  const RECONNECT_MAX_INTERVAL = 60000;
  const INITIAL_RECONNECT_DELAY = 1000;

  useEffect(() => {
    updateBluetoothConnectionState(connectedDevices);
  }, [connectedDevices]);

  const cleanupReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const attemptReconnect = useCallback(
    async (continuous = false) => {
      if (isReconnecting.current || reconnectTimeoutRef.current) {
        return;
      }

      if (!globalWsRef || globalWsRef.readyState !== WebSocket.OPEN) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          attemptReconnect(continuous);
        }, RECONNECT_BASE_INTERVAL);
        return;
      }

      const lastDeviceAddress = localStorage.getItem(
        "lastConnectedBluetoothDevice",
      );
      if (!lastDeviceAddress) {
        cleanupReconnectTimer();
        reconnectAttemptsRef.current = 0;
        setReconnectAttempt(0);
        isReconnecting.current = false;
        window.dispatchEvent(new Event("networkBannerHide"));
        return;
      }

      try {
        isReconnecting.current = true;
        window.dispatchEvent(new Event("networkBannerShow"));

        try {
          const deviceListResp = await requestDevicesListDeduped();
          const devices = (deviceListResp && deviceListResp.payload) || [];

          const isAlreadyConnected = devices.some(
            (device) =>
              device.address === lastDeviceAddress && device.connected,
          );

          if (isAlreadyConnected) {
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            reconnectionExhausted = false;
            window.dispatchEvent(new Event("networkBannerHide"));
            window.dispatchEvent(new Event("networkScreenHide"));
            retryIsCancelled = true;
            return;
          }
        } catch (_) {}

        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);

        if (reconnectAttemptsRef.current >= 10) {
          reconnectionExhausted = true;
          window.dispatchEvent(new Event("networkScreenShow"));
        }

        const response = await queueConnectRequest(lastDeviceAddress);

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data.connected) {
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            reconnectionExhausted = false;
            retryIsCancelled = true;
            window.dispatchEvent(new Event("networkBannerHide"));
            window.dispatchEvent(new Event("networkScreenHide"));
            return;
          }
        }

        const delayTime = Math.min(
          RECONNECT_BASE_INTERVAL *
            Math.pow(2, reconnectAttemptsRef.current - 1),
          RECONNECT_MAX_INTERVAL,
        );
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          isReconnecting.current = false;
          attemptReconnect(continuous);
        }, delayTime);
      } catch (error) {
        console.error("Reconnect attempt failed:", error);
        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);

        if (reconnectAttemptsRef.current >= 10) {
          reconnectionExhausted = true;
          window.dispatchEvent(new Event("networkScreenShow"));
        }

        const delayTime = Math.min(
          RECONNECT_BASE_INTERVAL *
            Math.pow(2, reconnectAttemptsRef.current - 1),
          RECONNECT_MAX_INTERVAL,
        );
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          isReconnecting.current = false;
          attemptReconnect(continuous);
        }, delayTime);
      }
    },
    [cleanupReconnectTimer],
  );

  useEffect(() => {
    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );
    if (
      lastDeviceAddress &&
      !reconnectInitTriggeredRef.current &&
      wsConnected
    ) {
      reconnectInitTriggeredRef.current = true;
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
      isReconnecting.current = false;

      setTimeout(() => {
        attemptReconnect();
      }, INITIAL_RECONNECT_DELAY);
    }

    return () => {
      cleanupReconnectTimer();
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
      isReconnecting.current = false;
    };
  }, [wsConnected]);

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
        const resp = await requestDevicesListDeduped();
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
          console.log("Network connection established successfully");

          isPolling = false;
          clearInterval(networkPollRef.current);
          networkPollRef.current = null;
          isNetworkPollingActive = false;
          return true;
        }
      } catch (error) {
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
                .catch((error) => {
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
        retryIsCancelled = true;
        isNetworkPollingActive = false;

        const resp = await sendWsRequest("bluetooth.device.disconnect", {
          address,
        });
        if (!resp || resp.status !== "disconnected")
          throw new Error("Failed to disconnect device");

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

        const resp = await sendWsRequest("bluetooth.device.unpair", {
          address: deviceAddress,
        });
        if (!resp || (resp.error && resp.error.message)) {
          throw new Error(resp?.error?.message || "Failed to remove device");
        }

        if (
          localStorage.getItem("lastConnectedBluetoothDevice") === deviceAddress
        ) {
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

        if (topic === "bluetooth.agent") {
          if (ev.type === "bluetooth_pin" || ev.event === "request_pin_code") {
            const pairingKey = ev.pin || ev.pincode || "";
            setPairingRequest({
              pairingKey,
              address: ev.address,
              name: ev.name,
            });
          }
        } else if (topic === "bluetooth.pairing") {
          if (ev.type === "pairing_succeeded") {
            setPairingRequest(null);
          }
        } else if (topic === "bluetooth.connection") {
          if (ev.event === "connection_established") {
            const address = ev.device;
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
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            reconnectionExhausted = false;
          } else if (ev.event === "connection_closed") {
            const address = ev.device;
            setConnectedDevices((prev) =>
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
              reconnectAttemptsRef.current = 0;
              setReconnectAttempt(0);
              isReconnecting.current = false;
              if (!manualDisconnectInProgress) {
                setTimeout(() => {
                  attemptReconnect();
                }, INITIAL_RECONNECT_DELAY);
              } else {
                manualDisconnectInProgress = false;
              }
            }
          } else if (ev.event === "connection_failed") {
            window.dispatchEvent(new Event("networkBannerShow"));
          }
        }
        return;
      }
    },
    [
      stopNetworkPolling,
      startNetworkPolling,
      stopRetrying,
      attemptReconnect,
      cleanupReconnectTimer,
      fetchDevices,
    ],
  );

  const startDiscovery = useCallback(async () => {
    if (discoveryActive.current || isInitializingDiscovery) {
      return true;
    }

    try {
      isInitializingDiscovery = true;
      const resp = await sendWsRequest("bluetooth.discoverable", {
        discoverable: true,
      });
      if (!resp || (resp.status && resp.status !== "requested")) {
        throw new Error("Failed to start discovery");
      }
      discoveryActive.current = true;
      return true;
    } catch (err) {
      console.error("Error starting discovery:", err);
      return false;
    } finally {
      isInitializingDiscovery = false;
    }
  }, []);

  const stopDiscovery = useCallback(async () => {
    if (!discoveryActive.current || isStoppingDiscovery) {
      return;
    }

    try {
      isStoppingDiscovery = true;
      await sendWsRequest("bluetooth.discoverable", { discoverable: false });

      discoveryActive.current = false;
    } catch (err) {
      console.error("Failed to stop discovery:", err);
    } finally {
      isStoppingDiscovery = false;
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
    attemptReconnect,
    hasFetchedInitialDevices,
  };
};
