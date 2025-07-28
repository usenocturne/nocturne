import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "./useNetwork";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";
import { checkNetworkConnectivity } from "../utils/networkChecker";

const API_BASE = "http://localhost:5000";

let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;

let wsReconnectAttempts = 0;
let wsReconnectTimer = null;
let wsReconnectInProgress = false;
const WS_MAX_RECONNECT_ATTEMPTS = 30;
const WS_RECONNECT_INTERVAL = 2000; // 2 seconds

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;
let isConnectRequestInProgress = false;
let connectRequestQueue = [];

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(
      `${API_BASE}/bluetooth/connect/${request.deviceAddress}`,
      {
        method: "POST",
        signal: controller.signal,
        ...request.options,
      },
    );

    clearTimeout(timeoutId);

    let connectionSuccessful = false;

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      connectionSuccessful = data.connected !== false;

      if (connectionSuccessful) {
        while (connectRequestQueue.length > 0) {
          const pendingRequest = connectRequestQueue.shift();
          pendingRequest.reject(
            new Error("Connection already established to another device"),
          );
        }
      }
    }

    request.resolve(response);

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
  if (
    wsReconnectInProgress ||
    wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS
  ) {
    return;
  }

  wsReconnectInProgress = true;
  wsReconnectAttempts++;

  console.log(
    `WebSocket reconnection attempt ${wsReconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS}`,
  );

  wsReconnectTimer = setTimeout(() => {
    wsReconnectInProgress = false;
    setupGlobalWebSocket();
  }, WS_RECONNECT_INTERVAL);
};

const setupGlobalWebSocket = async () => {
  if (globalWsRef && globalWsRef.readyState === WebSocket.CONNECTING) return;

  try {
    console.log("Connecting to WebSocket...");
    const socket = new WebSocket(`ws://${API_BASE.replace("http://", "")}/ws`);
    globalWsRef = socket;

    socket.onopen = async () => {
      console.log("Connected to WebSocket");
      cleanupWsReconnection();

      try {
        const networkStatus = await checkNetworkConnectivity();
        console.log(
          "Network status after WebSocket reconnection:",
          networkStatus,
        );

        if (networkStatus.isConnected) {
          window.dispatchEvent(new Event("online"));
          window.dispatchEvent(new CustomEvent("networkRestored"));
        } else {
          window.dispatchEvent(new Event("offline"));
        }
      } catch (error) {
        console.error(
          "Failed to check network status after WebSocket reconnection:",
          error,
        );
      }

      globalWsListeners.forEach(
        (listener) => listener.onOpen && listener.onOpen(socket),
      );
    };

    socket.onclose = (event) => {
      console.log("Disconnected from WebSocket");
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

        const response = await networkAwareRequest(() => fetch(url, options), {
          skipNetworkCheck: true,
        });

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

export const useNocturneVersion = () => {
  const [version, setVersion] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const { apiRequest } = useNocturned();

  const fetchVersion = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const data = await apiRequest("/info");

      if (data && data.version) {
        const cleanVersion = data.version.replace(/^v/, "");
        setVersion(cleanVersion);
      } else {
        setVersion(null);
      }
    } catch (err) {
      console.error("Failed to fetch version from nocturned:", err);
      setError(err.message);
      setVersion(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

  return {
    version,
    isLoading,
    error,
    refetch: fetchVersion,
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
  const listenerIdRef = useRef(null);
  const lastSuccessfulStageRef = useRef(null);

  const checkUpdateStatus = useCallback(async () => {
    try {
      const status = await apiRequest("/update/status");
      setUpdateStatus(status);
      setIsUpdating(status.inProgress);

      if (status.stage) {
        lastSuccessfulStageRef.current = status.stage;
      }

      if (status.error) {
        setIsError(true);
        setErrorMessage(status.error);
      } else {
        setIsError(false);
        setErrorMessage("");
      }

      return status;
    } catch (error) {
      console.error("Error checking update status:", error);
      return null;
    }
  }, [apiRequest]);

  const startUpdate = useCallback(
    async (imageURL, sum) => {
      try {
        setIsUpdating(true);
        setIsError(false);
        setErrorMessage("");

        setProgress({
          bytesComplete: 0,
          bytesTotal: 0,
          speed: 0,
          percent: 0,
        });

        const data = await apiRequest("/update", "POST", {
          image_url: imageURL,
          sum,
        });

        return data;
      } catch (error) {
        console.error("Error starting update:", error);
        setIsUpdating(false);
        setIsError(true);
        setErrorMessage(`Failed to start update: ${error.message}`);
        return null;
      }
    },
    [apiRequest],
  );

  const handleWsMessage = useCallback(
    (data) => {
      if (data.type === "progress") {
        setProgress({
          bytesComplete: data.bytes_complete,
          bytesTotal: data.bytes_total,
          speed: data.speed,
          percent: data.percent,
        });

        if (data.stage) {
          lastSuccessfulStageRef.current = data.stage;
          setUpdateStatus((prev) => ({
            ...prev,
            stage: data.stage,
            inProgress: true,
          }));
        }
      } else if (data.type === "completion") {
        if (data.success) {
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            stage: "complete",
          }));
          setIsUpdating(false);
        } else {
          setIsError(true);
          setErrorMessage(data.error || "Update failed");
          setIsUpdating(false);
          setUpdateStatus((prev) => ({
            ...prev,
            inProgress: false,
            error: data.error || "Update failed",
          }));
        }

        checkUpdateStatus();
      }
    },
    [checkUpdateStatus],
  );

  useEffect(() => {
    let statusIntervalId = null;

    if (isUpdating) {
      statusIntervalId = setInterval(() => {
        checkUpdateStatus();
      }, 5000);
    }

    return () => {
      if (statusIntervalId) {
        clearInterval(statusIntervalId);
      }
    };
  }, [isUpdating, checkUpdateStatus]);

  useEffect(() => {
    const listenerId = addMessageListener("system-update", handleWsMessage);
    listenerIdRef.current = listenerId;

    checkUpdateStatus();

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [
    addMessageListener,
    removeMessageListener,
    handleWsMessage,
    checkUpdateStatus,
  ]);

  return {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage,
    wsConnected,
    startUpdate,
    checkUpdateStatus,
  };
};

export const useBluetooth = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [pairingRequest, setPairingRequest] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState([]);
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

  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL = 5000;
  const INITIAL_RECONNECT_DELAY = 1000;

  const { isConnected: isInternetConnected } = useNetwork();
  const networkCheckBypass =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("networkCheckBypass") === "true";

  const skipBluetoothStep = isInternetConnected || networkCheckBypass;

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

      if (
        !continuous &&
        reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
      ) {
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const devicesResponse = await fetch(`${API_BASE}/bluetooth/devices`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (devicesResponse.ok) {
          const devices = await devicesResponse.json();

          const isAlreadyConnected = devices.some(
            (device) =>
              device.address === lastDeviceAddress && device.connected,
          );

          if (isAlreadyConnected) {
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            window.dispatchEvent(new Event("networkBannerHide"));
            retryIsCancelled = true;
            return;
          }
        }

        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);

        await new Promise((r) => setTimeout(r, 5000));

        const response = await queueConnectRequest(lastDeviceAddress);

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data.connected) {
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            retryIsCancelled = true;
            window.dispatchEvent(new Event("networkBannerHide"));
            return;
          }
        }

        if (
          continuous ||
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          const delayTime = continuous
            ? Math.max(RECONNECT_INTERVAL, 5000)
            : RECONNECT_INTERVAL;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            isReconnecting.current = false;
            if (continuous) {
              attemptReconnect(true);
            } else {
              attemptReconnect();
            }
          }, delayTime);
        } else {
          cleanupReconnectTimer();
          isReconnecting.current = false;
          window.dispatchEvent(new Event("networkBannerHide"));
        }
      } catch (error) {
        console.error("Reconnect attempt failed:", error);
        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);

        if (
          continuous ||
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          const delayTime = continuous
            ? Math.max(RECONNECT_INTERVAL, 5000)
            : RECONNECT_INTERVAL;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            isReconnecting.current = false;
            if (continuous) {
              attemptReconnect(true);
            } else {
              attemptReconnect();
            }
          }, delayTime);
        } else {
          cleanupReconnectTimer();
          isReconnecting.current = false;
          window.dispatchEvent(new Event("networkBannerHide"));
        }
      }
    },
    [cleanupReconnectTimer],
  );

  useEffect(() => {
    if (skipBluetoothStep) {
      return;
    }

    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );
    if (lastDeviceAddress) {
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
  }, [attemptReconnect, cleanupReconnectTimer, skipBluetoothStep]);

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
    if (isDevicesFetching && !force) {
      return [];
    }

    try {
      isDevicesFetching = true;
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/devices`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("Failed to fetch devices");
      }

      const data = await response.json();
      setDevices(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
      isDevicesFetching = false;
    }
  }, []);

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

  const connectDevice = useCallback(
    async (deviceAddress) => {
      try {
        setLoading(true);
        stopRetrying();
        retryIsCancelled = false;
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
                    startNetworkPolling(deviceAddress);
                    retryIsCancelled = true;
                    window.dispatchEvent(new Event("networkBannerHide"));
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
        startNetworkPolling(deviceAddress);
        window.dispatchEvent(new Event("networkBannerHide"));
        return true;
      } catch (err) {
        window.dispatchEvent(new Event("networkBannerShow"));
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fetchDevices, stopRetrying, startNetworkPolling],
  );

  const disconnectDevice = useCallback(
    async (address) => {
      try {
        stopNetworkPolling();
        stopRetrying();
        retryIsCancelled = true;
        isNetworkPollingActive = false;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(
          `${API_BASE}/bluetooth/disconnect/${address}`,
          {
            method: "POST",
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error("Failed to disconnect device");

        localStorage.removeItem("lastConnectedBluetoothDevice");

        setTimeout(() => {
          stopNetworkPolling();
          stopRetrying();
        }, 100);

        await fetchDevices(true);
        return true;
      } catch (error) {
        console.error("Error disconnecting:", error);
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(
          `${API_BASE}/bluetooth/remove/${deviceAddress}`,
          {
            method: "POST",
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to remove device");
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
      switch (data.type) {
        case "bluetooth/pairing":
          setPairingRequest(data.payload);
          break;

        case "bluetooth/paired":
          setPairingRequest(null);
          setConnectedDevices((prev) => [...prev, data.payload.device]);
          setLastConnectedDevice(data.payload.device);
          localStorage.setItem(
            "lastConnectedBluetoothDevice",
            data.payload.device.address,
          );
          setTimeout(() => {
            startNetworkPolling(data.payload.device.address);
          }, 5000);
          window.dispatchEvent(new Event("networkBannerHide"));
          clearConnectQueue();
          break;

        case "bluetooth/connect":
          startNetworkPolling(data.payload.address);
          window.dispatchEvent(new Event("networkBannerHide"));
          cleanupReconnectTimer();
          reconnectAttemptsRef.current = 0;
          setReconnectAttempt(0);
          isReconnecting.current = false;
          clearConnectQueue();
          break;

        case "network_status":
          if (data.payload.status === "online") {
            cleanupReconnectTimer();
            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            retryIsCancelled = true;
            clearConnectQueue();
            window.dispatchEvent(new Event("networkBannerHide"));
          }
          break;

        case "bluetooth/disconnect":
          setConnectedDevices((prev) =>
            prev.filter((device) => device.address !== data.payload.address),
          );
          if (lastConnectedDevice?.address === data.payload.address) {
            setLastConnectedDevice(null);
            stopNetworkPolling();
            stopRetrying();
            window.dispatchEvent(new Event("offline"));

            reconnectAttemptsRef.current = 0;
            setReconnectAttempt(0);
            isReconnecting.current = false;
            setTimeout(() => {
              attemptReconnect();
            }, INITIAL_RECONNECT_DELAY);
          }
          break;

        case "bluetooth/network/disconnect":
          window.dispatchEvent(new Event("offline"));

          if (isReconnecting.current) {
            cleanupReconnectTimer();
            isReconnecting.current = false;
          }

          reconnectAttemptsRef.current = 0;
          setReconnectAttempt(0);

          setTimeout(() => {
            attemptReconnect();
          }, INITIAL_RECONNECT_DELAY);
          break;

        default:
          break;
      }
    },
    [
      lastConnectedDevice,
      stopNetworkPolling,
      startNetworkPolling,
      stopRetrying,
      attemptReconnect,
      cleanupReconnectTimer,
    ],
  );

  const startDiscovery = useCallback(async () => {
    if (discoveryActive.current || isInitializingDiscovery) {
      return true;
    }

    try {
      isInitializingDiscovery = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/discover/on`, {
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      await fetch(`${API_BASE}/bluetooth/discover/off`, {
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/accept`, {
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error("Failed to accept pairing");
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/deny`, {
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error("Failed to deny pairing");
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
    disconnectDevice,
    forgetDevice,
    enableNetworking,
    wsConnected,
    stopRetrying,
    reconnectAttempt,
    attemptReconnect,
  };
};
