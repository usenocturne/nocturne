import { useState, useEffect, useRef, useCallback } from "react";
import {
  checkNetworkConnectivity,
  startNetworkMonitoring,
} from "../utils/networkChecker";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(true);
  const [showNoNetwork, setShowNoNetwork] = useState(false);
  const checkCountRef = useRef(0);
  const monitorCleanupRef = useRef(null);

  const checkNetwork = useCallback(async () => {
    try {
      setIsChecking(true);
      const response = await checkNetworkConnectivity();

      if (response.isConnected !== isConnected) {
        setIsConnected(response.isConnected);

        if (response.isConnected) {
          checkCountRef.current = 0;
          setShowNoNetwork(false);
        } else {
          checkCountRef.current++;
          if (checkCountRef.current >= 1) {
            setShowNoNetwork(true);
          }
        }
      } else if (response.isConnected) {
        checkCountRef.current = 0;
      }

      return response.isConnected;
    } catch (error) {
      console.error("Network connectivity check failed:", error);

      if (isConnected) {
        setIsConnected(false);
        checkCountRef.current++;
        if (checkCountRef.current >= 1) {
          setShowNoNetwork(true);
        }
      }

      return false;
    } finally {
      setIsChecking(false);
    }
  }, [isConnected]);

  useEffect(() => {
    const initialCheckId = setTimeout(() => {
      checkNetwork();
    }, 500);

    monitorCleanupRef.current = startNetworkMonitoring((connected) => {
      if (connected) {
        checkCountRef.current = 0;
        setIsConnected(true);
        setShowNoNetwork(false);
      } else {
        checkCountRef.current++;
        setIsConnected(false);
        if (checkCountRef.current >= 1) {
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
    checkNetwork,
  };
}
