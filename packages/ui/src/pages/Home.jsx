import { useEffect, useRef, useState } from "react";
import Sidebar from "../components/common/navigation/Sidebar";
import HorizontalScroll from "../components/common/navigation/HorizontalScroll";
import Redirect from "../components/common/navigation/Redirect";
import { useGradientState } from "../hooks/useGradientState";

export default function Home({
  accessToken,
  activeSection,
  setActiveSection,
  recentAlbums,
  userPlaylists,
  topArtists,
  currentPlayback,
  currentlyPlayingAlbum,
  isLoading,
  refreshData,
  refreshPlaybackState,
}) {
  const { updateGradientColors } = useGradientState();
  const scrollContainerRef = useRef(null);
  const hasScrolledToCurrentAlbumRef = useRef(false);
  const itemWidth = 290;

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
    } else if (activeSection === "nowPlaying" && currentlyPlayingAlbum) {
      const albumImage = currentlyPlayingAlbum?.images?.[0]?.url;
      updateGradientColors(albumImage || null, "nowPlaying");
    }

    localStorage.setItem("lastActiveSection", activeSection);
  }, [
    activeSection,
    updateGradientColors,
    recentAlbums,
    currentlyPlayingAlbum,
  ]);

  const handleWheel = (e) => {
    e.preventDefault();

    if (scrollContainerRef.current) {
      const scrollAmount = itemWidth;
      const direction = Math.sign(e.deltaX);

      scrollContainerRef.current.scrollBy({
        left: scrollAmount * direction,
        behavior: "smooth",
      });
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

  useEffect(() => {
    if (
      scrollContainerRef.current &&
      activeSection === "recents" &&
      currentlyPlayingAlbum?.id &&
      !hasScrolledToCurrentAlbumRef.current &&
      recentAlbums.length > 0
    ) {
      const currentAlbumIndex = recentAlbums.findIndex(
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
  }, [currentlyPlayingAlbum, activeSection, recentAlbums]);

  useEffect(() => {
    hasScrolledToCurrentAlbumRef.current = false;
  }, [activeSection]);

  const renderContent = () => {
    if (activeSection === "recents") {
      return (
        <HorizontalScroll
          containerRef={scrollContainerRef}
          currentlyPlayingId={currentlyPlayingAlbum?.id}
          accessToken={accessToken}
          activeSection={activeSection}
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
                    className="min-w-[280px] mr-10 snap-start"
                  >
                    <div
                      className="mt-10 aspect-square rounded-[12px] drop-shadow-xl bg-white/10 animate-pulse"
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
                  className="min-w-[280px] mr-10 snap-start"
                  data-id={album.id}
                >
                  <Redirect
                    href={`/album/${album.id}`}
                    accessToken={accessToken}
                  >
                    <div
                      className="mt-10 aspect-square rounded-[12px] drop-shadow-xl"
                      style={{ width: 280, height: 280 }}
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
                  </Redirect>

                  <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {album.name}
                  </h4>

                  {album.artists?.[0] && (
                    <Redirect
                      href={`/artist/${album.artists[0].id}`}
                      accessToken={accessToken}
                    >
                      <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                        {album.artists.map((artist) => artist.name).join(", ")}
                      </h4>
                    </Redirect>
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
    } else {
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
