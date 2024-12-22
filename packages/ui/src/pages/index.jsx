import Sidebar from "../components/common/navigation/Sidebar";
import Settings from "../components/settings/Settings";
import LongPressLink from "../components/common/navigation/LongPressLink";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fetchLikedSongs } from "../services/playlistService";
import DonationQRModal from "../components/common/modals/DonationQRModal";

export default function Home({
  accessToken,
  playlists,
  artists,
  radio,
  activeSection,
  setActiveSection,
  loading,
  albumsQueue,
  updateGradientColors,
  currentlyPlayingAlbum,
  showBrightnessOverlay,
  handleError,
}) {
  const [showDonationModal, setShowDonationModal] = useState(false);
  useEffect(() => {
    if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    } else if (activeSection === "library" && playlists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && artists.length > 0) {
      const firstArtistImage = artists[0]?.images?.[0]?.url;
      updateGradientColors(firstArtistImage || null, "artists");
    } else if (activeSection === "recents" && albumsQueue.length > 0) {
      const firstAlbumImage = albumsQueue[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    } else if (activeSection === "settings") {
      const firstAlbumImage = albumsQueue[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    }
  }, [activeSection, updateGradientColors, playlists, artists, albumsQueue]);

  const scrollContainerRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const prevQueueLengthRef = useRef(albumsQueue.length);
  const itemWidth = 290;
  const hasScrolledToCurrentAlbumRef = useRef(false);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    external_urls: {
      spotify: "https://open.spotify.com/collection/tracks",
    },
  });

  const handleWheel = (e) => {
    if (!showBrightnessOverlay) {
      e.preventDefault();

      if (scrollContainerRef.current) {
        const scrollAmount = itemWidth;
        const direction = Math.sign(e.deltaX);

        scrollContainerRef.current.scrollBy({
          left: scrollAmount * direction,
          behavior: "smooth",
        });
      }
    }
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("wheel", handleWheel, {
        passive: false,
      });
    }

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("wheel", handleWheel);
      }
    };
  }, []);

  const handleScroll = () => {
    setIsScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  };

  useEffect(() => {
    if (
      scrollContainerRef.current &&
      activeSection === "recents" &&
      albumsQueue.length !== prevQueueLengthRef.current
    ) {
      scrollContainerRef.current.scrollTo({
        left: 0,
        behavior: "smooth",
      });
    }

    prevQueueLengthRef.current = albumsQueue.length;
  }, [albumsQueue, activeSection]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      scrollContainerRef.current &&
      activeSection === "recents" &&
      currentlyPlayingAlbum &&
      !hasScrolledToCurrentAlbumRef.current
    ) {
      const currentAlbumIndex = albumsQueue.findIndex(
        (album) => album.id === currentlyPlayingAlbum.id
      );

      if (currentAlbumIndex !== -1) {
        scrollContainerRef.current.scrollTo({
          left: currentAlbumIndex * (itemWidth + 40),
          behavior: "smooth",
        });
        hasScrolledToCurrentAlbumRef.current = true;
      }
    }
  }, [currentlyPlayingAlbum, activeSection, albumsQueue]);

  useEffect(() => {
    hasScrolledToCurrentAlbumRef.current = false;
  }, [activeSection]);

  useEffect(() => {
    if (accessToken) {
      fetchLikedSongs(accessToken, handleError).then((liked) => {
        if (liked) {
          setLikedSongs(liked);
        }
      });
    }
  }, [accessToken]);

  return (
    <div className="relative min-h-screen">
      {!loading && (
        <div className="relative z-10 grid grid-cols-[2.21fr_3fr] fadeIn-animation">
          <div
            className="h-screen overflow-y-auto pb-12 pl-8 relative scroll-container scroll-smooth"
            style={{ willChange: "transform" }}
          >
            <Sidebar
              activeSection={activeSection}
              setActiveSection={setActiveSection}
            />
          </div>

          <div className="h-screen overflow-y-auto">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
              style={{ willChange: "transform" }}
            >
              {activeSection === "recents" && (
                <>
                  {albumsQueue.map((item) => (
                    <div
                      key={item.id}
                      className="min-w-[280px] mr-10 snap-start"
                    >
                      <LongPressLink
                        href={
                          item.type === "show"
                            ? `/show/${item.id}`
                            : `/album/${item.id}`
                        }
                        spotifyUrl={item?.external_urls?.spotify}
                        accessToken={accessToken}
                      >
                        <Image
                          src={
                            item?.images?.[0]?.url || "/images/not-playing.webp"
                          }
                          alt={
                            item.type === "show" ? "Show Cover" : "Album Cover"
                          }
                          width={280}
                          height={280}
                          priority
                          className="mt-10 aspect-square rounded-[12px] drop-shadow-xl"
                        />
                      </LongPressLink>
                      <LongPressLink
                        href={
                          item.type === "show"
                            ? `/show/${item.id}`
                            : `/album/${item.id}`
                        }
                        spotifyUrl={item?.external_urls?.spotify}
                        accessToken={accessToken}
                      >
                        <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                          {item.name}
                        </h4>
                      </LongPressLink>
                      {item.type === "show" ? (
                        <h4 className="text-[32px] font-[560] text-white truncate tracking-tight max-w-[280px]">
                          {item.publisher}
                        </h4>
                      ) : item.artists?.[0] ? (
                        <LongPressLink
                          href={`/artist/${item.artists[0].id}`}
                          spotifyUrl={item.artists[0]?.external_urls?.spotify}
                          accessToken={accessToken}
                        >
                          <h4 className="text-[32px] font-[560] text-white truncate tracking-tight max-w-[280px]">
                            {item.artists
                              .map((artist) => artist.name)
                              .join(", ")}
                          </h4>
                        </LongPressLink>
                      ) : null}
                    </div>
                  ))}
                </>
              )}
              {activeSection === "library" && (
                <>
                  {likedSongs && (
                    <div className="min-w-[280px] mr-10 snap-start">
                      <LongPressLink
                        href="/collection/tracks"
                        spotifyUrl={likedSongs.external_urls.spotify}
                        accessToken={accessToken}
                      >
                        <Image
                          src="https://misc.scdn.co/liked-songs/liked-songs-640.png"
                          alt="Liked Songs"
                          width={280}
                          height={280}
                          className="mt-10 aspect-square rounded-[12px] drop-shadow-xl"
                        />
                      </LongPressLink>
                      <LongPressLink
                        href="/collection/tracks"
                        spotifyUrl={likedSongs.external_urls.spotify}
                        accessToken={accessToken}
                      >
                        <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                          {likedSongs.name}
                        </h4>
                      </LongPressLink>
                      <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
                        {likedSongs.tracks.total.toLocaleString()} Songs
                      </h4>
                    </div>
                  )}
                  {playlists &&
                    playlists.map((item) =>
                      item && item.id ? (
                        <div
                          key={item.id}
                          className="min-w-[280px] mr-10 snap-start"
                        >
                          <LongPressLink
                            href={`/playlist/${item.id}`}
                            spotifyUrl={item?.external_urls?.spotify}
                            accessToken={accessToken}
                          >
                            <Image
                              src={
                                item?.images?.[0]?.url ||
                                "/images/not-playing.webp"
                              }
                              alt="Playlist Cover"
                              width={280}
                              height={280}
                              className="mt-10 aspect-square rounded-[12px] drop-shadow-xl"
                            />
                          </LongPressLink>
                          <LongPressLink
                            href={`/playlist/${item.id}`}
                            spotifyUrl={item?.external_urls?.spotify}
                            accessToken={accessToken}
                          >
                            <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                              {item.name}
                            </h4>
                          </LongPressLink>
                          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
                            {item.tracks?.total?.toLocaleString() || 0} Songs
                          </h4>
                        </div>
                      ) : null
                    )}
                </>
              )}
              {activeSection === "artists" &&
                artists.map((artist) => (
                  <div
                    key={artist.id}
                    className="min-w-[280px] mr-10 snap-start"
                  >
                    <LongPressLink
                      href={`/artist/${artist.id}`}
                      spotifyUrl={artist?.external_urls?.spotify}
                      accessToken={accessToken}
                    >
                      <Image
                        src={
                          artist?.images?.[0]?.url || "/images/not-playing.webp"
                        }
                        alt="Artist Cover"
                        width={280}
                        height={280}
                        className="mt-10 aspect-square rounded-full drop-shadow-xl"
                      />
                    </LongPressLink>
                    <LongPressLink
                      href={`/artist/${artist.id}`}
                      spotifyUrl={artist?.external_urls?.spotify}
                      accessToken={accessToken}
                    >
                      <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                        {artist.name}
                      </h4>
                    </LongPressLink>
                    <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
                      {artist.followers.total.toLocaleString()} Followers
                    </h4>
                  </div>
                ))}
              {activeSection === "radio" &&
                radio.map((mix) => (
                  <div key={mix.id} className="min-w-[280px] mr-10 snap-start">
                    <LongPressLink
                      href={`/mix/${mix.id}?accessToken=${accessToken}`}
                      accessToken={accessToken}
                    >
                      <Image
                        src={mix.images[0].url || "/images/not-playing.webp"}
                        alt="Radio Cover"
                        width={280}
                        height={280}
                        className="mt-10 aspect-square rounded-[12px] drop-shadow-xl"
                      />
                    </LongPressLink>
                    <LongPressLink
                      href={`/mix/${mix.id}?accessToken=${accessToken}`}
                      accessToken={accessToken}
                    >
                      <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                        {mix.name}
                      </h4>
                    </LongPressLink>
                    <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                      {mix.tracks.length} Songs
                    </h4>
                  </div>
                ))}
              {activeSection === "settings" && (
                <div className="w-full h-full overflow-y-auto">
                  <Settings
                    accessToken={accessToken}
                    onOpenDonationModal={() => setShowDonationModal(true)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showDonationModal && (
        <DonationQRModal onClose={() => setShowDonationModal(false)} />
      )}
    </div>
  );
}
