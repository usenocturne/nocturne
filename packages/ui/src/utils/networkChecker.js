export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

const STATUS_ENDPOINT = "http://localhost:5000/network/status";

const CACHE_WINDOW_MS = 3000;
let lastCheckTimestamp = 0;
let lastCheckResult = null;
let inFlightPromise = null;

async function fetchNetworkStatus() {
  await new Promise((r) => setTimeout(r, 5000));
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
      throw new Error("Non-200 status");
    }

    const data = await response.json();
    return {
      isConnected: data.status === "online",
      source: "daemon",
    };
  } catch {
    return { isConnected: false, source: "browser" };
  }
}

function maybeUseCache() {
  if (Date.now() - lastCheckTimestamp < CACHE_WINDOW_MS && lastCheckResult) {
    return lastCheckResult;
  }
  return null;
}

function updateCache(result) {
  lastCheckTimestamp = Date.now();
  lastCheckResult = result;
  return result;
}

let hasDaemonFailed = false;
const NETWORK_CHECK_BYPASS_KEY = "networkCheckBypass";

function isBypassed() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export async function checkNetworkConnectivity() {
  const bypassResult = isBypassed();
  if (bypassResult) return { isConnected: true, source: "bypass" };

  const cached = maybeUseCache();
  if (cached) return cached;

  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = fetchNetworkStatus().then((res) => {
    inFlightPromise = null;
    return updateCache(res);
  });

  return inFlightPromise;
}

export async function checkNetworkConnectivitySync() {
  const bypassResult = isBypassed();
  if (bypassResult) return { isConnected: true, source: "bypass" };

  const cached = maybeUseCache();
  if (cached) return cached;

  if (inFlightPromise) return inFlightPromise;

  const result = await fetchNetworkStatus();
  return updateCache(result);
}

let networkWebSocket = null;
