import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import FontLoader from "./components/common/FontLoader";
import AuthContainer from "./components/auth/AuthContainer";
import NetworkScreen from "./components/auth/NetworkScreen";
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
import { useBluetooth, useSystemUpdate } from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { usePlaybackProgress } from "./hooks/usePlaybackProgress";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ConnectorProvider } from "./contexts/ConnectorContext";
import React from "react";
import { NotificationProvider, useNotifications } from "./contexts/NotificationContext";
import NotificationsContainer from "./components/common/notifications/NotificationsContainer";
import PairingScreen from "./components/auth/PairingScreen";
import LockView from "./components/common/LockView";
import LoadingScreen from "./components/common/LoadingScreen";
import PowerMenuOverlay from "./components/common/overlays/PowerMenuOverlay";
import { CheckIcon } from "./components/common/icons";
import { SettingsUpdateIcon } from "./components/common/icons";

export const NetworkContext = React.createContext({
  selectedNetwork: null,
  setSelectedNetwork: () => {},
});

export const ConnectorContext = React.createContext({
  showConnectorModal: false,
  setShowConnectorModal: () => {},
});

function useGlobalButtonMapping({
  accessToken,
  isAuthenticated,
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
      if (
        !accessToken ||
        !isAuthenticated ||
        isProcessingButtonPress ||
        isTutorialActive ||
        isDisabled
      )
        return;

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
          const response = await fetch(
            `https://api.spotify.com/v1/artists/${mappedId}/top-tracks?market=from_token`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            if (data.tracks && data.tracks.length > 0) {
              uris = data.tracks.map((track) => track.uri);
            }
          } else {
            contextUri = `spotify:artist:${mappedId}`;
          }
        } else if (mappedType === "show") {
          const response = await fetch(
            `https://api.spotify.com/v1/shows/${mappedId}/episodes?limit=50`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
              const lastPlayedEpisodeId = localStorage.getItem(
                `lastPlayedEpisode_${mappedId}`,
              );
              let targetEpisodeIndex = 0;

              if (lastPlayedEpisodeId) {
                const foundIndex = data.items.findIndex(
                  (ep) => ep.id === lastPlayedEpisodeId,
                );
                if (foundIndex !== -1) {
                  targetEpisodeIndex = foundIndex;
                }
              }

              contextUri = `spotify:show:${mappedId}`;
              uris = [`spotify:episode:${data.items[targetEpisodeIndex].id}`];
            }
          } else {
            contextUri = `spotify:show:${mappedId}`;
          }
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

              const response = await fetch(
                "https://api.spotify.com/v1/me/tracks?limit=50",
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              );

              if (response.ok) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                  uris = data.items.map((item) => item.track.uri);
                  localStorage.setItem("playingLikedSongs", "true");
                }
              }
            }
          } else {
            const response = await fetch(
              "https://api.spotify.com/v1/me/tracks?limit=50",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (response.ok) {
              const data = await response.json();
              if (data.items && data.items.length > 0) {
                uris = data.items.map((item) => item.track.uri);
                localStorage.setItem("playingLikedSongs", "true");
              }
            }
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
      accessToken,
      isAuthenticated,
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
    if (!isAuthenticated || isTutorialActive) return;

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
  }, [isAuthenticated, handleButtonPress, isTutorialActive, isDisabled]);

  const setIgnoreNextRelease = useCallback(() => {
    ignoreNextReleaseRef.current = true;
  }, []);

  return {
    showMappingOverlay: isDisabled ? false : showMappingOverlay,
    activeButton,
    setIgnoreNextRelease,
  };
}

function NotificationEffects({ isUpdating, updateStatus, activeSection, handleReboot }) {
  const { addNotification } = useNotifications();
  const notificationShownRef = useRef(false);

  useEffect(() => {
    if (!isUpdating && updateStatus.stage === "complete" && activeSection !== "settings" && !notificationShownRef.current) {
      notificationShownRef.current = true;
      addNotification({
        icon: SettingsUpdateIcon,
        title: "Update installed",
        description: "Nocturne was updated successfully. Restart to apply.",
        action: { label: "Restart", onPress: handleReboot },
      });
    }
  }, [isUpdating, updateStatus.stage, activeSection, addNotification, handleReboot]);

  return null;
}

function App() {
  const [showTutorial, setShowTutorial] = useState(false);
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
  const [showLoader, setShowLoader] = useState(true);
  const [powerMenuVisible, setPowerMenuVisible] = useState(false);
  const powerMenuVisibleRef = useRef(false);

  useEffect(() => {
    powerMenuVisibleRef.current = powerMenuVisible;
  }, [powerMenuVisible]);

  const {
    isAuthenticated,
    accessToken,
    authIsLoading,
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
  } = useSpotifyData(activeSection, showLoader, !showLoader);

  const {
    isConnected: isInternetConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
  } = useNetwork();

  useEffect(() => {
    if (showLoader) return;
    if (!isInternetConnected) return;

    const existing = document.getElementById("analytics");
    if (existing) return;

    const script = document.createElement("script");
    script.defer = true;
    script.src = "https://p.itsnebula.net/script.js";
    script.setAttribute(
      "data-website-id",
      "3465cd10-6beb-4dd9-969c-f7f44704fd18",
    );
    script.id = "analytics";
    document.body.appendChild(script);
  }, [showLoader, isInternetConnected]);

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
    accessToken,
  );

  const {
    showMappingOverlay: showGlobalMappingOverlay,
    activeButton: globalActiveButton,
    setIgnoreNextRelease,
  } = useGlobalButtonMapping({
    accessToken,
    isAuthenticated,
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
    if (isAuthenticated) {
      const handleNetworkRestored = () => {
        refreshPlaybackState(true);
      };
      window.addEventListener("online", handleNetworkRestored);
      return () => {
        window.removeEventListener("online", handleNetworkRestored);
      };
    }
  }, [isAuthenticated, refreshPlaybackState]);

  useEffect(() => {
    if (isAuthenticated) {
      const hasSeenTutorial =
        localStorage.getItem("hasSeenTutorial") === "true";
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
    }
  }, [isAuthenticated, setActiveSection]);

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
  }, []);

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

  const handleAuthSuccess = () => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
    const isTokenValid = storedExpiry && new Date(storedExpiry) > new Date();

    if (storedAccessToken && storedRefreshToken && isTokenValid) {
      if (initialDataLoaded) {
        console.log("Refreshing data after auth success");
        refreshData();
      } else {
        console.log(
          "Skipping refresh - letting initial data load handle the fetch",
        );
      }
    } else {
      console.warn("No valid tokens found after auth success");
    }
  };

  const handleTutorialComplete = () => {
    setShowTutorial(false);
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
  };

  const isUpdateInProgress = isUpdating;

  const showConnectionLostScreen =
    initialCheckDone &&
    !isUpdateInProgress &&
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
    showNetworkBanner &&
    hasEverConnectedThisSession;

  let content;
  if (authIsLoading && !initialCheckDone) {
    content = null;
  } else if (
    !isInternetConnected &&
    !hasEverConnectedThisSession &&
    initialCheckDone
  ) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        onConnectionRestored={handleConnectionRestored}
      />
    );
  } else if (showConnectionLostScreen) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        deviceName={lastConnectedDevice?.name}
        onConnectionRestored={handleConnectionRestored}
      />
    );
  } else if (!isAuthenticated && initialCheckDone) {
    content = <AuthContainer onAuthSuccess={handleAuthSuccess} />;
  } else if (showTutorial) {
    content = <Tutorial onComplete={handleTutorialComplete} />;
  } else if (activeSection === "nowPlaying") {
    content = (
      <NowPlaying
        accessToken={accessToken}
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
        accessToken={accessToken}
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
        accessToken={accessToken}
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
      />
      <ConnectorProvider>
        <SettingsProvider>
          <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
            <NetworkContext.Provider value={networkContextValue}>
              <ConnectorContext.Provider value={connectorContextValue}>
                <Router>
                  <FontLoader />
                  {showLoader && (
                    <LoadingScreen
                      show={showLoader}
                      onComplete={() => setShowLoader(false)}
                    />
                  )}
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
                      {!isUpdateInProgress &&
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
                        accessToken={accessToken}
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
                      {!showTutorial && showGlobalMappingOverlay && (
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
