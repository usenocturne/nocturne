import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import QRAuthFlow from "./qr/QRAuthFlow";
import packageInfo from "../../../package.json";
import NetworkScreen from "../bluetooth/NetworkScreen";
import PairingScreen from "../bluetooth/PairingScreen";
import EnableTetheringScreen from "../bluetooth/EnableTetheringScreen";
import { NocturneIcon } from "../icons";

const ConnectionScreen = () => {
  const [isBluetoothDiscovering, setIsBluetoothDiscovering] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairingKey, setPairingKey] = useState(null);
  const [showTethering, setShowTethering] = useState(false);
  const [deviceType, setDeviceType] = useState(null);

  const checkNetworkConnectivity = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1", {
        method: "OPTIONS",
      });
      return response.ok;
    } catch (error) {
      console.error("Network connectivity check failed:", error);
      return false;
    }
  };

  const enableBluetoothDiscovery = async () => {
    try {
      setIsBluetoothDiscovering(true);
      const response = await fetch(
        "http://localhost:5000/bluetooth/discover/on",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to enable bluetooth discovery");
      }

      setTimeout(() => {
        setIsBluetoothDiscovering(false);
        fetch("http://localhost:5000/bluetooth/discover/off", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }).catch(console.error);
      }, 120000);
    } catch (error) {
      console.error("Error enabling bluetooth discovery:", error);
      setIsBluetoothDiscovering(false);
    }
  };

  const enableBluetoothNetwork = (address) => {
    try {
      const intervalId = setInterval(async () => {
        try {
          const response = await fetch(
            `http://localhost:5000/bluetooth/network/${address}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            }
          );

          const data = await response.json();

          if (data.status === "success") {
            clearInterval(intervalId);

            setTimeout(async () => {
              setIsBluetoothDiscovering(false);
              setPairingKey(null);
              setIsPairing(false);
              setShowTethering(false);
            }, 5000);
          }
        } catch (error) {
          console.error("Error enabling bluetooth networking:", error);
        }
      }, 5000);
    } catch (error) {
      console.error("Error enabling bluetooth networking:", error);
    }
  };

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setDeviceType(isIOS ? "ios" : "other");

    const ws = new WebSocket("ws://localhost:5000/ws");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "bluetooth/pairing") {
        const { address, pairingKey } = data.payload;
        setIsPairing(true);
        setPairingKey(pairingKey);
        console.log("pairing", address, pairingKey);
      } else if (data.type === "bluetooth/paired") {
        const { address } = data.payload.device;
        console.log("paired", address);
        enableBluetoothNetwork(address);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    enableBluetoothDiscovery();

    return () => {
      ws.close();
    };
  }, []);

  const handlePairingAccept = async () => {
    try {
      const response = await fetch(
        "http://localhost:5000/bluetooth/pairing/accept",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to accept bluetooth pairing");
      }

      setShowTethering(true);
      setIsPairing(false);
    } catch (error) {
      console.error("Error accepting bluetooth pairing:", error);
    }
  };

  if (showTethering) {
    return (
      <EnableTetheringScreen
        deviceType={deviceType}
        message={
          deviceType === "ios"
            ? "Please turn on your Personal Hotspot in Settings"
            : "Please enable Bluetooth tethering in your phone's settings"
        }
      />
    );
  }

  if (isPairing) {
    return (
      <PairingScreen
        pin={pairingKey}
        onAccept={handlePairingAccept}
        onReject={() => {
          setIsPairing(false);
          setPairingKey(null);
          enableBluetoothDiscovery();
        }}
      />
    );
  }

  return <NetworkScreen />;
};

const AuthMethodSelector = ({ onSelect, networkStatus }) => {
  const [showQRFlow, setShowQRFlow] = useState(false);
  const [buttonsVisible, setButtonsVisible] = useState(true);
  const [defaultButtonVisible, setDefaultButtonVisible] = useState(false);
  const [showDefaultButton, setShowDefaultButton] = useState(false);
  const [escapeKeyTimer, setEscapeKeyTimer] = useState(null);
  const router = useRouter();

  useEffect(() => {
    if (showDefaultButton) {
      setTimeout(() => setDefaultButtonVisible(true), 50);
    }
  }, [showDefaultButton]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !escapeKeyTimer) {
        const timer = setTimeout(() => {
          setShowDefaultButton(true);
        }, 2000);
        setEscapeKeyTimer(timer);
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === "Escape" && escapeKeyTimer) {
        clearTimeout(escapeKeyTimer);
        setEscapeKeyTimer(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (escapeKeyTimer) {
        clearTimeout(escapeKeyTimer);
      }
    };
  }, [escapeKeyTimer]);

  const handleDefaultSubmit = (e) => {
    e.preventDefault();
    localStorage.setItem("spotifyAuthType", "default");
    onSelect({ type: "default" });
  };

  if (!networkStatus?.isConnected && !router.pathname.includes("phone-auth")) {
    return <ConnectionScreen />;
  }

  return (
    <div className="bg-black h-screen flex items-center justify-center overflow-hidden fixed inset-0">
      <div className="w-full flex flex-col items-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-xl">
          <NocturneIcon className="mx-auto h-14 w-auto" />
          <div
            className={`transition-all duration-250 ${
              buttonsVisible ? "h-[70px] opacity-100" : "h-0 opacity-0"
            }`}
          >
            <h2 className="mt-4 text-center text-[46px] font-[580] text-white tracking-tight">
              Welcome to Nocturne
            </h2>
          </div>
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-xl">
          <div
            className={`relative transition-all duration-250 ${
              showDefaultButton ? "h-[260px]" : "h-[150px]"
            }`}
          >
            <div
              className={`absolute top-0 left-0 w-full transition-opacity duration-250 ${
                buttonsVisible ? "opacity-100" : "opacity-0"
              } ${showDefaultButton ? "space-y-6 mt-2" : "mt-6"}`}
              style={{ pointerEvents: buttonsVisible ? "auto" : "none" }}
            >
              <div>
                <button
                  onClick={() => setShowQRFlow(true)}
                  className="flex w-full justify-center rounded-full bg-white/10 px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm"
                >
                  Login with Phone
                </button>
              </div>
              <div
                className={`transition-all duration-250 overflow-hidden ${
                  showDefaultButton
                    ? defaultButtonVisible
                      ? "h-[80px] opacity-100"
                      : "h-0 opacity-0"
                    : "h-0 opacity-0"
                }`}
              >
                <button
                  onClick={handleDefaultSubmit}
                  className="flex w-full justify-center rounded-full ring-white/10 ring-2 ring-inset px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm hover:bg-white/10 transition-colors"
                >
                  Use Developer Credentials
                </button>
              </div>
              <p className="mt-6 text-center text-white/30 text-[16px]">
                {packageInfo.version}
              </p>
            </div>
          </div>
          {showQRFlow && (
            <QRAuthFlow
              onBack={() => setShowQRFlow(false)}
              onComplete={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthMethodSelector;
