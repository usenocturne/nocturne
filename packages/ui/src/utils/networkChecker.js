export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

const STATUS_ENDPOINT = "http://localhost:5000/network/status";
let hasDaemonFailed = false;

export async function checkNetworkConnectivity() {
  if (hasDaemonFailed) {
    return { isConnected: navigator.onLine, source: "browser" };
  }

  if (!navigator.onLine) {
    return { isConnected: false, source: "browser" };
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
      return { isConnected: navigator.onLine, source: "browser" };
    }

    const data = await response.json();
    return {
      isConnected: data.status === "online",
      source: "daemon",
    };
  } catch (error) {
    hasDaemonFailed = true;
    return {
      isConnected: navigator.onLine,
      source: "browser",
    };
  }
}

export async function checkNetworkConnectivitySync() {
  if (hasDaemonFailed) {
    return { isConnected: navigator.onLine, source: "browser" };
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
      return { isConnected: navigator.onLine, source: "browser" };
    }

    const data = await response.json();
    return {
      isConnected: data.status === "online",
      source: "daemon",
    };
  } catch (error) {
    hasDaemonFailed = true;
    return {
      isConnected: navigator.onLine,
      source: "browser",
    };
  }
}

let networkWebSocket = null;