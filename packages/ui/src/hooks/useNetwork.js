import { useState, useEffect, useRef, useCallback } from "react";
import {
  checkNetworkConnectivity,
  startNetworkMonitoring,
} from "../utils/networkChecker";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(true);
  const [showNoNetwork, setShowNoNetwork] = useState(false);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const checkCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const monitorCleanupRef = useRef(null);

  const checkNetwork = useCallback(async () => {
    try {
      setIsChecking(true);
      const response = await checkNetworkConnectivity();

      if (response.isConnected !== isConnected) {
        setIsConnected(response.isConnected);

        if (response.isConnected) {
          checkCountRef.current = 0;
          consecutiveFailuresRef.current = 0;
          setShowNoNetwork(false);
          setShowNetworkBanner(false);
        } else {
          checkCountRef.current++;
          consecutiveFailuresRef.current++;

          if (consecutiveFailuresRef.current >= 3) {
            setShowNetworkBanner(true);
          }

          if (checkCountRef.current >= 2) {
            setShowNoNetwork(true);
          }
        }
      } else if (response.isConnected) {
        checkCountRef.current = 0;
        consecutiveFailuresRef.current = 0;
        setShowNetworkBanner(false);
      } else {
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= 3) {
          setShowNetworkBanner(true);
        }
      }

      return response.isConnected;
    } catch (error) {
      console.error("Network connectivity check failed:", error);

      if (isConnected) {
        setIsConnected(false);
        checkCountRef.current++;
        consecutiveFailuresRef.current++;

        if (consecutiveFailuresRef.current >= 3) {
          setShowNetworkBanner(true);
        }

        if (checkCountRef.current >= 2) {
          setShowNoNetwork(true);
        }
      } else {
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= 3) {
          setShowNetworkBanner(true);
        }
      }

      return false;
    } finally {
      setIsChecking(false);
    }
  }, [isConnected]);

  const dismissNetworkBanner = useCallback(() => {
    setShowNetworkBanner(false);
  }, []);

  useEffect(() => {
    const initialCheckId = setTimeout(() => {
      checkNetwork();
    }, 500);

    monitorCleanupRef.current = startNetworkMonitoring((connected) => {
      if (connected) {
        checkCountRef.current = 0;
        consecutiveFailuresRef.current = 0;
        setIsConnected(true);
        setShowNoNetwork(false);
        setShowNetworkBanner(false);
      } else {
        checkCountRef.current++;
        consecutiveFailuresRef.current++;
        setIsConnected(false);

        if (consecutiveFailuresRef.current >= 3) {
          setShowNetworkBanner(true);
        }

        if (checkCountRef.current >= 2) {
          setShowNoNetwork(true);
        }
      }
    });

    const intervalId = setInterval(checkNetwork, 1000);

    return () => {
      clearTimeout(initialCheckId);
      clearInterval(intervalId);
      if (monitorCleanupRef.current) {
        monitorCleanupRef.current();
      }
    };
  }, [checkNetwork]);

  return {
    isConnected,
    isChecking,
    showNoNetwork,
    showNetworkBanner,
    dismissNetworkBanner,
    checkNetwork,
  };
}
