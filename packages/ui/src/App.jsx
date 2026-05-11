import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import FontLoader from "./components/common/FontLoader";
import Tutorial from "./components/tutorial/Tutorial";
import Home from "./pages/Home";
import ContentView from "./components/content/ContentView";
import NowPlaying from "./components/player/NowPlaying";
import DeviceSwitcherModal from "./components/player/DeviceSwitcherModal";
import ButtonMappingOverlay from "./components/common/overlays/ButtonMappingOverlay";
import GradientBackground from "./components/common/GradientBackground";
import { useGradientState } from "./hooks/useGradientState";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import {
  useBluetooth,
  useSystemUpdate,
  useNocturneInfo,
  useNocturned,
  sendNocturneWsRequest,
  subscribeAppReadyState,
  subscribeSpotifySkippedState,
  AutoUpdateManager,
} from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { usePlaybackProgress } from "./hooks/usePlaybackProgress";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { OTAProvider } from "./contexts/OTAContext";
import React from "react";
import {
  NotificationProvider,
  useNotifications,
} from "./contexts/NotificationContext";
import { VoiceProvider } from "./contexts/VoiceContext";
import NotificationsContainer from "./components/common/notifications/NotificationsContainer";
import PairingScreen from "./components/screens/PairingScreen";
import LockView from "./components/common/LockView";
import PowerMenuOverlay from "./components/common/overlays/PowerMenuOverlay";
import VoiceOverlay from "./components/common/overlays/voice/VoiceOverlay";
import { CheckIcon } from "./components/common/icons";
import { SettingsUpdateIcon } from "./components/common/icons";
import UpdateCheckNotification from "./components/common/notifications/UpdateCheckNotification";
import NetworkScreen from "./components/screens/NetworkScreen";
import NetworkBanner from "./components/common/overlays/NetworkBanner";
import AuthScreen from "./components/screens/AuthScreen";
import SplashScreen from "./components/screens/SplashScreen";
import UIShell from "./mockingbird/UIShell";
import { useSubscription } from "./hooks/useSubscription";

const LazyBTPairing = React.lazy(
  () => import("./mockingbird/ui/components/Setup/BTPairing"),
);

function MockingbirdPairingOverlay({ pin }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        fontFamily:
          "spotify-circular, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <React.Suspense fallback={null}>
        <LazyBTPairing pin={pin} />
      </React.Suspense>
    </div>
  );
}

function useGlobalButtonMapping({
  playTrack,
  playDJMix,
  refreshPlaybackState,
  setActiveSection,
  isTutorialActive,
  isDisabled = false,
  currentPlayback,
  spotifyUserId,
}) {
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [activeButton, setActiveButton] = useState(null);
  const [isProcessingButtonPress, setIsProcessingButtonPress] = useState(false);
  const ignoreNextReleaseRef = useRef(false);
  const shouldRenderRef = useRef(true);

  const handleButtonPress = useCallback(
    async (buttonNumber) => {
      if (isProcessingButtonPress || isTutorialActive || isDisabled) return;

      const mappedId = localStorage.getItem(`button${buttonNumber}Id`);
      const mappedType = localStorage.getItem(`button${buttonNumber}Type`);

      if (!mappedId || !mappedType) return;

      setIsProcessingButtonPress(true);
      setActiveButton(buttonNumber);
      setShowMappingOverlay(true);

      let contextUri = null;
      let uris = null;

      try {
        if (mappedType === "album") {
          contextUri = `spotify:album:${mappedId}`;
        } else if (mappedType === "playlist") {
          contextUri = `spotify:playlist:${mappedId}`;
        } else if (mappedType === "artist") {
          contextUri = `spotify:artist:${mappedId}`;
        } else if (mappedType === "show") {
          contextUri = `spotify:show:${mappedId}`;
        } else if (mappedType === "mix") {
          const mixTracksJson = localStorage.getItem(
            `button${buttonNumber}Tracks`,
          );
          if (mixTracksJson) {
            try {
              const mixTracks = JSON.parse(mixTracksJson);
              uris = mixTracks;
              localStorage.setItem("currentPlayingMixId", mappedId);
            } catch (e) {
              console.error("Error parsing mix tracks:", e);
            }
          }
        } else if (mappedType === "liked-songs") {
          if (spotifyUserId) {
            contextUri = `spotify:user:${spotifyUserId}:collection`;
          } else {
            const likedTracksJson = localStorage.getItem(
              `button${buttonNumber}Tracks`,
            );
            if (likedTracksJson) {
              try {
                const likedTracks = JSON.parse(likedTracksJson);
                uris = likedTracks;
              } catch (e) {
                console.error("Error parsing liked tracks:", e);
              }
            }
          }
          localStorage.setItem("playingLikedSongs", "true");
        }

        let success = false;
        const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

        if (mappedType === "playlist" && mappedId === DJ_PLAYLIST_ID) {
          success = await (playDJMix
            ? playDJMix(currentPlayback?.device?.id)
            : playTrack(null, contextUri));
        } else if (contextUri) {
          success = await playTrack(null, contextUri);
        } else if (uris && uris.length > 0) {
          success = await playTrack(null, null, uris);
        }

        if (success) {
          setTimeout(() => {
            refreshPlaybackState();
            setActiveSection("nowPlaying");
          }, 500);
        }

        setTimeout(() => {
          setShowMappingOverlay(false);
          setActiveButton(null);
          setIsProcessingButtonPress(false);
        }, 1500);
      } catch (error) {
        console.error("Error playing mapped content:", error);
        setShowMappingOverlay(false);
        setActiveButton(null);
        setIsProcessingButtonPress(false);
      }
    },
    [
      playTrack,
      playDJMix,
      refreshPlaybackState,
      setActiveSection,
      isProcessingButtonPress,
      isTutorialActive,
      isDisabled,
      currentPlayback,
    ],
  );

  useEffect(() => {
    if (isTutorialActive) return;

    if (isDisabled) return;

    const handleKeyDown = (e) => {
      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;
      e.preventDefault();
    };

    const handleKeyUp = (e) => {
      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;

      if (ignoreNextReleaseRef.current) {
        ignoreNextReleaseRef.current = false;
        return;
      }

      handleButtonPress(buttonNumber);
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [handleButtonPress, isTutorialActive, isDisabled]);

  const setIgnoreNextRelease = useCallback(() => {
    ignoreNextReleaseRef.current = true;
  }, []);

  return {
    showMappingOverlay: isDisabled ? false : showMappingOverlay,
    activeButton,
    setIgnoreNextRelease,
  };
}

function NotificationEffects({
  isUpdating,
  updateStatus,
  activeSection,
  handleReboot,
  isError,
  errorMessage,
}) {
  const { addNotification, removeNotification } = useNotifications();
  const notificationShownRef = useRef(false);
  const lastErrorMessageRef = useRef(null);
  const { settings } = useSettings();
  const autoUpdateEnabled = settings?.autoUpdateEnabled;

  useEffect(() => {
    if (
      !isUpdating &&
      updateStatus.stage === "complete" &&
      activeSection !== "settings" &&
      !notificationShownRef.current &&
      !autoUpdateEnabled
    ) {
      notificationShownRef.current = true;
      addNotification({
        icon: SettingsUpdateIcon,
        title: "Update installed",
        description: "Nocturne was updated successfully. Restart to apply.",
        action: { label: "Restart", onPress: handleReboot },
      });
    }
  }, [
    isUpdating,
    updateStatus.stage,
    activeSection,
    addNotification,
    handleReboot,
    autoUpdateEnabled,
  ]);

  useEffect(() => {
    if (isError && errorMessage) {
      if (lastErrorMessageRef.current !== errorMessage) {
        lastErrorMessageRef.current = errorMessage;
        addNotification({
          icon: SettingsUpdateIcon,
          title: "Update failed",
          description: errorMessage,
        });
      }
    } else if (!isError) {
      lastErrorMessageRef.current = null;
    }
  }, [isError, errorMessage, addNotification]);

  return null;
}

function App() {
  const { isSubscribed, hasPhoneAccess } = useSubscription();
  const [appPlatform, setAppPlatform] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [currentTutorialStep, setCurrentTutorialStep] = useState(0);
  const [activeSection, setActiveSection] = useState("recents");
  const previousSectionRef = useRef("recents");
  const activeSectionRef = useRef(activeSection);

  useEffect(() => {
    activeSectionRef.current = activeSection;
    if (activeSection !== "lock") {
      previousSectionRef.current = activeSection;
    }
  }, [activeSection]);
  const [viewingContent, setViewingContent] = useState(null);
  const [contentSourceSection, setContentSourceSection] = useState(null);
  const [isDeviceSwitcherOpen, setIsDeviceSwitcherOpen] = useState(false);
  const [playbackIntentOnDeviceSwitch, setPlaybackIntentOnDeviceSwitch] =
    useState(null);
  const [prefetchedDevices, setPrefetchedDevices] = useState(null);
  const [powerMenuVisible, setPowerMenuVisible] = useState(false);
  const powerMenuVisibleRef = useRef(false);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const [showExhaustedReconnectScreen, setShowExhaustedReconnectScreen] =
    useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [isSpotifyAuthenticated, setIsSpotifyAuthenticated] = useState(null);
  const [isSpotifySkipped, setIsSpotifySkipped] = useState(false);
  const [needsSpotifyAuthorization, setNeedsSpotifyAuthorization] =
    useState(false);
  const [authStatusMessage, setAuthStatusMessage] = useState(null);
  const [hasSeenTutorialFlag, setHasSeenTutorialFlag] = useState(
    () => localStorage.getItem("hasSeenTutorial") === "true",
  );
  const [
    hasSeenMockingbirdOnboardingFlag,
    setHasSeenMockingbirdOnboardingFlag,
  ] = useState(
    () => localStorage.getItem("hasSeenMockingbirdOnboarding") === "true",
  );
  const [isAuthCheckInProgress, setIsAuthCheckInProgress] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const startSectionAppliedRef = useRef(false);
  const lastSpotifyAuthStateRef = useRef(null);
  const lastSpotifySkippedStateRef = useRef(false);
  const splashFlowWithDeviceRef = useRef(false);

  useEffect(() => {
    powerMenuVisibleRef.current = powerMenuVisible;
  }, [powerMenuVisible]);

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    spotifyUserId,
    initialDataLoaded,
    isLoading,
    errors: dataErrors,
    refreshData,
    refreshRecentlyPlayed,
  } = useSpotifyData(activeSection, false, true);

  const {
    version: nocturneVersion,
    isLoading: isInfoLoading,
    refetch: refetchInfo,
  } = useNocturneInfo();

  useEffect(() => {
    const syncFromStorage = () => {
      setHasSeenTutorialFlag(
        localStorage.getItem("hasSeenTutorial") === "true",
      );
      setHasSeenMockingbirdOnboardingFlag(
        localStorage.getItem("hasSeenMockingbirdOnboarding") === "true",
      );
    };

    syncFromStorage();

    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  useEffect(() => {
    const handleShowBanner = () => setShowNetworkBanner(true);
    const handleHideBanner = () => setShowNetworkBanner(false);
    const handleShowNetworkScreen = () => setShowExhaustedReconnectScreen(true);
    const handleHideNetworkScreen = () =>
      setShowExhaustedReconnectScreen(false);

    window.addEventListener("networkBannerShow", handleShowBanner);
    window.addEventListener("networkBannerHide", handleHideBanner);
    window.addEventListener("networkScreenShow", handleShowNetworkScreen);
    window.addEventListener("networkScreenHide", handleHideNetworkScreen);

    return () => {
      window.removeEventListener("networkBannerShow", handleShowBanner);
      window.removeEventListener("networkBannerHide", handleHideBanner);
      window.removeEventListener("networkScreenShow", handleShowNetworkScreen);
      window.removeEventListener("networkScreenHide", handleHideNetworkScreen);
    };
  }, []);

  const {
    devices,
    pairingRequest,
    isConnecting,
    showTetheringScreen,
    lastConnectedDevice,
    connectedDevices,
    hasFetchedInitialDevices,
    acceptPairing,
    denyPairing,
    setDiscoverable,
    disconnectDevice,
    enableNetworking,
    stopRetrying,
    reconnectAttempt,
  } = useBluetooth();

  const { addMessageListener, removeMessageListener, wsConnected } =
    useNocturned();

  const hasDevices =
    (Array.isArray(devices) && devices.length > 0) ||
    (Array.isArray(connectedDevices) && connectedDevices.length > 0) ||
    Boolean(lastConnectedDevice);

  const processSpotifyAuthMessage = useCallback(
    (message) => {
      if (!message) return false;

      let topic = message.topic;
      let data =
        message.data ??
        message.payload ??
        message.result?.data ??
        message.result?.payload ??
        message.result ??
        null;

      if (!topic && message.result?.topic) {
        topic = message.result.topic;
      }

      if (!topic && message.type === "event") {
        topic = message.topic;
      }

      if (
        !topic &&
        (message.authenticated !== undefined ||
          message.result?.authenticated !== undefined)
      ) {
        topic = "spotify.auth.status";
        data =
          message.result?.authenticated !== undefined
            ? message.result
            : message;
      }

      if (!topic || !data) {
        return false;
      }

      if (data.authenticated === undefined && data.data) {
        data = data.data;
      }

      const authenticatedValue = data.authenticated;
      const needsAuthorizationValue = data.needsAuthorization;
      const skippedValue = data.skipped;

      if (data.loading === true && authenticatedValue === false) {
        return true;
      }

      const isAuthenticated =
        authenticatedValue === true ||
        authenticatedValue === 1 ||
        authenticatedValue === "1";

      const isSkipped = skippedValue === true;

      const needsAuthorization =
        isAuthenticated || isSkipped
          ? false
          : needsAuthorizationValue === undefined
            ? true
            : needsAuthorizationValue === true ||
              needsAuthorizationValue === 1 ||
              needsAuthorizationValue === "1";

      setIsSpotifyAuthenticated(isAuthenticated);
      if (skippedValue !== undefined) {
        setIsSpotifySkipped(isSkipped);
      }
      setNeedsSpotifyAuthorization(needsAuthorization);
      setAuthStatusMessage(
        hasDevices &&
          needsAuthorization &&
          isAuthenticated === false &&
          !isSkipped
          ? "Open the Nocturne app to finish logging into Spotify."
          : null,
      );

      if (isAuthenticated) {
        refreshPlaybackState(true);

        const wasSkipped = lastSpotifySkippedStateRef.current === true;
        const wasNotAuthenticated = lastSpotifyAuthStateRef.current === false;
        const shouldForceDataLoad =
          wasSkipped || (wasNotAuthenticated && initialDataLoaded);

        if (shouldForceDataLoad) {
          setTimeout(() => {
            refreshData();
          }, 1000);
        }
      }

      lastSpotifyAuthStateRef.current = isAuthenticated;
      lastSpotifySkippedStateRef.current = isSkipped;

      setIsAuthCheckInProgress(false);
      return true;
    },
    [refreshPlaybackState, initialDataLoaded, refreshData, hasDevices],
  );

  useEffect(() => {
    const unsubscribe = subscribeAppReadyState((state) => {
      setAppReady(state.ready);
      setAppPlatform(state.platform);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSpotifySkippedState((skipped) => {
      setIsSpotifySkipped(skipped);
      lastSpotifySkippedStateRef.current = skipped;
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!wsConnected) return;

    if (!appReady) return;

    if (hasPhoneAccess === false && appPlatform !== "web") return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 5;

    setIsAuthCheckInProgress(true);

    const attemptRequest = () => {
      sendNocturneWsRequest("spotify.auth.getStatus", {}, { timeoutMs: 5000 })
        .then((authResult) => {
          if (cancelled) return;

          const resultData = authResult?.result ?? authResult;
          const isLoading =
            resultData?.loading === true || resultData?.data?.loading === true;

          if (isLoading && retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptRequest, 2000);
            return;
          }

          processSpotifyAuthMessage(authResult);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(
            `Failed to fetch spotify auth status (attempt ${retryCount + 1}/${maxRetries}):`,
            err,
          );

          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptRequest, 1000);
          } else {
            console.error("Max retry attempts reached for spotify auth status");
            setIsAuthCheckInProgress(false);
          }
        });
    };

    attemptRequest();

    return () => {
      cancelled = true;
    };
  }, [wsConnected, appReady, hasPhoneAccess, appPlatform]);

  useEffect(() => {
    if (!showAuthScreen || !appReady || !wsConnected) return;
    if (hasPhoneAccess === false && appPlatform !== "web") return;

    const interval = setInterval(() => {
      sendNocturneWsRequest("spotify.auth.getStatus", {}, { timeoutMs: 5000 })
        .then((authResult) => {
          processSpotifyAuthMessage(authResult);
        })
        .catch(() => {});
    }, 5000);

    return () => clearInterval(interval);
  }, [
    showAuthScreen,
    appReady,
    wsConnected,
    processSpotifyAuthMessage,
    hasPhoneAccess,
    appPlatform,
  ]);

  useEffect(() => {
    if (hasPhoneAccess === false && appPlatform !== "web") {
      setShowAuthScreen(false);
      setShowTutorial(false);
      return;
    }

    if (isSpotifySkipped) {
      setShowAuthScreen(false);
      if (!hasSeenTutorialFlag && appReady) {
        setShowTutorial(true);
      } else {
        setShowTutorial(false);
      }
      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (needsSpotifyAuthorization || isSpotifyAuthenticated === false) {
      setShowAuthScreen(true);
      setShowTutorial(false);

      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (!hasSeenTutorialFlag) {
      if (isSpotifyAuthenticated && appReady) {
        setShowAuthScreen(false);
        setShowTutorial(true);
      } else if (!hasDevices || !appReady) {
        setShowAuthScreen(true);
        setShowTutorial(false);
      } else {
        setShowAuthScreen(false);
        setShowTutorial(false);
      }
      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (splashFlowWithDeviceRef.current) {
      return;
    }

    if (!hasDevices && isSpotifyAuthenticated !== true) {
      setShowAuthScreen(false);
      setShowTutorial(false);
      return;
    }

    setShowAuthScreen(false);
    setShowTutorial(false);
  }, [
    hasDevices,
    hasSeenTutorialFlag,
    needsSpotifyAuthorization,
    isSpotifyAuthenticated,
    isSpotifySkipped,
    appReady,
    hasPhoneAccess,
    appPlatform,
  ]);

  useEffect(() => {
    if (!hasSeenTutorialFlag) return;
    if (showTutorial) return;
    if (startSectionAppliedRef.current) return;
    if (isSpotifyAuthenticated !== true) return;

    const shouldStartWithNowPlaying =
      localStorage.getItem("startWithNowPlaying") === "true";
    if (shouldStartWithNowPlaying) {
      setActiveSection("nowPlaying");
    }
    startSectionAppliedRef.current = true;
  }, [
    hasSeenTutorialFlag,
    showTutorial,
    isSpotifyAuthenticated,
    setActiveSection,
  ]);

  useEffect(() => {
    if (!wsConnected) return;

    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );

    if (lastDeviceAddress) {
      splashFlowWithDeviceRef.current = true;
      setShowSplash(false);
      setShowAuthScreen(false);
      setActiveSection("nowPlaying");
    } else {
      setShowSplash(false);
      if (!hasSeenTutorialFlag) {
        setShowAuthScreen(true);
      }
    }
  }, [wsConnected, hasSeenTutorialFlag]);

  const { updateStatus, progress, isUpdating, isError, errorMessage } =
    useSystemUpdate();

  useEffect(() => {
    const listenerId = addMessageListener("spotify-auth", (message) => {
      if (
        message?.type === "event" &&
        typeof message.topic === "string" &&
        message.topic.startsWith("spotify.auth.")
      ) {
        processSpotifyAuthMessage(message);
      }
    });

    return () => {
      if (listenerId) {
        removeMessageListener(listenerId);
      }
    };
  }, [addMessageListener, removeMessageListener, processSpotifyAuthMessage]);

  const [gradientState, updateGradientColors] = useGradientState(activeSection);

  const playbackProgress = usePlaybackProgress(
    currentPlayback,
    refreshPlaybackState,
  );

  const {
    showMappingOverlay: showGlobalMappingOverlay,
    activeButton: globalActiveButton,
    setIgnoreNextRelease,
  } = useGlobalButtonMapping({
    playTrack: playerControls.playTrack,
    playDJMix: playerControls.playDJMix,
    refreshPlaybackState,
    setActiveSection,
    isTutorialActive: showTutorial,
    isDisabled:
      powerMenuVisible ||
      isUpdating ||
      localStorage.getItem("mockingbirdUiEnabled") === "true",
    currentPlayback,
    spotifyUserId,
  });

  const handleOpenDeviceSwitcher = useCallback(
    (playbackIntentOrDevices = null, devicesArg = null) => {
      let playbackIntent = null;
      let devicesList = null;

      if (Array.isArray(playbackIntentOrDevices)) {
        devicesList = playbackIntentOrDevices;
      } else {
        playbackIntent = playbackIntentOrDevices;
        devicesList = devicesArg;
      }

      if (playbackIntent) {
        setPlaybackIntentOnDeviceSwitch(playbackIntent);
      }

      if (devicesList && devicesList.length > 0) {
        setPrefetchedDevices(devicesList);
      }

      setIsDeviceSwitcherOpen(true);
    },
    [],
  );

  const handleCloseDeviceSwitcher = useCallback(
    (selectedDeviceId = null) => {
      setIsDeviceSwitcherOpen(false);
      setPrefetchedDevices(null);
      if (selectedDeviceId && playbackIntentOnDeviceSwitch) {
        const { trackUriToPlay, contextUriToPlay, urisToPlay } =
          playbackIntentOnDeviceSwitch;
        (async () => {
          let success = false;
          if (contextUriToPlay) {
            success = await playerControls.playTrack(
              trackUriToPlay,
              contextUriToPlay,
              null,
              selectedDeviceId,
            );
          } else if (urisToPlay && urisToPlay.length > 0) {
            success = await playerControls.playTrack(
              null,
              null,
              urisToPlay,
              selectedDeviceId,
            );
          } else if (trackUriToPlay) {
            success = await playerControls.playTrack(
              trackUriToPlay,
              null,
              null,
              selectedDeviceId,
            );
          }

          if (success) {
            setTimeout(() => {
              refreshPlaybackState();
              setActiveSection("nowPlaying");
            }, 1500);
          }
          setPlaybackIntentOnDeviceSwitch(null);
        })();
      } else {
        setPlaybackIntentOnDeviceSwitch(null);
      }
    },
    [playbackIntentOnDeviceSwitch, playerControls, refreshPlaybackState],
  );

  const deviceSwitcherContextValue = useMemo(
    () => ({ openDeviceSwitcher: handleOpenDeviceSwitcher }),
    [handleOpenDeviceSwitcher],
  );

  useEffect(() => {
    const handleNetworkRestored = () => {
      refreshPlaybackState(true);
      if (!initialDataLoaded) {
        refreshData();
        refreshRecentlyPlayed();
      }
    };
    window.addEventListener("online", handleNetworkRestored);
    return () => {
      window.removeEventListener("online", handleNetworkRestored);
    };
  }, [
    refreshPlaybackState,
    refreshData,
    refreshRecentlyPlayed,
    initialDataLoaded,
  ]);

  useEffect(() => {
    if (viewingContent) return;

    if (showTutorial || showAuthScreen) {
      updateGradientColors(null, "auth");
      return;
    }

    switch (activeSection) {
      case "recents": {
        const firstAlbumImage =
          recentAlbums[0]?.images?.[1]?.url ||
          recentAlbums[0]?.images?.[0]?.url;
        if (firstAlbumImage) {
          updateGradientColors(firstAlbumImage, "recents");
        }
        break;
      }
      case "library": {
        const firstPlaylistImage =
          userPlaylists[0]?.images?.[1]?.url ||
          userPlaylists[0]?.images?.[0]?.url;
        updateGradientColors(firstPlaylistImage || null, "library");
        break;
      }
      case "artists": {
        const firstArtistImage =
          topArtists[0]?.images?.[1]?.url || topArtists[0]?.images?.[0]?.url;
        if (firstArtistImage) {
          updateGradientColors(firstArtistImage, "artists");
        }
        break;
      }
      case "radio": {
        const firstMixImage = radioMixes[0]?.images?.[0]?.url || null;
        updateGradientColors(firstMixImage, "radio");
        break;
      }
      case "podcasts": {
        const firstShowImage =
          userShows[0]?.show?.images?.[1]?.url ||
          userShows[0]?.show?.images?.[0]?.url;
        updateGradientColors(firstShowImage || null, "podcasts");
        break;
      }
      case "settings":
        updateGradientColors(null, "settings");
        break;
      case "nowPlaying": {
        const albumImage =
          currentlyPlayingAlbum?.images?.[1]?.url ||
          currentlyPlayingAlbum?.images?.[0]?.url;
        if (albumImage) {
          updateGradientColors(albumImage, "nowPlaying");
        }
        break;
      }
      case "lock": {
        const albumImage =
          currentlyPlayingAlbum?.images?.[1]?.url ||
          currentlyPlayingAlbum?.images?.[0]?.url;
        if (albumImage) {
          updateGradientColors(albumImage, "lock");
        }
        break;
      }
      default:
        break;
    }
  }, [
    activeSection,
    viewingContent,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    radioMixes,
    userShows,
    currentlyPlayingAlbum,
    showTutorial,
    showAuthScreen,
  ]);

  useEffect(() => {
    if (lastConnectedDevice) {
      setDiscoverable(false);
    } else {
      setDiscoverable(true);
    }
  }, [lastConnectedDevice, setDiscoverable]);

  useEffect(() => {
    if (showTetheringScreen) {
      enableNetworking();
    }
  }, [showTetheringScreen, enableNetworking]);

  useEffect(() => {
    if (showTutorial) return;

    if (viewingContent) return;

    if (currentlyPlayingAlbum?.is_phone_media) return;

    const activeGradientSection = activeSectionRef.current;
    const albumImage =
      currentlyPlayingAlbum?.images?.[1]?.url ||
      currentlyPlayingAlbum?.images?.[0]?.url;

    if (albumImage) {
      if (activeGradientSection === "nowPlaying") {
        updateGradientColors(albumImage, "nowPlaying");
      } else if (activeGradientSection === "recents") {
        updateGradientColors(albumImage, "recents");
      }
    } else if (currentlyPlayingAlbum?.type === "local-track") {
      if (
        activeGradientSection === "recents" ||
        activeGradientSection === "nowPlaying"
      ) {
        updateGradientColors("/images/not-playing.webp", activeGradientSection);
      }
    }
  }, [
    currentlyPlayingAlbum,
    updateGradientColors,
    showTutorial,
    viewingContent,
  ]);

  useEffect(() => {
    const holdTimerRef = { current: null };
    const longPressTriggeredRef = { current: false };

    const handleKeyDown = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (powerMenuVisibleRef.current) return;

      if (longPressTriggeredRef.current) return;

      if (showTutorial && currentTutorialStep === 7) {
        return;
      }

      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          setPowerMenuVisible(true);
          holdTimerRef.current = null;
        }, 600);
      }
    };

    const handleKeyUp = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      if (powerMenuVisibleRef.current) {
        setPowerMenuVisible(false);
        e.stopPropagation();
        return;
      }

      if (showAuthScreen) {
        return;
      }

      if (localStorage.getItem("mockingbirdUiEnabled") === "true") {
        window.carThingRootStore?.uiState?.toggleSettings();
        return;
      }

      if (activeSectionRef.current === "lock") {
        const target = previousSectionRef.current || "recents";
        setActiveSection(target);
        activeSectionRef.current = target;
      } else {
        previousSectionRef.current = activeSectionRef.current;
        setActiveSection("lock");
        activeSectionRef.current = "lock";
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [showTutorial, currentTutorialStep, showAuthScreen]);

  const handleShutdown = () => {
    fetch("http://localhost:5000/device/power/shutdown", {
      method: "POST",
    }).catch((err) => console.error("Shutdown request failed", err));
    setPowerMenuVisible(false);
  };

  const handleReboot = () => {
    fetch("http://localhost:5000/device/power/reboot", {
      method: "POST",
    }).catch((err) => console.error("Restart request failed", err));
    setPowerMenuVisible(false);
  };

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setCurrentTutorialStep(0);
    const isMockingbirdActive =
      localStorage.getItem("mockingbirdUiEnabled") === "true";
    if (isMockingbirdActive) {
      localStorage.setItem("hasSeenMockingbirdOnboarding", "true");
      setHasSeenMockingbirdOnboardingFlag(true);
    } else {
      localStorage.setItem("hasSeenTutorial", "true");
      setHasSeenTutorialFlag(true);
    }
    startSectionAppliedRef.current = true;
    const shouldStartWithNowPlaying =
      localStorage.getItem("startWithNowPlaying") === "true";
    if (shouldStartWithNowPlaying) {
      setActiveSection("nowPlaying");
    } else {
      setActiveSection("recents");
    }
  };

  const handleOpenContent = (id, type) => {
    setContentSourceSection(activeSection);
    setViewingContent({ id, type });
    if (type === "artist") {
      setActiveSection("artists");
    } else if (type === "album") {
      setActiveSection("recents");
    }
  };

  const handleNavigateToArtistFromNowPlaying = useCallback(
    (artistId, contentType) => {
      setContentSourceSection("nowPlaying");
      setViewingContent({ id: artistId, type: contentType });
      setActiveSection("artists");
    },
    [],
  );

  const handleNavigateToAlbumFromNowPlaying = useCallback(
    (albumId, contentType) => {
      setContentSourceSection("nowPlaying");
      setViewingContent({ id: albumId, type: contentType });
      setActiveSection("recents");
    },
    [],
  );

  const handleCloseContent = () => {
    const source = contentSourceSection;
    setViewingContent(null);
    setContentSourceSection(null);

    if (source) {
      setActiveSection(source);
    }
  };

  const handleNavigateToNowPlaying = () => {
    setViewingContent(null);
    setActiveSection("nowPlaying");
  };

  const handleNavigateToArtist = (id, type) => {
    setViewingContent({ id, type });
    setActiveSection("artists");
  };

  const handleConnectionRestored = () => {
    refreshPlaybackState(true);
    if (!initialDataLoaded) {
      refreshData();
      refreshRecentlyPlayed();
    }
  };

  const hasActiveBluetoothConnection =
    Array.isArray(connectedDevices) &&
    connectedDevices.some((device) => device?.connected);

  const showConnectionLostScreen =
    !showTutorial &&
    !pairingRequest &&
    ((!lastConnectedDevice &&
      !hasActiveBluetoothConnection &&
      hasFetchedInitialDevices) ||
      showExhaustedReconnectScreen);
  // const showConnectionLostScreen = false;

  const isMockingbirdSetting =
    localStorage.getItem("mockingbirdUiEnabled") === "true";

  const showSubscriptionScreen =
    appReady &&
    appPlatform !== null &&
    appPlatform !== "web" &&
    hasPhoneAccess === false;

  const isMockingbird = isMockingbirdSetting;

  const displayNetworkBanner =
    showNetworkBanner &&
    !isMockingbird &&
    !showConnectionLostScreen &&
    !showTutorial &&
    !showAuthScreen &&
    !showSplash &&
    reconnectAttempt === 0;

  const isSystemScreen =
    showSplash || showAuthScreen || showConnectionLostScreen || showTutorial;
  const mockingbirdSystemScreen =
    isMockingbird && !showSplash
      ? showTutorial && !hasSeenMockingbirdOnboardingFlag
        ? "tutorial"
        : appPlatform !== "web" && hasPhoneAccess === false
          ? "subscription"
          : !hasSeenMockingbirdOnboardingFlag &&
              (isSpotifyAuthenticated || isSpotifySkipped) &&
              hasDevices
            ? "tutorial"
            : showAuthScreen
              ? "auth"
              : showConnectionLostScreen
                ? "connectionLost"
                : null
      : null;

  const voiceSuppressed =
    isSystemScreen ||
    showSubscriptionScreen ||
    showTetheringScreen ||
    !!pairingRequest ||
    isMockingbird ||
    isSubscribed === false;

  let content;
  if (showSplash) {
    content = <SplashScreen />;
  } else if (showSubscriptionScreen) {
    content = <AuthScreen subscriptionRequired={true} />;
  } else if (showAuthScreen) {
    content = (
      <AuthScreen
        isLoading={isAuthCheckInProgress}
        statusMessage={authStatusMessage}
      />
    );
  } else if (showConnectionLostScreen) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        deviceName={lastConnectedDevice?.name}
        onConnectionRestored={handleConnectionRestored}
        reconnectionExhausted={showExhaustedReconnectScreen}
      />
    );
  } else if (showTutorial) {
    content = (
      <Tutorial
        onComplete={handleTutorialComplete}
        onStepChange={setCurrentTutorialStep}
      />
    );
  } else if (activeSection === "nowPlaying") {
    content = (
      <NowPlaying
        currentPlayback={currentPlayback}
        playbackProgress={playbackProgress}
        onClose={() => setActiveSection("recents")}
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
        onNavigateToArtist={handleNavigateToArtistFromNowPlaying}
        onNavigateToAlbum={handleNavigateToAlbumFromNowPlaying}
        setIgnoreNextRelease={setIgnoreNextRelease}
        isReceivingNowPlayingUpdates={isReceivingNowPlayingUpdates}
      />
    );
  } else if (activeSection === "lock") {
    content = (
      <LockView
        currentPlayback={currentPlayback}
        refreshPlaybackState={refreshPlaybackState}
        updateGradientColors={updateGradientColors}
        onClose={() => setActiveSection("recents")}
      />
    );
  } else if (viewingContent) {
    content = (
      <ContentView
        contentId={viewingContent.id}
        contentType={viewingContent.type}
        onClose={handleCloseContent}
        onNavigateToNowPlaying={handleNavigateToNowPlaying}
        currentlyPlayingTrackUri={currentPlayback?.item?.uri}
        currentPlayback={currentPlayback}
        radioMixes={radioMixes}
        updateGradientColors={updateGradientColors}
        setIgnoreNextRelease={setIgnoreNextRelease}
        playbackProgress={playbackProgress}
        refreshPlaybackState={refreshPlaybackState}
        spotifyUserId={spotifyUserId}
      />
    );
  } else {
    content = (
      <Home
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        recentAlbums={recentAlbums}
        userPlaylists={userPlaylists}
        topArtists={topArtists}
        likedSongs={likedSongs}
        radioMixes={radioMixes}
        userShows={userShows}
        currentPlayback={currentPlayback}
        currentlyPlayingAlbum={currentlyPlayingAlbum}
        playbackProgress={playbackProgress}
        isLoading={isLoading}
        refreshData={refreshData}
        refreshPlaybackState={refreshPlaybackState}
        onOpenContent={handleOpenContent}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
      />
    );
  }

  return (
    <SettingsProvider>
      <OTAProvider>
        <AutoUpdateManager />
        <NotificationProvider>
          <NotificationEffects
            isUpdating={isUpdating}
            updateStatus={updateStatus}
            activeSection={activeSection}
            handleReboot={handleReboot}
            isError={isError}
            errorMessage={errorMessage}
          />
          {!showConnectionLostScreen && !showTutorial && (
            <UpdateCheckNotification
              setActiveSection={setActiveSection}
              currentVersion={nocturneVersion}
            />
          )}
          <VoiceProvider suppressed={voiceSuppressed}>
            <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
              <Router>
                <FontLoader />
                <main className="overflow-hidden relative min-h-screen rounded-2xl nocturne-font-stack">
                  <GradientBackground
                    gradientState={gradientState}
                    className="bg-black"
                  />

                  <div className="relative z-10">
                    <UIShell
                      isMockingbird={isMockingbird}
                      mockingbirdProps={{
                        currentPlayback,
                        playerControls,
                        spotifyData: {
                          recentAlbums,
                          userPlaylists,
                          topArtists,
                          likedSongs,
                          radioMixes,
                          userShows,
                          spotifyUserId,
                          initialDataLoaded,
                        },
                        playbackProgress,
                        systemScreen: mockingbirdSystemScreen,
                        onTutorialComplete: handleTutorialComplete,
                      }}
                    >
                      {content}
                    </UIShell>
                    {!showTetheringScreen &&
                      !showConnectionLostScreen &&
                      !showTutorial && (
                        <>
                          {pairingRequest ? (
                            isMockingbird ? (
                              <MockingbirdPairingOverlay
                                pin={pairingRequest.pairingKey}
                              />
                            ) : (
                              <PairingScreen
                                pin={pairingRequest.pairingKey}
                                isConnecting={isConnecting}
                                onAccept={acceptPairing}
                                onReject={denyPairing}
                              />
                            )
                          ) : null}
                        </>
                      )}
                    <NetworkBanner
                      visible={displayNetworkBanner}
                      onClose={() => setShowNetworkBanner(false)}
                    />
                    <DeviceSwitcherModal
                      isOpen={isDeviceSwitcherOpen}
                      onClose={handleCloseDeviceSwitcher}
                      initialDevices={prefetchedDevices}
                    />
                    {!showTutorial && (
                      <ButtonMappingOverlay
                        show={showGlobalMappingOverlay}
                        activeButton={globalActiveButton}
                      />
                    )}
                    <PowerMenuOverlay
                      show={powerMenuVisible}
                      onShutdown={handleShutdown}
                      onReboot={handleReboot}
                      onClose={() => setPowerMenuVisible(false)}
                    />
                  </div>
                </main>
                <VoiceOverlay />
                <NotificationsContainer />
              </Router>
            </DeviceSwitcherContext.Provider>
          </VoiceProvider>
        </NotificationProvider>
      </OTAProvider>
    </SettingsProvider>
  );
}

export default App;
