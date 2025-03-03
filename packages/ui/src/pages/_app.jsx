import "../styles/globals.css";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import ErrorAlert from "../components/common/alerts/ErrorAlert";
import AuthSelection from "../components/auth/AuthSelection";
import ButtonMappingOverlay from "../components/common/controls/ButtonMappingOverlay";
import Tutorial from "../components/tutorial/Tutorial";
import classNames from "classnames";
import { ErrorCodes } from "../constants/errorCodes";
import {
  checkNetworkConnectivity,
  startNetworkMonitoring,
} from "../lib/networkChecker";
import {
  fetchRecentlyPlayedAlbums,
  fetchUserPlaylists,
  fetchTopArtists,
  fetchUserRadio,
} from "../services";
import {
  inter,
  notoSansSC,
  notoSansTC,
  notoSerifJP,
  notoSansKR,
  notoNaskhAR,
  notoSansDV,
  notoSansHE,
  notoSansBN,
  notoSansTA,
  notoSansTH,
  notoSansGK,
} from "../constants/fonts";
import {
  BrightnessLowIcon,
  BrightnessMidIcon,
  BrightnessHighIcon,
} from "../components/icons";
import { useAuthState } from "../hooks/useAuthState";
import { useMediaState } from "../hooks/useMediaState";
import { useGradientState } from "../hooks/useGradientState";
import { useNavigationState } from "../hooks/useNavigationState";
import { useKeyboardHandlers } from "../hooks/useKeyboardHandlers";
import { usePlaybackProgress } from "../hooks/usePlaybackProgress";

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState(null);
  const [pressedButton, setPressedButton] = useState(null);
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [brightness, setBrightness] = useState(160);
  const [showBrightnessOverlay, setShowBrightnessOverlay] = useState(false);
  const [networkStatus, setNetworkStatus] = useState({ isConnected: false });
  const [showNoNetwork, setShowNoNetwork] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("lastActiveSection") || "recents";
    }
    return "recents";
  });
  const { updateSectionHistory } = useNavigationState();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const lastActivityTimeRef = useRef(Date.now());
  const inactivityTimeoutRef = useRef(null);
  const initialCheckTimeoutRef = useRef(null);
  const initialCheckDoneRef = useRef(false);

  const mainFontClasses = `${inter.variable} ${notoSansSC.variable} ${notoSansTC.variable} ${notoSerifJP.variable} ${notoSansKR.variable} ${notoNaskhAR.variable} ${notoSansDV.variable} ${notoSansHE.variable} ${notoSansBN.variable} ${notoSansTA.variable} ${notoSansTH.variable} ${notoSansGK.variable}`;

  const handleError = (errorType, errorMessage) => {
    setError({
      code: ErrorCodes[errorType],
      message: `${ErrorCodes[errorType]}: ${errorMessage}`,
    });
  };

  const clearError = () => {
    setError(null);
  };

  const {
    authState,
    accessToken,
    refreshToken,
    handleAuthSelection: hookHandleAuthSelection,
    refreshAccessToken,
    clearSession,
    setAccessToken,
    setRefreshToken,
    setAuthState,
    authCode,
    setAuthCode,
    handleAuthSelection,
  } = useAuthState(router);

  const {
    currentPlayback,
    currentlyPlayingTrackUri,
    currentlyPlayingAlbum,
    albumsQueue,
    recentAlbums,
    playlists,
    artists,
    radio,
    isShuffleEnabled,
    currentRepeat,
    fetchCurrentPlayback,
    setPlaylists,
    setArtists,
    setRadio,
    setAlbumsQueue,
    setRecentAlbums,
  } = useMediaState(accessToken, handleError);

  const {
    colors,
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState(activeSection);

  const estimatedProgress = usePlaybackProgress(currentPlayback);

  useKeyboardHandlers({
    drawerOpen,
    setDrawerOpen,
    showBrightnessOverlay,
    setShowBrightnessOverlay,
    brightness,
    setBrightness,
    router,
    setActiveSection,
    handleError,
    accessToken,
    refreshToken,
    refreshAccessToken,
    isShuffleEnabled,
    currentRepeat,
    fetchCurrentPlayback,
    setPressedButton,
    setShowMappingOverlay,
  });

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const checkInitialConnectivity = async () => {
      if (router.pathname.includes("phone-auth")) {
        return;
      }

      let mounted = true;
      let checkInterval;
      let hasShownError = false;

      if (!initialCheckDoneRef.current) {
        initialCheckTimeoutRef.current = setTimeout(() => {
          if (!initialCheckDoneRef.current && mounted) {
            setShowNoNetwork(true);
          }
        }, 5000);
      }

      const checkNetwork = async () => {
        if (!mounted) return;

        try {
          const status = await checkNetworkConnectivity();
          if (mounted) {
            setNetworkStatus({ isConnected: status.isConnected });
            initialCheckDoneRef.current = true;
            if (status.isConnected) {
              if (hasShownError) {
                clearError();
                hasShownError = false;
              }
              if (initialCheckTimeoutRef.current) {
                clearTimeout(initialCheckTimeoutRef.current);
                initialCheckTimeoutRef.current = null;
              }
            }
          }
        } catch (error) {
          if (mounted) {
            setNetworkStatus({ isConnected: false });
            initialCheckDoneRef.current = true;
          }
        }
      };

      if (!window.networkCheckInterval) {
        checkNetwork();
        window.networkCheckInterval = setInterval(checkNetwork, 3000);
        checkInterval = window.networkCheckInterval;
      }

      return () => {
        mounted = false;
        if (checkInterval && checkInterval === window.networkCheckInterval) {
          clearInterval(window.networkCheckInterval);
          window.networkCheckInterval = null;
        }
        if (initialCheckTimeoutRef.current) {
          clearTimeout(initialCheckTimeoutRef.current);
          initialCheckTimeoutRef.current = null;
        }
      };
    };

    checkInitialConnectivity();
  }, [router.pathname]);

  useEffect(() => {
    let timeoutId;
    if (!networkStatus?.isConnected && initialCheckDoneRef.current) {
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
  }, [networkStatus?.isConnected]);

  useEffect(() => {
    if (accessToken) {
      localStorage.setItem("spotifyAccessToken", accessToken);
      localStorage.setItem(
        "spotifyTokenExpiry",
        new Date(Date.now() + 3600 * 1000).toISOString()
      );

      if (!window.networkMonitoringActive) {
        window.networkMonitoringActive = true;
        const networkCleanup = startNetworkMonitoring(async (isConnected) => {
          try {
            if (isConnected) {
              const status = await checkNetworkConnectivity();
              setNetworkStatus({ isConnected: status.isConnected });
              clearError();
            } else {
              setNetworkStatus({ isConnected: false });
              if (accessToken && !router.pathname.includes("phone-auth")) {
                handleError("NETWORK_ERROR", "Lost connection to Spotify");
              }
            }
          } catch (error) {
            setNetworkStatus({ isConnected: false });
            if (accessToken && !router.pathname.includes("phone-auth")) {
              handleError("NETWORK_ERROR", error.message);
            }
          }
        });

        window.networkMonitoringCleanup = networkCleanup;
      }

      const fetchInitialData = async () => {
        try {
          await Promise.all([
            fetchRecentlyPlayedAlbums(
              accessToken,
              setRecentAlbums,
              setAlbumsQueue,
              handleError
            ),
            fetchUserPlaylists(
              accessToken,
              setPlaylists,
              updateGradientColors,
              handleError
            ),
            fetchTopArtists(
              accessToken,
              setArtists,
              updateGradientColors,
              handleError
            ),
            fetchUserRadio(
              accessToken,
              setRadio,
              updateGradientColors,
              handleError
            ),
          ]);
        } catch (error) {
          console.error("Error fetching initial data:", error);
          handleError("FETCH_DATA_ERROR", error.message);
        } finally {
          setLoading(false);
        }
      };

      fetchInitialData();

      const recentlyPlayedInterval = setInterval(() => {
        fetchRecentlyPlayedAlbums(
          accessToken,
          setRecentAlbums,
          setAlbumsQueue,
          handleError
        );
      }, 5 * 60 * 1000);

      return () => {
        clearInterval(recentlyPlayedInterval);
        if (window.networkMonitoringCleanup) {
          window.networkMonitoringCleanup();
          window.networkMonitoringCleanup = null;
          window.networkMonitoringActive = false;
        }
      };
    }
  }, [accessToken]);

  useEffect(() => {
    if (refreshToken) {
      localStorage.setItem("spotifyRefreshToken", refreshToken);
      localStorage.setItem("spotifyAuthType", authState.authType);
    }
  }, [refreshToken, authState.authType]);

  useEffect(() => {
    if (accessToken) {
      const attemptTokenRefresh = async () => {
        if (isRefreshing) return;

        try {
          setIsRefreshing(true);
          const networkStatus = await checkNetworkConnectivity();
          if (!networkStatus.isConnected) {
            setTimeout(attemptTokenRefresh, 3000);
            return;
          }

          const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
          const currentTime = new Date();
          const expiryTime = new Date(tokenExpiry);

          if (
            !tokenExpiry ||
            expiryTime <= new Date(currentTime.getTime() + 5 * 60000)
          ) {
            try {
              await refreshAccessToken();
            } catch (error) {
              console.error("Token refresh failed:", error);
              if (error.message.includes("invalid_grant")) {
                await clearSession();
              } else {
                setTimeout(attemptTokenRefresh, 3000);
              }
            }
          }
        } catch (error) {
          setTimeout(attemptTokenRefresh, 3000);
        } finally {
          setIsRefreshing(false);
        }
      };

      attemptTokenRefresh();

      const tokenRefreshInterval = setInterval(
        attemptTokenRefresh,
        5 * 60 * 1000
      );

      return () => {
        clearInterval(tokenRefreshInterval);
      };
    }
  }, [accessToken]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
      if (!hasSeenTutorial && authState.authSelectionMade) {
        setShowTutorial(true);
      }
    }
  }, [authState.authSelectionMade]);

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
          activeSection === "nowPlaying" &&
          !showBrightnessOverlay &&
          !showMappingOverlay &&
          !drawerOpen &&
          authState.authSelectionMade &&
          accessToken &&
          !router.pathname.includes("phone-auth") &&
          !window.location.search.includes("code")
        ) {
          setActiveSection("nowPlaying");
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

  useEffect(() => {
    if (activeSection === "nowPlaying") {
      if (!currentPlayback || !currentPlayback.is_playing) {
        updateGradientColors(null);
      } else {
        const albumImages = currentPlayback?.item?.album?.images;
        const podcastImages = currentPlayback?.item?.images;

        if (albumImages?.[0]?.url) {
          updateGradientColors(albumImages[0].url, "nowPlaying");
        } else if (podcastImages?.[0]?.url) {
          updateGradientColors(podcastImages[0].url, "nowPlaying");
        } else {
          updateGradientColors(null);
        }
      }
    }
  }, [router.pathname, currentPlayback, updateGradientColors]);

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

    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [showBrightnessOverlay]);

  useEffect(() => {
    updateSectionHistory(activeSection);
  }, [activeSection, updateSectionHistory]);

  useEffect(() => {
    const handleEscapePress = (event) => {
      if (event.key === "Escape") {
        window.dispatchEvent(new CustomEvent("app-escape-pressed"));
      }
    };

    window.addEventListener("keydown", handleEscapePress);

    return () => {
      window.removeEventListener("keydown", handleEscapePress);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        setAuthCode(code);
        setAuthState((prev) => ({ ...prev, authSelectionMade: true }));
      }
    }
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      if (typeof window === "undefined") return;
      if (window.location.search.includes("code")) return;
      if (isRefreshing) return;

      const savedRefreshToken = localStorage.getItem("spotifyRefreshToken");
      const savedAuthType = localStorage.getItem("spotifyAuthType");

      if (savedRefreshToken && savedAuthType) {
        const attemptSessionRestore = async () => {
          if (isRefreshing) return;

          try {
            setIsRefreshing(true);
            const networkStatus = await checkNetworkConnectivity();
            if (!networkStatus.isConnected) {
              setTimeout(attemptSessionRestore, 3000);
              return;
            }

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
              });
            }
          } catch (error) {
            console.error("Failed to restore session:", error);
            clearSession();

            if (error.message && error.message.includes("invalid_grant")) {
              await clearSession();
            } else {
              setTimeout(attemptSessionRestore, 3000);
            }
          } finally {
            setIsRefreshing(false);
          }
        };

        attemptSessionRestore();
      } else if (
        authState.authSelectionMade &&
        !router.pathname.includes("phone-auth")
      ) {
        await clearSession();
      }
    };

    initializeAuth();
  }, [networkStatus?.isConnected]);

  if (!isHydrated) {
    return null;
  }

  return (
    <main
      className={`overflow-hidden relative min-h-screen rounded-2xl ${mainFontClasses}`}
      style={{
        fontFamily:
          "var(--font-inter), var(--font-noto-sans-sc), var(--font-noto-sans-tc), var(--font-noto-serif-jp), var(--font-noto-sans-kr), var(--font-noto-naskh-ar), var(--font-noto-sans-dv), var(--font-noto-sans-he), var(--font-noto-sans-bn), var(--font-noto-sans-ta), var(--font-noto-sans-th), var(--font-noto-sans-gk)",
        fontOpticalSizing: "auto",
      }}
    >
      {(!networkStatus?.isConnected &&
        showNoNetwork &&
        !router.pathname.includes("phone-auth")) ||
      (!authState.authSelectionMade &&
        !router.pathname.includes("phone-auth") &&
        !window.location.search.includes("code") &&
        !localStorage.getItem("spotifyRefreshToken") &&
        !localStorage.getItem("spotifyAccessToken")) ? (
        <AuthSelection
          onSelect={hookHandleAuthSelection}
          networkStatus={networkStatus}
        />
      ) : networkStatus?.isConnected ? (
        showTutorial ? (
          <Tutorial
            onComplete={() => {
              setShowTutorial(false);
              localStorage.setItem("hasSeenTutorial", "true");
            }}
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
              className="absolute inset-0 bg-black"
            />
            <div className="relative z-10">
              <Component
                {...pageProps}
                accessToken={accessToken}
                playlists={playlists}
                recentAlbums={recentAlbums}
                artists={artists}
                radio={radio}
                currentlyPlayingAlbum={currentlyPlayingAlbum}
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
                showTutorial={showTutorial}
                estimatedProgress={estimatedProgress}
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
                    style={{
                      height: `${((brightness - 5) / (250 - 5)) * 100}%`,
                    }}
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
        )
      ) : (
        <AuthSelection
          onSelect={hookHandleAuthSelection}
          networkStatus={networkStatus}
        />
      )}
    </main>
  );
}
