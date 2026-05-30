import React, { useMemo } from "react";
import SwiperCarousel from "../../components/common/navigation/SwiperCarousel";
import SpotifyImage from "../../components/common/SpotifyImage";
import { AlertCircleIcon } from "../../components/common/icons";

const CARD_SIZE_STYLE = { width: 280, height: 280 };

function LibrarySection({
  isSpotifySkipped,
  isLoading,
  userPlaylists,
  likedSongs,
  activeSection,
  playingStateMap,
  onCardClick,
}) {
  const filteredPlaylists = useMemo(
    () =>
      isLoading.userPlaylists
        ? []
        : userPlaylists.filter(
            (item) =>
              (item?.type === "playlist" ||
                item?.uri?.includes(":playlist:")) &&
              item.id !== "37i9dQZF1EYkqdzj48dyYq",
          ),
    [userPlaylists, isLoading.userPlaylists],
  );

  const libraryItems = useMemo(
    () => [{ ...likedSongs, id: "liked-songs" }, ...filteredPlaylists],
    [likedSongs, filteredPlaylists],
  );

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

  const handleItemSelect = (index) => {
    if (index === 0) {
      onCardClick("liked", "liked-songs");
      return;
    }
    const adjustedIndex = index - 1;
    if (adjustedIndex >= 0 && adjustedIndex < filteredPlaylists.length) {
      const playlist = filteredPlaylists[adjustedIndex];
      onCardClick(playlist.id, "playlist");
    }
  };

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
                style={CARD_SIZE_STYLE}
                className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
                onClick={() => onCardClick("liked", "liked-songs")}
              >
                <img
                  src={item.images[0].url}
                  alt="Liked Songs"
                  className="w-full h-full object-cover rounded-[12px]"
                />
              </div>
              <h4
                className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]"
                onClick={() => onCardClick("liked", "liked-songs")}
              >
                {item.name}
              </h4>
              <h4 className="text-[32px] font-[560] text-white/60 truncate tracking-tight max-w-[280px] flex items-center">
                {playingStateMap.likedSongs ? (
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
              style={CARD_SIZE_STYLE}
              className="mt-10 aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
              onClick={() => onCardClick(playlist.id, "playlist")}
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
              {playingStateMap.playlistId === playlist.id ? (
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
      onItemSelect={handleItemSelect}
    />
  );
}

export default React.memo(LibrarySection);
