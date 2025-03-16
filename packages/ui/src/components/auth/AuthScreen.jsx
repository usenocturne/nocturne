import React, { useEffect, useState, useRef } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useAuth } from "../../hooks/useAuth";
import NocturneIcon from "../common/icons/NocturneIcon";
import QRCodeDisplay from "./QRCodeDisplay";

const AuthScreen = ({ onAuthSuccess }) => {
  const [error, setError] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const authAttemptedRef = useRef(false);

  const { authData, isLoading, initAuth, pollAuthStatus, isAuthenticated } =
    useAuth();

  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");

    if (!authInitialized && !isAuthenticated && !authAttemptedRef.current) {
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
              pollAuthStatus(authResponse.device_code);
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
  ]);

  useEffect(() => {
    if (isAuthenticated) {
      onAuthSuccess();
    }
  }, [isAuthenticated, onAuthSuccess]);

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <div
        style={{
          backgroundImage: generateMeshGradient([
            currentColor1,
            currentColor2,
            currentColor3,
            currentColor4,
          ]),
          transition: "background-image 0.5s linear",
        }}
        className="absolute inset-0"
      />

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
            verificationUri={authData?.verification_uri_complete}
            isLoading={isLoading}
            error={
              error
                ? error
                : authData === null
                  ? "Failed to generate QR code"
                  : null
            }
          />
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
