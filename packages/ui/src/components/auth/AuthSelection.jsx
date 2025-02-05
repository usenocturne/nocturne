import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import QRAuthFlow from "./qr/QRAuthFlow";
import packageInfo from "../../../package.json";
import NetworkScreen from "../bluetooth/NetworkScreen";
import PairingScreen from "../bluetooth/PairingScreen";
import EnableTetheringScreen from "../bluetooth/EnableTetheringScreen";
import { NocturneIcon } from "../icons";
import { checkNetworkConnectivity } from "../../lib/networkChecker";

const ConnectionScreen = () => {
  const [isBluetoothDiscovering, setIsBluetoothDiscovering] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairingKey, setPairingKey] = useState(null);
  const [showTethering, setShowTethering] = useState(false);
  const [deviceType, setDeviceType] = useState(null);
  const [isNetworkConnected, setIsNetworkConnected] = useState(false);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(true);
  const [showNoNetwork, setShowNoNetwork] = useState(false);
  const initialCheckTimeoutRef = useRef(null);
  const initialCheckDoneRef = useRef(false);
  const reconnectionAttemptedRef = useRef(false);
  const failedReconnectAttemptsRef = useRef(0);

  const hasStoredCredentials =
    typeof window !== "undefined" &&
    (localStorage.getItem("spotifyRefreshToken") ||
      localStorage.getItem("spotifyAccessToken"));

  const checkNetwork = useCallback(async () => {
    try {
      setIsCheckingNetwork(true);
      const response = await checkNetworkConnectivity();
      const isConnected = response.isConnected;
      setIsNetworkConnected(isConnected);
      initialCheckDoneRef.current = true;
      
      if (isConnected && initialCheckTimeoutRef.current) {
        clearTimeout(initialCheckTimeoutRef.current);
        initialCheckTimeoutRef.current = null;
      }
      return isConnected;
    } catch (error) {
      console.error("Network connectivity check failed:", error);
      setIsNetworkConnected(false);
      initialCheckDoneRef.current = true;
      return false;
    } finally {
      setIsCheckingNetwork(false);
    }
  }, []);

  const tryReconnectLastDevice = async () => {
    const lastDeviceAddress = localStorage.getItem('connectedBluetoothAddress');
    if (failedReconnectAttemptsRef.current >= 10) {
      if (reconnectInterval) {
        console.log("Stopping automatic reconnection attempts - reached maximum failure attempts");
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
      return false;
    }

    if (lastDeviceAddress && !reconnectionAttemptedRef.current) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(
          `http://localhost:5000/bluetooth/connect/${lastDeviceAddress}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            signal: controller.signal
          }
        );

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error("Failed to reconnect to last device");
        }

        const data = await response.json();
        if (data.status === "success") {
          console.log("Successfully reconnected to last device");
          setShowNoNetwork(false);
          setShowTethering(true);
          enableBluetoothNetwork(lastDeviceAddress);
          reconnectionAttemptedRef.current = true;
          failedReconnectAttemptsRef.current = 0;
          return true;
        }
        failedReconnectAttemptsRef.current++;
      } catch (error) {
        if (error.name === 'AbortError') {
          console.error("Reconnection request timed out after 1 minute");
        } else {
          console.error("Error reconnecting to last device:", error);
        }
        failedReconnectAttemptsRef.current++;
      }
    }
    return false;
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
    let failedNetworkAttempts = 0;
    try {
      const intervalId = setInterval(async () => {
        try {
          if (failedNetworkAttempts >= 10) {
            console.log("Stopping automatic network enabling attempts - reached maximum failure attempts");
            clearInterval(intervalId);
            return;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);

          const networkStatus = await checkNetworkConnectivity();
          if (networkStatus.isConnected) {
            clearInterval(intervalId);
            clearTimeout(timeout);
            return;
          }

          const response = await fetch(
            `http://localhost:5000/bluetooth/network/${address}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              signal: controller.signal
            }
          );

          clearTimeout(timeout);

          const data = await response.json();

          if (data.status === "success") {
            setShowTethering(true);
            setIsPairing(false);
            failedNetworkAttempts = 0;
          } else {
            failedNetworkAttempts++;
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            console.error("Network request timed out after 1 minute");
          } else {
            console.error("Error enabling bluetooth networking:", error);
          }
          failedNetworkAttempts++;
        }
      }, 10000);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      fetch(
        `http://localhost:5000/bluetooth/network/${address}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal
        }
      ).catch(error => {
        if (error.name === 'AbortError') {
          console.error("Initial network request timed out after 1 minute");
        } else {
          console.error(error);
        }
        failedNetworkAttempts++;
      });

    } catch (error) {
      console.error("Error enabling bluetooth networking:", error);
      failedNetworkAttempts++;
    }
  };

  useEffect(() => {
    let mounted = true;
    let checkInterval;
    let reconnectInterval;
    let reconnectTimeoutId;

    const startNetworkCheck = async () => {
      const lastDeviceAddress = localStorage.getItem('connectedBluetoothAddress');
      if (lastDeviceAddress) {
        reconnectionAttemptedRef.current = false;
        failedReconnectAttemptsRef.current = 0;
        
        reconnectTimeoutId = setTimeout(() => {
          if (!reconnectionAttemptedRef.current && mounted) {
            setShowNoNetwork(true);
            setShowTethering(false);
          }
        }, 15000);

        const reconnected = await tryReconnectLastDevice();
        if (!reconnected) {
          setShowNoNetwork(true);
          reconnectInterval = setInterval(async () => {
            if (!reconnectionAttemptedRef.current) {
              const reconnected = await tryReconnectLastDevice();
              if (reconnected || failedReconnectAttemptsRef.current >= 10) {
                if (reconnected) {
                  setShowNoNetwork(false);
                  setShowTethering(true);
                }
                clearInterval(reconnectInterval);
                reconnectInterval = null;
              }
            }
          }, 10000);
        } else {
          if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
          }
          setShowNoNetwork(false);
          setShowTethering(true);
        }
      } else {
        enableBluetoothDiscovery();
      }

      initialCheckTimeoutRef.current = setTimeout(() => {
        if (!initialCheckDoneRef.current && mounted) {
          setShowNoNetwork(true);
        }
      }, 5000);

      const isConnected = await checkNetwork();
      
      checkInterval = setInterval(async () => {
        if (!mounted) return;
        const isConnected = await checkNetwork();
        if (!isConnected) {
          const lastDeviceAddress = localStorage.getItem('connectedBluetoothAddress');
          if (lastDeviceAddress) {
            if (!reconnectionAttemptedRef.current) {
              setShowNoNetwork(true);
              if (!reconnectInterval) {
                reconnectInterval = setInterval(async () => {
                  if (!reconnectionAttemptedRef.current) {
                    const reconnected = await tryReconnectLastDevice();
                    if (reconnected || failedReconnectAttemptsRef.current >= 10) {
                      if (reconnected) {
                        setShowNoNetwork(false);
                        setShowTethering(true);
                      }
                      clearInterval(reconnectInterval);
                      reconnectInterval = null;
                    }
                  }
                }, 10000);
              }
            }
            enableBluetoothNetwork(lastDeviceAddress);
          } else {
            enableBluetoothDiscovery();
          }
        }
      }, 10000);
    };

    startNetworkCheck();

    const ws = new WebSocket("ws://localhost:5000/ws");

    ws.onmessage = (event) => {
      if (!mounted) return;
      const data = JSON.parse(event.data);
      if (data.type === "bluetooth/pairing") {
        const { address, pairingKey } = data.payload;
        setIsPairing(true);
        setPairingKey(pairingKey);
      } else if (data.type === "bluetooth/paired") {
        const { address } = data.payload.device;
        localStorage.setItem('connectedBluetoothAddress', address);
        setShowNoNetwork(false);
        setShowTethering(true);
        enableBluetoothNetwork(address);
      } else if (data.type === "bluetooth/connect") {
        const { address } = data;
        localStorage.setItem('connectedBluetoothAddress', address);
        setShowNoNetwork(false);
        setShowTethering(true);
        reconnectionAttemptedRef.current = true;
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
        enableBluetoothNetwork(address);
      } else if (data.type === "bluetooth/network/disconnect") {
        const lastDeviceAddress = localStorage.getItem('connectedBluetoothAddress');
        if (lastDeviceAddress) {
          setShowNoNetwork(true);
          setIsPairing(false);
          reconnectionAttemptedRef.current = false;
          if (!reconnectInterval) {
            reconnectInterval = setInterval(async () => {
              if (!reconnectionAttemptedRef.current) {
                const reconnected = await tryReconnectLastDevice();
                if (reconnected || failedReconnectAttemptsRef.current >= 10) {
                  if (reconnected) {
                    setShowNoNetwork(false);
                    setShowTethering(true);
                  }
                  clearInterval(reconnectInterval);
                  reconnectInterval = null;
                }
              }
            }, 10000);
          }
          enableBluetoothNetwork(lastDeviceAddress);
        }
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      mounted = false;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
      }
      if (initialCheckTimeoutRef.current) {
        clearTimeout(initialCheckTimeoutRef.current);
      }
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
      }
      ws.close();
    };
  }, []);

  useEffect(() => {
    let timeoutId;
    if (!isNetworkConnected && initialCheckDoneRef.current) {
      timeoutId = setTimeout(() => {
        setShowNoNetwork(true);
      }, 10000);
    } else {
      setShowNoNetwork(false);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isNetworkConnected]);

  useEffect(() => {
    if (isNetworkConnected) {
      setIsBluetoothDiscovering(false);
      setPairingKey(null);
      setIsPairing(false);
      setShowTethering(false);
    }
  }, [isNetworkConnected]);

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

  if (!isNetworkConnected && showNoNetwork) {
    return <NetworkScreen isCheckingNetwork={isCheckingNetwork} />;
  }

  return null;
};

const AuthMethodSelector = ({ onSelect, networkStatus }) => {
  const [showQRFlow, setShowQRFlow] = useState(false);
  const [buttonsVisible, setButtonsVisible] = useState(true);
  const [defaultButtonVisible, setDefaultButtonVisible] = useState(false);
  const [showDefaultButton, setShowDefaultButton] = useState(false);
  const [escapeKeyTimer, setEscapeKeyTimer] = useState(null);
  const [isNetworkReady, setIsNetworkReady] = useState(false);
  const router = useRouter();

  const hasStoredCredentials =
    typeof window !== "undefined" &&
    (localStorage.getItem("spotifyRefreshToken") ||
      localStorage.getItem("spotifyAccessToken"));

  useEffect(() => {
    let mounted = true;
    let checkInterval;

    const startNetworkCheck = () => {
      const check = async () => {
        if (!mounted) return;
        try {
          const status = await checkNetworkConnectivity();
          if (mounted) {
            const isConnected = status.isConnected;
            setIsNetworkReady(isConnected);
            
            if (isConnected && hasStoredCredentials) {
              const savedAuthType = localStorage.getItem("spotifyAuthType") || "default";
              onSelect({ type: savedAuthType });
            }
          }
        } catch (error) {
          console.error("Network check failed:", error);
          if (mounted) {
            setIsNetworkReady(false);
          }
        }
      };

      check();
      checkInterval = setInterval(check, 2000);
    };

    startNetworkCheck();

    return () => {
      mounted = false;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [hasStoredCredentials, onSelect]);

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
    if (!isNetworkReady) return;
    localStorage.setItem("spotifyAuthType", "default");
    onSelect({ type: "default" });
  };

  if (networkStatus?.isConnected && !hasStoredCredentials) {
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
  }

  if (!networkStatus?.isConnected && !router.pathname.includes("phone-auth")) {
    return <ConnectionScreen />;
  }

  return <NetworkScreen isCheckingNetwork={!isNetworkReady} />;
};

export default AuthMethodSelector;
