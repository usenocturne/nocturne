import { useEffect, useRef, useState } from "react";
import Sidebar from "../components/common/navigation/Sidebar";
import HorizontalScroll from "../components/common/navigation/HorizontalScroll";
import Settings from "../components/settings/Settings";

import { useNavigation } from "../hooks/useNavigation";
import { useSpotifyPlayerControls } from "../hooks/useSpotifyPlayerControls";
import DonationQRModal from "../components/common/modals/DonationQRModal";

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
  const scrollContainerRef = useRef(null);
  const itemWidth = 290;
  const [newAlbumAdded, setNewAlbumAdded] = useState(false);
  const { playDJMix } = useSpotifyPlayerControls(accessToken);
  const [showDonationModal, setShowDonationModal] = useState(false);

  const handleOpenDonationModal = () => {
    setShowDonationModal(true);
  };

  const { scrollByAmount } = useNavigation({
    containerRef: scrollContainerRef,
    activeSection,
    enableScrollTracking: true,
    enableWheelNavigation: true,
    enableKeyboardNavigation: false,
    enableItemSelection: false,
    itemWidth: itemWidth,
    itemGap: 40,
    currentlyPlayingId: currentlyPlayingAlbum?.id,
  });

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
    if (activeSection === "nowPlaying") {
      refreshPlaybackState();
    }
  }, [activeSection, refreshPlaybackState]);

  useEffect(() => {
    if (recentAlbums.length > 0 && activeSection === "recents") {
      setNewAlbumAdded(true);
    }
  }, [recentAlbums, activeSection]);

  useEffect(() => {
    if (newAlbumAdded && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        left: 0,
        behavior: "smooth",
      });

      setTimeout(() => {
        setNewAlbumAdded(false);
      }, 300);
    }
  }, [newAlbumAdded]);

  useEffect(() => {
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
    return (
      <HorizontalScroll
        key="recents"
        containerRef={scrollContainerRef}
        currentlyPlayingId={currentlyPlayingAlbum?.id}
        accessToken={accessToken}
        activeSection={activeSection}
        onItemSelect={handleRecentsItemSelect}
      >
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
          style={{ willChange: "transform" }}
        >
          {isLoading.recentAlbums ? (
            Array(5)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-${index}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse"
                    style={{ width: 280, height: 280 }}
                  ></div>
                  <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                  <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
                </div>
              ))
          ) : recentAlbums.length > 0 ? (
            recentAlbums.map((album) => (
              <div
                key={album.id}
                className="min-w-[280px] pl-2 mr-10 snap-start"
                data-id={album.id}
                data-playing={
                  album.id === currentlyPlayingAlbum?.id ? "true" : "false"
                }
              >
                <div
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                  style={{ width: 280, height: 280 }}
                  onClick={() =>
                    album.type !== "local-track" &&
                    onOpenContent(
                      album.id,
                      album.type === "show" ? "show" : "album",
                    )
                  }
                >
                  {album.images?.[1]?.url && album.type !== "local-track" ? (
                    <img
                      src={album.images[1].url}
                      alt="Album Cover"
                      className="w-full h-full object-cover rounded-[12px]"
                    />
                  ) : album.type === "local-track" ? (
                    <img
                      src="/images/not-playing.webp"
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
                        onClick={() =>
                          onOpenContent(album.artists[0].id, "artist")
                        }
                      >
                        {album.artists.map((artist) => artist.name).join(", ")}
                      </h4>
                    )}
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No recent albums found
            </div>
          )}
          <div className="min-w-4 flex-shrink-0"></div>
        </div>
      </HorizontalScroll>
    );
  };

  const renderLibrarySection = () => {
    return (
      <HorizontalScroll
        containerRef={scrollContainerRef}
        accessToken={accessToken}
        activeSection={activeSection}
        onItemSelect={handleLibraryItemSelect}
      >
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
          style={{ willChange: "transform" }}
        >
          <div
            key="liked-songs"
            className="min-w-[280px] pl-2 mr-10 snap-start"
          >
            <div
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              style={{ width: 280, height: 280 }}
              onClick={() => onOpenContent("liked", "liked-songs")}
            >
              <img
                src={likedSongs.images[0].url}
                alt="Liked Songs"
                className="w-full h-full object-cover rounded-[12px]"
              />
            </div>
            <h4
              className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
              onClick={() => onOpenContent("liked", "liked-songs")}
            >
              {likedSongs.name}
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
                `${likedSongs.tracks.total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} Songs`
              )}
            </h4>
          </div>

          {isLoading.userPlaylists ? (
            Array(3)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-playlist-${index}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse"
                    style={{ width: 280, height: 280 }}
                  ></div>
                  <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                  <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
                </div>
              ))
          ) : userPlaylists.length > 0 ? (
            userPlaylists
              .filter(
                (item) =>
                  item?.type === "playlist" &&
                  item.id !== "37i9dQZF1EYkqdzj48dyYq" &&
                  item.tracks?.total > 0,
              )
              .map((playlist) => (
                <div
                  key={`playlist-${playlist.id}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                    style={{ width: 280, height: 280 }}
                    onClick={() => onOpenContent(playlist.id, "playlist")}
                  >
                    {playlist?.images?.length > 0 ? (
                      <img
                        src={playlist.images[1]?.url || playlist.images[0].url}
                        alt={`${playlist.name} Cover`}
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
                    ) : (
                      `${(playlist.tracks?.total || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} Songs`
                    )}
                  </h4>
                </div>
              ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No playlists found
            </div>
          )}
          <div className="min-w-4 flex-shrink-0"></div>
        </div>
      </HorizontalScroll>
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
    return (
      <HorizontalScroll
        containerRef={scrollContainerRef}
        accessToken={accessToken}
        activeSection={activeSection}
        onItemSelect={handleArtistsItemSelect}
      >
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
          style={{ willChange: "transform" }}
        >
          {isLoading.topArtists ? (
            Array(5)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-artist-${index}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse"
                    style={{ width: 280, height: 280 }}
                  ></div>
                  <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                  <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
                </div>
              ))
          ) : topArtists.length > 0 ? (
            topArtists.map((artist) => (
              <div
                key={artist.id}
                className="min-w-[280px] pl-2 mr-10 snap-start"
                data-id={artist.id}
              >
                <div
                  className="mt-10 aspect-square rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                  style={{ width: 280, height: 280 }}
                  onClick={() => onOpenContent(artist.id, "artist")}
                >
                  {artist.images?.[1]?.url ? (
                    <img
                      src={artist.images[1].url}
                      alt={`${artist.name} Profile`}
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
                  ) : (
                    `${formatFollowerCount(artist.followers.total)} Followers`
                  )}
                </h4>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No artists found
            </div>
          )}
          <div className="min-w-4 flex-shrink-0"></div>
        </div>
      </HorizontalScroll>
    );
  };

  const renderRadioSection = () => {
    return (
      <HorizontalScroll
        containerRef={scrollContainerRef}
        accessToken={accessToken}
        activeSection={activeSection}
        onItemSelect={handleRadioItemSelect}
      >
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
          style={{ willChange: "transform" }}
        >
          <div
            key="dj-playlist"
            className="min-w-[280px] pl-2 mr-10 snap-start"
          >
            <div
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10"
              style={{ width: 280, height: 280 }}
              onClick={() =>
                playDJMix().then((success) => {
                  if (success) {
                    setTimeout(() => {
                      refreshPlaybackState();
                      setActiveSection("nowPlaying");
                    }, 500);
                  }
                })
              }
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

          {isLoading.radioMixes ? (
            Array(5)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-${index}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse"
                    style={{ width: 280, height: 280 }}
                  ></div>
                  <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                  <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
                </div>
              ))
          ) : radioMixes.length > 0 ? (
            radioMixes.map((mix, index) => (
              <div
                key={`${mix.id}-${index}`}
                className="min-w-[280px] pl-2 mr-10 snap-start"
                data-id={mix.id}
              >
                <div
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                  style={{ width: 280, height: 280 }}
                  onClick={() => onOpenContent(mix.id, "mix")}
                >
                  {mix.images?.[0]?.url ? (
                    <img
                      src={mix.images[0].url}
                      alt={`${mix.name} Cover`}
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
                    `${mix.tracks ? mix.tracks.length : 0} Tracks`
                  )}
                </h4>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No mixes found
            </div>
          )}
          <div className="min-w-4 flex-shrink-0"></div>
        </div>
      </HorizontalScroll>
    );
  };

  const renderPodcastsSection = () => {
    return (
      <HorizontalScroll
        containerRef={scrollContainerRef}
        accessToken={accessToken}
        activeSection={activeSection}
        onItemSelect={handlePodcastsItemSelect}
      >
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
          style={{ willChange: "transform" }}
        >
          {isLoading.userShows ? (
            Array(5)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-${index}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 animate-pulse"
                    style={{ width: 280, height: 280 }}
                  ></div>
                  <div className="mt-2 h-9 w-48 bg-white/10 rounded animate-pulse"></div>
                  <div className="mt-2 h-8 w-40 bg-white/10 rounded animate-pulse"></div>
                </div>
              ))
          ) : userShows.length > 0 ? (
            userShows.map((item, i) => {
              const show = item.show;
              return (
                <div
                  key={`${show.id}-${i}`}
                  className="min-w-[280px] pl-2 mr-10 snap-start"
                  data-id={show.id}
                >
                  <div
                    className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                    style={{ width: 280, height: 280 }}
                    onClick={() => onOpenContent(show.id, "show")}
                  >
                    {show.images?.[1]?.url || show.images?.[0]?.url ? (
                      <img
                        src={show.images[1]?.url || show.images[0]?.url}
                        alt={`${show.name} Cover`}
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
            })
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No podcasts found
            </div>
          )}
          <div className="min-w-4 flex-shrink-0"></div>
        </div>
      </HorizontalScroll>
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
            accessToken={accessToken}
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

        <div className="h-screen overflow-y-auto">{renderContent()}</div>
      </div>

      {showDonationModal && (
        <DonationQRModal onClose={() => setShowDonationModal(false)} />
      )}
    </div>
  );
}
