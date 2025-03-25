import { createContext, useContext, useState, useEffect } from 'react';

const API_BASE = 'https://172.16.42.1:20574';

const ConnectorContext = createContext({
  isConnectorAvailable: false,
  isLoading: true,
  connectorInfo: {}
});

export function ConnectorProvider({ children }) {
  const [isConnectorAvailable, setIsConnectorAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [connectorInfo, setConnectorInfo] = useState({});

  useEffect(() => {
    const checkConnectorAvailability = async () => {
      try {
        const response = await fetch(`${API_BASE}/info`);
        setConnectorInfo(response.json());
        setIsConnectorAvailable(response.ok);
      } catch (error) {
        setIsConnectorAvailable(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkConnectorAvailability();
  }, []);

  return (
    <ConnectorContext.Provider value={{ isConnectorAvailable, isLoading, connectorInfo }}>
      {children}
    </ConnectorContext.Provider>
  );
}

export function useConnector() {
  return useContext(ConnectorContext);
} 