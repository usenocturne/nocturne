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
import SystemUpdateModal from "./components/common/modals/SystemUpdateModal";
import ButtonMappingOverlay from "./components/common/overlays/ButtonMappingOverlay";
import { useNetwork } from "./hooks/useNetwork";
import { useGradientState } from "./hooks/useGradientState";
import { PlaybackProgressContext } from "./hooks/usePlaybackProgress";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import { useBluetooth, useSystemUpdate } from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ConnectorProvider } from "./contexts/ConnectorContext";
import React from "react";
import PairingScreen from "./components/auth/PairingScreen";
import EnableTetheringScreen from "./components/auth/EnableTetheringScreen";

export const NetworkContext = React.createContext({
  selectedNetwork: null,
  setSelectedNetwork: () => { },
});

export const ConnectorContext = React.createContext({
  showConnectorModal: false,
  setShowConnectorModal: () => { },
});

function useGlobalButtonMapping({
  accessToken,
  isAuthenticated,
  playTrack,
  refreshPlaybackState,
  setActiveSection,
  isTutorialActive,
}) {
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [activeButton, setActiveButton] = useState(null);
  const [isProcessingButtonPress, setIsProcessingButtonPress] = useState(false);
  const ignoreNextReleaseRef = useRef(false);

  const handleButtonPress = useCallback(
    async (buttonNumber) => {
      if (
        !accessToken ||
        !isAuthenticated ||
        isProcessingButtonPress ||
        isTutorialActive
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
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.tracks && data.tracks.length > 0) {
              uris = data.tracks.map((track) => track.uri);
            }
          } else {
            contextUri = `spotify:artist:${mappedId}`;
          }
        } else if (mappedType === "mix") {
          const mixTracksJson = localStorage.getItem(
            `button${buttonNumber}Tracks`
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
            `button${buttonNumber}Tracks`
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
                }
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
              }
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
        if (contextUri) {
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
      refreshPlaybackState,
      setActiveSection,
      isProcessingButtonPress,
      isTutorialActive,
    ]
  );

  useEffect(() => {
    if (!isAuthenticated || isTutorialActive) return;

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
  }, [isAuthenticated, handleButtonPress, isTutorialActive]);

  const setIgnoreNextRelease = useCallback(() => {
    ignoreNextReleaseRef.current = true;
  }, []);

  return {
    showMappingOverlay,
    activeButton,
    setIgnoreNextRelease,
  };
}

function App() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("lastActiveSection") || "recents";
  });
  const [viewingContent, setViewingContent] = useState(null);
  const [isDeviceSwitcherOpen, setIsDeviceSwitcherOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [showConnectorModal, setShowConnectorModal] = useState(false);

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
    playbackProgress,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    isLoading,
    errors: dataErrors,
    refreshData,
  } = useSpotifyData(activeSection);

  const { isConnected, showNoNetwork, checkNetwork } = useNetwork();
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
    stopRetrying
  } = useBluetooth();

  const {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage
  } = useSystemUpdate();

  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState(activeSection);

  const {
    showMappingOverlay: showGlobalMappingOverlay,
    activeButton: globalActiveButton,
    setIgnoreNextRelease,
  } = useGlobalButtonMapping({
    accessToken,
    isAuthenticated,
    playTrack: playerControls.playTrack,
    refreshPlaybackState,
    setActiveSection,
    isTutorialActive: showTutorial,
  });

  const handleOpenDeviceSwitcher = () => {
    setIsDeviceSwitcherOpen(true);
  };

  const handleCloseDeviceSwitcher = () => {
    setIsDeviceSwitcherOpen(false);
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
    checkNetwork();
  }, [checkNetwork]);

  useEffect(() => {
    if (isAuthenticated) {
      const handleNetworkRestored = () => {
        refreshPlaybackState(true);
      };

      window.addEventListener('online', handleNetworkRestored);
      window.addEventListener('networkRestored', handleNetworkRestored);
      
      return () => {
        window.removeEventListener('online', handleNetworkRestored);
        window.removeEventListener('networkRestored', handleNetworkRestored);
      };
    }
  }, [isAuthenticated, refreshPlaybackState]);

  useEffect(() => {
    if (isAuthenticated) {
      const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
      setShowTutorial(!hasSeenTutorial);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeSection === "recents" && recentAlbums.length > 0) {
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
    }
  }, [
    activeSection,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    currentlyPlayingAlbum,
  ]);

  useEffect(() => {
    if (!isConnected) {
      setDiscoverable(true);
    } else {
      setDiscoverable(false);
    }
  }, [isConnected, setDiscoverable]);

  useEffect(() => {
    if (showTetheringScreen) {
      enableNetworking();
    }
  }, [showTetheringScreen, enableNetworking]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.images?.[1]?.url) {
      if (activeSection === "nowPlaying") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "nowPlaying");
      } else if (activeSection === "recents") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "recents");
      }
    }
  }, [currentlyPlayingAlbum, activeSection, updateGradientColors]);

  const handleAuthSuccess = () => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
    const isTokenValid = storedExpiry && new Date(storedExpiry) > new Date();

    if (storedAccessToken && storedRefreshToken) {
      if (isTokenValid) {
        refreshData();
      }

      const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
      setShowTutorial(!hasSeenTutorial);
    } else {
      console.warn("No valid tokens found after auth success");
    }
  };

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    localStorage.setItem("hasSeenTutorial", "true");
  };

  const handleOpenContent = (id, type) => {
    setViewingContent({ id, type });
  };

  const handleCloseContent = () => {
    setViewingContent(null);

    if (
      activeSection === "nowPlaying" &&
      currentlyPlayingAlbum?.images?.[0]?.url
    ) {
      updateGradientColors(currentlyPlayingAlbum.images[1].url, "nowPlaying");
    } else if (activeSection === "recents" && recentAlbums.length > 0) {
      updateGradientColors(recentAlbums[0]?.images?.[1]?.url, "recents");
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      updateGradientColors(topArtists[0]?.images?.[1]?.url, "artists");
    } else if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    }
  };

  const handleNavigateToNowPlaying = () => {
    setViewingContent(null);
    setActiveSection("nowPlaying");
  };

  const handleNetworkCancel = () => {
    if (lastConnectedDevice) {
      disconnectDevice(lastConnectedDevice.address);
    }
  };

  const isFlashing = isUpdating && updateStatus.stage === 'flash';

  let content;
  if (authIsLoading) {
    content = null;
  } else if (!isAuthenticated) {
    content = <AuthContainer onAuthSuccess={handleAuthSuccess} />;
  } else if (showTutorial) {
    content = <Tutorial onComplete={handleTutorialComplete} />;
  } else if (activeSection === "nowPlaying") {
    content = (
      <NowPlaying
        accessToken={accessToken}
        currentPlayback={currentPlayback}
        onClose={() => setActiveSection("recents")}
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
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
        radioMixes={radioMixes}
        updateGradientColors={updateGradientColors}
        setIgnoreNextRelease={setIgnoreNextRelease}
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
        currentPlayback={currentPlayback}
        currentlyPlayingAlbum={currentlyPlayingAlbum}
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
    <ConnectorProvider>
      <SettingsProvider>
        <PlaybackProgressContext.Provider value={playbackProgress}>
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
                      {content}
                      {(!isConnected || showNoNetwork) && !isFlashing && !showTetheringScreen && <NetworkScreen />}
                      {pairingRequest && (
                        <PairingScreen
                          pin={pairingRequest.pairingKey}
                          isConnecting={isConnecting}
                          onAccept={acceptPairing}
                          onReject={denyPairing}
                        />
                      )}
                      {showTetheringScreen && !isConnected && !isFlashing && (
                        <EnableTetheringScreen
                          key={`tethering-${Date.now()}-${Math.random()}`}
                          deviceType={lastConnectedDevice?.name}
                          message={`Please enable hotspot and Bluetooth tethering on ${lastConnectedDevice?.name || 'your device'} to continue.`}
                          onDismissRetry={() => {
                            stopRetrying();
                          }}
                        />
                      )}
                      <SystemUpdateModal
                        show={isFlashing}
                        status={updateStatus}
                        progress={progress}
                        isError={isError}
                        errorMessage={errorMessage}
                      />
                      <DeviceSwitcherModal
                        isOpen={isDeviceSwitcherOpen}
                        onClose={handleCloseDeviceSwitcher}
                        accessToken={accessToken}
                      />
                      <NetworkPasswordModal
                        network={selectedNetwork}
                        onClose={handleNetworkClose}
                        onConnect={handleNetworkClose}
                      />
                      {showConnectorModal && (
                        <ConnectorQRModal
                          onClose={() => setShowConnectorModal(false)}
                        />
                      )}
                      {!showTutorial && showGlobalMappingOverlay && (
                        <ButtonMappingOverlay
                          show={showGlobalMappingOverlay}
                          activeButton={globalActiveButton}
                        />
                      )}
                    </div>
                  </main>
                </Router>
              </ConnectorContext.Provider>
            </NetworkContext.Provider>
          </DeviceSwitcherContext.Provider>
        </PlaybackProgressContext.Provider>
      </SettingsProvider>
    </ConnectorProvider>
  );
}

export default App;
