import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Sidebar from "../components/common/navigation/Sidebar";

import { useSpotifyPlayerControls } from "../hooks/useSpotifyPlayerControls";
import {
  getSpotifySkippedState,
  subscribeSpotifySkippedState,
} from "../hooks/useNocturned";

import RecentsSection from "./home/RecentsSection";

const Settings = lazy(() => import("../components/settings/Settings"));
const DonationQRModal = lazy(
  () => import("../components/common/modals/DonationQRModal"),
);
const LibrarySection = lazy(() => import("./home/LibrarySection"));
const ArtistsSection = lazy(() => import("./home/ArtistsSection"));
const RadioSection = lazy(() => import("./home/RadioSection"));
const PodcastsSection = lazy(() => import("./home/PodcastsSection"));

const DJ_PLAYLIST_URI = "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";

function SectionFallback() {
  return (
    <div
      className="flex h-screen items-center justify-center"
      role="status"
      aria-label="Loading section"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </div>
  );
}

export default function Home({
  accessToken,
  activeSection,
  setActiveSection,
  recentAlbums,
  userPlaylists,
  likedSongs,
  topArtists,
  radioMixes,
  userShows,
  currentPlayback,
  currentlyPlayingAlbum,
  isLoading,
  refreshData,
  refreshPlaybackState,
  onOpenContent,
  onNavigateToNowPlaying,
}: UiComponentProps) {
  const { playDJMix } = useSpotifyPlayerControls(currentPlayback);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [isSpotifySkipped, setIsSpotifySkipped] = useState(() =>
    getSpotifySkippedState(),
  );

  useEffect(() => {
    const unsubscribe = subscribeSpotifySkippedState((skipped) => {
      setIsSpotifySkipped(skipped);
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const handleOpenDonationModal = () => {
    setShowDonationModal(true);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (activeSection === "recents") {
          setActiveSection("nowPlaying");
        } else if (
          activeSection !== "nowPlaying" &&
          activeSection !== "settings"
        ) {
          setActiveSection("recents");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSection, setActiveSection]);

  const playbackContextUri = currentPlayback?.context?.uri;
  const playbackContextIsNull = currentPlayback?.context === null;
  const playbackItemArtists = currentPlayback?.item?.artists;
  const currentPlaybackDeviceId = currentPlayback?.device?.id;

  const playingStateMap = useMemo(() => {
    const likedSongsPlaying =
      playbackContextUri?.includes("collection") ||
      (playbackContextIsNull &&
        typeof window !== "undefined" &&
        window.localStorage?.getItem("playingLikedSongs") === "true");

    const playlistId = playbackContextUri?.startsWith("spotify:playlist:")
      ? playbackContextUri.split(":")[2]
      : null;

    const artistIds = new Set(playbackItemArtists?.map((a) => a.id) || []);

    return {
      likedSongs: Boolean(likedSongsPlaying),
      playlistId,
      artistIds,
      mixUri: playbackContextUri,
      djPlaying: playbackContextUri === DJ_PLAYLIST_URI,
    };
  }, [playbackContextUri, playbackContextIsNull, playbackItemArtists]);

  const handlePlayDJMix = useCallback(
    (deviceId) => {
      if (playbackContextUri === DJ_PLAYLIST_URI) {
        setActiveSection("nowPlaying");
        return;
      }
      playDJMix(deviceId).then((success) => {
        if (success) {
          setTimeout(() => {
            refreshPlaybackState();
            setActiveSection("nowPlaying");
          }, 500);
        }
      });
    },
    [playbackContextUri, playDJMix, refreshPlaybackState, setActiveSection],
  );

  const currentlyPlayingAlbumId = currentlyPlayingAlbum?.id;

  const renderContent = () => {
    switch (activeSection) {
      case "recents":
        return (
          <RecentsSection
            isSpotifySkipped={isSpotifySkipped}
            isLoading={isLoading}
            recentAlbums={recentAlbums}
            activeSection={activeSection}
            currentlyPlayingAlbumId={currentlyPlayingAlbumId}
            onCardClick={onOpenContent}
            onNavigateToNowPlaying={onNavigateToNowPlaying}
          />
        );
      case "library":
        return (
          <LibrarySection
            isSpotifySkipped={isSpotifySkipped}
            isLoading={isLoading}
            userPlaylists={userPlaylists}
            likedSongs={likedSongs}
            activeSection={activeSection}
            playingStateMap={playingStateMap}
            onCardClick={onOpenContent}
          />
        );
      case "artists":
        return (
          <ArtistsSection
            isSpotifySkipped={isSpotifySkipped}
            isLoading={isLoading}
            topArtists={topArtists}
            activeSection={activeSection}
            playingStateMap={playingStateMap}
            onCardClick={onOpenContent}
          />
        );
      case "radio":
        return (
          <RadioSection
            isSpotifySkipped={isSpotifySkipped}
            isLoading={isLoading}
            radioMixes={radioMixes}
            activeSection={activeSection}
            playingStateMap={playingStateMap}
            onPlayDJMix={handlePlayDJMix}
            onCardClick={onOpenContent}
            currentPlaybackDeviceId={currentPlaybackDeviceId}
          />
        );
      case "podcasts":
        return (
          <PodcastsSection
            isSpotifySkipped={isSpotifySkipped}
            isLoading={isLoading}
            userShows={userShows}
            activeSection={activeSection}
            onCardClick={onOpenContent}
          />
        );
      case "settings":
        return (
          <Settings
            onOpenDonationModal={handleOpenDonationModal}
            setActiveSection={setActiveSection}
          />
        );
      default:
        return (
          <div className="flex items-center justify-center h-full text-white/50 text-2xl">
            {activeSection} section will be implemented next
          </div>
        );
    }
  };

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 grid grid-cols-[2.2fr_3fr] fadeIn-animation">
        <div
          className="h-screen overflow-y-auto pb-12 pl-8 relative scroll-container scroll-smooth"
          style={{ willChange: "transform" }}
        >
          <Sidebar
            activeSection={activeSection}
            setActiveSection={setActiveSection}
          />
        </div>

        <div className="h-screen overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<SectionFallback />}>{renderContent()}</Suspense>
        </div>
      </div>

      {showDonationModal && (
        <Suspense fallback={null}>
          <DonationQRModal onClose={() => setShowDonationModal(false)} />
        </Suspense>
      )}
    </div>
  );
}
