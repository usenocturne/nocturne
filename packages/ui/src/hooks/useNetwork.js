import { useState, useEffect, useRef, useCallback } from "react";
import { useNocturned } from "./useNocturned";
import { checkNetworkConnectivitySync } from "../utils/networkChecker";

const ALLOWED_AUTH_ENDPOINTS = [
  'accounts.spotify.com/oauth2/device/authorize',
  'accounts.spotify.com/api/token'
];

const isAuthEndpoint = (url) => ALLOWED_AUTH_ENDPOINTS.some(endpoint => url.includes(endpoint));

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(null);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [initialConnectionFailed, setInitialConnectionFailed] = useState(false);
  const [hasEverConnectedThisSession, setHasEverConnectedThisSession] = useState(false);
  const { wsConnected, addMessageListener, removeMessageListener } = useNocturned();
  const listenerIdRef = useRef(null);
  const checkInProgressRef = useRef(false);

  const isInTutorial = !localStorage.getItem("hasSeenTutorial");

  const updateConnectionStatus = useCallback((newIsConnected) => {
    setIsConnected(prev => {
      if (prev === newIsConnected) return prev;
      
      if (newIsConnected) {
        if (!hasEverConnectedThisSession) {
          setHasEverConnectedThisSession(true);
        }
        setShowNetworkBanner(false);
        window.dispatchEvent(new Event('networkBannerHide'));
      } else if (!isInTutorial) {
        setShowNetworkBanner(true);
        window.dispatchEvent(new Event('networkBannerShow'));
      }
      return newIsConnected;
    });
  }, [isInTutorial, hasEverConnectedThisSession]);

  const performNetworkCheck = useCallback(async () => {
    if (checkInProgressRef.current) return;
    checkInProgressRef.current = true;

    try {
      const status = await checkNetworkConnectivitySync();
      updateConnectionStatus(status.isConnected);
      
      if (status.source === 'browser') {
        const online = navigator.onLine;
        updateConnectionStatus(online);
        
        if (online) {
          window.dispatchEvent(new CustomEvent('browserOnlyModeOnline'));
        }
      }
    } catch (error) {
      console.error("Network check failed:", error);
      updateConnectionStatus(navigator.onLine);
    } finally {
      checkInProgressRef.current = false;
    }
  }, [updateConnectionStatus]);

  useEffect(() => {
    let mounted = true;
    
    const initialCheck = async () => {
      const status = await checkNetworkConnectivitySync();
      if (!mounted) return;
      
      updateConnectionStatus(status.isConnected);
      
      if (!status.isConnected) {
        setInitialConnectionFailed(true);
      } else {
        setHasEverConnectedThisSession(true);
      }
      setInitialCheckDone(true);

      if (status.source === 'browser' && navigator.onLine) {
        window.dispatchEvent(new CustomEvent('browserOnlyModeOnline'));
      }
    };

    initialCheck();
    return () => { mounted = false; };
  }, [updateConnectionStatus]);

  useEffect(() => {
    if (wsConnected) {
      const handleNetworkStatusMessage = (data) => {
        if (data.type === "network_status") {
          const isOnline = data.payload?.status === "online";
          updateConnectionStatus(isOnline);
        }
      };

      const handleOfflineEvent = () => {
        updateConnectionStatus(false);
      };

      const handleOnlineEvent = () => {
        updateConnectionStatus(navigator.onLine);
        performNetworkCheck();
      };

      const listenerId = addMessageListener("network-status-listener", handleNetworkStatusMessage);
      listenerIdRef.current = listenerId;

      window.addEventListener('offline', handleOfflineEvent);
      window.addEventListener('online', handleOnlineEvent);

      return () => {
        if (listenerIdRef.current) {
          removeMessageListener(listenerIdRef.current);
        }
        window.removeEventListener('offline', handleOfflineEvent);
        window.removeEventListener('online', handleOnlineEvent);
      };
    } else if (initialCheckDone) {
      updateConnectionStatus(navigator.onLine);
      performNetworkCheck();
    }

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [wsConnected, addMessageListener, removeMessageListener, initialCheckDone, performNetworkCheck, updateConnectionStatus]);

  return {
    isConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
    isAuthEndpoint,
  };
}
