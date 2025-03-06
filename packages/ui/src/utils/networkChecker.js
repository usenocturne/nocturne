export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export async function checkNetworkConnectivity() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch("https://api.spotify.com/v1/", {
      method: "OPTIONS",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new NetworkError(`HTTP error! status: ${response.status}`);
    }

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
    if (error instanceof NetworkError) {
      return {
        isConnected: false,
        error: error.message,
      };
    }
    return {
      isConnected: false,
      error: error.message || "Network connectivity check failed",
    };
  }
}

export function startNetworkMonitoring(onStatusChange) {
  let isOnline = true;

  const checkConnection = async () => {
    try {
      const status = await checkNetworkConnectivity();
      if (!isOnline && status.isConnected) {
        isOnline = true;
        onStatusChange?.(true);
      } else if (isOnline && !status.isConnected) {
        isOnline = false;
        onStatusChange?.(false);
      }
    } catch (error) {
      if (isOnline) {
        isOnline = false;
        onStatusChange?.(false);
      }
    }
  };

  checkConnection();

  const intervalId = setInterval(checkConnection, 30000);

  window.addEventListener("online", () => {
    checkConnection();
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    onStatusChange?.(false);
  });

  return () => {
    clearInterval(intervalId);
    window.removeEventListener("online", checkConnection);
    window.removeEventListener("offline", () => {
      isOnline = false;
      onStatusChange?.(false);
    });
  };
}
