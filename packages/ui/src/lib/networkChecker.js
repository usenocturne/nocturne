export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export async function checkNetworkConnectivity(accessToken) {
  if (!accessToken) {
    throw new NetworkError("No access token available");
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      "https://api.spotify.com/v1/me/player/devices",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new NetworkError("Authorization error");
      }
      throw new NetworkError(`HTTP error! status: ${response.status}`);
    }

    return {
      isConnected: true,
      hasDevices: async () => {
        const data = await response.json();
        return data.devices && data.devices.length > 0;
      },
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new NetworkError("Network request timed out");
    }
    if (error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(
      error.message || "Network connectivity check failed"
    );
  }
}

export async function waitForNetwork(
  accessToken,
  maxAttempts = 3,
  delayMs = 2000
) {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const status = await checkNetworkConnectivity(accessToken);
      return status;
    } catch (error) {
      attempts++;
      if (attempts === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function startNetworkMonitoring(accessToken, onStatusChange) {
  let isOnline = true;

  const checkConnection = async () => {
    try {
      await checkNetworkConnectivity(accessToken);
      if (!isOnline) {
        isOnline = true;
        onStatusChange?.(true);
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

  window.addEventListener("online", checkConnection);
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
