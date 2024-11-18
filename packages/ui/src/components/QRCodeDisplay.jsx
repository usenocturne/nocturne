import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, X } from "lucide-react";

const QRCodeDisplay = ({ onSuccess, onBack }) => {
  const [sessionId, setSessionId] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onBack();
    }, 300);
  };

  useEffect(() => {
    const createSession = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/v1/auth/qr/create", {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Failed to create QR session");
        }

        const data = await response.json();
        setSessionId(data.sessionId);
        setIsPolling(true);
      } catch (error) {
        console.error("Failed to create QR session:", error);
        setError("Failed to generate QR code. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };

    createSession();
  }, []);

  useEffect(() => {
    if (!sessionId || !isPolling) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/v1/auth/qr/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          throw new Error("Failed to check session status");
        }

        const data = await response.json();

        if (data.status === "completed" && data.tempId) {
          setIsPolling(false);
          onSuccess({ type: "custom", tempId: data.tempId });
        }
      } catch (error) {
        console.error("Failed to check session status:", error);
      }
    }, 2000);

    const timeoutId = setTimeout(() => {
      clearInterval(pollInterval);
      setIsPolling(false);
      setError("QR code has expired. Please try again.");
    }, 15 * 60 * 1000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [sessionId, isPolling, onSuccess]);

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

    const qrUrl = `${window.location.origin}/phone-auth/${sessionId}`;

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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

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

export default QRCodeDisplay;
