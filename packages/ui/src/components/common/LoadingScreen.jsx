import React, { useEffect, useState } from "react";
import { useBluetooth } from "../../hooks/useNocturned";
import { useConnector } from "../../contexts/ConnectorContext";
import { useNetwork } from "../../hooks/useNetwork";
import { useAuth } from "../../hooks/useAuth";
import { waitForStableNetwork } from "../../utils/networkAwareRequest";
import { useGradientState } from "../../hooks/useGradientState";
import GradientBackground from "./GradientBackground";
import NocturneIcon from "./icons/NocturneIcon";

const LoadingScreen = ({ show = true, onComplete }) => {
  const [gradientState, updateGradientColors] = useGradientState();
  const [progress, setProgress] = useState(0);

  const [bootCounterDone, setBootCounterDone] = useState(false);

  const [tokenRefreshed, setTokenRefreshed] = useState(false);

  const { loading: connectorLoading, reconnectAttempt } = useBluetooth();
  const { isConnectorAvailable } = useConnector();
  const { isConnected: isInternetConnected } = useNetwork();
  const skipBluetoothStep = isConnectorAvailable || isInternetConnected;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const showReconnectMessage =
    !skipBluetoothStep &&
    reconnectAttempt > 0 &&
    reconnectAttempt < MAX_RECONNECT_ATTEMPTS;
  const { refreshTokens } = useAuth();

  const [networkStable, setNetworkStable] = useState(false);
  const [networkTimedOut, setNetworkTimedOut] = useState(false);

  useEffect(() => {
    if (!show || networkStable) return;

    let cancelled = false;

    const bypass =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("networkCheckBypass") === "true";

    const markStable = () => {
      if (!cancelled) setNetworkStable(true);
    };

    if (bypass) {
      markStable();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve("timeout"), 30000),
        );

        const stablePromise = waitForStableNetwork(5000).then(() => "stable");

        const result = await Promise.race([stablePromise, timeoutPromise]);

        if (result === "stable") {
          markStable();
        } else {
          setNetworkTimedOut(true);
          markStable();
        }
      } catch {
        setNetworkTimedOut(true);
        markStable();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show, networkStable]);

  useEffect(() => {
    if (!show || tokenRefreshed) return;

    if (!networkStable) return;

    if (networkTimedOut) {
      setTokenRefreshed(true);
      return;
    }
    if (!bootCounterDone) return;
    if (!skipBluetoothStep && connectorLoading) return;

    (async () => {
      try {
        await refreshTokens();
      } catch (err) {
        console.error("Token refresh during loading failed", err);
      } finally {
        setTokenRefreshed(true);
      }
    })();
  }, [
    show,
    tokenRefreshed,
    networkStable,
    networkTimedOut,
    bootCounterDone,
    connectorLoading,
    skipBluetoothStep,
    refreshTokens,
  ]);

  useEffect(() => {
    if (show) {
      updateGradientColors(null, "auth");
    }
  }, [show, updateGradientColors]);

  useEffect(() => {
    if (!show) return;

    const resetBootCounter = async () => {
      try {
        await fetch("http://localhost:5000/device/resetcounter", {
          method: "POST",
        });
      } catch (err) {
        console.error("Error resetting boot counter:", err);
      } finally {
        setBootCounterDone(true);
      }
    };

    resetBootCounter();
  }, [show]);

  useEffect(() => {
    if (!show) return;

    const tasksTotal = 4;
    let completed = 0;
    if (bootCounterDone) completed += 1;
    if (networkStable) completed += 1;
    if (skipBluetoothStep || !connectorLoading) completed += 1;
    if (tokenRefreshed) completed += 1;

    const pct = Math.floor((completed / tasksTotal) * 100);
    setProgress(pct);

    if (completed === tasksTotal && onComplete) {
      const timer = setTimeout(() => {
        onComplete();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [
    show,
    bootCounterDone,
    networkStable,
    connectorLoading,
    tokenRefreshed,
    onComplete,
    skipBluetoothStep,
  ]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden rounded-2xl">
      <div className="absolute inset-0 bg-black" />

      <GradientBackground gradientState={gradientState} />

      <div className="relative z-10 flex flex-col items-center">
        <NocturneIcon className="h-14 w-auto mb-8" />

        <div className="relative">
          <div className="relative w-72 h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-white rounded-full"
              style={{ width: `${progress}%`, transition: "width 0.3s ease" }}
            />
          </div>

          {showReconnectMessage && (
            <p className="absolute top-full left-1/2 -translate-x-1/2 mt-4 text-[22px] text-white/60 tracking-tight whitespace-nowrap">
              Attempting to reconnect...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
