import React from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import SpotifyImage from "../../components/common/SpotifyImage";
import { AlertCircleIcon } from "../../components/common/icons";

const CARD_SIZE_STYLE = { width: 280, height: 280 };

function RecentsSection({
  isSpotifySkipped,
  isLoading,
  recentAlbums,
  activeSection,
  currentlyPlayingAlbumId,
  onCardClick,
}) {
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
                style={CARD_SIZE_STYLE}
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

  const handleItemSelect = (index) => {
    if (index !== -1 && recentAlbums[index]) {
      const album = recentAlbums[index];
      onCardClick(album.id, "album");
    }
  };

  return (
    <SwiperCarousel
      items={recentAlbums}
      renderItem={(album, index, isActive) => (
        <div
          data-id={album.id}
          className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
        >
          <div
            style={CARD_SIZE_STYLE}
            className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
            onClick={() =>
              album.type !== "local-track" &&
              onCardClick(album.id, album.type === "show" ? "show" : "album")
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
              onCardClick(album.id, album.type === "show" ? "show" : "album")
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
                  onClick={() => onCardClick(album.artists[0].id, "artist")}
                >
                  {album.artists.map((artist) => artist.name).join(", ")}
                </h4>
              )}
        </div>
      )}
      keyExtractor={(album) => album.id}
      getItemId={(album) => album.id}
      activeSection={activeSection}
      currentlyPlayingId={currentlyPlayingAlbumId}
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(RecentsSection);
