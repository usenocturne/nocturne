import "../styles/globals.css";
import { useEffect, useState, useCallback, useRef } from "react";
import ColorThief from "color-thief-browser";
import { useRouter } from "next/router";
import { Inter } from "next/font/google";
import {
  fetchRecentlyPlayedAlbums,
  fetchUserPlaylists,
  fetchTopArtists,
  fetchUserRadio,
} from "../services";
import ErrorAlert from "../components/ErrorAlert";
import AuthSelection from "../components/AuthSelection";
import { createClient } from "@supabase/supabase-js";
import ButtonMappingOverlay from "../components/ButtonMappingOverlay";
import classNames from "classnames";

const inter = Inter({ subsets: ["latin", "latin-ext"] });

const ErrorCodes = {
  FETCH_CURRENT_PLAYBACK_ERROR: "E001",
  FETCH_ACCESS_TOKEN_ERROR: "E002",
  REFRESH_ACCESS_TOKEN_ERROR: "E003",
  FETCH_LYRICS_ERROR: "E004",
  FETCH_USER_PLAYLISTS_ERROR: "E005",
  SYNC_VOLUME_ERROR: "E006",
  CHANGE_VOLUME_ERROR: "E007",
  CHECK_LIKED_TRACKS_ERROR: "E008",
  CHECK_IF_TRACK_IS_LIKED_ERROR: "E009",
  TOGGLE_LIKED_TRACK_ERROR: "E010",
  TOGGLE_LIKE_TRACK_ERROR: "E011",
  TOGGLE_PLAY_PAUSE_ERROR: "E012",
  SKIP_TO_NEXT_TRACK_ERROR: "E013",
  SKIP_TO_PREVIOUS_ERROR: "E014",
  CHECK_PLAYLIST_CONTENTS_ERROR: "E015",
  ADD_TRACK_TO_PLAYLIST_ERROR: "E016",
  TOGGLE_SHUFFLE_ERROR: "E017",
  TOGGLE_REPEAT_ERROR: "E018",
  FETCH_PLAYBACK_STATE_ERROR: "E019",
  LOAD_MORE_TRACKS_ERROR: "E020",
  NO_DEVICES_AVAILABLE: "E021",
  PLAY_ALBUM_ERROR: "E022",
  TRANSFER_PLAYBACK_ERROR: "E023",
  PLAY_TRACK_ERROR: "E024",
  PLAY_TRACK_REQUEST_ERROR: "E025",
  FETCH_ALBUM_ERROR: "E026",
  FETCH_PLAYBACK_STATE_ERROR: "E027",
  PLAY_ARTIST_TOP_TRACKS_ERROR: "E028",
  FETCH_ARTIST_ERROR: "E029",
  PLAY_PLAYLIST_ERROR: "E030",
  FETCH_PLAYLIST_ERROR: "E031",
  FETCH_RECENTLY_PLAYED_ALBUMS_ERROR: "E032",
  FETCH_TOP_ARTISTS_ERROR: "E033",
  FETCH_USER_RADIO_ERROR: "E034",
  FETCH_USER_PROFILE_ERROR: "E035",
  AUTH_ERROR: "E036",
  DEVICES_FETCH_ERROR: "E037",
  FETCH_PLAYLIST_TRACKS_ERROR: "E038",
};

const initialAuthState = () => {
  if (typeof window === "undefined") {
    return {
      authSelectionMade: false,
      authType: null,
      tempId: null,
    };
  }

  try {
    const savedAuthType = localStorage.getItem("spotifyAuthType");
    const savedTempId = localStorage.getItem("spotifyTempId");

    if (savedAuthType) {
      return {
        authSelectionMade: true,
        authType: savedAuthType,
        tempId: savedAuthType === "custom" ? savedTempId : null,
      };
    }
  } catch (e) {
    console.error("Error accessing localStorage:", e);
  }

  return {
    authSelectionMade: false,
    authType: null,
    tempId: null,
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
  const [pressedButton, setPressedButton] = useState(null);
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [brightness, setBrightness] = useState(160);
  const [showBrightnessOverlay, setShowBrightnessOverlay] = useState(false);
  const { authSelectionMade, authType, tempId } = authState;

  const handleAuthSelection = async (selection) => {
    const newState = {
      authSelectionMade: true,
      authType: selection.type,
      tempId: selection.type === "custom" ? selection.tempId : null,
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
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

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

          if (data && data.item) {
            const currentAlbum = data.item.album;
            const currentTrackUri = data.item.uri;
            setCurrentlyPlayingTrackUri(currentTrackUri);
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

                const imageUrl = currentAlbum.images[0].url;
                if (imageUrl !== albumImage) {
                  localStorage.setItem("albumImage", imageUrl);
                  setAlbumImage(imageUrl);
                  setAlbumName(currentAlbum.name);
                  setArtistName(
                    currentAlbum.artists.map((artist) => artist.name).join(", ")
                  );

                  if (activeSection === "recents") {
                    updateGradientColors(imageUrl);
                  }
                }
              }
            }
          }
        } else if (response.status !== 401 && response.status !== 403) {
          handleError(
            "FETCH_CURRENT_PLAYBACK_ERROR",
            `HTTP error! status: ${response.status}`
          );
        }
      } catch (error) {
        if (error.message.includes("Unexpected end of JSON input")) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          return;
        } else {
          handleError("FETCH_CURRENT_PLAYBACK_ERROR", error.message);
        }
      }
    }
  };

  const redirectToSpotify = async () => {
    const scopes =
      "user-read-recently-played user-read-private user-top-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

    let clientId;
    if (authType === "custom" && tempId) {
      try {
        const supabaseInstance = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

        const { data, error } = await supabaseInstance
          .from("spotify_credentials")
          .select("client_id")
          .eq("temp_id", tempId)
          .single();

        if (error) {
          console.error("Supabase error:", error);
          handleError("AUTH_ERROR", "Failed to get custom credentials");
          return;
        }

        if (!data) {
          handleError("AUTH_ERROR", "No credentials found for the provided ID");
          return;
        }

        clientId = data.client_id;
        localStorage.setItem("spotifyAuthType", "custom");
        localStorage.setItem("spotifyTempId", tempId);
      } catch (error) {
        console.error("Error getting custom credentials:", error);
        handleError("AUTH_ERROR", error.message);
        return;
      }
    } else {
      clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      localStorage.setItem("spotifyAuthType", "default");
    }

    if (!clientId) {
      handleError("AUTH_ERROR", "No client ID available");
      return;
    }

    window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${process.env.NEXT_PUBLIC_REDIRECT_URI}&scope=${scopes}`;
  };

  const fetchAccessToken = async (code) => {
    try {
      const response = await fetch("/api/token", {
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
      const response = await fetch("/api/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
          isCustomAuth: authType === "custom",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setAccessToken(data.access_token);
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
      }
      return data;
    } catch (error) {
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
    const holdDuration = 2000;
    const quickPressDuration = 200;
    let holdTimer = null;
    let hasTriggered = false;
    let lastMPressTime = 0;
    let mPressCount = 0;
    let brightnessOverlayTimer = null;
    let keyPressStartTime = null;

    const handleKeyDown = (event) => {
      if (event.key === "m" || event.key === "M") {
        if (!keyPressStartTime) {
          keyPressStartTime = Date.now();
        }

        const now = Date.now();

        if (
          now - lastMPressTime < 500 &&
          now - keyPressStartTime < quickPressDuration
        ) {
          mPressCount++;
          if (mPressCount === 3) {
            if (brightnessOverlayTimer) {
              clearTimeout(brightnessOverlayTimer);
            }

            setShowBrightnessOverlay(true);

            brightnessOverlayTimer = setTimeout(() => {
              setShowBrightnessOverlay(false);
            }, 300000);

            mPressCount = 0;
            lastMPressTime = 0;
            return;
          }
        } else {
          mPressCount = 1;
        }
        lastMPressTime = now;

        if (!hasTriggered && mPressCount < 2) {
          holdTimer = setTimeout(() => {
            if (router.pathname !== "/") {
              router.push("/").then(() => {
                setActiveSection("settings");
              });
            } else {
              setActiveSection("settings");
            }
            hasTriggered = true;
          }, holdDuration);
        }
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === "m" || event.key === "M") {
        keyPressStartTime = null;
        if (holdTimer) {
          clearTimeout(holdTimer);
        }
        hasTriggered = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdTimer) {
        clearTimeout(holdTimer);
      }
      if (brightnessOverlayTimer) {
        clearTimeout(brightnessOverlayTimer);
      }
    };
  }, [router, setShowBrightnessOverlay, setActiveSection]);

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
        !pressStartPath?.includes("/playlist/")
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

              const playlistId = mappedRoute.split("/").pop();

              const playbackResponse = await fetch(
                "https://api.spotify.com/v1/me/player",
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              let currentShuffle = false;
              let currentRepeat = "off";

              if (playbackResponse.ok && playbackResponse.status !== 204) {
                const playbackData = await playbackResponse.json();
                currentShuffle = playbackData.shuffle_state;
                currentRepeat = playbackData.repeat_state;
              }

              const devicesResponse = await fetch(
                "https://api.spotify.com/v1/me/player/devices",
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (!devicesResponse.ok) {
                throw new Error(
                  `Devices fetch error! status: ${devicesResponse.status}`
                );
              }

              const devicesData = await devicesResponse.json();

              if (!devicesData?.devices || devicesData.devices.length === 0) {
                handleError(
                  "NO_DEVICES_AVAILABLE",
                  "No devices available for playback"
                );
                return;
              }

              const device = devicesData.devices[0];
              const activeDeviceId = device.id;

              if (!device.is_active) {
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

              let startPosition = 0;
              if (currentShuffle) {
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
                `https://api.spotify.com/v1/me/player/shuffle?state=${currentShuffle}`,
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
              handleError("PLAY_TRACK_REQUEST_ERROR", error.message);
            }
          };

          playRequest();
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
    if (typeof window !== "undefined" && authSelectionMade) {
      const code = new URLSearchParams(window.location.search).get("code");
      setAuthCode(code);
    }
  }, [authSelectionMade]);

  useEffect(() => {
    if (authCode && authSelectionMade) {
      fetchAccessToken(authCode);
    } else if (
      typeof window !== "undefined" &&
      !window.location.search.includes("code") &&
      authSelectionMade
    ) {
      redirectToSpotify();
    }
  }, [authCode, authSelectionMade]);

  useEffect(() => {
    if (accessToken) {
      const tokenRefreshInterval = setInterval(() => {
        refreshAccessToken();
      }, 3000 * 1000);

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

      const playbackInterval = setInterval(() => {
        fetchCurrentPlayback();
      }, 1000);

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
        if (currentPlayback.item && currentPlayback.item.album.images[0]) {
          updateGradientColors(
            currentPlayback.item.album.images[0].url,
            "nowPlaying"
          );
        }
      }
    }
  }, [router.pathname, currentPlayback]);

  const updateGradientColors = useCallback(
    (imageUrl, section = null) => {
      if (!imageUrl) {
        if (section === "radio") {
          const radioColors = ["#223466", "#1f2d57", "#be54a6", "#1e2644"];
          setSectionGradients((prev) => ({ ...prev, [section]: radioColors }));
          if (activeSection === "radio" || activeSection === "nowPlaying") {
            setTargetColor1(radioColors[0]);
            setTargetColor2(radioColors[1]);
            setTargetColor3(radioColors[2]);
            setTargetColor4(radioColors[3]);
          }
        } else if (
          section === "settings" ||
          router.pathname === "/now-playing"
        ) {
          const settingsColors = ["#191414", "#191414", "#191414", "#191414"];
          setSectionGradients((prev) => ({
            ...prev,
            [section]: settingsColors,
          }));
          if (
            activeSection === "settings" ||
            router.pathname === "/now-playing"
          ) {
            setTargetColor1(settingsColors[0]);
            setTargetColor2(settingsColors[1]);
            setTargetColor3(settingsColors[2]);
            setTargetColor4(settingsColors[3]);
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
      className={`overflow-hidden relative min-h-screen ${inter.className}`}
    >
      {!authState.authSelectionMade ? (
        <AuthSelection onSelect={handleAuthSelection} />
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
