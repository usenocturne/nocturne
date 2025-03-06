import { useState, useEffect, useRef, useCallback } from "react";
import {
  checkNetworkConnectivity,
  startNetworkMonitoring,
} from "../utils/networkChecker";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [showNoNetwork, setShowNoNetwork] = useState(false);
  const initialCheckTimeoutRef = useRef(null);
  const initialCheckDoneRef = useRef(false);
  const cleanupRef = useRef(null);

  const checkNetwork = useCallback(async () => {
    try {
      setIsChecking(true);
      const response = await checkNetworkConnectivity();
      setIsConnected(response.isConnected);
      initialCheckDoneRef.current = true;

      if (response.isConnected && initialCheckTimeoutRef.current) {
        clearTimeout(initialCheckTimeoutRef.current);
        initialCheckTimeoutRef.current = null;
      }

      return response.isConnected;
    } catch (error) {
      console.error("Network connectivity check failed:", error);
      setIsConnected(false);
      initialCheckDoneRef.current = true;
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    initialCheckTimeoutRef.current = setTimeout(() => {
      if (!initialCheckDoneRef.current) {
        setShowNoNetwork(true);
      }
    }, 5000);

    checkNetwork();

    cleanupRef.current = startNetworkMonitoring((connected) => {
      setIsConnected(connected);
    });

    const intervalId = setInterval(checkNetwork, 10000);

    return () => {
      if (initialCheckTimeoutRef.current) {
        clearTimeout(initialCheckTimeoutRef.current);
      }
      clearInterval(intervalId);
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, [checkNetwork]);

  useEffect(() => {
    let timeoutId;
    if (!isConnected && initialCheckDoneRef.current) {
      timeoutId = setTimeout(() => {
        setShowNoNetwork(true);
      }, 10000);
    } else {
      setShowNoNetwork(false);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isConnected]);

  return {
    isConnected,
    isChecking,
    showNoNetwork,
    checkNetwork,
  };
}
