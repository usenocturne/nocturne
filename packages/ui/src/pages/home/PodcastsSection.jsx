import React from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import SpotifyImage from "../../components/common/SpotifyImage";
import { AlertCircleIcon } from "../../components/common/icons";

const CARD_SIZE_STYLE = { width: 280, height: 280 };

function PodcastsSection({
  isSpotifySkipped,
  isLoading,
  userShows,
  activeSection,
  onCardClick,
}) {
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

  if (userShows.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-64 text-white/50 text-2xl">
        No podcasts found
      </div>
    );
  }

  const handleItemSelect = (index) => {
    if (index !== -1 && userShows[index]) {
      const show = userShows[index].show;
      onCardClick(show.id, "show");
    }
  };

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
              style={CARD_SIZE_STYLE}
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              onClick={() => onCardClick(show.id, "show")}
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
              onClick={() => onCardClick(show.id, "show")}
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
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(PodcastsSection);
