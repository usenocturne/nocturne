import "../styles/globals.css";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import ColorThief from "color-thief-browser";
import { useRouter } from "next/router";
import {
  fetchRecentlyPlayedAlbums,
  fetchUserPlaylists,
  fetchTopArtists,
  fetchUserRadio,
} from "../services";
import ErrorAlert from "../components/ErrorAlert";
import AuthSelection from "../components/AuthSelection";
import ButtonMappingOverlay from "../components/ButtonMappingOverlay";
import classNames from "classnames";
import { ErrorCodes } from "../constants/errorCodes";
import { getCurrentDevice } from "@/services/deviceService";
import {
  checkNetworkConnectivity,
  startNetworkMonitoring,
} from "../lib/networkChecker";
import { inter, notoSansSC, notoSansJP, notoSansKR } from "../constants/fonts";

const initialAuthState = () => {
  if (typeof window === "undefined") {
    return {
      authSelectionMade: false,
      authType: null,
    };
  }

  try {
    const existingAuthType = localStorage.getItem("spotifyAuthType");
    const existingRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const existingTempId = localStorage.getItem("spotifyTempId");

    if (existingAuthType && existingRefreshToken) {
      return {
        authSelectionMade: true,
        authType: existingAuthType,
        tempId: existingTempId,
      };
    }
  } catch (e) {
    console.error("Error accessing localStorage:", e);
  }

  return {
    authSelectionMade: false,
    authType: null,
  };
};

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [authState, setAuthState] = useState(initialAuthState);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumsQueue, setAlbumsQueue] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [radio, setRadio] = useState([]);
  const [albumImage, setAlbumImage] = useState(null);
  const [colors, setColors] = useState([]);
  const [albumName, setAlbumName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [activeSection, setActiveSection] = useState("recents");
  const [currentColor1, setCurrentColor1] = useState("#191414");
  const [currentColor2, setCurrentColor2] = useState("#191414");
  const [currentColor3, setCurrentColor3] = useState("#191414");
  const [currentColor4, setCurrentColor4] = useState("#191414");
  const [targetColor1, setTargetColor1] = useState("#191414");
  const [targetColor2, setTargetColor2] = useState("#191414");
  const [targetColor3, setTargetColor3] = useState("#191414");
  const [targetColor4, setTargetColor4] = useState("#191414");
  const [transitionSpeed, setTransitionSpeed] = useState(30);
  const [loading, setLoading] = useState(true);
  const [currentlyPlayingTrackUri, setCurrentlyPlayingTrackUri] =
    useState(null);
  const [sectionGradients, setSectionGradients] = useState({
    recents: null,
    library: null,
    artists: null,
    radio: null,
  });
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState(null);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [currentRepeat, setCurrentRepeat] = useState("off");
  const [pressedButton, setPressedButton] = useState(null);
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [brightness, setBrightness] = useState(160);
  const [showBrightnessOverlay, setShowBrightnessOverlay] = useState(false);
  const { authSelectionMade, authType, tempId } = authState;
  const keyStatesRef = useRef({
    4: false,
    Escape: false,
  });
  const resetTimerRef = useRef(null);
  const startTimeRef = useRef(null);
  const [networkStatus, setNetworkStatus] = useState({ isConnected: false });
  const inactivityTimeoutRef = useRef(null);
  const lastActivityTimeRef = useRef(Date.now());

  useEffect(() => {
    const checkInitialConnectivity = async () => {
      const intervalId = setInterval(async () => {
        try {
          const savedAccessToken = localStorage.getItem("spotifyAccessToken");
          if (savedAccessToken) {
            await checkNetworkConnectivity(savedAccessToken);
          } else {
            await fetch("https://api.spotify.com/v1", { method: "OPTIONS" });
          }
          clearInterval(intervalId);
          setNetworkStatus({ isConnected: true });
        } catch (error) {
          setNetworkStatus({ isConnected: false });
          handleError("NETWORK_ERROR", "Unable to connect to Spotify");
        }
      }, 3000);
    };

    checkInitialConnectivity();
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      if (typeof window === "undefined") return;

      if (window.location.search.includes("code")) return;

      const savedRefreshToken = localStorage.getItem("spotifyRefreshToken");
      const savedAuthType = localStorage.getItem("spotifyAuthType");
      const savedTempId = localStorage.getItem("spotifyTempId");

      if (savedRefreshToken && savedAuthType) {
        try {
          const refreshData = await refreshAccessToken();

          if (refreshData?.access_token) {
            setAccessToken(refreshData.access_token);
            localStorage.setItem(
              "spotifyAccessToken",
              refreshData.access_token
            );

            if (refreshData.refresh_token) {
              setRefreshToken(refreshData.refresh_token);
              localStorage.setItem(
                "spotifyRefreshToken",
                refreshData.refresh_token
              );
            }

            const newExpiry = new Date(
              Date.now() + refreshData.expires_in * 1000
            ).toISOString();
            localStorage.setItem("spotifyTokenExpiry", newExpiry);

            setAuthState({
              authSelectionMade: true,
              authType: savedAuthType,
              tempId: savedTempId,
            });

            if (savedAuthType === "custom") {
              await supabase
                .from("spotify_credentials")
                .update({
                  access_token: refreshData.access_token,
                  refresh_token: refreshData.refresh_token || savedRefreshToken,
                  token_expiry: newExpiry,
                  last_used: new Date().toISOString(),
                })
                .match({
                  temp_id: savedTempId,
                  refresh_token: savedRefreshToken,
                });
            }
          }
        } catch (error) {
          console.error("Failed to restore session:", error);

          if (error.message && error.message.includes("invalid_grant")) {
            await clearSession();
            if (!authState.tempId) {
              redirectToSpotify();
            }
          }
        }
      } else if (
        authState.authSelectionMade &&
        !router.pathname.includes("phone-auth")
      ) {
        if (!authState.tempId) {
          redirectToSpotify();
        }
      }
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    if (accessToken) {
      localStorage.setItem("spotifyAccessToken", accessToken);
      localStorage.setItem(
        "spotifyTokenExpiry",
        new Date(Date.now() + 3600 * 1000).toISOString()
      );
    }
  }, [accessToken]);

  useEffect(() => {
    if (refreshToken) {
      localStorage.setItem("spotifyRefreshToken", refreshToken);
      localStorage.setItem("spotifyAuthType", authState.authType);
    }
  }, [refreshToken, authState.authType]);

  useEffect(() => {
    const handleActivity = () => {
      lastActivityTimeRef.current = Date.now();
    };

    const checkInactivity = () => {
      const currentTime = Date.now();
      const inactiveTime = currentTime - lastActivityTimeRef.current;
      const isAutoRedirectEnabled =
        localStorage.getItem("autoRedirectEnabled") === "true";

      if (inactiveTime >= 60000) {
        if (
          isAutoRedirectEnabled &&
          currentPlayback?.is_playing &&
          router.pathname !== "/now-playing" &&
          !showBrightnessOverlay &&
          !showMappingOverlay &&
          !drawerOpen &&
          authState.authSelectionMade &&
          accessToken &&
          !router.pathname.includes("phone-auth") &&
          !window.location.search.includes("code")
        ) {
          router.push("/now-playing");
        }
      }
    };

    lastActivityTimeRef.current = Date.now();

    const events = [
      "mousemove",
      "mousedown",
      "click",
      "touchstart",
      "touchmove",
      "keydown",
      "wheel",
      "scroll",
      "input",
      "focus",
    ];

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    inactivityTimeoutRef.current = setInterval(checkInactivity, 1000);

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimeoutRef.current) {
        clearInterval(inactivityTimeoutRef.current);
      }
    };
  }, [
    router.pathname,
    currentPlayback?.is_playing,
    showBrightnessOverlay,
    showMappingOverlay,
    drawerOpen,
    authState.authSelectionMade,
    accessToken,
  ]);

  const handleAuthSelection = async (selection) => {
    const newState = {
      authSelectionMade: true,
      authType: selection.type,
    };
    setAuthState(newState);
  };

  const handleError = (errorType, errorMessage) => {
    setError({
      code: ErrorCodes[errorType],
      message: `${ErrorCodes[errorType]}: ${errorMessage}`,
    });
  };

  const clearError = () => {
    setError(null);
  };

  const handleEscapePress = (event) => {
    if (event.key === "Escape") {
      window.dispatchEvent(new CustomEvent("app-escape-pressed"));
    }
  };

  const calculateBrightness = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  const calculateHue = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h;

    if (max === min) {
      h = 0;
    } else {
      const d = max - min;
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return h * 360;
  };

  const extractColors = (imageUrl) => {
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const palette = colorThief.getPalette(img, 8);
      const filteredColors = palette
        .map(
          (color) =>
            `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`
        )
        .filter((color) => {
          const brightness = calculateBrightness(color);
          return brightness > 120 || brightness < 10;
        })
        .sort((a, b) => calculateHue(a) - calculateHue(b));

      setColors(filteredColors);
    };
  };

  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = ({ r, g, b }) => {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const getNextColor = (current, target) => {
    const step = (start, end) => {
      if (start === end) return start;
      const diff = end - start;
      return start + (diff > 0 ? Math.min(1, diff) : Math.max(-1, diff));
    };

    return {
      r: step(current.r, target.r),
      g: step(current.g, target.g),
      b: step(current.b, target.b),
    };
  };

  const generateMeshGradient = (colors) => {
    if (colors.length === 0) return "#191414";

    const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];

    const radialGradients = positions.map((position, index) => {
      const color = colors[index % colors.length];
      return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
    });

    return `${radialGradients.join(", ")}`;
  };

  const fetchCurrentPlayback = async () => {
    if (accessToken) {
      try {
        const response = await fetch(
          "https://api.spotify.com/v1/me/player?type=episode,track",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.status === 204) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          return;
        }

        if (response.ok) {
          const data = await response.json();
          if (data === null || Object.keys(data).length === 0) {
            setCurrentPlayback(null);
            setCurrentlyPlayingAlbum(null);
            setCurrentlyPlayingTrackUri(null);
            return;
          }

          setCurrentPlayback({
            ...data,
            device: {
              ...data.device,
              volume_percent: data.device?.volume_percent,
            },
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
          });

          setIsShuffleEnabled(data.shuffle_state);
          setCurrentRepeat(data.repeat_state);

          if (data && data.item) {
            if (data && data.item) {
              const currentTrackUri = data.item.uri;
              setCurrentlyPlayingTrackUri(currentTrackUri);

              if (data.item.type === "track") {
                const currentAlbum = data.item.album;
                if (
                  !currentlyPlayingAlbum ||
                  currentlyPlayingAlbum.id !== currentAlbum.id
                ) {
                  if (!router.pathname.includes("album")) {
                    setCurrentlyPlayingAlbum(currentAlbum);
                    setAlbumsQueue((prevQueue) => {
                      const updatedQueue = prevQueue.filter(
                        (album) => album.id !== currentAlbum.id
                      );
                      return [currentAlbum, ...updatedQueue];
                    });

                    const imageUrl = currentAlbum.images[0]?.url;
                    if (imageUrl !== albumImage) {
                      localStorage.setItem("albumImage", imageUrl);
                      setAlbumImage(imageUrl);
                      setAlbumName(currentAlbum.name);
                      setArtistName(
                        currentAlbum.artists
                          .map((artist) => artist.name)
                          .join(", ")
                      );

                      if (activeSection === "recents") {
                        updateGradientColors(imageUrl);
                      }
                    }
                  }
                }
              } else if (data.item.type === "episode") {
                const currentShow = data.item.show;
                if (
                  !currentlyPlayingAlbum ||
                  currentlyPlayingAlbum.id !== currentShow.id
                ) {
                  setCurrentlyPlayingAlbum(currentShow);
                  setAlbumsQueue((prevQueue) => {
                    const updatedQueue = prevQueue.filter(
                      (album) => album.id !== currentShow.id
                    );
                    return [currentShow, ...updatedQueue];
                  });

                  const imageUrl = currentShow.images[0]?.url;
                  if (imageUrl !== albumImage) {
                    localStorage.setItem("albumImage", imageUrl);
                    setAlbumImage(imageUrl);
                    setAlbumName(currentShow.name);
                    setArtistName(currentShow.publisher);

                    if (activeSection === "recents") {
                      updateGradientColors(imageUrl);
                    }
                  }
                }
              }
            }
          }
        } else if (response.status !== 401 && response.status !== 403) {
          return;
        }
      } catch (error) {
        if (error.message.includes("Unexpected end of JSON input")) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          return;
        } else {
          console.error("Error fetching current playback:", error);
        }
      }
    }
  };

  const redirectToSpotify = async () => {
    const scopes =
      "user-read-recently-played user-read-private user-top-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

    const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
    const urlParams = new URLSearchParams(window.location.search);
    const phoneSession = urlParams.get("session");
    const isPhoneAuth = !!phoneSession;

    if (!clientId) {
      handleError("AUTH_ERROR", "No client ID available");
      return;
    }

    const state = isPhoneAuth
      ? encodeURIComponent(
          JSON.stringify({
            phoneAuth: true,
            sessionId: phoneSession,
          })
        )
      : undefined;

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.append("client_id", clientId);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append(
      "redirect_uri",
      process.env.NEXT_PUBLIC_REDIRECT_URI
    );
    authUrl.searchParams.append("scope", scopes);
    if (state) {
      authUrl.searchParams.append("state", state);
    }

    window.location.href = authUrl.toString();
  };

  const fetchAccessToken = async (code) => {
    try {
      const response = await fetch("/api/v1/auth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          tempId,
          isCustomAuth: authType === "custom",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
    } catch (error) {
      handleError("FETCH_ACCESS_TOKEN_ERROR", error.message);
    }
  };

  const refreshAccessToken = async () => {
    try {
      const currentRefreshToken = localStorage.getItem("spotifyRefreshToken");
      const currentAuthType = localStorage.getItem("spotifyAuthType");
      const currentTempId = localStorage.getItem("spotifyTempId");

      const response = await fetch("/api/v1/auth/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: currentRefreshToken,
          isCustomAuth: currentAuthType === "custom",
          tempId: currentTempId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Refresh token error:", {
          status: response.status,
          data: errorData,
        });
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      setAccessToken(data.access_token);
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
        localStorage.setItem("spotifyRefreshToken", data.refresh_token);
      }

      const newExpiry = new Date(
        Date.now() + data.expires_in * 1000
      ).toISOString();
      localStorage.setItem("spotifyTokenExpiry", newExpiry);

      return data;
    } catch (error) {
      console.error("Token refresh error:", error);
      handleError("REFRESH_ACCESS_TOKEN_ERROR", error.message);
      throw error;
    }
  };

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const handleAppEscape = () => {
      router.push("/").then(() => {
        setActiveSection("recents");
      });
    };

    window.addEventListener("app-escape-pressed", handleAppEscape);

    return () => {
      window.removeEventListener("app-escape-pressed", handleAppEscape);
    };
  }, [router, setActiveSection]);

  useEffect(() => {
    const handleWheel = (event) => {
      if (showBrightnessOverlay) {
        event.stopPropagation();
        event.preventDefault();
        setBrightness((prev) => {
          const newValue = prev + (event.deltaX > 0 ? 5 : -5);
          return Math.max(5, Math.min(250, newValue));
        });
      }
    };

    const handleKeyDown = (event) => {
      if (
        showBrightnessOverlay &&
        ["1", "2", "3", "4", "Escape", "Enter"].includes(event.key)
      ) {
        event.stopPropagation();
        event.preventDefault();

        const existingTimeout = window.brightnessOverlayTimer;
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }
        setShowBrightnessOverlay(false);
      }
    };

    const handleTouchMove = (event) => {
      if (showBrightnessOverlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleTouchStart = (event) => {
      if (showBrightnessOverlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchstart", handleTouchStart);
    };
  }, [showBrightnessOverlay]);

  useEffect(() => {
    const handleWheel = (event) => {
      if (showBrightnessOverlay) {
        event.stopPropagation();
        event.preventDefault();
        setBrightness((prev) => {
          const newValue = prev + (event.deltaX > 0 ? 5 : -5);
          return Math.max(5, Math.min(250, newValue));
        });
      }
    };

    const handleKeyDown = (event) => {
      if (
        showBrightnessOverlay &&
        ["1", "2", "3", "4", "Escape", "Enter"].includes(event.key)
      ) {
        event.stopPropagation();
        event.preventDefault();

        const existingTimeout = window.brightnessOverlayTimer;
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }
        setShowBrightnessOverlay(false);
      }
    };

    const handleTouchMove = (event) => {
      if (showBrightnessOverlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleTouchStart = (event) => {
      if (showBrightnessOverlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchstart", handleTouchStart);
    };
  }, [showBrightnessOverlay]);

  useEffect(() => {
    const resetDuration = 5000;

    const performReset = () => {
      localStorage.removeItem("spotifyAuthType");
      localStorage.removeItem("spotifyTempId");
      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");

      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("button") && key.endsWith("Map")) {
          localStorage.removeItem(key);
        }
      });

      router.push("/").then(() => {
        window.location.reload();
      });
    };

    const handleKeyDown = (event) => {
      if (event.key === "4" || event.key === "Escape") {
        keyStatesRef.current[event.key] = true;

        if (keyStatesRef.current["4"] && keyStatesRef.current["Escape"]) {
          if (!startTimeRef.current) {
            startTimeRef.current = Date.now();

            if (resetTimerRef.current) {
              clearInterval(resetTimerRef.current);
            }

            resetTimerRef.current = setInterval(async () => {
              const elapsedTime = Date.now() - startTimeRef.current;
              if (elapsedTime >= resetDuration) {
                try {
                  const refreshToken = localStorage.getItem(
                    "spotifyRefreshToken"
                  );
                  const tempId = localStorage.getItem("spotifyTempId");
                  const authType = localStorage.getItem("spotifyAuthType");
                  if (authType === "custom" && refreshToken && tempId) {
                    const { error } = await supabase
                      .from("spotify_credentials")
                      .delete()
                      .match({
                        temp_id: tempId,
                        refresh_token: refreshToken,
                      });
                    if (error) {
                      console.error(
                        "Error removing credentials from database:",
                        error
                      );
                    }
                  }
                  localStorage.clear();
                  router.push("/").then(() => {
                    window.location.reload();
                  });
                } catch (error) {
                  console.error("Error during reset:", error);
                  localStorage.clear();
                  router.push("/").then(() => {
                    window.location.reload();
                  });
                }
              }

              if (
                keyStatesRef.current["4"] &&
                keyStatesRef.current["Escape"] &&
                elapsedTime >= resetDuration
              ) {
                clearInterval(resetTimerRef.current);
                performReset();
              }
            }, 100);
          }
        }
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === "4" || event.key === "Escape") {
        keyStatesRef.current[event.key] = false;

        if (resetTimerRef.current) {
          clearInterval(resetTimerRef.current);
          resetTimerRef.current = null;
        }
        startTimeRef.current = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      if (resetTimerRef.current) {
        clearInterval(resetTimerRef.current);
      }
    };
  }, [router]);

  useEffect(() => {
    const validKeys = ["1", "2", "3", "4"];
    const pressStartTimes = {};
    const holdDuration = 2000;
    let hideTimerRef = null;

    const handleKeyDown = (event) => {
      if (!validKeys.includes(event.key)) return;
      pressStartTimes[event.key] = Date.now();
      pressStartTimes[`${event.key}_path`] = window.location.pathname;
    };

    const handleKeyUp = (event) => {
      if (!validKeys.includes(event.key)) return;

      const pressDuration = Date.now() - (pressStartTimes[event.key] || 0);
      const pressStartPath = pressStartTimes[`${event.key}_path`];
      delete pressStartTimes[event.key];
      delete pressStartTimes[`${event.key}_path`];

      if (
        pressDuration < holdDuration &&
        !pressStartPath?.includes("/playlist/") &&
        !pressStartPath?.includes("/collection/")
      ) {
        const hasAnyMappings = validKeys.some(
          (key) => localStorage.getItem(`button${key}Map`) !== null
        );

        if (!hasAnyMappings) {
          return;
        }

        const mappedRoute = localStorage.getItem(`button${event.key}Map`);

        if (hideTimerRef) {
          clearTimeout(hideTimerRef);
        }

        setPressedButton(event.key);
        setShowMappingOverlay(true);

        hideTimerRef = setTimeout(() => {
          setShowMappingOverlay(false);
          setPressedButton(null);
          hideTimerRef = null;
        }, 2000);

        if (mappedRoute) {
          const playRequest = async () => {
            try {
              if (!accessToken) {
                if (!refreshToken) {
                  throw new Error("No refresh token available");
                }
                await refreshAccessToken();
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }

              if (!accessToken) {
                throw new Error("Failed to obtain access token");
              }

              const device = await getCurrentDevice(accessToken, handleError);
              const activeDeviceId = device == null ? null : device.id;

              if (device && !device.is_active) {
                await fetch("https://api.spotify.com/v1/me/player", {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    device_ids: [activeDeviceId],
                    play: false,
                  }),
                });

                await new Promise((resolve) => setTimeout(resolve, 500));
              }

              if (mappedRoute === "liked-songs") {
                const tracksResponse = await fetch(
                  "https://api.spotify.com/v1/me/tracks?limit=50",
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  }
                );

                if (!tracksResponse.ok) {
                  throw new Error("Failed to fetch liked songs");
                }

                const tracksData = await tracksResponse.json();
                const trackUris = tracksData.items.map(
                  (item) => item.track.uri
                );

                let startPosition = 0;
                if (isShuffleEnabled) {
                  startPosition = Math.floor(Math.random() * trackUris.length);
                }

                await fetch(
                  `https://api.spotify.com/v1/me/player/shuffle?state=${isShuffleEnabled}`,
                  {
                    method: "PUT",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  }
                );

                const playResponse = await fetch(
                  "https://api.spotify.com/v1/me/player/play",
                  {
                    method: "PUT",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      uris: trackUris,
                      offset: { position: startPosition },
                      device_id: activeDeviceId,
                    }),
                  }
                );

                if (!playResponse.ok) {
                  throw new Error(`Play error! status: ${playResponse.status}`);
                }

                return;
              }

              const playlistId = mappedRoute.split("/").pop();

              let startPosition = 0;
              if (isShuffleEnabled) {
                const playlistResponse = await fetch(
                  `https://api.spotify.com/v1/playlists/${playlistId}`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  }
                );

                if (playlistResponse.ok) {
                  const playlistData = await playlistResponse.json();
                  const totalTracks = playlistData.tracks.total;
                  startPosition = Math.floor(Math.random() * totalTracks);
                }
              }

              const shuffleResponse = await fetch(
                `https://api.spotify.com/v1/me/player/shuffle?state=${isShuffleEnabled}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (!shuffleResponse.ok) {
                console.error("Failed to set shuffle state");
              }

              const playResponse = await fetch(
                "https://api.spotify.com/v1/me/player/play",
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    context_uri: `spotify:playlist:${playlistId}`,
                    offset: { position: startPosition },
                    device_id: activeDeviceId,
                  }),
                }
              );

              if (!playResponse.ok) {
                throw new Error(`Play error! status: ${playResponse.status}`);
              }

              const repeatResponse = await fetch(
                `https://api.spotify.com/v1/me/player/repeat?state=${currentRepeat}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (!repeatResponse.ok) {
                console.error("Failed to set repeat state");
              }

              await new Promise((resolve) => setTimeout(resolve, 500));
              fetchCurrentPlayback();
            } catch (error) {
              console.error("Error in playRequest:", error);
            }
          };

          playRequest().then(() => {
            setShowMappingOverlay(false);
            setPressedButton(null);
            router.push("/now-playing");
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (hideTimerRef) {
        clearTimeout(hideTimerRef);
      }
    };
  }, [accessToken, refreshToken, router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const code = new URLSearchParams(window.location.search).get("code");
      const state = new URLSearchParams(window.location.search).get("state");

      if (code) {
        if (state) {
          try {
            const stateData = JSON.parse(decodeURIComponent(state));
            if (stateData.phoneAuth) {
              localStorage.setItem("spotifySessionId", stateData.sessionId);
              const exchangeTokens = async () => {
                try {
                  const tokenResponse = await fetch("/api/v1/auth/token", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      code,
                      isPhoneAuth: true,
                      sessionId: stateData.sessionId,
                      tempId: stateData.tempId,
                    }),
                  });

                  if (!tokenResponse.ok) {
                    throw new Error("Token exchange failed");
                  }

                  const tokenData = await tokenResponse.json();

                  const { error: updateError } = await supabase
                    .from("spotify_credentials")
                    .update({
                      access_token: tokenData.access_token,
                      refresh_token: tokenData.refresh_token,
                      token_expiry: new Date(
                        Date.now() + tokenData.expires_in * 1000
                      ).toISOString(),
                      auth_completed: true,
                      first_used_at: new Date().toISOString(),
                      last_used: new Date().toISOString(),
                    })
                    .eq("session_id", stateData.sessionId);

                  if (updateError) {
                    console.error("Failed to update database:", updateError);
                    throw new Error("Failed to store tokens");
                  }

                  document.documentElement.innerHTML = `
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <title>Authentication Successful</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                          body {
                            background: #000;
                            color: #fff;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                            height: 100vh;
                            margin: 0;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            text-align: center;
                            padding: 20px;
                          }
                          .success-icon {
                            width: 60px;
                            height: 60px;
                            border-radius: 50%;
                            background: #1DB954;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 0 auto 24px;
                          }
                          h1 {
                            font-size: 24px;
                            margin: 0 0 12px;
                            font-weight: bold;
                          }
                          p {
                            color: rgba(255,255,255,0.7);
                            margin: 0;
                            line-height: 1.5;
                          }
                          .countdown {
                            margin-top: 24px;
                            color: rgba(255,255,255,0.5);
                            font-size: 14px;
                          }
                        </style>
                      </head>
                      <body>
                        <div class="success-icon">
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </div>
                        <h1>Authentication Successful</h1>
                        <p>You can close this window and return to Nocturne.</p>
                        <div class="countdown">This window will close automatically...</div>
                      </body>
                    </html>
                  `;

                  setTimeout(() => {
                    window.close();
                  }, 3000);
                } catch (error) {
                  console.error("Token exchange error:", error);
                  document.documentElement.innerHTML = `
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <title>Authentication Error</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                          body {
                            background: #000;
                            color: #fff;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                            height: 100vh;
                            margin: 0;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            text-align: center;
                            padding: 20px;
                          }
                          .error-icon {
                            width: 60px;
                            height: 60px;
                            border-radius: 50%;
                            background: #E34D4D;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 0 auto 24px;
                          }
                          h1 {
                            font-size: 24px;
                            margin: 0 0 12px;
                            font-weight: bold;
                          }
                          p {
                            color: rgba(255,255,255,0.7);
                            margin: 0;
                            line-height: 1.5;
                          }
                          .error-message {
                            margin-top: 12px;
                            color: rgba(227, 77, 77, 0.8);
                            font-size: 14px;
                          }
                        </style>
                      </head>
                      <body>
                        <div class="error-icon">
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </div>
                        <h1>Authentication Error</h1>
                        <p>Something went wrong while authenticating.</p>
                        <div class="error-message">${error.message}</div>
                      </body>
                    </html>
                  `;
                }
              };

              exchangeTokens();
            } else {
              setAuthCode(code);
              setAuthState((prev) => ({ ...prev, authSelectionMade: true }));
            }
          } catch (e) {
            console.error("Error parsing state:", e);
            setAuthCode(code);
            setAuthState((prev) => ({ ...prev, authSelectionMade: true }));
          }
        } else {
          setAuthCode(code);
          setAuthState((prev) => ({ ...prev, authSelectionMade: true }));
        }
      }
    }
  }, []);

  useEffect(() => {
    if (authCode) {
      fetchAccessToken(authCode);
    } else if (
      typeof window !== "undefined" &&
      !window.location.search.includes("code") &&
      authState.authSelectionMade &&
      !router.pathname.includes("phone-auth")
    ) {
      if (authState.authType === "custom") {
        const savedAccessToken = localStorage.getItem("spotifyAccessToken");
        const savedRefreshToken = localStorage.getItem("spotifyRefreshToken");
        const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");

        if (savedAccessToken && savedRefreshToken) {
          if (tokenExpiry && new Date(tokenExpiry) <= new Date()) {
            refreshAccessToken();
          } else {
            setAccessToken(savedAccessToken);
            setRefreshToken(savedRefreshToken);
          }
          return;
        }
      }

      if (!authState.tempId) {
        redirectToSpotify();
      }
    }
  }, [authCode, authState.authSelectionMade]);

  useEffect(() => {
    if (accessToken) {
      const checkTokenExpiry = async () => {
        const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
        const currentTime = new Date();
        const expiryTime = new Date(tokenExpiry);

        if (
          !tokenExpiry ||
          expiryTime <= new Date(currentTime.getTime() + 5 * 60000)
        ) {
          try {
            const refreshData = await refreshAccessToken();
            if (refreshData.access_token) {
              setAccessToken(refreshData.access_token);
              localStorage.setItem(
                "spotifyAccessToken",
                refreshData.access_token
              );
              localStorage.setItem(
                "spotifyTokenExpiry",
                new Date(
                  Date.now() + refreshData.expires_in * 1000
                ).toISOString()
              );

              if (refreshData.refresh_token) {
                setRefreshToken(refreshData.refresh_token);
                localStorage.setItem(
                  "spotifyRefreshToken",
                  refreshData.refresh_token
                );
              }
            }
          } catch (error) {
            console.error("Token refresh failed:", error);
            if (error.message.includes("invalid_grant")) {
              clearSession();
              redirectToSpotify();
            }
          }
        }
      };

      checkTokenExpiry();

      const tokenRefreshInterval = setInterval(checkTokenExpiry, 5 * 60 * 1000);
      const playbackInterval = setInterval(() => {
        fetchCurrentPlayback();
      }, 1000);

      const networkCleanup = startNetworkMonitoring(
        accessToken,
        async (isConnected) => {
          try {
            if (isConnected) {
              const status = await checkNetworkConnectivity(accessToken);
              setNetworkStatus({ isConnected: true });
            } else {
              setNetworkStatus({ isConnected: false });
              handleError("NETWORK_ERROR", "Lost connection to Spotify");
            }
          } catch (error) {
            setNetworkStatus({ isConnected: false });
            handleError("NETWORK_ERROR", error.message);
          }
        }
      );

      setLoading(false);

      fetchRecentlyPlayedAlbums(
        accessToken,
        setAlbums,
        setAlbumsQueue,
        handleError
      );
      fetchUserPlaylists(
        accessToken,
        setPlaylists,
        updateGradientColors,
        handleError
      );
      fetchTopArtists(
        accessToken,
        setArtists,
        updateGradientColors,
        handleError
      );
      fetchUserRadio(accessToken, setRadio, updateGradientColors, handleError);

      const recentlyPlayedInterval = setInterval(() => {
        fetchRecentlyPlayedAlbums(
          accessToken,
          setAlbums,
          setAlbumsQueue,
          handleError
        );
      }, 5 * 60 * 1000);

      window.addEventListener("keydown", handleEscapePress);

      return () => {
        clearInterval(tokenRefreshInterval);
        clearInterval(playbackInterval);
        clearInterval(recentlyPlayedInterval);
        window.removeEventListener("keydown", handleEscapePress);
        networkCleanup();
      };
    }
  }, [accessToken]);

  useEffect(() => {
    if (router.pathname === "/now-playing") {
      if (!currentPlayback || !currentPlayback.is_playing) {
        setTargetColor1("#191414");
        setTargetColor2("#191414");
        setTargetColor3("#191414");
        setTargetColor4("#191414");
      } else {
        const albumImages = currentPlayback?.item?.album?.images;
        const podcastImages = currentPlayback?.item?.images;

        if (albumImages && albumImages.length > 0 && albumImages[0]?.url) {
          updateGradientColors(albumImages[0].url, "nowPlaying");
        } else if (
          podcastImages &&
          podcastImages.length > 0 &&
          podcastImages[0]?.url
        ) {
          updateGradientColors(podcastImages[0].url, "nowPlaying");
        } else {
          setTargetColor1("#191414");
          setTargetColor2("#191414");
          setTargetColor3("#191414");
          setTargetColor4("#191414");
        }
      }
    }
  }, [router.pathname, currentPlayback]);

  const clearSession = async () => {
    try {
      const refreshToken = localStorage.getItem("spotifyRefreshToken");
      const tempId = localStorage.getItem("spotifyTempId");
      const authType = localStorage.getItem("spotifyAuthType");

      if (authType === "custom" && refreshToken && tempId) {
        await supabase.from("spotify_credentials").delete().match({
          temp_id: tempId,
          refresh_token: refreshToken,
        });
      }

      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      localStorage.removeItem("spotifyTempId");
      localStorage.removeItem("spotifySessionId");

      setAccessToken(null);
      setRefreshToken(null);
      setAuthState({
        authSelectionMade: false,
        authType: null,
      });
    } catch (error) {
      console.error("Error during session cleanup:", error);
      const authItems = [
        "spotifyAccessToken",
        "spotifyRefreshToken",
        "spotifyTokenExpiry",
        "spotifyAuthType",
        "spotifyTempId",
        "spotifySessionId",
      ];
      authItems.forEach((item) => localStorage.removeItem(item));

      setAccessToken(null);
      setRefreshToken(null);
      setAuthState({
        authSelectionMade: false,
        authType: null,
      });
    }
  };

  const updateGradientColors = useCallback(
    (imageUrl, section = null) => {
      if (!imageUrl) {
        if (section === "radio") {
          const radioColors = ["#d5f2c0", "#daf4c7", "#da90c9", "#db3dcb"];
          setSectionGradients((prev) => ({ ...prev, [section]: radioColors }));
          if (activeSection === "radio" || activeSection === "nowPlaying") {
            setTargetColor1(radioColors[0]);
            setTargetColor2(radioColors[1]);
            setTargetColor3(radioColors[2]);
            setTargetColor4(radioColors[3]);
          }
        } else if (section === "library") {
          const libraryColors = ["#7662e9", "#a9c1de", "#8f90e3", "#5b30ef"];
          setSectionGradients((prev) => ({
            ...prev,
            [section]: libraryColors,
          }));
          if (activeSection === "library") {
            setTargetColor1(libraryColors[0]);
            setTargetColor2(libraryColors[1]);
            setTargetColor3(libraryColors[2]);
            setTargetColor4(libraryColors[3]);
          }
        }
        return;
      }

      const colorThief = new ColorThief();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        const dominantColors = colorThief.getPalette(img, 4);
        const hexColors = dominantColors.map((color) =>
          rgbToHex({ r: color[0], g: color[1], b: color[2] })
        );

        setSectionGradients((prev) => ({
          ...prev,
          [section]: hexColors,
        }));

        if (
          section === activeSection ||
          section === "nowPlaying" ||
          activeSection === "nowPlaying"
        ) {
          setTargetColor1(hexColors[0]);
          setTargetColor2(hexColors[1]);
          setTargetColor3(hexColors[2]);
          setTargetColor4(hexColors[3]);
        }
      };
    },
    [
      activeSection,
      router.pathname,
      setTargetColor1,
      setTargetColor2,
      setTargetColor3,
      setTargetColor4,
    ]
  );

  useEffect(() => {
    const current1 = hexToRgb(currentColor1);
    const current2 = hexToRgb(currentColor2);
    const current3 = hexToRgb(currentColor3);
    const current4 = hexToRgb(currentColor4);

    const target1 = hexToRgb(targetColor1);
    const target2 = hexToRgb(targetColor2);
    const target3 = hexToRgb(targetColor3);
    const target4 = hexToRgb(targetColor4);

    const intervalId = setInterval(() => {
      const nextColor1 = getNextColor(current1, target1);
      const nextColor2 = getNextColor(current2, target2);
      const nextColor3 = getNextColor(current3, target3);
      const nextColor4 = getNextColor(current4, target4);

      setCurrentColor1(rgbToHex(nextColor1));
      setCurrentColor2(rgbToHex(nextColor2));
      setCurrentColor3(rgbToHex(nextColor3));
      setCurrentColor4(rgbToHex(nextColor4));

      current1.r = nextColor1.r;
      current1.g = nextColor1.g;
      current1.b = nextColor1.b;

      current2.r = nextColor2.r;
      current2.g = nextColor2.g;
      current2.b = nextColor2.b;

      current3.r = nextColor3.r;
      current3.g = nextColor3.g;
      current3.b = nextColor3.b;

      current4.r = nextColor4.r;
      current4.g = nextColor4.g;
      current4.b = nextColor4.b;

      if (
        nextColor1.r === target1.r &&
        nextColor1.g === target1.g &&
        nextColor1.b === target1.b &&
        nextColor2.r === target2.r &&
        nextColor2.g === target2.g &&
        nextColor2.b === target2.b &&
        nextColor3.r === target3.r &&
        nextColor3.g === target3.g &&
        nextColor3.b === target3.b &&
        nextColor4.r === target4.r &&
        nextColor4.g === target4.g &&
        nextColor4.b === target4.b
      ) {
        clearInterval(intervalId);
      }
    }, transitionSpeed);

    return () => clearInterval(intervalId);
  }, [
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    targetColor1,
    targetColor2,
    targetColor3,
    targetColor4,
    transitionSpeed,
  ]);

  useEffect(() => {
    if (albumImage) {
      extractColors(albumImage);
    }
  }, [albumImage]);

  useEffect(() => {
    if (activeSection !== "recents" && sectionGradients[activeSection]) {
      const [color1, color2, color3, color4] = sectionGradients[activeSection];
      setTargetColor1(color1);
      setTargetColor2(color2);
      setTargetColor3(color3);
      setTargetColor4(color4);
    }
  }, [activeSection, sectionGradients]);

  if (!isHydrated) {
    return null;
  }

  const BrightnessLowIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="rgba(0, 0, 0)"
      fill="rgba(0, 0, 0)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 4h.01" />
      <path d="M20 12h.01" />
      <path d="M12 20h.01" />
      <path d="M4 12h.01" />
      <path d="M17.657 6.343h.01" />
      <path d="M17.657 17.657h.01" />
      <path d="M6.343 17.657h.01" />
      <path d="M6.343 6.343h.01" />
    </svg>
  );

  const BrightnessMidIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="rgba(0, 0, 0)"
      fill="rgba(0, 0, 0)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1" />
      <path d="M12 20v1" />
      <path d="M3 12h1" />
      <path d="M20 12h1" />
      <path d="m18.364 5.636-.707.707" />
      <path d="m6.343 17.657-.707.707" />
      <path d="m5.636 5.636.707.707" />
      <path d="m17.657 17.657.707.707" />
    </svg>
  );

  const BrightnessHighIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="rgba(0, 0, 0)"
      fill="rgba(0, 0, 0)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );

  return (
    <main
      className={`overflow-hidden relative min-h-screen rounded-2xl ${inter.className}`}
      style={{
        fontFamily: `${inter.style.fontFamily}, ${notoSansSC.style.fontFamily}, ${notoSansJP.style.fontFamily}, ${notoSansKR.style.fontFamily}, sans-serif`,
        fontOpticalSizing: "auto",
      }}
    >
      {!authState.authSelectionMade &&
      !router.pathname.includes("phone-auth") &&
      !window.location.search.includes("code") ? (
        <AuthSelection
          onSelect={handleAuthSelection}
          networkStatus={networkStatus}
        />
      ) : (
        <>
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
          <div className="relative z-10">
            <Component
              {...pageProps}
              accessToken={accessToken}
              albums={albums}
              playlists={playlists}
              artists={artists}
              radio={radio}
              currentlyPlayingAlbum={currentlyPlayingAlbum}
              setCurrentlyPlayingAlbum={setCurrentlyPlayingAlbum}
              activeSection={activeSection}
              setActiveSection={setActiveSection}
              loading={loading}
              albumsQueue={albumsQueue}
              currentlyPlayingTrackUri={currentlyPlayingTrackUri}
              currentPlayback={currentPlayback}
              fetchCurrentPlayback={fetchCurrentPlayback}
              drawerOpen={drawerOpen}
              setDrawerOpen={setDrawerOpen}
              updateGradientColors={updateGradientColors}
              handleError={handleError}
              showBrightnessOverlay={showBrightnessOverlay}
              networkStatus={networkStatus}
            />
            <ErrorAlert error={error} onClose={clearError} />
          </div>
          {(showBrightnessOverlay || brightness) && (
            <div
              className={classNames(
                "fixed right-0 top-[70px] transform transition-opacity duration-300 z-50",
                {
                  "opacity-0 volumeOutScale": !showBrightnessOverlay,
                  "opacity-100 volumeInScale": showBrightnessOverlay,
                }
              )}
            >
              <div className="w-14 h-44 bg-slate-700/60 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden">
                <div
                  className={classNames(
                    "bg-white w-full transition-all duration-200 ease-out",
                    {
                      "rounded-b-[13px]": brightness < 250,
                      "rounded-[13px]": brightness === 250,
                    }
                  )}
                  style={{ height: `${((brightness - 5) / (250 - 5)) * 100}%` }}
                >
                  <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7">
                    {(() => {
                      const brightnessPercent =
                        ((brightness - 5) / (250 - 5)) * 100;
                      if (brightnessPercent >= 60)
                        return <BrightnessHighIcon className="w-7 h-7" />;
                      if (brightnessPercent >= 30)
                        return <BrightnessMidIcon className="w-7 h-7" />;
                      return <BrightnessLowIcon className="w-7 h-7" />;
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}
          <ButtonMappingOverlay
            show={showMappingOverlay}
            onClose={() => setShowMappingOverlay(false)}
            activeButton={pressedButton}
          />
        </>
      )}
    </main>
  );
}
