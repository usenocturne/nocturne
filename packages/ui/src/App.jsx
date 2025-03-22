import { useState, useEffect } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import FontLoader from "./components/common/FontLoader";
import AuthContainer from "./components/auth/AuthContainer";
import NetworkScreen from "./components/auth/NetworkScreen";
import Tutorial from "./components/tutorial/Tutorial";
import Home from "./pages/Home";
import ContentView from "./components/content/ContentView";
import NowPlaying from "./components/player/NowPlaying";
import BluetoothPairingModal from "./components/bluetooth/BluetoothPairingModal";
import BluetoothNetworkModal from "./components/bluetooth/BluetoothNetworkModal";
import DeviceSwitcherModal from "./components/player/DeviceSwitcherModal";
import { useNetwork } from "./hooks/useNetwork";
import { useGradientState } from "./hooks/useGradientState";
import { PlaybackProgressContext } from "./hooks/usePlaybackProgress";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import { useBluetooth } from "./hooks/useBluetooth";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { SettingsProvider } from "./contexts/SettingsContext";

function App() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("lastActiveSection") || "recents";
  });
  const [viewingContent, setViewingContent] = useState(null);
  const [isDeviceSwitcherOpen, setIsDeviceSwitcherOpen] = useState(false);

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
    showNetworkPrompt,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    setDiscoverable,
    disconnectDevice,
    enableNetworking,
  } = useBluetooth();

  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState(activeSection);

  const handleOpenDeviceSwitcher = () => {
    setIsDeviceSwitcherOpen(true);
  };

  const handleCloseDeviceSwitcher = () => {
    setIsDeviceSwitcherOpen(false);
  };

  const deviceSwitcherContextValue = {
    openDeviceSwitcher: handleOpenDeviceSwitcher,
  };

  useEffect(() => {
    checkNetwork();
  }, [checkNetwork]);

  useEffect(() => {
    if (isAuthenticated) {
      const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
      setShowTutorial(!hasSeenTutorial);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeSection === "recents" && recentAlbums.length > 0) {
      const firstAlbumImage = recentAlbums[0]?.images?.[0]?.url;
      if (firstAlbumImage) {
        updateGradientColors(firstAlbumImage, "recents");
      }
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      const firstArtistImage = topArtists[0]?.images?.[0]?.url;
      if (firstArtistImage) {
        updateGradientColors(firstArtistImage, "artists");
      }
    } else if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    } else if (activeSection === "nowPlaying" && currentlyPlayingAlbum) {
      const albumImage = currentlyPlayingAlbum?.images?.[0]?.url;
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
    if (showNetworkPrompt) {
      enableNetworking();
    }
  }, [showNetworkPrompt, enableNetworking]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.images?.[0]?.url) {
      if (activeSection === "nowPlaying") {
        updateGradientColors(currentlyPlayingAlbum.images[0].url, "nowPlaying");
      } else if (activeSection === "recents") {
        updateGradientColors(currentlyPlayingAlbum.images[0].url, "recents");
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
      updateGradientColors(currentlyPlayingAlbum.images[0].url, "nowPlaying");
    } else if (activeSection === "recents" && recentAlbums.length > 0) {
      updateGradientColors(recentAlbums[0]?.images?.[0]?.url, "recents");
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      updateGradientColors(topArtists[0]?.images?.[0]?.url, "artists");
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
        playerControls={playerControls}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
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
    <SettingsProvider>
      <PlaybackProgressContext.Provider value={playbackProgress}>
        <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
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
                {!isConnected && showNoNetwork && <NetworkScreen />}
                <BluetoothPairingModal
                  pairingRequest={pairingRequest}
                  isConnecting={isConnecting}
                  onAccept={acceptPairing}
                  onDeny={denyPairing}
                />
                <BluetoothNetworkModal
                  show={showNetworkPrompt && !isConnected}
                  deviceName={lastConnectedDevice?.name}
                  onCancel={handleNetworkCancel}
                  isConnecting={isConnecting}
                />
                <DeviceSwitcherModal
                  isOpen={isDeviceSwitcherOpen}
                  onClose={handleCloseDeviceSwitcher}
                  accessToken={accessToken}
                />
              </div>
            </main>
          </Router>
        </DeviceSwitcherContext.Provider>
      </PlaybackProgressContext.Provider>
    </SettingsProvider>
  );
}

export default App;
