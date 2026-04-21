import React, { useMemo } from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import SpotifyImage from "../../components/common/SpotifyImage";
import { AlertCircleIcon } from "../../components/common/icons";

const CARD_SIZE_STYLE = { width: 280, height: 280 };
const DJ_ITEM = { id: "dj-playlist", type: "dj", name: "DJ" };

function RadioSection({
  isSpotifySkipped,
  isLoading,
  radioMixes,
  activeSection,
  playingStateMap,
  onPlayDJMix,
  onCardClick,
  currentPlaybackDeviceId,
}) {
  const radioItems = useMemo(() => {
    const availableMixes = isLoading.radioMixes ? [] : radioMixes;
    return [DJ_ITEM, ...availableMixes];
  }, [radioMixes, isLoading.radioMixes]);

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

  const isPlayingMix = (mix) => {
    if (mix && mix.uri) {
      return playingStateMap.mixUri === mix.uri;
    }
    if (mix.id.startsWith("spotify-")) {
      const spotifyMix = radioMixes.find(
        (m) => m.id === mix.id && m.type === "spotify-radio",
      );
      if (spotifyMix) {
        return playingStateMap.mixUri === spotifyMix.uri;
      }
    }
    const playingMixId = localStorage.getItem(`playingMix-${mix.id}`);
    return playingStateMap.mixUri === playingMixId;
  };

  const handleDJClick = () => {
    onPlayDJMix(currentPlaybackDeviceId);
  };

  const handleItemSelect = (index) => {
    if (index === 0) {
      handleDJClick();
      return;
    }
    const adjustedIndex = index - 1;
    if (adjustedIndex >= 0 && adjustedIndex < radioMixes.length) {
      const mix = radioMixes[adjustedIndex];
      onCardClick(mix.id, "mix");
    }
  };

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
                style={CARD_SIZE_STYLE}
                className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)] bg-white/10"
                onClick={handleDJClick}
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
                {playingStateMap.djPlaying ? (
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
              style={CARD_SIZE_STYLE}
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              onClick={() => onCardClick(mix.id, "mix")}
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
              onClick={() => onCardClick(mix.id, "mix")}
            >
              {mix.name}
            </h4>
            <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
              {isPlayingMix(mix) ? (
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
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(RadioSection);
