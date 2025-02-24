import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import NetworkScreen from "../bluetooth/NetworkScreen";
import PairingScreen from "../bluetooth/PairingScreen";
import EnableTetheringScreen from "../bluetooth/EnableTetheringScreen";
import { NocturneIcon } from "../icons";
import { checkNetworkConnectivity } from "../../lib/networkChecker";
import { useGradientState } from "../../hooks/useGradientState";
import { oauthAuthorize, checkAuthStatus } from "../../services/authService";
import { QRCodeSVG } from "qrcode.react";

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
    const lastDeviceAddress = localStorage.getItem("connectedBluetoothAddress");
    if (failedReconnectAttemptsRef.current >= 10) {
      if (reconnectInterval) {
        console.log(
          "Stopping automatic reconnection attempts - reached maximum failure attempts"
        );
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
            signal: controller.signal,
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
        if (error.name === "AbortError") {
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
            console.log(
              "Stopping automatic network enabling attempts - reached maximum failure attempts"
            );
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
              signal: controller.signal,
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
          if (error.name === "AbortError") {
            console.error("Network request timed out after 1 minute");
          } else {
            console.error("Error enabling bluetooth networking:", error);
          }
          failedNetworkAttempts++;
        }
      }, 10000);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      fetch(`http://localhost:5000/bluetooth/network/${address}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }).catch((error) => {
        if (error.name === "AbortError") {
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
      const lastDeviceAddress = localStorage.getItem(
        "connectedBluetoothAddress"
      );
      if (!lastDeviceAddress) {
        enableBluetoothDiscovery();
      } else {
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
          const lastDeviceAddress = localStorage.getItem(
            "connectedBluetoothAddress"
          );
          if (lastDeviceAddress) {
            if (!reconnectionAttemptedRef.current) {
              setShowNoNetwork(true);
              if (!reconnectInterval) {
                reconnectInterval = setInterval(async () => {
                  if (!reconnectionAttemptedRef.current) {
                    const reconnected = await tryReconnectLastDevice();
                    if (
                      reconnected ||
                      failedReconnectAttemptsRef.current >= 10
                    ) {
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
        localStorage.setItem("connectedBluetoothAddress", address);
        setShowNoNetwork(false);
        setShowTethering(true);
        enableBluetoothNetwork(address);
      } else if (data.type === "bluetooth/connect") {
        const { address } = data;
        localStorage.setItem("connectedBluetoothAddress", address);
        setShowNoNetwork(false);
        setShowTethering(true);
        reconnectionAttemptedRef.current = true;
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
        enableBluetoothNetwork(address);
      } else if (data.type === "bluetooth/network/disconnect") {
        const lastDeviceAddress = localStorage.getItem(
          "connectedBluetoothAddress"
        );
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
            ? "Please enable Personal Hotspot in your phone's settings."
            : "Please enable Bluetooth Tethering in your phone's settings."
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
  const [isNetworkReady, setIsNetworkReady] = useState(false);
  const [spotifyAuthData, setSpotifyAuthData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    setTargetColor1,
    setTargetColor2,
    setTargetColor3,
    setTargetColor4,
  } = useGradientState();

  const gradientThemes = [
    {
      colors: ["#2C1E3D", "#532E5D", "#8D5DA7", "#B98BC9"],
    },
    {
      colors: ["#1A1423", "#3D2C8D", "#9163CB", "#D499B9"],
    },
    {
      colors: ["#0D1B2A", "#1B263B", "#415A77", "#778DA9"],
    },
    {
      colors: ["#0B132B", "#1C2541", "#3A506B", "#5BC0BE"],
    },
    {
      colors: ["#241623", "#3C223F", "#5C2A6A", "#8E4585"],
    },
  ];

  const hasStoredCredentials =
    typeof window !== "undefined" &&
    (localStorage.getItem("spotifyRefreshToken") ||
      localStorage.getItem("spotifyAccessToken"));

  useEffect(() => {
    const initDevice = async () => {
      try {
        const authData = await oauthAuthorize();
        setSpotifyAuthData(authData);
        setIsLoading(false);
      } catch (err) {
        console.error("Failed to authorize oauth2 device:", err);
        setError({
          message: "Failed to generate QR code",
          details: err.message,
        });
        setIsLoading(false);
      }
    };

    initDevice();
  }, []);

  useEffect(() => {
    if (spotifyAuthData?.device_code) {
      const pollInterval = setInterval(async () => {
        try {
          const data = await checkAuthStatus(spotifyAuthData.device_code);

          if (data.access_token && data.refresh_token) {
            clearInterval(pollInterval);

            localStorage.setItem("spotifyAccessToken", data.access_token);
            localStorage.setItem("spotifyRefreshToken", data.refresh_token);
            localStorage.setItem("spotifyAuthType", "spotify");
            onSelect({
              type: "spotify",
            });
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, spotifyAuthData.interval * 1000 || 5000);

      const timeoutId = setTimeout(() => {
        clearInterval(pollInterval);
        setError({
          message: "QR code has expired. Please refresh the page to try again.",
        });
      }, 15 * 60 * 1000);

      return () => {
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
      };
    }
  }, [spotifyAuthData, onSelect]);

  useEffect(() => {
    let mounted = true;
    let checkInterval;

    const startNetworkCheck = () => {
      const check = async () => {
        if (!mounted) return;
        try {
          const status = await checkNetworkConnectivity();
          if (mounted) {
            setIsNetworkReady(status.isConnected);

            if (status.isConnected && hasStoredCredentials) {
              const savedAuthType =
                localStorage.getItem("spotifyAuthType") || "default";
              onSelect({ type: savedAuthType });
            }
          }
        } catch (error) {
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
    let animationFrameId;
    let startTime = Date.now();
    const totalDuration = 30000;

    const easeInOutQuad = (t) => {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    };

    const interpolateColor = (color1, color2, factor) => {
      const r1 = parseInt(color1.slice(1, 3), 16);
      const g1 = parseInt(color1.slice(3, 5), 16);
      const b1 = parseInt(color1.slice(5, 7), 16);

      const r2 = parseInt(color2.slice(1, 3), 16);
      const g2 = parseInt(color2.slice(3, 5), 16);
      const b2 = parseInt(color2.slice(5, 7), 16);

      const r = Math.round(r1 + (r2 - r1) * factor);
      const g = Math.round(g1 + (g2 - g1) * factor);
      const b = Math.round(b1 + (b2 - b1) * factor);

      return `#${r.toString(16).padStart(2, "0")}${g
        .toString(16)
        .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    };

    const animate = () => {
      const now = Date.now();
      const elapsed = (now - startTime) % totalDuration;
      const rawProgress = elapsed / totalDuration;

      const themeCount = gradientThemes.length;
      const themePosition = rawProgress * themeCount;
      const currentThemeIndex = Math.floor(themePosition);
      const nextThemeIndex = (currentThemeIndex + 1) % themeCount;

      let themeProgress = themePosition - currentThemeIndex;
      themeProgress = easeInOutQuad(themeProgress);

      const currentTheme = gradientThemes[currentThemeIndex];
      const nextTheme = gradientThemes[nextThemeIndex];

      if (elapsed % 12 === 0) {
        setTargetColor1(
          interpolateColor(
            currentTheme.colors[0],
            nextTheme.colors[0],
            themeProgress
          )
        );
        setTargetColor2(
          interpolateColor(
            currentTheme.colors[1],
            nextTheme.colors[1],
            themeProgress
          )
        );
        setTargetColor3(
          interpolateColor(
            currentTheme.colors[2],
            nextTheme.colors[2],
            themeProgress
          )
        );
        setTargetColor4(
          interpolateColor(
            currentTheme.colors[3],
            nextTheme.colors[3],
            themeProgress
          )
        );
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [setTargetColor1, setTargetColor2, setTargetColor3, setTargetColor4]);

  if (!networkStatus?.isConnected) {
    return <ConnectionScreen />;
  }

  if (!isNetworkReady) {
    return <NetworkScreen isCheckingNetwork={true} />;
  }

  if (hasStoredCredentials) {
    return null;
  }

  const renderQRSection = () => {
    if (isLoading) {
      return (
        <div className="animate-pulse bg-white/10 w-[280px] h-[280px] rounded-xl" />
      );
    }

    if (error) {
      return (
        <div className="w-[280px] h-[280px] rounded-xl bg-white/10 flex items-center justify-center p-6">
          <p className="text-white/70 text-xl text-center">{error.message}</p>
        </div>
      );
    }

    return (
      <div className="bg-white p-1 rounded-xl">
        <QRCodeSVG
          value={spotifyAuthData?.verification_uri_complete || ""}
          size={250}
          level="H"
          includeMargin={true}
        />
      </div>
    );
  };

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

        <div className="flex justify-center">{renderQRSection()}</div>
      </div>
    </div>
  );
};

export default AuthMethodSelector;
