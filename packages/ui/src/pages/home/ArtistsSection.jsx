import React from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import SpotifyImage from "../../components/common/SpotifyImage";
import { AlertCircleIcon } from "../../components/common/icons";
import { formatFollowerCount } from "../../utils/helpers";

const CARD_SIZE_STYLE = { width: 280, height: 280 };

function ArtistsSection({
  isSpotifySkipped,
  isLoading,
  topArtists,
  activeSection,
  playingStateMap,
  onCardClick,
}) {
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

  const handleItemSelect = (index) => {
    if (index !== -1 && topArtists[index]) {
      const artist = topArtists[index];
      onCardClick(artist.id, "artist");
    }
  };

  return (
    <SwiperCarousel
      items={topArtists}
      renderItem={(artist, index, isActive) => (
        <div
          data-id={artist.id}
          className={`pl-2 transition-transform duration-200 ease-out ${isActive ? "scale-105" : ""}`}
        >
          <div
            style={CARD_SIZE_STYLE}
            className="mt-10 aspect-square rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
            onClick={() => onCardClick(artist.id, "artist")}
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
            onClick={() => onCardClick(artist.id, "artist")}
          >
            {artist.name}
          </h4>
          <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
            {playingStateMap.artistIds.has(artist.id) ? (
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
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(ArtistsSection);
