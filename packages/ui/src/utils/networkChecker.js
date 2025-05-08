export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export async function checkNetworkConnectivity() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch("https://1.1.1.1/", {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      isConnected: true,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        isConnected: false,
        error: "Network request timed out",
      };
    }

    return {
      isConnected: false,
      error: error.message || "Network connectivity check failed",
    };
  }
}

export function startNetworkMonitoring(onStatusChange) {
  const handleOnline = async () => {
    const status = await checkNetworkConnectivity();
    if (status.isConnected) {
      onStatusChange?.(true);
    }
  };

  const handleOffline = () => {
    onStatusChange?.(false);
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
