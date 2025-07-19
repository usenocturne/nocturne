import { createContext, useContext, useState, useEffect } from "react";

const API_BASE = "http://172.16.42.1:20574";

const ConnectorContext = createContext({
  isConnectorAvailable: false,
  isLoading: true,
  connectorInfo: {},
});

export function ConnectorProvider({ children }) {
  const [isConnectorAvailable, setIsConnectorAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [connectorInfo, setConnectorInfo] = useState({});

  useEffect(() => {
    let intervalId;
    const POLL_INTERVAL = 15000;
    const POLL_DURATION = 180000;
    const startTime = Date.now();

    let connectorFound = false;

    const checkConnectorAvailability = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${API_BASE}/info`, {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setConnectorInfo(data);
          setIsConnectorAvailable(true);
          connectorFound = true;
          clearInterval(intervalId);
        } else {
          setIsConnectorAvailable(false);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        setIsConnectorAvailable(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkConnectorAvailability();

    intervalId = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= POLL_DURATION || connectorFound) {
        clearInterval(intervalId);
        return;
      }
      checkConnectorAvailability();
    }, POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <ConnectorContext.Provider
      value={{
        isConnectorAvailable,
        isLoading,
        connectorInfo,
      }}
    >
      {children}
    </ConnectorContext.Provider>
  );
}

export function useConnector() {
  return useContext(ConnectorContext);
}
