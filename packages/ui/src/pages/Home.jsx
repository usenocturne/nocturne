import { useEffect, useRef, useState } from "react";
import Sidebar from "../components/common/navigation/Sidebar";
import HorizontalScroll from "../components/common/navigation/HorizontalScroll";
import Redirect from "../components/common/navigation/Redirect";
import { useGradientState } from "../hooks/useGradientState";
import { useNavigation } from "../hooks/useNavigation";

export default function Home({
  accessToken,
  activeSection,
  setActiveSection,
  recentAlbums,
  userPlaylists,
  likedSongs,
  topArtists,
  radioMixes,
  currentPlayback,
  currentlyPlayingAlbum,
  isLoading,
  refreshData,
  refreshPlaybackState,
  onOpenContent,
}) {
  const { updateGradientColors } = useGradientState();
  const scrollContainerRef = useRef(null);
  const hasScrolledToCurrentAlbumRef = useRef(false);
  const itemWidth = 290;
  const [newAlbumAdded, setNewAlbumAdded] = useState(false);

  const { scrollByAmount } = useNavigation({
    containerRef: scrollContainerRef,
    activeSection,
    enableScrollTracking: false,
    enableWheelNavigation: true,
    enableKeyboardNavigation: false,
    enableItemSelection: false,
    itemWidth: itemWidth,
    itemGap: 40,
  });

  useEffect(() => {
    const storedSection = localStorage.getItem("lastActiveSection");
    if (storedSection && storedSection !== activeSection) {
      setActiveSection(storedSection);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "recents" && recentAlbums.length > 0) {
      const firstAlbumImage = recentAlbums[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      const firstPlaylistImage = userPlaylists[0]?.images?.[0]?.url;
      updateGradientColors(firstPlaylistImage || null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      const firstArtistImage = topArtists[0]?.images?.[0]?.url;
      updateGradientColors(firstArtistImage || null, "artists");
    } else if (activeSection === "radio" && radioMixes.length > 0) {
      updateGradientColors(null, "radio");
    } else if (activeSection === "nowPlaying" && currentlyPlayingAlbum) {
      const albumImage = currentlyPlayingAlbum?.images?.[0]?.url;
      updateGradientColors(albumImage || null, "nowPlaying");
    }

    localStorage.setItem("lastActiveSection", activeSection);
  }, [
    activeSection,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    radioMixes,
    currentlyPlayingAlbum,
  ]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      hasScrolledToCurrentAlbumRef.current = false;
    }
  }, [currentlyPlayingAlbum?.id]);

  useEffect(() => {
    if (
      scrollContainerRef.current &&
      scrollContainerRef.current.scrollLeft <= 10
    ) {
      if (recentAlbums.length > 0 && activeSection === "recents") {
        setNewAlbumAdded(true);
      }
    }
  }, [recentAlbums]);

  useEffect(() => {
    if (newAlbumAdded && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        left: itemWidth + 40,
        behavior: "auto",
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollContainerRef.current.scrollTo({
            left: 0,
            behavior: "smooth",
          });

          setNewAlbumAdded(false);
        });
      });
    }
  }, [newAlbumAdded]);

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
        item?.type === "playlist" && item.id !== "37i9dQZF1EYkqdzj48dyYq"
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

  const renderRecentsSection = () => {
    return (
      <HorizontalScroll
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
          {isLoading?.data?.recentAlbums && recentAlbums.length === 0 ? (
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
              >
                <div
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] cursor-pointer"
                  style={{ width: 280, height: 280 }}
                  onClick={() => onOpenContent(album.id, "album")}
                >
                  {album.images?.[0]?.url ? (
                    <img
                      src={album.images[0].url}
                      alt="Album Cover"
                      className="w-full h-full rounded-[12px] aspect-square"
                    />
                  ) : (
                    <div className="w-full h-full rounded-[12px] bg-white/10"></div>
                  )}
                </div>

                <h4
                  className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px] cursor-pointer"
                  onClick={() => onOpenContent(album.id, "album")}
                >
                  {album.name}
                </h4>

                {album.artists?.[0] && (
                  <h4
                    className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]"
                    onClick={() => onOpenContent(album.artists[0].id, "artist")}
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
                className="w-full h-full rounded-[12px] aspect-square"
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
                `${likedSongs.tracks.total.toLocaleString()} Songs`
              )}
            </h4>
          </div>

          {isLoading?.data?.userPlaylists && userPlaylists.length === 0 ? (
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
                  item.id !== "37i9dQZF1EYkqdzj48dyYq"
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
                    {playlist?.images?.[0]?.url ? (
                      <img
                        src={playlist.images[0].url}
                        alt={`${playlist.name} Cover`}
                        className="w-full h-full rounded-[12px] aspect-square"
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
                      `${playlist.tracks?.total?.toLocaleString() || 0} Songs`
                    )}
                  </h4>
                </div>
              ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No playlists found
            </div>
          )}
        </div>
      </HorizontalScroll>
    );
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
          {isLoading?.data?.topArtists && topArtists.length === 0 ? (
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
                  {artist.images?.[0]?.url ? (
                    <img
                      src={artist.images[0].url}
                      alt={`${artist.name} Profile`}
                      className="w-full h-full rounded-full aspect-square object-cover"
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
                    `${artist.followers.total.toLocaleString()} Followers`
                  )}
                </h4>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No artists found
            </div>
          )}
        </div>
      </HorizontalScroll>
    );
  };

  const renderRadioSection = () => {
    const formatTrackCount = (mix) => {
      if (!mix.tracks || !mix.tracks.length) return "Mix";
      return `${mix.tracks.length} Tracks`;
    };

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
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10 cursor-pointer"
              style={{ width: 280, height: 280 }}
            >
              <img
                src="/images/radio-cover/dj.webp"
                alt="DJ Playlist"
                className="w-full h-full rounded-[12px]"
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

          {isLoading?.data?.radioMixes &&
          (!radioMixes || radioMixes.length === 0) ? (
            Array(4)
              .fill()
              .map((_, index) => (
                <div
                  key={`loading-mix-${index}`}
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
          ) : radioMixes && radioMixes.length > 0 ? (
            radioMixes.map((mix) => (
              <div key={mix.id} className="min-w-[280px] pl-2 mr-10 snap-start">
                <div
                  className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] cursor-pointer"
                  style={{ width: 280, height: 280 }}
                  onClick={() => onOpenContent(mix.id, "mix")}
                >
                  {mix.images?.[0]?.url ? (
                    <img
                      src={mix.images[0].url}
                      alt={`${mix.name} Cover`}
                      className="w-full h-full rounded-[12px] aspect-square"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full rounded-[12px] bg-white/10"></div>
                  )}
                </div>
                <h4
                  className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px] cursor-pointer"
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
                    formatTrackCount(mix)
                  )}
                </h4>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
              No mixes found
            </div>
          )}
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
    </div>
  );
}
