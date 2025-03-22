import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useNavigation } from "../../hooks/useNavigation";
import { useLyrics } from "../../hooks/useLyrics";
import { usePlaybackProgress } from "../../hooks/usePlaybackProgress";
import { useGestureControls } from "../../hooks/useGestureControls";
import ProgressBar from "./ProgressBar";
import ScrollingText from "../common/ScrollingText";
import {
  HeartIcon,
  HeartIconFilled,
  BackIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  MenuIcon,
  LyricsIcon,
  DJIcon,
  DeviceSwitcherIcon,
  VolumeLoudIcon,
  VolumeLowIcon,
  VolumeOffIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
} from "../common/icons";

const NowPlaying = ({
  accessToken,
  currentPlayback,
  onClose,
  updateGradientColors,
  onOpenDeviceSwitcher,
}) => {
  const [isLiked, setIsLiked] = useState(false);
  const [isCheckingLike, setIsCheckingLike] = useState(false);
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false);
  const [volumeOverlayState, setVolumeOverlayState] = useState({
    visible: false,
    animation: "hidden"
  });
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  
  const volumeTimerRef = useRef(null);
  const volumeLastAdjustedRef = useRef(0);
  const lastWheelEventRef = useRef(0);
  const wheelDeltaAccumulatorRef = useRef(0);
  const containerRef = useRef(null);
  const currentTrackIdRef = useRef(null);
  const prevVolumeRef = useRef(null);
  const manualVolumeChangeRef = useRef(false);
  
  const isDJPlaylist =
    currentPlayback?.context?.uri === "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";
  const contentContainerRef = useRef(null);

  const {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    checkIsTrackLiked,
    likeTrack,
    unlikeTrack,
    sendDJSignal,
    setVolume,
    volume,
    updateVolumeFromDevice,
    toggleShuffle,
    setRepeatMode: setRepeatModeApi,
  } = useSpotifyPlayerControls(accessToken);

  const {
    progressMs,
    isPlaying,
    duration,
    progressPercentage,
    updateProgress,
    triggerRefresh
  } = usePlaybackProgress(accessToken);

  useEffect(() => {
    if (currentPlayback?.device?.volume_percent !== undefined) {
      if (prevVolumeRef.current === null) {
        prevVolumeRef.current = currentPlayback.device.volume_percent;
      }
      updateVolumeFromDevice(currentPlayback.device.volume_percent);
    }
  }, [currentPlayback?.device?.volume_percent, updateVolumeFromDevice]);
  
  const showVolumeOverlay = useCallback(() => {
    if (!manualVolumeChangeRef.current) return;
    
    volumeLastAdjustedRef.current = Date.now();
    
    if (volumeTimerRef.current) {
      clearTimeout(volumeTimerRef.current);
    }
    
    setVolumeOverlayState({
      visible: true,
      animation: "showing"
    });
    
    volumeTimerRef.current = setTimeout(() => {
      setVolumeOverlayState(prev => ({
        ...prev,
        animation: "hiding"
      }));
      
      setTimeout(() => {
        setVolumeOverlayState({
          visible: false,
          animation: "hidden"
        });
        
        manualVolumeChangeRef.current = false;
      }, 300);
    }, 1500);
  }, []);
  
  useEffect(() => {
    return () => {
      if (volumeTimerRef.current) {
        clearTimeout(volumeTimerRef.current);
      }
    };
  }, []);
  
  useEffect(() => {
    if (prevVolumeRef.current === null) {
      prevVolumeRef.current = volume;
      return;
    }
    
    if (prevVolumeRef.current !== volume && manualVolumeChangeRef.current) {
      showVolumeOverlay();
    }
    
    prevVolumeRef.current = volume;
  }, [volume, showVolumeOverlay]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setShuffleEnabled(currentPlayback.shuffle_state);
    }
    if (currentPlayback?.repeat_state) {
      setRepeatMode(currentPlayback.repeat_state);
    }
  }, [currentPlayback?.shuffle_state, currentPlayback?.repeat_state]);

  const handlePlayPause = async () => {
    if (currentPlayback?.is_playing) {
      await pausePlayback();
    } else if (currentPlayback?.item) {
      await playTrack();
    }
    triggerRefresh();
  };

  const trackInfo = useMemo(() => {
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

    const trackId = currentPlayback?.item?.id;
    
    return { trackName, artistName, albumArt, trackId };
  }, [currentPlayback]);

  const { trackName, artistName, albumArt, trackId } = trackInfo;

  const handleWheel = useCallback((e) => {
    if (isProgressScrubbing) return;

    const now = Date.now();
    if (now - lastWheelEventRef.current < 50) {
      e.preventDefault();
      return;
    }
    lastWheelEventRef.current = now;

    e.preventDefault();
    e.stopPropagation();

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelDeltaAccumulatorRef.current += delta;

    if (Math.abs(wheelDeltaAccumulatorRef.current) >= 2) {
      const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
      const newVolume = Math.max(0, Math.min(100, volume + direction * 5));

      wheelDeltaAccumulatorRef.current = 0;

      if (newVolume !== volume) {
        manualVolumeChangeRef.current = true;
        setVolume(newVolume);
        triggerRefresh();
      }
    }
  }, [isProgressScrubbing, volume, setVolume, triggerRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    let options = { passive: false, capture: true };
    
    const handleWheelWithOptions = (e) => {
      handleWheel(e);
    };
    
    if (container) {
      container.addEventListener("wheel", handleWheelWithOptions, options);
    }

    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheelWithOptions, options);
      }
    };
  }, [handleWheel]);

  useNavigation({
    containerRef,
    enableEscapeKey: true,
    enableWheelNavigation: false,
    enableKeyboardNavigation: true,
    onEscape: onClose,
    onEnterKey: handlePlayPause,
    activeSection: "nowPlaying",
  });

  useGestureControls({
    contentRef: contentContainerRef,
    onSwipeLeft: () => {
      handleSkipNext();
    },
    onSwipeRight: () => {
      handleSkipPrevious();
    },
    onSwipeUp: () => {
      if (!showLyrics) {
        toggleLyrics();
      }
    },
    onSwipeDown: () => {
      if (showLyrics) {
        toggleLyrics();
      }
    },
    isActive: true,
  });

  const {
    showLyrics,
    lyrics,
    currentLyricIndex,
    isLoading: lyricsLoading,
    error: lyricsError,
    lyricsContainerRef,
    toggleLyrics,
  } = useLyrics(accessToken, currentPlayback, contentContainerRef);

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
  }, [trackId, currentPlayback?.item?.type, isCheckingLike, checkIsTrackLiked]);

  const handleSkipNext = useCallback(async () => {
    await skipToNext();
    triggerRefresh();
  }, [skipToNext, triggerRefresh]);

  const handleSkipPrevious = useCallback(async () => {
    const RESTART_THRESHOLD_MS = 3000;

    if (progressMs > RESTART_THRESHOLD_MS) {
      await seekToPosition(0);
      updateProgress(0);
    } else {
      await skipToPrevious();
    }
    triggerRefresh();
  }, [progressMs, seekToPosition, updateProgress, skipToPrevious, triggerRefresh]);

  const handleToggleLike = useCallback(async () => {
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
      triggerRefresh();
    } catch (error) {
      setIsLiked(!isLiked);
      console.error("Error toggling track like:", error);
    }
  }, [trackId, currentPlayback?.item?.type, isCheckingLike, isLiked, unlikeTrack, likeTrack, triggerRefresh]);

  const handleScrubbingChange = (scrubbing) => {
    setIsProgressScrubbing(scrubbing);
  };

  const handleSeek = useCallback(async (position) => {
    try {
      if (currentPlayback?.item) {
        await seekToPosition(position);
        updateProgress(position);
        triggerRefresh();
      }
    } catch (error) {
      console.error("Error seeking:", error);
    }
  }, [currentPlayback?.item, seekToPosition, updateProgress, triggerRefresh]);

  const handleToggleShuffle = useCallback(async () => {
    try {
      const newShuffleState = !shuffleEnabled;
      setShuffleEnabled(newShuffleState);
      await toggleShuffle(newShuffleState);
      triggerRefresh();
    } catch (error) {
      console.error("Error toggling shuffle:", error);
      setShuffleEnabled(!shuffleEnabled);
    }
  }, [shuffleEnabled, toggleShuffle, triggerRefresh]);

  const handleToggleRepeat = useCallback(async () => {
    try {
      const nextModeMap = { off: "context", context: "track", track: "off" };
      const newRepeatMode = nextModeMap[repeatMode] || "off";

      setRepeatMode(newRepeatMode);
      await setRepeatModeApi(newRepeatMode);
      triggerRefresh();
    } catch (error) {
      console.error("Error toggling repeat mode:", error);
    }
  }, [repeatMode, setRepeatModeApi, triggerRefresh]);

  const VolumeIcon = useMemo(() => {
    if (volume === 0) {
      return <VolumeOffIcon className="w-7 h-7" />;
    } else if (volume > 0 && volume <= 60) {
      return <VolumeLowIcon className="w-7 h-7 ml-1.5" />;
    } else {
      return <VolumeLoudIcon className="w-7 h-7" />;
    }
  }, [volume]);

  const PlayPauseIcon = useMemo(() => {
    return currentPlayback?.is_playing ? (
      <PauseIcon className="w-14 h-14" />
    ) : (
      <PlayIcon className="w-14 h-14" />
    );
  }, [currentPlayback?.is_playing]);

  return (
    <div
      className="flex flex-col gap-1 h-screen w-full z-10 fadeIn-animation"
      ref={containerRef}
    >
      <div ref={contentContainerRef}>
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
              <div className="max-w-[400px]">
                <ScrollingText
                  text={trackName}
                  className="text-[40px] font-[580] text-white tracking-tight"
                  maxWidth="400px"
                  pauseDuration={1000}
                  pixelsPerSecond={40}
                />
              </div>
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
          <div
            onClick={handlePlayPause}
            className="transition-opacity duration-100"
          >
            {PlayPauseIcon}
          </div>
          <div onClick={handleSkipNext}>
            <ForwardIcon className="w-14 h-14" />
          </div>
        </div>

        <div className="flex items-center">
          {isDJPlaylist && (
            <div onClick={sendDJSignal}>
              <DJIcon className="w-14 h-14 fill-white/60 mr-4 mb-1" />
            </div>
          )}
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
                {!isDJPlaylist && (
                  <>
                    <MenuItem onClick={handleToggleShuffle}>
                      <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                        <span className="text-[28px]">
                          {shuffleEnabled
                            ? "Disable Shuffle"
                            : "Enable Shuffle"}
                        </span>
                        <ShuffleIcon
                          aria-hidden="true"
                          className={`h-8 w-8 ${
                            shuffleEnabled ? "text-white" : "text-white/60"
                          }`}
                        />
                      </div>
                    </MenuItem>
                    <MenuItem onClick={handleToggleRepeat}>
                      <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                        <span className="text-[28px]">
                          {repeatMode === "off"
                            ? "Enable Repeat"
                            : repeatMode === "context"
                            ? "Enable Repeat One"
                            : "Disable Repeat"}
                        </span>
                        {repeatMode === "track" ? (
                          <RepeatOneIcon
                            aria-hidden="true"
                            className="h-8 w-8 text-white"
                          />
                        ) : (
                          <RepeatIcon
                            aria-hidden="true"
                            className={`h-8 w-8 ${
                              repeatMode === "context"
                                ? "text-white"
                                : "text-white/60"
                            }`}
                          />
                        )}
                      </div>
                    </MenuItem>
                  </>
                )}
                <MenuItem onClick={onOpenDeviceSwitcher}>
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                    <span className="text-[28px]">Switch Device</span>
                    <DeviceSwitcherIcon
                      aria-hidden="true"
                      className="h-8 w-8 text-white/60"
                    />
                  </div>
                </MenuItem>
              </div>
            </MenuItems>
          </Menu>
        </div>
      </div>
      <div
        className={`fixed -right-1.5 top-[4.5rem] transform transition-opacity duration-300 ${
          !volumeOverlayState.visible
            ? "hidden"
            : volumeOverlayState.animation === "showing"
            ? "opacity-100 volumeInScale"
            : volumeOverlayState.animation === "hiding"
            ? "opacity-0 volumeOutScale"
            : "hidden"
        }`}
      >
        <div className="w-14 h-44 bg-slate-700/60 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden">
          <div
            className="bg-white w-full transition-height duration-300 rounded-b-[13px]"
            style={{ height: `${volume}%` }}
          >
            <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7">
              {VolumeIcon}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NowPlaying;
