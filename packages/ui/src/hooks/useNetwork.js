import { useState, useEffect, useRef, useCallback } from "react";
import { useNocturned } from "./useNocturned";
import { checkNetworkConnectivity } from "../utils/networkChecker";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [initialConnectionFailed, setInitialConnectionFailed] = useState(false);
  const [hasEverConnectedThisSession, setHasEverConnectedThisSession] = useState(false);
  const { wsConnected, addMessageListener, removeMessageListener } = useNocturned();
  const fallbackIntervalRef = useRef(null);
  const listenerIdRef = useRef(null);

  const isInTutorial = !localStorage.getItem("hasSeenTutorial");

  const updateConnectionStatus = useCallback((newIsConnected) => {
    setIsConnected(newIsConnected);
    if (newIsConnected) {
      if (!hasEverConnectedThisSession) {
        setHasEverConnectedThisSession(true);
      }
      setShowNetworkBanner(false);
    } else {
      if (!isInTutorial) {
        setShowNetworkBanner(true);
      }
    }
  }, [isInTutorial, hasEverConnectedThisSession]);

  const performDirectNetworkCheck = useCallback(async (isFallback = false) => {
    try {
      const status = await checkNetworkConnectivity();
      updateConnectionStatus(status.isConnected);
      if (isFallback && status.isConnected && wsConnected) {
        if (fallbackIntervalRef.current) {
          clearInterval(fallbackIntervalRef.current);
          fallbackIntervalRef.current = null;
        }
      }
      return status.isConnected;
    } catch (error) {
      console.error("Direct network check failed:", error);
      updateConnectionStatus(false);
      return false;
    }
  }, [updateConnectionStatus, wsConnected]);

  useEffect(() => {
    performDirectNetworkCheck().then((connected) => {
      if (!connected) {
        setInitialConnectionFailed(true);
      } else {
        setHasEverConnectedThisSession(true);
      }
      setInitialCheckDone(true);
    });
  }, [performDirectNetworkCheck]);

  useEffect(() => {
    if (wsConnected) {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }

      const handleNetworkStatusMessage = (data) => {
        if (data.type === "network_status") {
          updateConnectionStatus(data.payload.status === "online");
        }
      };

      const listenerId = addMessageListener("network-status-listener", handleNetworkStatusMessage);
      listenerIdRef.current = listenerId;

      return () => {
        if (listenerIdRef.current) {
          removeMessageListener(listenerIdRef.current);
        }
      };
    } else if (initialCheckDone) {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
      fallbackIntervalRef.current = setInterval(() => {
        performDirectNetworkCheck(true);
      }, 5000);
    }

    return () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [wsConnected, addMessageListener, removeMessageListener, isInTutorial, initialCheckDone, performDirectNetworkCheck, updateConnectionStatus]);

  return {
    isConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
  };
}
