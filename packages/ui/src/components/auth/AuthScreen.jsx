import React, { useEffect, useState, useRef } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useAuth } from "../../hooks/useAuth";
import { useNetwork } from "../../hooks/useNetwork";
import NocturneIcon from "../common/icons/NocturneIcon";
import GradientBackground from "../common/GradientBackground";
import QRCodeDisplay from "./QRCodeDisplay";
import NetworkScreen from "./NetworkScreen";

const AuthScreen = ({ onAuthSuccess }) => {
  const [error, setError] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [hasQrCode, setHasQrCode] = useState(false);
  const authAttemptedRef = useRef(false);
  const authTimerRef = useRef(null);
  const previousNetworkStateRef = useRef(null);

  const { authData, isLoading, initAuth, pollAuthStatus, isAuthenticated } =
    useAuth();
  const { isConnected: isNetworkConnected, initialCheckDone } = useNetwork();
  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  useEffect(() => {
    if (
      !authInitialized &&
      !isAuthenticated &&
      !authAttemptedRef.current &&
      isNetworkConnected
    ) {
      if (authTimerRef.current) {
        clearTimeout(authTimerRef.current);
      }

      authTimerRef.current = setTimeout(async () => {
        authAttemptedRef.current = true;
        try {
          const storedAccessToken = localStorage.getItem("spotifyAccessToken");
          const storedRefreshToken = localStorage.getItem(
            "spotifyRefreshToken",
          );

          if (!storedAccessToken || !storedRefreshToken) {
            const authResponse = await initAuth();
            if (authResponse?.device_code) {
              setAuthInitialized(true);
              pollAuthStatus(authResponse.device_code);
            }
          }
        } catch (err) {
          setError("Failed to initialize authentication");
          console.error("Auth init error:", err);
        }
      }, 2000);
    }

    return () => {
      if (authTimerRef.current) {
        clearTimeout(authTimerRef.current);
      }
    };
  }, [
    initAuth,
    pollAuthStatus,
    isAuthenticated,
    authInitialized,
    isNetworkConnected,
  ]);

  useEffect(() => {
    if (isAuthenticated && authInitialized) {
      setAuthInitialized(false);
      setHasQrCode(false);
      authAttemptedRef.current = false;
    }
  }, [isAuthenticated, authInitialized]);

  useEffect(() => {
    if (authData?.verification_uri_complete) {
      setHasQrCode(true);
    }
  }, [authData]);

  useEffect(() => {
    if (isAuthenticated) {
      onAuthSuccess();
    }
  }, [isAuthenticated, onAuthSuccess]);

  useEffect(() => {
    if (
      previousNetworkStateRef.current === false &&
      isNetworkConnected === true
    ) {
      authAttemptedRef.current = false;
      setAuthInitialized(false);
      setHasQrCode(false);
      setError(null);
    }
    previousNetworkStateRef.current = isNetworkConnected;
  }, [isNetworkConnected]);

  useEffect(() => {
    if (authInitialized && !hasQrCode && isNetworkConnected) {
      const retryTimer = setTimeout(() => {
        if (!hasQrCode && isNetworkConnected) {
          authAttemptedRef.current = false;
          setAuthInitialized(false);
          setError(null);
        }
      }, 5000);

      return () => clearTimeout(retryTimer);
    }
  }, [authInitialized, hasQrCode, isNetworkConnected]);

  const handleQRCodeRefresh = async () => {
    if (!isNetworkConnected || isAuthenticated) return;

    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
    if (storedAccessToken && storedRefreshToken) return;

    try {
      setError(null);
      authAttemptedRef.current = false;
      setAuthInitialized(false);
      setHasQrCode(false);

      const authResponse = await initAuth();
      if (authResponse?.device_code) {
        setAuthInitialized(true);
        pollAuthStatus(authResponse.device_code);
      }
    } catch (err) {
      setError("Failed to refresh QR code");
      console.error("QR code refresh error:", err);
    }
  };

  if (!initialCheckDone) {
    return (
      <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
        <GradientBackground gradientState={gradientState} />
        <div className="relative z-10 flex flex-col items-center justify-center">
          <NocturneIcon className="h-12 w-auto animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isNetworkConnected) {
    return <NetworkScreen isConnectionLost={true} />;
  }

  const isContentLoading =
    (isLoading && !hasQrCode) || (isNetworkConnected === false && !hasQrCode);

  const displayError =
    error && !error.includes("authorization_pending")
      ? error
      : !isNetworkConnected
        ? "Network connection required"
        : null;

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <GradientBackground gradientState={gradientState} />

      <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-2 gap-16 items-center">
        <div className="flex flex-col items-start space-y-8 ml-12">
          <NocturneIcon className="h-12 w-auto" />

          <div className="space-y-4">
            <h2 className="text-4xl text-white tracking-tight font-[580] w-[24rem]">
              Scan the QR code with your phone's camera.
            </h2>
            <p className="text-[28px] text-white/60 tracking-tight w-[22rem]">
              You'll be redirected to Spotify to authorize Nocturne.
            </p>
          </div>
        </div>

        <div className="flex justify-center">
          <QRCodeDisplay
            verificationUri={
              hasQrCode && isNetworkConnected
                ? authData?.verification_uri_complete
                : null
            }
            isLoading={isContentLoading || !isNetworkConnected}
            error={displayError}
            onRefreshNeeded={handleQRCodeRefresh}
          />
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
