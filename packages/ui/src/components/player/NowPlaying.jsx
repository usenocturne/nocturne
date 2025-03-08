import { useState, useEffect } from "react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import {
  HeartIcon,
  HeartIconFilled,
  BackIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  MenuIcon,
} from "../common/icons";

const NowPlaying = ({ accessToken, currentPlayback, onClose }) => {
  const [isLiked, setIsLiked] = useState(false);
  const { playTrack, pausePlayback, skipToNext, skipToPrevious } =
    useSpotifyPlayerControls(accessToken);

  const trackName = currentPlayback?.item
    ? currentPlayback.item.type === "episode"
      ? currentPlayback.item.name
      : currentPlayback.item.name || "Not Playing"
    : "Not Playing";

  const artistName = currentPlayback?.item
    ? currentPlayback.item.type === "episode"
      ? currentPlayback.item.show.name
      : currentPlayback.item.artists.map((artist) => artist.name).join(", ")
    : "";

  const albumArt = currentPlayback?.item
    ? currentPlayback.item.type === "episode"
      ? currentPlayback.item.show.images[0]?.url || "/images/not-playing.webp"
      : currentPlayback.item.type === "local" ||
        !currentPlayback.item?.album?.images?.[0]?.url ||
        !currentPlayback.item?.album?.images?.[0]
      ? "/images/not-playing.webp"
      : currentPlayback.item.album.images[0].url
    : "/images/not-playing.webp";

  const isPlaying = currentPlayback?.is_playing || false;
  const progress = currentPlayback?.progress_ms || 0;
  const duration = currentPlayback?.item?.duration_ms || 1;
  const progressPercentage = (progress / duration) * 100;

  const handlePlayPause = async () => {
    if (isPlaying) {
      await pausePlayback();
    } else if (currentPlayback?.item) {
      await playTrack();
    }
  };

  const handleSkipNext = async () => {
    await skipToNext();
  };

  const handleSkipPrevious = async () => {
    await skipToPrevious();
  };

  const handleBack = () => {
    if (onClose) {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1 h-screen w-full z-10 fadeIn-animation">
      <div>
        <div className="md:w-1/3 flex flex-row items-center px-12 pt-10">
          <div className="min-w-[280px] mr-8">
            <img
              src={albumArt}
              alt={
                currentPlayback?.item?.type === "episode"
                  ? "Podcast Cover"
                  : "Album Art"
              }
              width={280}
              height={280}
              className="aspect-square rounded-[12px] drop-shadow-xl"
            />
          </div>

          <div className="flex-1 text-center md:text-left">
            <h4 className="text-[40px] font-[580] text-white truncate tracking-tight max-w-[400px]">
              {trackName}
            </h4>
            <h4 className="text-[36px] font-[560] text-white/60 truncate tracking-tight max-w-[380px]">
              {artistName}
            </h4>
          </div>
        </div>
      </div>

      <div className="px-12 pt-7 pb-7">
        <div className="relative w-full bg-white/20 rounded-full overflow-hidden h-2">
          <div
            className="absolute inset-0 bg-white transition-transform duration-300 ease-linear"
            style={{
              transform: `translateX(${progressPercentage - 100}%)`,
            }}
          />
        </div>
      </div>

      <div className="flex justify-between items-center w-full px-12">
        <div className="flex-shrink-0" onClick={() => setIsLiked(!isLiked)}>
          {isLiked ? (
            <HeartIconFilled className="w-14 h-14" />
          ) : (
            <HeartIcon className="w-14 h-14" />
          )}
        </div>

        <div className="flex justify-center gap-12 flex-1">
          <div onClick={handleSkipPrevious}>
            <BackIcon className="w-14 h-14" />
          </div>
          <div onClick={handlePlayPause}>
            {isPlaying ? (
              <PauseIcon className="w-14 h-14" />
            ) : (
              <PlayIcon className="w-14 h-14" />
            )}
          </div>
          <div onClick={handleSkipNext}>
            <ForwardIcon className="w-14 h-14" />
          </div>
        </div>

        <div className="flex items-center">
          <MenuIcon className="w-14 h-14 fill-white/60" />
        </div>
      </div>
    </div>
  );
};

export default NowPlaying;
