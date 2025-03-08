import { useState, useEffect } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import AuthContainer from "./components/auth/AuthContainer";
import NetworkScreen from "./components/auth/NetworkScreen";
import Tutorial from "./components/tutorial/Tutorial";
import Home from "./pages/Home";
import { useAuth } from "./hooks/useAuth";
import { useNetwork } from "./hooks/useNetwork";
import { useGradientState } from "./hooks/useGradientState";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { useSpotifyPlayerState } from "./hooks/useSpotifyPlayerState";

function App() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("lastActiveSection") || "recents";
  });

  const { isAuthenticated, accessToken, isLoading: authIsLoading } = useAuth();
  const { isConnected, showNoNetwork, checkNetwork } = useNetwork();
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
  } = useGradientState();

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading: playerIsLoading,
    error: playerError,
    refreshPlaybackState,
  } = useSpotifyPlayerState(accessToken);

  const {
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    isLoading: dataIsLoading,
    errors: dataErrors,
    refreshData,
  } = useSpotifyData(
    accessToken,
    albumChangeEvent,
    activeSection,
    currentlyPlayingAlbum
  );

  useEffect(() => {
    checkNetwork();
  }, [checkNetwork]);

  useEffect(() => {
    if (isAuthenticated) {
      const hasSeenTutorial = localStorage.getItem("hasSeenTutorial");
      setShowTutorial(!hasSeenTutorial);
    }
  }, [isAuthenticated]);

  const handleAuthSuccess = () => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

    if (storedAccessToken && storedRefreshToken) {
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

  let content;
  if (authIsLoading) {
    content = null;
  } else if (!isAuthenticated) {
    content = <AuthContainer onAuthSuccess={handleAuthSuccess} />;
  } else if (showTutorial) {
    content = <Tutorial onComplete={handleTutorialComplete} />;
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
        isLoading={{
          data: dataIsLoading,
          player: playerIsLoading,
        }}
        refreshData={refreshData}
        refreshPlaybackState={refreshPlaybackState}
      />
    );
  }

  return (
    <Router>
      <main className="overflow-hidden relative min-h-screen rounded-2xl">
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
        </div>
      </main>
    </Router>
  );
}

export default App;
