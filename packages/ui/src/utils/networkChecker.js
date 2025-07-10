export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

const STATUS_ENDPOINT = "http://localhost:5000/network/status";
let hasDaemonFailed = false;
const NETWORK_CHECK_BYPASS_KEY = "networkCheckBypass";

function isBypassed() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";
  } catch {
    return false;
  }
}

export async function checkNetworkConnectivity() {
  if (isBypassed()) {
    return { isConnected: true, source: "bypass" };
  }

  if (hasDaemonFailed) {
    return { isConnected: false, source: "daemon" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300);

    const response = await fetch(STATUS_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      hasDaemonFailed = true;
      return { isConnected: false, source: "browser" };
    }

    const data = await response.json();
    return {
      isConnected: data.status === "online",
      source: "daemon",
    };
  } catch (error) {
    hasDaemonFailed = true;
    return {
      isConnected: false,
      source: "browser",
    };
  }
}

export async function checkNetworkConnectivitySync() {
  if (isBypassed()) {
    return { isConnected: true, source: "bypass" };
  }

  if (hasDaemonFailed) {
    return { isConnected: false, source: "daemon" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300);

    const response = await fetch(STATUS_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      hasDaemonFailed = true;
      return { isConnected: false, source: "browser" };
    }

    const data = await response.json();
    return {
      isConnected: data.status === "online",
      source: "daemon",
    };
  } catch (error) {
    hasDaemonFailed = true;
    return {
      isConnected: false,
      source: "browser",
    };
  }
}

let networkWebSocket = null;