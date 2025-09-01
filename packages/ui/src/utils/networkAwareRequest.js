import { checkNetworkConnectivity } from "./networkChecker";

const LOCAL_URLS = ["172.16.42.1", "localhost"];
let currentNetworkCheckPromise = null;
let isConnected = false;
let listeners = new Set();
let lastNetworkRestoredTime = 0;
export const DNS_READY_DELAY = 5000;

const NETWORK_CHECK_BYPASS_KEY = "networkCheckBypass";

const bypassAtLoad =
  typeof window !== "undefined" &&
  localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";
if (bypassAtLoad) {
  isConnected = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    isConnected = true;
    lastNetworkRestoredTime = Date.now();
    window.dispatchEvent(new CustomEvent("networkRestored"));
  });

  window.addEventListener("offline", () => {
    isConnected = false;
  });

  (async () => {
    try {
      const status = await checkNetworkConnectivity();
      isConnected = status.isConnected;
      window.dispatchEvent(new Event(isConnected ? "online" : "offline"));
    } catch {
      isConnected = false;
    }
  })();
}

function isLocalRequest(url) {
  if (!url) return false;
  return LOCAL_URLS.some((localUrl) => url.includes(localUrl));
}

export function setupNetworkMonitoring() {
  return () => {};
}

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export function waitForNetwork(checkIntervalMs = 1000) {
  return new Promise((resolve) => {
    const bypass =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";
    if (bypass || isConnected) {
      resolve();
      return;
    }

    const handleOnline = () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("browserOnlyModeOnline", handleOnline);
      resolve();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("browserOnlyModeOnline", handleOnline);
  });
}

export function waitForStableNetwork(stabilityDelayMs = 10000) {
  return new Promise((resolve) => {
    let stabilityTimeout = null;
    let isWaitingForOnline = false;

    const cleanup = () => {
      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
        stabilityTimeout = null;
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("browserOnlyModeOnline", handleOnline);
    };

    const handleOnline = () => {
      isWaitingForOnline = false;

      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
      }

      stabilityTimeout = setTimeout(() => {
        cleanup();
        resolve();
      }, stabilityDelayMs);
    };

    const handleOffline = () => {
      isWaitingForOnline = true;

      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
        stabilityTimeout = null;
      }
    };

    if (isConnected && !isWaitingForOnline) {
      stabilityTimeout = setTimeout(() => {
        cleanup();
        resolve();
      }, stabilityDelayMs);
    } else {
      isWaitingForOnline = true;
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("browserOnlyModeOnline", handleOnline);
  });
}

export async function networkAwareRequest(
  requestFn,
  retryCount = 0,
  options = {},
) {
  const { requireNetwork = false } = options;

  try {
    const bypass =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";
    if (!bypass && !isConnected) {
      throw new Error("No network connection");
    }

    const requestInfo = await requestFn();
    const isAuthRequest = requestInfo?.url?.includes("accounts.spotify.com");
    const isLocal = isLocalRequest(requestInfo?.url);
    if (
      !bypass &&
      !isConnected &&
      !isAuthRequest &&
      (!isLocal || requireNetwork)
    ) {
      throw new Error("No network connection");
    }

    const response = await requestInfo;

    if (
      !response.ok &&
      retryCount < MAX_RETRIES &&
      (response.status >= 500 || [429, 408, 0, 304].includes(response.status))
    ) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return networkAwareRequest(requestFn, retryCount + 1, options);
    }

    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    if (retryCount < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return networkAwareRequest(requestFn, retryCount + 1, options);
    }

    throw error;
  }
}
