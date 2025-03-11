import React, { useState, useEffect, useRef } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useGradientState } from "../../hooks/useGradientState";
import { useNavigation } from "../../hooks/useNavigation";
import { useLyrics } from "../../hooks/useLyrics";
import ProgressBar from "./ProgressBar";
import {
  HeartIcon,
  HeartIconFilled,
  BackIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  MenuIcon,
  LyricsIcon,
} from "../common/icons";

const NowPlaying = ({ accessToken, currentPlayback, onClose }) => {
  const [isLiked, setIsLiked] = useState(false);
  const [isCheckingLike, setIsCheckingLike] = useState(false);
  const [realTimeProgress, setRealTimeProgress] = useState(0);
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false);
  const progressTimerRef = useRef(null);
  const lastUpdateTimeRef = useRef(Date.now());
  const currentTrackIdRef = useRef(null);
  const containerRef = useRef(null);
  const { updateGradientColors } = useGradientState();

  const {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    checkIsTrackLiked,
    likeTrack,
    unlikeTrack,
  } = useSpotifyPlayerControls(accessToken);

  const handlePlayPause = async () => {
    if (isPlaying) {
      await pausePlayback();
    } else if (currentPlayback?.item) {
      await playTrack();
    }
  };

  useNavigation({
    containerRef,
    enableEscapeKey: true,
    enableWheelNavigation: false,
    enableKeyboardNavigation: true,
    onEscape: onClose,
    onEnterKey: handlePlayPause,
    activeSection: "nowPlaying",
  });

  const {
    showLyrics,
    lyrics,
    currentLyricIndex,
    isLoading: lyricsLoading,
    error: lyricsError,
    lyricsContainerRef,
    toggleLyrics,
  } = useLyrics(accessToken, currentPlayback);

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
  const duration = currentPlayback?.item?.duration_ms || 1;
  const progressPercentage = (realTimeProgress / duration) * 100;
  const trackId = currentPlayback?.item?.id;

  useEffect(() => {
    if (albumArt && updateGradientColors) {
      updateGradientColors(albumArt, "nowPlaying");
    }
  }, [albumArt, updateGradientColors]);

  useEffect(() => {
    const checkCurrentTrackLiked = async () => {
      if (
        trackId &&
        currentPlayback?.item?.type === "track" &&
        !isCheckingLike
      ) {
        setIsCheckingLike(true);
        try {
          if (trackId !== currentTrackIdRef.current) {
            currentTrackIdRef.current = trackId;
            const liked = await checkIsTrackLiked(trackId);
            setIsLiked(liked);
          }
        } catch (error) {
          console.error("Error checking if track is liked:", error);
        } finally {
          setIsCheckingLike(false);
        }
      } else if (currentPlayback?.item?.type !== "track") {
        setIsLiked(false);
        currentTrackIdRef.current = null;
      }
    };

    checkCurrentTrackLiked();
  }, [trackId, checkIsTrackLiked, currentPlayback?.item?.type]);

  useEffect(() => {
    if (currentPlayback?.progress_ms !== undefined && !isProgressScrubbing) {
      setRealTimeProgress(currentPlayback.progress_ms);
      lastUpdateTimeRef.current = Date.now();
    }
  }, [currentPlayback?.progress_ms, isProgressScrubbing]);

  useEffect(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    if (isPlaying && !isProgressScrubbing) {
      progressTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;
        lastUpdateTimeRef.current = now;

        setRealTimeProgress((prev) => {
          const newProgress = Math.min(prev + elapsed, duration);
          return newProgress;
        });
      }, 100);
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [isPlaying, isProgressScrubbing, duration]);

  const handleSkipNext = async () => {
    await skipToNext();
  };

  const handleSkipPrevious = async () => {
    const RESTART_THRESHOLD_MS = 3000;

    if (realTimeProgress > RESTART_THRESHOLD_MS) {
      await seekToPosition(0);
      setRealTimeProgress(0);
      lastUpdateTimeRef.current = Date.now();
    } else {
      await skipToPrevious();
    }
  };

  const handleToggleLike = async () => {
    if (!trackId || currentPlayback?.item?.type !== "track" || isCheckingLike)
      return;

    try {
      if (isLiked) {
        setIsLiked(false);
        await unlikeTrack(trackId);
      } else {
        setIsLiked(true);
        await likeTrack(trackId);
      }
    } catch (error) {
      setIsLiked(!isLiked);
      console.error("Error toggling track like:", error);
    }
  };

  const handleSeek = async (position) => {
    try {
      if (currentPlayback?.item) {
        await seekToPosition(position);
        setRealTimeProgress(position);
        lastUpdateTimeRef.current = Date.now();
      }
    } catch (error) {
      console.error("Error seeking:", error);
    }
  };

  const handleScrubbingChange = (scrubbing) => {
    setIsProgressScrubbing(scrubbing);
  };

  return (
    <div
      className="flex flex-col gap-1 h-screen w-full z-10 fadeIn-animation"
      ref={containerRef}
    >
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
              className="aspect-square rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
            />
          </div>

          {!showLyrics ? (
            <div className="flex-1 text-center md:text-left">
              <h4 className="text-[40px] font-[580] text-white truncate tracking-tight max-w-[400px]">
                {trackName}
              </h4>
              <h4 className="text-[36px] font-[560] text-white/60 truncate tracking-tight max-w-[380px]">
                {artistName}
              </h4>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-[280px]">
              <div
                className="flex-1 text-left overflow-y-auto h-[280px] w-[380px]"
                ref={lyricsContainerRef}
              >
                {lyricsLoading ? (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300">
                    Loading lyrics...
                  </p>
                ) : lyricsError ? (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300">
                    Lyrics not available
                  </p>
                ) : lyrics.length > 0 ? (
                  lyrics.map((lyric, index) => (
                    <p
                      key={index}
                      className={`text-[40px] font-[580] tracking-tight transition-colors duration-300 ${
                        index === currentLyricIndex
                          ? "text-white current-lyric-animation"
                          : index === currentLyricIndex - 1 ||
                            index === currentLyricIndex + 1
                          ? "text-white/40"
                          : "text-white/20"
                      }`}
                    >
                      {lyric.text}
                    </p>
                  ))
                ) : (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300">
                    Lyrics not available
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-12 pt-3 pb-7">
        <ProgressBar
          progress={progressPercentage}
          isPlaying={isPlaying}
          durationMs={duration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onScrubbingChange={handleScrubbingChange}
        />
      </div>

      <div
        className={`flex justify-between items-center w-full px-12 transition-all duration-200 ease-in-out ${
          isProgressScrubbing
            ? "translate-y-24 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="flex-shrink-0" onClick={handleToggleLike}>
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
          <Menu as="div" className="relative inline-block text-left">
            <MenuButton className="focus:outline-none">
              <MenuIcon className="w-14 h-14 fill-white/60" />
            </MenuButton>

            <MenuItems
              transition
              className="absolute right-0 bottom-full z-10 mb-2 w-[22rem] origin-bottom-right divide-y divide-slate-100/25 bg-[#161616] rounded-[13px] shadow-xl transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
            >
              <div className="py-1">
                <MenuItem onClick={toggleLyrics}>
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                    <span className="text-[28px]">
                      {showLyrics ? "Hide Lyrics" : "Show Lyrics"}
                    </span>
                    <LyricsIcon
                      aria-hidden="true"
                      className={`h-8 w-8 ${
                        showLyrics ? "text-white" : "text-white/60"
                      }`}
                    />
                  </div>
                </MenuItem>
              </div>
            </MenuItems>
          </Menu>
        </div>
      </div>
    </div>
  );
};

export default NowPlaying;
