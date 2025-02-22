import Sidebar from "../components/common/navigation/Sidebar";
import Settings from "../components/settings/Settings";
import LongPressLink from "../components/common/navigation/LongPressLink";
import HorizontalScroll from "@/components/common/navigation/HorizontalScroll";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fetchLikedSongs } from "../services/playlistService";
import DonationQRModal from "../components/common/modals/DonationQRModal";
import { useRouter } from "next/router";
import { getCurrentDevice } from "@/services/deviceService";

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
  currentPlayback,
  fetchCurrentPlayback,
  timezone,
}) {
  const [showDonationModal, setShowDonationModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const storedSection = localStorage.getItem("lastActiveSection");
    if (storedSection && storedSection !== activeSection) {
      setActiveSection(storedSection);
    }
  }, [router.pathname]);

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
      updateGradientColors(null, "settings");
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
        <div className="relative z-10 grid grid-cols-[2.2fr_3fr] fadeIn-animation">
          <div
            className="h-screen overflow-y-auto pb-12 pl-8 relative scroll-container scroll-smooth"
            style={{ willChange: "transform" }}
          >
            <Sidebar
              activeSection={activeSection}
              setActiveSection={setActiveSection}
              timezone={timezone}
            />
          </div>

          <div className="h-screen overflow-y-auto">
            {activeSection !== "settings" ? (
              <HorizontalScroll
                containerRef={scrollContainerRef}
                currentlyPlayingId={currentlyPlayingAlbum?.id}
                accessToken={accessToken}
                activeSection={activeSection}
              >
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  className="flex overflow-x-auto scroll-container p-2 snap-x snap-mandatory"
                  style={{ willChange: "transform" }}
                >
                  {activeSection === "recents" && (
                    <>
                      {albumsQueue.slice(0, 20).map((item) => (
                        <div
                          key={
                            item.type === "local"
                              ? `local-${item.uri}`
                              : item.id
                          }
                          className="min-w-[280px] mr-10 snap-start"
                        >
                          <LongPressLink
                            href={
                              item.id === null
                                ? ""
                                : item.type === "show"
                                ? `/show/${item.id}`
                                : `/album/${item.id}`
                            }
                            spotifyUrl={item?.external_urls?.spotify}
                            accessToken={accessToken}
                          >
                            <Image
                              src={
                                item?.images?.[0]?.url ||
                                "/images/not-playing.webp"
                              }
                              alt={
                                item.type === "show"
                                  ? "Show Cover"
                                  : "Album Cover"
                              }
                              width={280}
                              height={280}
                              priority
                              className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10"
                            />
                          </LongPressLink>
                          <LongPressLink
                            href={
                              item.id === null
                                ? ""
                                : item.type === "show"
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
                              href={
                                item.id === null
                                  ? ""
                                  : `/artist/${item.artists[0].id}`
                              }
                              spotifyUrl={
                                item.artists[0]?.external_urls?.spotify
                              }
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
                        <div
                          key="liked-songs"
                          className="min-w-[280px] mr-10 snap-start"
                        >
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
                              className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10"
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
                          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px] flex items-center">
                            {currentPlayback?.context?.uri?.includes(
                              "collection"
                            ) ||
                            (currentPlayback?.context === null &&
                              localStorage.getItem("playingLikedSongs") ===
                                "true") ? (
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
                      )}
                      {playlists
                        ?.filter(
                          (item) =>
                            item?.type === "playlist" &&
                            item.id !== "37i9dQZF1EYkqdzj48dyYq"
                        )
                        .map((playlist) => (
                          <div
                            key={`playlist-${playlist.id}`}
                            className="min-w-[280px] mr-10 snap-start"
                          >
                            <LongPressLink
                              href={`/playlist/${playlist.id}`}
                              spotifyUrl={playlist?.external_urls?.spotify}
                              accessToken={accessToken}
                            >
                              <Image
                                src={
                                  playlist?.images?.[0]?.url ||
                                  "/images/not-playing.webp"
                                }
                                alt={`${playlist.name} Cover`}
                                width={280}
                                height={280}
                                className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10"
                              />
                            </LongPressLink>
                            <LongPressLink
                              href={`/playlist/${playlist.id}`}
                              spotifyUrl={playlist?.external_urls?.spotify}
                              accessToken={accessToken}
                            >
                              <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                                {playlist.name}
                              </h4>
                            </LongPressLink>
                            <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px] flex items-center">
                              {currentPlayback &&
                              currentPlayback.context &&
                              currentPlayback.context.uri ===
                                `spotify:playlist:${playlist.id}` ? (
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
                                `${
                                  playlist.tracks?.total?.toLocaleString() || 0
                                } Songs`
                              )}
                            </h4>
                          </div>
                        ))}
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
                              artist?.images?.[0]?.url ||
                              "/images/not-playing.webp"
                            }
                            alt="Artist Cover"
                            width={280}
                            height={280}
                            className="mt-10 aspect-square rounded-full drop-shadow-xl bg-white/10"
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
                        <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px] flex items-center">
                          {currentPlayback?.item?.artists?.some(
                            (a) => a.id === artist.id
                          ) ? (
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
                    ))}
                  {activeSection === "radio" && (
                    <>
                      <div
                        key="dj-playlist"
                        className="min-w-[280px] mr-10 snap-start"
                      >
                        <div
                          className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10 cursor-pointer"
                          onClick={async () => {
                            try {
                              const device = await getCurrentDevice(
                                accessToken,
                                handleError
                              );
                              const deviceId = device?.id;
                              if (!deviceId) return;

                              await fetch(
                                `https://gue1-spclient.spotify.com/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
                                {
                                  method: "POST",
                                  headers: {
                                    "accept-language": "en",
                                    authorization: `Bearer ${accessToken}`,
                                    "content-type":
                                      "application/x-www-form-urlencoded",
                                  },
                                  body: '{"command": {"endpoint": "play", "context": {"entity_uri": "spotify:playlist:37i9dQZF1EYkqdzj48dyYq", "uri": "spotify:playlist:37i9dQZF1EYkqdzj48dyYq", "url": "hm:\\/\\/lexicon-session-provider\\/context-resolve\\/v2\\/session?contextUri=spotify:playlist:37i9dQZF1EYkqdzj48dyYq"}}}',
                                }
                              );

                              setTimeout(() => {
                                fetchCurrentPlayback();
                              }, 300);
                            } catch (error) {
                              console.error(
                                "Error playing DJ playlist:",
                                error
                              );
                              handleError("PLAYBACK_ERROR", error.message);
                            }
                          }}
                        >
                          <Image
                            src="/images/radio-cover/dj.webp"
                            alt="DJ Playlist"
                            width={280}
                            height={280}
                            className="aspect-square rounded-[12px] drop-shadow-xl bg-white/10"
                          />
                        </div>
                        <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                          DJ
                        </h4>
                        <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px] flex items-center">
                          {currentPlayback?.context?.uri ===
                          "spotify:playlist:37i9dQZF1EYkqdzj48dyYq" ? (
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
                            "AI DJ"
                          )}
                        </h4>
                      </div>
                      {radio.map((mix) => (
                        <div
                          key={mix.id}
                          className="min-w-[280px] mr-10 snap-start"
                        >
                          <LongPressLink
                            href={`/mix/${mix.id}?accessToken=${accessToken}`}
                            accessToken={accessToken}
                          >
                            <Image
                              src={
                                mix.images[0].url || "/images/not-playing.webp"
                              }
                              alt="Radio Cover"
                              width={280}
                              height={280}
                              className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10"
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
                          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px] flex items-center">
                            {(() => {
                              const playingMixId = localStorage.getItem(
                                `playingMix-${mix.id}`
                              );
                              return currentPlayback?.context?.uri ===
                                playingMixId ? (
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
                                `${mix.tracks.length} Songs`
                              );
                            })()}
                          </h4>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </HorizontalScroll>
            ) : (
              <div className="w-full h-full overflow-y-auto">
                <Settings
                  accessToken={accessToken}
                  onOpenDonationModal={() => setShowDonationModal(true)}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {showDonationModal && (
        <DonationQRModal onClose={() => setShowDonationModal(false)} />
      )}
    </div>
  );
}
