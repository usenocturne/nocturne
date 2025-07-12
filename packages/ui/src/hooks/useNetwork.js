import { useState, useEffect, useRef, useCallback } from "react";
import { useNocturned, addGlobalWsListener } from "./useNocturned";
import { checkNetworkConnectivitySync } from "../utils/networkChecker";

const NETWORK_CHECK_BYPASS_KEY = "networkCheckBypass";

const isBypassed =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";

const ALLOWED_AUTH_ENDPOINTS = [
  "accounts.spotify.com/oauth2/device/authorize",
  "accounts.spotify.com/api/token",
];

const isAuthEndpoint = (url) =>
  ALLOWED_AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint));

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(isBypassed ? true : null);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(
    isBypassed ? true : false,
  );
  const [initialConnectionFailed, setInitialConnectionFailed] = useState(false);
  const [hasEverConnectedThisSession, setHasEverConnectedThisSession] =
    useState(isBypassed ? true : false);
  const { wsConnected, addMessageListener, removeMessageListener } =
    useNocturned();
  const listenerIdRef = useRef(null);
  const globalListenerCleanupRef = useRef(null);
  const checkInProgressRef = useRef(false);

  const isInTutorial = !localStorage.getItem("hasSeenTutorial");

  const updateConnectionStatus = useCallback(
    (newIsConnected) => {
      setIsConnected((prev) => {
        if (prev === newIsConnected) return prev;

        if (newIsConnected) {
          if (!hasEverConnectedThisSession) {
            setHasEverConnectedThisSession(true);
          }
          setShowNetworkBanner(false);
          window.dispatchEvent(new Event("networkBannerHide"));
          window.dispatchEvent(new Event("networkRestored"));
        } else if (!isInTutorial) {
          setShowNetworkBanner(true);
          window.dispatchEvent(new Event("networkBannerShow"));
        }
        return newIsConnected;
      });
    },
    [isInTutorial, hasEverConnectedThisSession],
  );

  const performNetworkCheck = useCallback(async () => {
    if (checkInProgressRef.current) return;
    checkInProgressRef.current = true;

    try {
      const bypass = localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true";
      if (bypass) {
        updateConnectionStatus(true);
        return;
      }

      const status = await checkNetworkConnectivitySync();
      updateConnectionStatus(status.isConnected);

      if (status.source === "browser" && status.isConnected) {
        window.dispatchEvent(new CustomEvent("browserOnlyModeOnline"));
      }
    } catch (error) {
      console.error("Network check failed:", error);
      updateConnectionStatus(false);
    } finally {
      checkInProgressRef.current = false;
    }
  }, [updateConnectionStatus]);

  useEffect(() => {
    const handleGlobalNetworkStatus = (data) => {
      if (data.type === "network_status") {
        const isOnline = data.payload?.status === "online";
        updateConnectionStatus(isOnline);
      }
    };

    globalListenerCleanupRef.current = addGlobalWsListener(
      "network-global-listener",
      {
        onMessage: handleGlobalNetworkStatus,
      },
    );

    return () => {
      if (globalListenerCleanupRef.current) {
        globalListenerCleanupRef.current();
      }
    };
  }, [updateConnectionStatus]);

  useEffect(() => {
    let mounted = true;

    if (isBypassed) {
      updateConnectionStatus(true);
      setInitialCheckDone(true);
      return;
    }

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

      if (status.source === "browser" && status.isConnected) {
        window.dispatchEvent(new CustomEvent("browserOnlyModeOnline"));
      }
    };

    initialCheck();
    return () => {
      mounted = false;
    };
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
        updateConnectionStatus(true);
        performNetworkCheck();
      };

      const listenerId = addMessageListener(
        "network-status-listener",
        handleNetworkStatusMessage,
      );
      listenerIdRef.current = listenerId;

      window.addEventListener("offline", handleOfflineEvent);
      window.addEventListener("online", handleOnlineEvent);

      return () => {
        if (listenerIdRef.current) {
          removeMessageListener(listenerIdRef.current);
        }
        window.removeEventListener("offline", handleOfflineEvent);
        window.removeEventListener("online", handleOnlineEvent);
      };
    } else if (initialCheckDone) {
      performNetworkCheck();
    }

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [
    wsConnected,
    addMessageListener,
    removeMessageListener,
    initialCheckDone,
    performNetworkCheck,
    updateConnectionStatus,
  ]);

  return {
    isConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
    isAuthEndpoint,
  };
}
