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
  const initialCheckCompleteRef = useRef(false);
  const hasEstablishedConnectionRef = useRef(false);

  const checkNetwork = useCallback(async () => {
    try {
      setIsChecking(true);
      const response = await checkNetworkConnectivity();

      if (response.isConnected) {
        hasEstablishedConnectionRef.current = true;
      }

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

          if (
            !hasEstablishedConnectionRef.current ||
            !initialCheckCompleteRef.current
          ) {
            if (checkCountRef.current >= 2) {
              setShowNoNetwork(true);
              setShowNetworkBanner(false);
            }
          } else {
            if (consecutiveFailuresRef.current >= 3) {
              setShowNetworkBanner(true);
              setShowNoNetwork(false);
            }
          }
        }
      } else if (response.isConnected) {
        checkCountRef.current = 0;
        consecutiveFailuresRef.current = 0;
        setShowNetworkBanner(false);
      } else {
        consecutiveFailuresRef.current++;

        if (
          !hasEstablishedConnectionRef.current ||
          !initialCheckCompleteRef.current
        ) {
          if (checkCountRef.current >= 2) {
            setShowNoNetwork(true);
            setShowNetworkBanner(false);
          }
        } else {
          if (consecutiveFailuresRef.current >= 3) {
            setShowNetworkBanner(true);
            setShowNoNetwork(false);
          }
        }
      }

      return response.isConnected;
    } catch (err) {
      console.error("Network connectivity check failed:", err);

      consecutiveFailuresRef.current++;

      if (
        !hasEstablishedConnectionRef.current ||
        !initialCheckCompleteRef.current
      ) {
        checkCountRef.current++;
        if (checkCountRef.current >= 2) {
          setShowNoNetwork(true);
          setShowNetworkBanner(false);
        }
      } else {
        if (consecutiveFailuresRef.current >= 3) {
          setShowNetworkBanner(true);
          setShowNoNetwork(false);
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
    const initialCheck = async () => {
      await checkNetwork();
      setTimeout(() => {
        initialCheckCompleteRef.current = true;
      }, 2000);
    };

    initialCheck();

    monitorCleanupRef.current = startNetworkMonitoring((connected) => {
      if (connected) {
        checkCountRef.current = 0;
        consecutiveFailuresRef.current = 0;
        setIsConnected(true);
        setShowNoNetwork(false);
        setShowNetworkBanner(false);
        hasEstablishedConnectionRef.current = true;
      } else {
        if (
          !hasEstablishedConnectionRef.current ||
          !initialCheckCompleteRef.current
        ) {
          checkCountRef.current++;
          if (checkCountRef.current >= 2) {
            setShowNoNetwork(true);
            setShowNetworkBanner(false);
          }
        } else {
          consecutiveFailuresRef.current++;
          if (consecutiveFailuresRef.current >= 3) {
            setShowNetworkBanner(true);
            setShowNoNetwork(false);
          }
        }
        setIsConnected(false);
      }
    });

    const intervalId = setInterval(checkNetwork, 1000);

    return () => {
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
