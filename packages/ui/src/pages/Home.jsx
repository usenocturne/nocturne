import { useEffect, useState } from "react";
import Sidebar from "../components/common/navigation/Sidebar";
import SwiperCarousel from "../components/common/navigation/SwiperCarousel";
import Settings from "../components/settings/Settings";
import SpotifyImage from "../components/common/SpotifyImage";

import { useSpotifyPlayerControls } from "../hooks/useSpotifyPlayerControls";
import DonationQRModal from "../components/common/modals/DonationQRModal";
import {
  getSpotifySkippedState,
  subscribeSpotifySkippedState,
} from "../hooks/useNocturned";
import { AlertCircleIcon } from "../components/common/icons";

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
  updateGradientColors,
}) {
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
    if (activeSection === "recents" && recentAlbums.length > 0) {
      const firstAlbumImage =
        recentAlbums[0]?.images?.[1]?.url || recentAlbums[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      const firstPlaylistImage =
        userPlaylists[0]?.images?.[1]?.url ||
        userPlaylists[0]?.images?.[0]?.url;
      updateGradientColors(firstPlaylistImage || null, "library");
    } else if (activeSection === "radio" && radioMixes.length > 0) {
      const firstMixImage = radioMixes[0]?.images?.[0]?.url;
      updateGradientColors(firstMixImage || null, "radio");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      const firstArtistImage =
        topArtists[0]?.images?.[1]?.url || topArtists[0]?.images?.[0]?.url;
      updateGradientColors(firstArtistImage || null, "artists");
    } else if (activeSection === "podcasts" && userShows.length > 0) {
      const firstShowImage =
        userShows[0]?.show?.images?.[1]?.url ||
        userShows[0]?.show?.images?.[0]?.url;
      updateGradientColors(firstShowImage || null, "podcasts");
    } else if (activeSection === "settings") {
      updateGradientColors(null, "settings");
    }
  }, [
    activeSection,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    radioMixes,
    userShows,
    currentlyPlayingAlbum,
  ]);

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

  useEffect(() => {
    if (currentlyPlayingAlbum?.is_phone_media) return;

    if (currentlyPlayingAlbum?.images?.[1]?.url) {
      if (activeSection === "nowPlaying") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "nowPlaying");
      } else if (activeSection === "recents") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "recents");
      }
    }
  }, [currentlyPlayingAlbum, activeSection, updateGradientColors]);

  const isPlayingLikedSongs = () => {
    return (
      currentPlayback?.context?.uri?.includes("collection") ||
      (currentPlayback?.context === null &&
        localStorage.getItem("playingLikedSongs") === "true")
    );
  };

  const isPlayingFromPlaylist = (playlistId) => {
    return currentPlayback?.context?.uri === `spotify:playlist:${playlistId}`;
  };

  const isFromCurrentlyPlayingArtist = (artistId) => {
    return currentPlayback?.item?.artists?.some((a) => a.id === artistId);
  };

  const isPlayingFromMix = (mixId) => {
    const mix = radioMixes.find((m) => m.id === mixId);

    if (mix && mix.uri) {
      return currentPlayback?.context?.uri === mix.uri;
    }

    if (mixId.startsWith("spotify-")) {
      const spotifyMix = radioMixes.find(
        (mix) => mix.id === mixId && mix.type === "spotify-radio",
      );
      if (spotifyMix) {
        return currentPlayback?.context?.uri === spotifyMix.uri;
      }
    }

    const playingMixId = localStorage.getItem(`playingMix-${mixId}`);
    return currentPlayback?.context?.uri === playingMixId;
  };

  const isPlayingDJ = () => {
    return (
      currentPlayback?.context?.uri ===
      "spotify:playlist:37i9dQZF1EYkqdzj48dyYq"
    );
  };

  const handleRecentsItemSelect = (index, item) => {
    if (index !== -1 && recentAlbums[index]) {
      const album = recentAlbums[index];
      onOpenContent(album.id, "album");
    }
  };

  const handleLibraryItemSelect = (index, item) => {
    if (index === 0) {
      onOpenContent("liked", "liked-songs");
      return;
    }

    const adjustedIndex = index - 1;
    const playlists = userPlaylists.filter(
      (item) =>
        item?.type === "playlist" && item.id !== "37i9dQZF1EYkqdzj48dyYq",
    );

    if (adjustedIndex >= 0 && adjustedIndex < playlists.length) {
      const playlist = playlists[adjustedIndex];
      onOpenContent(playlist.id, "playlist");
    }
  };

  const handleArtistsItemSelect = (index, item) => {
    if (index !== -1 && topArtists[index]) {
      const artist = topArtists[index];
      onOpenContent(artist.id, "artist");
    }
  };

  const handleRadioItemSelect = (index, item) => {
    if (index === 0) {
      if (isPlayingDJ()) {
        setActiveSection("nowPlaying");
      } else {
        playDJMix(currentPlayback?.device?.id).then((success) => {
          if (success) {
            setTimeout(() => {
              refreshPlaybackState();
              setActiveSection("nowPlaying");
            }, 500);
          }
        });
      }
      return;
    }

    const adjustedIndex = index - 1;
    if (adjustedIndex >= 0 && adjustedIndex < radioMixes.length) {
      const mix = radioMixes[adjustedIndex];
      onOpenContent(mix.id, "mix");
    }
  };

  const handlePodcastsItemSelect = (index, item) => {
    if (index !== -1 && userShows[index]) {
      const show = userShows[index].show;
      onOpenContent(show.id, "show");
    }
  };

  const renderRecentsSection = () => {
    if (isSpotifySkipped) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full text-white/50 text-2xl text-center">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          Connect Spotify to see
          <br />
          recently played
        </div>
      );
    }

    if (isLoading.recentAlbums) {
      return (
        <div className="flex gap-10 p-2">
          {Array(5)
            .fill()
            .map((_, index) => (
              <div key={`loading-${index}`} className="flex-shrink-0">
                <div
                  style={{ width: 280, height: 280 }}
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse w-[280px] h-[280px]"
                ></div>
                <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
              </div>
            ))}
        </div>
      );
    }

    if (recentAlbums.length === 0) {
      return (
        <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
          No recent albums found
        </div>
      );
    }

    return (
      <SwiperCarousel
        items={recentAlbums}
        renderItem={(album, index, isActive) => (
          <div
            data-id={album.id}
            className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
          >
            <div
              style={{ width: 280, height: 280 }}
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              onClick={() =>
                album.type !== "local-track" &&
                onOpenContent(
                  album.id,
                  album.type === "show" ? "show" : "album",
                )
              }
            >
              {album.type !== "local-track" ? (
                <SpotifyImage
                  images={album.images}
                  preferredSizeIndex={1}
                  alt="Album Cover"
                  priority={50}
                  className="w-full h-full object-cover rounded-[12px]"
                />
              ) : album.type === "local-track" ? (
                <img
                  src={album.images?.[0]?.url || "/images/not-playing.webp"}
                  alt="Local File"
                  className="w-full h-full object-cover rounded-[12px]"
                />
              ) : (
                <div className="w-full h-full rounded-[12px] bg-white/10"></div>
              )}
            </div>

            <h4
              className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
              onClick={() =>
                album.type !== "local-track" &&
                onOpenContent(
                  album.id,
                  album.type === "show" ? "show" : "album",
                )
              }
            >
              {album.name}
            </h4>

            {album.type === "show"
              ? album.publisher && (
                  <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                    {album.publisher}
                  </h4>
                )
              : album.artists?.[0] && (
                  <h4
                    className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]"
                    onClick={() => onOpenContent(album.artists[0].id, "artist")}
                  >
                    {album.artists.map((artist) => artist.name).join(", ")}
                  </h4>
                )}
          </div>
        )}
        keyExtractor={(album) => album.id}
        getItemId={(album) => album.id}
        activeSection={activeSection}
        currentlyPlayingId={currentlyPlayingAlbum?.id}
        onItemSelect={handleRecentsItemSelect}
      />
    );
  };

  const renderLibrarySection = () => {
    if (isSpotifySkipped) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full text-white/50 text-2xl text-center">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          Connect Spotify to see
          <br />
          your playlists
        </div>
      );
    }

    const filteredPlaylists = isLoading.userPlaylists
      ? []
      : userPlaylists.filter(
          (item) =>
            (item?.type === "playlist" || item?.uri?.includes(":playlist:")) &&
            item.id !== "37i9dQZF1EYkqdzj48dyYq",
        );

    const libraryItems = [
      { ...likedSongs, id: "liked-songs" },
      ...filteredPlaylists,
    ];

    return (
      <SwiperCarousel
        items={libraryItems}
        renderItem={(item, index, isActive) => {
          if (item.id === "liked-songs") {
            return (
              <div
                className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
              >
                <div
                  style={{ width: 280, height: 280 }}
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                  onClick={() => onOpenContent("liked", "liked-songs")}
                >
                  <img
                    src={item.images[0].url}
                    alt="Liked Songs"
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                </div>
                <h4
                  className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
                  onClick={() => onOpenContent("liked", "liked-songs")}
                >
                  {item.name}
                </h4>
                <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
                  {isPlayingLikedSongs() ? (
                    <>
                      <div className="w-5 ml-0.5 mr-3 mb-2">
                        <section>
                          <div className="wave0"></div>
                          <div className="wave1"></div>
                          <div className="wave2"></div>
                          <div className="wave3"></div>
                        </section>
                      </div>
                      Now Playing
                    </>
                  ) : (
                    `${item.tracks.total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} Songs`
                  )}
                </h4>
              </div>
            );
          }

          const playlist = item;
          return (
            <div
              className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
            >
              <div
                style={{ width: 280, height: 280 }}
                className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                onClick={() => onOpenContent(playlist.id, "playlist")}
              >
                {playlist?.images?.length > 0 ? (
                  <SpotifyImage
                    images={playlist.images}
                    preferredSizeIndex={1}
                    alt={`${playlist.name} Cover`}
                    priority={30}
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                ) : (
                  <div className="w-full h-full rounded-[12px] bg-white/10"></div>
                )}
              </div>
              <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                {playlist.name}
              </h4>
              <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
                {isPlayingFromPlaylist(playlist.id) ? (
                  <>
                    <div className="w-5 ml-0.5 mr-3 mb-2">
                      <section>
                        <div className="wave0"></div>
                        <div className="wave1"></div>
                        <div className="wave2"></div>
                        <div className="wave3"></div>
                      </section>
                    </div>
                    Now Playing
                  </>
                ) : playlist.tracks?.total != null ? (
                  `${playlist.tracks.total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} Songs`
                ) : playlist.owner?.display_name ? (
                  `by ${playlist.owner.display_name}`
                ) : (
                  "Playlist"
                )}
              </h4>
            </div>
          );
        }}
        keyExtractor={(item) => item.id}
        getItemId={(item) => item.id}
        activeSection={activeSection}
        onItemSelect={handleLibraryItemSelect}
      />
    );
  };

  const formatFollowerCount = (count) => {
    if (count >= 1000000) {
      const millions = count / 1000000;
      return millions % 1 === 0
        ? `${Math.floor(millions)}M`
        : `${millions.toFixed(1)}M`;
    }
    return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const renderArtistsSection = () => {
    if (isSpotifySkipped) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full text-white/50 text-2xl text-center">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          Connect Spotify to see
          <br />
          your top artists
        </div>
      );
    }

    if (isLoading.topArtists) {
      return (
        <div className="flex gap-10 p-2">
          {Array(5)
            .fill()
            .map((_, index) => (
              <div key={`loading-artist-${index}`} className="flex-shrink-0">
                <div className="mt-10 aspect-square rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse w-[280px] h-[280px]"></div>
                <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
              </div>
            ))}
        </div>
      );
    }

    if (topArtists.length === 0) {
      return (
        <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
          No artists found
        </div>
      );
    }

    return (
      <SwiperCarousel
        items={topArtists}
        renderItem={(artist, index, isActive) => (
          <div
            data-id={artist.id}
            className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
          >
            <div
              style={{ width: 280, height: 280 }}
              className="mt-10 aspect-square rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              onClick={() => onOpenContent(artist.id, "artist")}
            >
              {artist.images?.length > 0 ? (
                <SpotifyImage
                  images={artist.images}
                  preferredSizeIndex={1}
                  alt={`${artist.name} Profile`}
                  priority={20}
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-white/10"></div>
              )}
            </div>
            <h4
              className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
              onClick={() => onOpenContent(artist.id, "artist")}
            >
              {artist.name}
            </h4>
            <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
              {isFromCurrentlyPlayingArtist(artist.id) ? (
                <>
                  <div className="w-5 ml-0.5 mr-3 mb-2">
                    <section>
                      <div className="wave0"></div>
                      <div className="wave1"></div>
                      <div className="wave2"></div>
                      <div className="wave3"></div>
                    </section>
                  </div>
                  Now Playing
                </>
              ) : artist.followers?.total != null ? (
                `${formatFollowerCount(artist.followers.total)} Followers`
              ) : (
                "Top Artist"
              )}
            </h4>
          </div>
        )}
        keyExtractor={(artist) => artist.id}
        getItemId={(artist) => artist.id}
        activeSection={activeSection}
        onItemSelect={handleArtistsItemSelect}
      />
    );
  };

  const renderRadioSection = () => {
    if (isSpotifySkipped) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full text-white/50 text-2xl text-center">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          Connect Spotify to see
          <br />
          radio mixes
        </div>
      );
    }

    const availableMixes = isLoading.radioMixes ? [] : radioMixes;
    const radioItems = [
      { id: "dj-playlist", type: "dj", name: "DJ" },
      ...availableMixes,
    ];

    return (
      <SwiperCarousel
        items={radioItems}
        renderItem={(item, index, isActive) => {
          if (item.type === "dj") {
            return (
              <div
                className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
              >
                <div
                  style={{ width: 280, height: 280 }}
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10"
                  onClick={() => {
                    if (isPlayingDJ()) {
                      setActiveSection("nowPlaying");
                    } else {
                      playDJMix(currentPlayback?.device?.id).then((success) => {
                        if (success) {
                          setTimeout(() => {
                            refreshPlaybackState();
                            setActiveSection("nowPlaying");
                          }, 500);
                        }
                      });
                    }
                  }}
                >
                  <img
                    src="/images/radio-cover/dj.webp"
                    alt="DJ Playlist"
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                </div>
                <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                  DJ
                </h4>
                <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
                  {isPlayingDJ() ? (
                    <>
                      <div className="w-5 ml-0.5 mr-3 mb-2">
                        <section>
                          <div className="wave0"></div>
                          <div className="wave1"></div>
                          <div className="wave2"></div>
                          <div className="wave3"></div>
                        </section>
                      </div>
                      Now Playing
                    </>
                  ) : (
                    "Made for You"
                  )}
                </h4>
              </div>
            );
          }

          const mix = item;
          return (
            <div
              data-id={mix.id}
              className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
            >
              <div
                style={{ width: 280, height: 280 }}
                className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                onClick={() => onOpenContent(mix.id, "mix")}
              >
                {mix.type === "static" && mix.images?.[0]?.url ? (
                  <img
                    src={mix.images[0].url}
                    alt={`${mix.name} Cover`}
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                ) : mix.images?.length > 0 ? (
                  <SpotifyImage
                    images={mix.images}
                    preferredSizeIndex={0}
                    alt={`${mix.name} Cover`}
                    priority={10}
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                ) : (
                  <div className="w-full h-full rounded-[12px] bg-white/10"></div>
                )}
              </div>
              <h4
                className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
                onClick={() => onOpenContent(mix.id, "mix")}
              >
                {mix.name}
              </h4>
              <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
                {isPlayingFromMix(mix.id) ? (
                  <>
                    <div className="w-5 ml-0.5 mr-3 mb-2">
                      <section>
                        <div className="wave0"></div>
                        <div className="wave1"></div>
                        <div className="wave2"></div>
                        <div className="wave3"></div>
                      </section>
                    </div>
                    Now Playing
                  </>
                ) : (
                  `${mix.tracks?.total || mix.trackCount || (mix.tracks ? mix.tracks.length : 0)} Tracks`
                )}
              </h4>
            </div>
          );
        }}
        keyExtractor={(item) => item.id}
        getItemId={(item) => item.id}
        activeSection={activeSection}
        onItemSelect={handleRadioItemSelect}
      />
    );
  };

  const renderPodcastsSection = () => {
    if (isSpotifySkipped) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full text-white/50 text-2xl text-center">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          Connect Spotify to see
          <br />
          your shows
        </div>
      );
    }

    if (isLoading.userShows) {
      return (
        <div className="flex gap-10 p-2">
          {Array(5)
            .fill()
            .map((_, index) => (
              <div key={`loading-${index}`} className="flex-shrink-0">
                <div
                  style={{ width: 280, height: 280 }}
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse w-[280px] h-[280px]"
                ></div>
                <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
              </div>
            ))}
        </div>
      );
    }

    if (userShows.length === 0) {
      return (
        <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
          No podcasts found
        </div>
      );
    }

    return (
      <SwiperCarousel
        items={userShows}
        renderItem={(item, index, isActive) => {
          const show = item.show;
          return (
            <div
              data-id={show.id}
              className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
            >
              <div
                style={{ width: 280, height: 280 }}
                className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                onClick={() => onOpenContent(show.id, "show")}
              >
                {show.images?.length > 0 ? (
                  <SpotifyImage
                    images={show.images}
                    preferredSizeIndex={1}
                    alt={`${show.name} Cover`}
                    priority={20}
                    className="w-full h-full object-cover rounded-[12px]"
                  />
                ) : (
                  <div className="w-full h-full rounded-[12px] bg-white/10"></div>
                )}
              </div>
              <h4
                className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
                onClick={() => onOpenContent(show.id, "show")}
              >
                {show.name}
              </h4>
              <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                {show.publisher}
              </h4>
            </div>
          );
        }}
        keyExtractor={(item) => item.show.id}
        getItemId={(item) => item.show.id}
        activeSection={activeSection}
        onItemSelect={handlePodcastsItemSelect}
      />
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case "recents":
        return renderRecentsSection();
      case "library":
        return renderLibrarySection();
      case "artists":
        return renderArtistsSection();
      case "radio":
        return renderRadioSection();
      case "podcasts":
        return renderPodcastsSection();
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
          {renderContent()}
        </div>
      </div>

      {showDonationModal && (
        <DonationQRModal onClose={() => setShowDonationModal(false)} />
      )}
    </div>
  );
}
