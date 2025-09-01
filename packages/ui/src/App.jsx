import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import FontLoader from "./components/common/FontLoader";
import Tutorial from "./components/tutorial/Tutorial";
import Home from "./pages/Home";
import ContentView from "./components/content/ContentView";
import NowPlaying from "./components/player/NowPlaying";
import DeviceSwitcherModal from "./components/player/DeviceSwitcherModal";
import NetworkPasswordModal from "./components/common/modals/NetworkPasswordModal";
import ConnectorQRModal from "./components/common/modals/ConnectorQRModal";
import ButtonMappingOverlay from "./components/common/overlays/ButtonMappingOverlay";
import NetworkBanner from "./components/common/overlays/NetworkBanner";
import GradientBackground from "./components/common/GradientBackground";
import { useNetwork } from "./hooks/useNetwork";
import { useGradientState } from "./hooks/useGradientState";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import {
  useBluetooth,
  useSystemUpdate,
  useNocturneInfo,
} from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { usePlaybackProgress } from "./hooks/usePlaybackProgress";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ConnectorProvider } from "./contexts/ConnectorContext";
import React from "react";
import {
  NotificationProvider,
  useNotifications,
} from "./contexts/NotificationContext";
import NotificationsContainer from "./components/common/notifications/NotificationsContainer";
import PairingScreen from "./components/auth/PairingScreen";
import LockView from "./components/common/LockView";
import PowerMenuOverlay from "./components/common/overlays/PowerMenuOverlay";
import { CheckIcon } from "./components/common/icons";
import { SettingsUpdateIcon } from "./components/common/icons";
import UpdateCheckNotification from "./components/common/notifications/UpdateCheckNotification";
import UpdateScreen from "./components/common/UpdateScreen";

export const NetworkContext = React.createContext({
  selectedNetwork: null,
  setSelectedNetwork: () => {},
});

export const ConnectorContext = React.createContext({
  showConnectorModal: false,
  setShowConnectorModal: () => {},
});

function useGlobalButtonMapping({
  playTrack,
  playDJMix,
  refreshPlaybackState,
  setActiveSection,
  isTutorialActive,
  isDisabled = false,
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
          const likedTracksJson = localStorage.getItem(
            `button${buttonNumber}Tracks`,
          );
          if (likedTracksJson) {
            try {
              const likedTracks = JSON.parse(likedTracksJson);
              uris = likedTracks;
              localStorage.setItem("playingLikedSongs", "true");
            } catch (e) {
              console.error("Error parsing liked tracks:", e);
            }
          } else {
            console.log(
              "No cached liked tracks available, WebSocket implementation needed",
            );
          }
        }

        let success = false;
        const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

        if (mappedType === "playlist" && mappedId === DJ_PLAYLIST_ID) {
          success = await (playDJMix
            ? playDJMix()
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

  useEffect(() => {
    if (
      !isUpdating &&
      updateStatus.stage === "complete" &&
      activeSection !== "settings" &&
      !notificationShownRef.current
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
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [playbackIntentOnDeviceSwitch, setPlaybackIntentOnDeviceSwitch] =
    useState(null);
  const [prefetchedDevices, setPrefetchedDevices] = useState(null);
  const [powerMenuVisible, setPowerMenuVisible] = useState(false);
  const powerMenuVisibleRef = useRef(false);

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
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    initialDataLoaded,
    isLoading,
    errors: dataErrors,
    refreshData,
    refreshRecentlyPlayed,
  } = useSpotifyData(activeSection, false, true);

  const {
    isConnected: isInternetConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
  } = useNetwork();

  const {
    version: nocturneVersion,
    serial,
    isLoading: isInfoLoading,
    refetch: refetchInfo,
  } = useNocturneInfo();

  const [analyticsEnabled, setAnalyticsEnabled] = useState(
    () => localStorage.getItem("analyticsEnabled") !== "false",
  );

  useEffect(() => {
    const handleStorageChange = () => {
      setAnalyticsEnabled(localStorage.getItem("analyticsEnabled") !== "false");
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!isInternetConnected) return;
    if (isInfoLoading) return;
    if (!serial) return;

    const existing = document.getElementById("analytics");

    if (!analyticsEnabled) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (existing) return;

    window.umamiBeforeSend = (type, payload) => {
      if (!payload) return false;
      return { ...payload, id: serial };
    };

    const script = document.createElement("script");
    script.defer = true;
    script.src = "https://p.itsnebula.net/script.js";
    script.setAttribute(
      "data-website-id",
      "3465cd10-6beb-4dd9-969c-f7f44704fd18",
    );
    script.setAttribute("data-before-send", "umamiBeforeSend");
    script.id = "analytics";

    document.body.appendChild(script);
  }, [isInternetConnected, isInfoLoading, serial, analyticsEnabled]);

  const {
    pairingRequest,
    isConnecting,
    showTetheringScreen,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    setDiscoverable,
    disconnectDevice,
    enableNetworking,
    stopRetrying,
  } = useBluetooth();

  const { updateStatus, progress, isUpdating, isError, errorMessage } =
    useSystemUpdate();

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
    isDisabled: powerMenuVisible || isUpdating,
  });

  const handleOpenDeviceSwitcher = (
    playbackIntentOrDevices = null,
    devicesArg = null,
  ) => {
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
  };

  const handleCloseDeviceSwitcher = (selectedDeviceId = null) => {
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
  };

  const deviceSwitcherContextValue = {
    openDeviceSwitcher: handleOpenDeviceSwitcher,
  };

  const handleNetworkClose = () => {
    setSelectedNetwork(null);
  };

  const networkContextValue = {
    selectedNetwork,
    setSelectedNetwork,
  };

  const connectorContextValue = {
    showConnectorModal,
    setShowConnectorModal,
  };

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
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial") === "true";
    if (hasSeenTutorial) {
      setShowTutorial(false);
      const shouldStartWithNowPlaying =
        localStorage.getItem("startWithNowPlaying") === "true";
      if (shouldStartWithNowPlaying) {
        setActiveSection("nowPlaying");
      }
    } else {
      setShowTutorial(true);
    }
  }, [setActiveSection]);

  useEffect(() => {
    if (viewingContent) return;
    if (showTutorial) {
      updateGradientColors(null, "auth");
    } else if (activeSection === "recents" && recentAlbums.length > 0) {
      const firstAlbumImage = recentAlbums[0]?.images?.[1]?.url;
      if (firstAlbumImage) {
        updateGradientColors(firstAlbumImage, "recents");
      }
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      const firstArtistImage = topArtists[0]?.images?.[1]?.url;
      if (firstArtistImage) {
        updateGradientColors(firstArtistImage, "artists");
      }
    } else if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    } else if (activeSection === "settings") {
      updateGradientColors(null, "settings");
    } else if (activeSection === "nowPlaying" && currentlyPlayingAlbum) {
      const albumImage = currentlyPlayingAlbum?.images?.[1]?.url;
      if (albumImage) {
        updateGradientColors(albumImage, "nowPlaying");
      }
    } else if (activeSection === "lock") {
      const albumImage = currentlyPlayingAlbum?.images?.[1]?.url;
      if (albumImage) {
        updateGradientColors(albumImage, "lock");
      }
    }
  }, [
    activeSection,
    viewingContent,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    currentlyPlayingAlbum,
    showTutorial,
  ]);

  useEffect(() => {
    if (lastConnectedDevice && isInternetConnected) {
      setDiscoverable(false);
    } else {
      setDiscoverable(true);
    }
  }, [lastConnectedDevice, isInternetConnected, setDiscoverable]);

  useEffect(() => {
    if (showTetheringScreen) {
      enableNetworking();
    }
  }, [showTetheringScreen, enableNetworking]);

  useEffect(() => {
    if (showTutorial) return;

    if (viewingContent) return;

    if (currentlyPlayingAlbum?.images?.[1]?.url) {
      if (activeSection === "nowPlaying") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "nowPlaying");
      } else if (activeSection === "recents") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "recents");
      }
    } else if (currentlyPlayingAlbum?.type === "local-track") {
      if (activeSection === "recents" || activeSection === "nowPlaying") {
        updateGradientColors("/images/not-playing.webp", activeSection);
      }
    }
  }, [
    currentlyPlayingAlbum,
    activeSection,
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
  }, [showTutorial, currentTutorialStep]);

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
    localStorage.setItem("hasSeenTutorial", "true");
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

  const handleNavigateToArtistFromNowPlaying = (artistId, contentType) => {
    setContentSourceSection("nowPlaying");
    setViewingContent({ id: artistId, type: contentType });
    setActiveSection("artists");
  };

  const handleNavigateToAlbumFromNowPlaying = (albumId, contentType) => {
    setContentSourceSection("nowPlaying");
    setViewingContent({ id: albumId, type: contentType });
    setActiveSection("recents");
  };

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

  const handleNetworkCancel = () => {
    if (lastConnectedDevice) {
      disconnectDevice(lastConnectedDevice.address);
    }
  };

  const handleConnectionRestored = () => {
    refreshPlaybackState(true);
    if (!initialDataLoaded) {
      refreshData();
      refreshRecentlyPlayed();
    }
  };

  const isUpdateScreenVisible =
    isUpdating || (updateStatus.stage && updateStatus.stage !== "");

  const showConnectionLostScreen =
    initialCheckDone &&
    !isUpdateScreenVisible &&
    !pairingRequest &&
    !showTetheringScreen &&
    ((initialConnectionFailed &&
      !isInternetConnected &&
      !hasEverConnectedThisSession) ||
      (!hasEverConnectedThisSession && !isInternetConnected));

  const displayNetworkBanner =
    initialCheckDone &&
    !showConnectionLostScreen &&
    !pairingRequest &&
    !isUpdating &&
    updateStatus.stage !== "download" &&
    updateStatus.stage !== "flash" &&
    showNetworkBanner &&
    hasEverConnectedThisSession;

  let content;
  if (isUpdateScreenVisible) {
    content = <UpdateScreen />;
  } else if (showConnectionLostScreen) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        deviceName={lastConnectedDevice?.name}
        onConnectionRestored={handleConnectionRestored}
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
      />
    );
  } else if (activeSection === "lock") {
    content = (
      <LockView
        currentPlayback={currentPlayback}
        refreshPlaybackState={refreshPlaybackState}
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
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
      />
    );
  }

  return (
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
          isInfoLoading={isInfoLoading}
          refetchInfo={refetchInfo}
        />
      )}
      <ConnectorProvider>
        <SettingsProvider>
          <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
            <NetworkContext.Provider value={networkContextValue}>
              <ConnectorContext.Provider value={connectorContextValue}>
                <Router>
                  <FontLoader />
                  <main
                    className="overflow-hidden relative min-h-screen rounded-2xl"
                    style={{
                      fontFamily: `var(--font-inter), var(--font-noto-sans-sc), var(--font-noto-sans-tc), var(--font-noto-serif-jp), var(--font-noto-sans-kr), var(--font-noto-naskh-ar), var(--font-noto-sans-bn), var(--font-noto-sans-dv), var(--font-noto-sans-he), var(--font-noto-sans-ta), var(--font-noto-sans-th), var(--font-noto-sans-gk), system-ui, sans-serif`,
                      fontOpticalSizing: "auto",
                    }}
                  >
                    <GradientBackground
                      gradientState={gradientState}
                      className="bg-black"
                    />

                    <div className="relative z-10">
                      {content}
                      {!isUpdateScreenVisible &&
                        !showTetheringScreen &&
                        !showConnectionLostScreen && (
                          <>
                            {pairingRequest ? (
                              <PairingScreen
                                pin={pairingRequest.pairingKey}
                                isConnecting={isConnecting}
                                onAccept={acceptPairing}
                                onReject={denyPairing}
                              />
                            ) : null}
                          </>
                        )}
                      <NetworkBanner visible={displayNetworkBanner} />
                      <DeviceSwitcherModal
                        isOpen={isDeviceSwitcherOpen}
                        onClose={handleCloseDeviceSwitcher}
                        initialDevices={prefetchedDevices}
                      />
                      {showConnectorModal && (
                        <ConnectorQRModal
                          onClose={() => setShowConnectorModal(false)}
                        />
                      )}
                      <NetworkPasswordModal
                        network={selectedNetwork}
                        onClose={handleNetworkClose}
                        onConnect={handleNetworkClose}
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
                  <NotificationsContainer />
                </Router>
              </ConnectorContext.Provider>
            </NetworkContext.Provider>
          </DeviceSwitcherContext.Provider>
        </SettingsProvider>
      </ConnectorProvider>
    </NotificationProvider>
  );
}

export default App;
