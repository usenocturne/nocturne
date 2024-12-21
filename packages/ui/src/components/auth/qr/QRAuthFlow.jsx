import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, X } from "lucide-react";

const QRAuthFlow = ({ onBack, onComplete }) => {
  const [sessionId, setSessionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const generateSessionId = () => {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      return Array.from(array, (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    };
    setSessionId(generateSessionId());
    setIsLoading(false);
    setIsVisible(true);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/v1/auth/qr/check?session_id=${sessionId}`
        );
        const data = await response.json();

        if (!isMounted) return;

        if (data.authCompleted && data.access_token && data.refresh_token) {
          clearInterval(pollInterval);

          localStorage.setItem("spotifyAccessToken", data.access_token);
          localStorage.setItem("spotifyRefreshToken", data.refresh_token);
          localStorage.setItem("spotifyTokenExpiry", data.token_expiry);
          localStorage.setItem("spotifyAuthType", "custom");
          localStorage.setItem("spotifyTempId", data.tempId);

          onComplete({
            type: "custom",
            tempId: data.tempId,
            skipSpotifyAuth: true,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          });
        } else if (data.authCompleted) {
          console.error("Auth completed but missing tokens");
        }

        if (error) setError(null);
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);

    const timeoutId = setTimeout(() => {
      clearInterval(pollInterval);
      setError("QR code has expired. Please try again.");
    }, 15 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [sessionId, onComplete, error]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onBack();
    }, 300);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="text-white/70 text-xl">{error}</div>
          <button
            onClick={onBack}
            className="flex items-center justify-center space-x-2 rounded-full bg-white/10 px-6 py-4 text-xl font-[560] text-white tracking-tight shadow-sm mx-auto"
          >
            <ArrowLeft size={24} />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    );
  }

  const modalContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center space-y-8">
          <div className="animate-pulse bg-white/10 w-[200px] h-[200px] rounded-xl mx-auto"></div>
          <div className="space-y-2 text-center">
            <p className="text-white text-2xl">Connect to Nocturne</p>
            <p className="text-white/50 text-lg">Generating QR Code...</p>
          </div>
        </div>
      );
    }

    if (!sessionId) {
      return null;
    }

    const qrUrl = `https://172.20.10.12:3500/phone-auth?session=${sessionId}`;

    return (
      <div className="flex flex-col items-center space-y-8">
        <div className="bg-white p-1 rounded-xl">
          <QRCodeSVG value={qrUrl} size={200} level="H" includeMargin={true} />
        </div>
        <div className="space-y-2 text-center">
          <p className="text-white text-2xl">Connect to Nocturne</p>
          <p className="text-white/50 text-lg">
            Open your phone's camera and point it at the QR code.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isVisible && !isExiting ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 transition-all duration-300 ${
          isVisible && !isExiting
            ? "-translate-y-1/2 opacity-100"
            : isExiting
            ? "translate-y-[10%] opacity-0"
            : "translate-y-[10%] opacity-0"
        }`}
      >
        <div className="relative bg-black/90 p-8 rounded-3xl shadow-2xl min-w-[400px] border border-white/10">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
          {modalContent()}
        </div>
      </div>
    </div>
  );
};

export default QRAuthFlow;
