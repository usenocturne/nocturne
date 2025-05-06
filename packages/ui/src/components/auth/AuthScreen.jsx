import React, { useEffect, useState, useRef } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useAuth } from "../../hooks/useAuth";
import NocturneIcon from "../common/icons/NocturneIcon";
import GradientBackground from "../common/GradientBackground";
import QRCodeDisplay from "./QRCodeDisplay";
import { checkNetworkConnectivity } from "../../utils/networkChecker";

const AuthScreen = ({ onAuthSuccess }) => {
  const [error, setError] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isNetworkConnected, setIsNetworkConnected] = useState(false);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(true);
  const [hasQrCode, setHasQrCode] = useState(false);
  const authAttemptedRef = useRef(false);

  const { authData, isLoading, initAuth, pollAuthStatus, isAuthenticated } =
    useAuth();

  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    const checkNetwork = async () => {
      setIsCheckingNetwork(true);
      try {
        const result = await checkNetworkConnectivity();
        setIsNetworkConnected(result.isConnected);
        if (!result.isConnected) {
          setError("Network connection required");
        } else {
          if (error === "Network connection required") {
            setError(null);
          }
        }
      } catch (err) {
        console.error("Network check error:", err);
        setIsNetworkConnected(false);
      } finally {
        setIsCheckingNetwork(false);
      }
    };

    checkNetwork();

    const networkCheckInterval = setInterval(
      checkNetwork,
      hasQrCode ? 10000 : 5000
    );

    return () => clearInterval(networkCheckInterval);
  }, [error, hasQrCode]);

  useEffect(() => {
    updateGradientColors(null, "auth");

    if (
      !authInitialized &&
      !isAuthenticated &&
      !authAttemptedRef.current &&
      isNetworkConnected
    ) {
      authAttemptedRef.current = true;

      const startAuth = async () => {
        try {
          const storedAccessToken = localStorage.getItem("spotifyAccessToken");
          const storedRefreshToken = localStorage.getItem(
            "spotifyRefreshToken"
          );

          if (!storedAccessToken || !storedRefreshToken) {
            const authResponse = await initAuth();
            if (authResponse?.device_code) {
              setAuthInitialized(true);

              const originalPollAuthStatus = pollAuthStatus;
              const safePollStatus = async (deviceCode) => {
                try {
                  await originalPollAuthStatus(deviceCode);
                } catch (err) {
                  if (!err.message?.includes("authorization_pending")) {
                    setError(err.message);
                  }
                }
              };

              safePollStatus(authResponse.device_code);
            }
          }
        } catch (err) {
          setError("Failed to initialize authentication");
          console.error("Auth init error:", err);
        }
      };

      startAuth();
    }
  }, [
    initAuth,
    pollAuthStatus,
    updateGradientColors,
    isAuthenticated,
    authInitialized,
    isNetworkConnected,
  ]);

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

  const isContentLoading =
    (isCheckingNetwork && !hasQrCode) || (isLoading && !hasQrCode);

  const displayError =
    error && !error.includes("authorization_pending")
      ? error
      : !isNetworkConnected && !isCheckingNetwork
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
          />
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
