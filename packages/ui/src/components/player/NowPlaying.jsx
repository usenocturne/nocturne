import React, { useState, useEffect, useRef } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useGradientState } from "../../hooks/useGradientState";
import { useNavigation } from "../../hooks/useNavigation";
import { useLyrics } from "../../hooks/useLyrics";
import { usePlaybackProgress } from "../../hooks/usePlaybackProgress";
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
  DJIcon,
  DeviceSwitcherIcon,
  VolumeLoudIcon,
  VolumeLowIcon,
  VolumeOffIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
} from "../common/icons";

const NowPlaying = ({ accessToken, currentPlayback, onClose, updateGradientColors, onOpenDeviceSwitcher }) => {
  const [isLiked, setIsLiked] = useState(false);
  const [isCheckingLike, setIsCheckingLike] = useState(false);
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false);
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false);
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const volumeIndicatorTimeoutRef = useRef(null);
  const volumeHideTimeoutRef = useRef(null);
  const volumeInteractionTimeoutRef = useRef(null);
  const lastWheelEventRef = useRef(0);
  const wheelDeltaAccumulatorRef = useRef(0);
  const containerRef = useRef(null);
  const currentTrackIdRef = useRef(null);
  const [volumeIndicatorAnimation, setVolumeIndicatorAnimation] = useState("hidden");
  const classNames = (...classes) => classes.filter(Boolean).join(' ');
  const isDJPlaylist =
    currentPlayback?.context?.uri === "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";

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
    updateProgress
  } = usePlaybackProgress(accessToken);

  useEffect(() => {
    if (currentPlayback?.device?.volume_percent !== undefined) {
      updateVolumeFromDevice(currentPlayback.device.volume_percent);
    }
  }, [currentPlayback?.device?.volume_percent, updateVolumeFromDevice]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setShuffleEnabled(currentPlayback.shuffle_state);
    }
    if (currentPlayback?.repeat_state) {
      setRepeatMode(currentPlayback.repeat_state);
    }
  }, [currentPlayback?.shuffle_state, currentPlayback?.repeat_state]);

  const handlePlayPause = async () => {
    if (isPlaying) {
      await pausePlayback();
    } else if (currentPlayback?.item) {
      await playTrack();
    }
  };

  const showVolumeIndicatorWithTimeout = () => {
    if (volumeIndicatorTimeoutRef.current) {
      clearTimeout(volumeIndicatorTimeoutRef.current);
    }
    
    if (volumeHideTimeoutRef.current) {
      clearTimeout(volumeHideTimeoutRef.current);
    }
    
    if (volumeInteractionTimeoutRef.current) {
      clearTimeout(volumeInteractionTimeoutRef.current);
    }
  
    setVolumeIndicatorAnimation("showing");
    setShowVolumeIndicator(true);
    setIsAdjustingVolume(true);
    
    volumeInteractionTimeoutRef.current = setTimeout(() => {
      setIsAdjustingVolume(false);
    }, 500);
    
    if (!isAdjustingVolume) {
      volumeIndicatorTimeoutRef.current = setTimeout(() => {
        setVolumeIndicatorAnimation("hiding");
        
        volumeHideTimeoutRef.current = setTimeout(() => {
          setShowVolumeIndicator(false);
          setVolumeIndicatorAnimation("hidden");
        }, 300);
      }, 1500);
    }
  };

  const handleWheel = (e) => {
    if (isProgressScrubbing) return;
    
    const now = Date.now();
    if (now - lastWheelEventRef.current < 16) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    lastWheelEventRef.current = now;
    
    const primaryDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) / 2 ? e.deltaX : e.deltaY;
    
    e.preventDefault();
    e.stopPropagation();
    
    wheelDeltaAccumulatorRef.current += primaryDelta;
    
    const volumeStep = 5;
    const threshold = 1.2;
    
    if (Math.abs(wheelDeltaAccumulatorRef.current) >= threshold) {
      setIsAdjustingVolume(true);
      
      if (volumeInteractionTimeoutRef.current) {
        clearTimeout(volumeInteractionTimeoutRef.current);
      }
      
      const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
      const newVolume = Math.max(0, Math.min(100, volume + (direction * volumeStep)));
      
      wheelDeltaAccumulatorRef.current = 0;
      
      setVolume(newVolume);
      showVolumeIndicatorWithTimeout();
      
      volumeInteractionTimeoutRef.current = setTimeout(() => {
        setIsAdjustingVolume(false);
      }, 800);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }
    
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel, { capture: true });
      }
      
      if (volumeIndicatorTimeoutRef.current) {
        clearTimeout(volumeIndicatorTimeoutRef.current);
      }
      
      if (volumeHideTimeoutRef.current) {
        clearTimeout(volumeHideTimeoutRef.current);
      }
      
      if (volumeInteractionTimeoutRef.current) {
        clearTimeout(volumeInteractionTimeoutRef.current);
      }
    };
  }, [volume, isProgressScrubbing]);

  useEffect(() => {
    if (showVolumeIndicator && !isAdjustingVolume) {
      const forceHideTimeout = setTimeout(() => {
        setVolumeIndicatorAnimation("hiding");
        
        setTimeout(() => {
          setShowVolumeIndicator(false);
          setVolumeIndicatorAnimation("hidden");
        }, 300);
      }, 1500);
      
      return () => clearTimeout(forceHideTimeout);
    }
  }, [showVolumeIndicator, isAdjustingVolume]);

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

  const handleSkipNext = async () => {
    await skipToNext();
  };

  const handleSkipPrevious = async () => {
    const RESTART_THRESHOLD_MS = 3000;

    if (progressMs > RESTART_THRESHOLD_MS) {
      await seekToPosition(0);
      updateProgress(0);
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
        updateProgress(position);
      }
    } catch (error) {
      console.error("Error seeking:", error);
    }
  };

  const handleScrubbingChange = (scrubbing) => {
    setIsProgressScrubbing(scrubbing);
  };

  const handleToggleShuffle = async () => {
    try {
      const newShuffleState = !shuffleEnabled;
      setShuffleEnabled(newShuffleState);
      
      await toggleShuffle(newShuffleState);
      
      setTimeout(async () => {
        try {
          const response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            setShuffleEnabled(data.shuffle_state);
          }
        } catch (error) {
          console.error("Error refreshing shuffle state:", error);
        }
      }, 1000);
    } catch (error) {
      console.error("Error toggling shuffle:", error);
      setShuffleEnabled(!shuffleEnabled);
    }
  };

  const handleToggleRepeat = async () => {
    try {
      let newRepeatMode;
      switch (repeatMode) {
        case "off":
          newRepeatMode = "context";
          break;
        case "context":
          newRepeatMode = "track";
          break;
        default:
          newRepeatMode = "off";
          break;
      }
      
      setRepeatMode(newRepeatMode);
      
      await setRepeatModeApi(newRepeatMode);
      
      setTimeout(async () => {
        try {
          const response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            setRepeatMode(data.repeat_state);
          }
        } catch (error) {
          console.error("Error refreshing repeat state:", error);
        }
      }, 1000);
    } catch (error) {
      console.error("Error toggling repeat mode:", error);
    }
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
                      className={`text-[40px] font-[580] tracking-tight transition-colors duration-300 ${index === currentLyricIndex
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
        className={`flex justify-between items-center w-full px-12 transition-all duration-200 ease-in-out ${isProgressScrubbing
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
                      className={`h-8 w-8 ${showLyrics ? "text-white" : "text-white/60"
                        }`}
                    />
                  </div>
                </MenuItem>
                <MenuItem onClick={handleToggleShuffle}>
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                    <span className="text-[28px]">
                      {shuffleEnabled ? "Disable Shuffle" : "Enable Shuffle"}
                    </span>
                    <ShuffleIcon
                      aria-hidden="true"
                      className={`h-8 w-8 ${shuffleEnabled ? "text-green-500" : "text-white/60"}`}
                    />
                  </div>
                </MenuItem>
                <MenuItem onClick={handleToggleRepeat}>
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight">
                    <span className="text-[28px]">
                      {repeatMode === "off" ? "Enable Repeat" : repeatMode === "context" ? "Enable Repeat One" : "Disable Repeat"}
                    </span>
                    {repeatMode === "track" ? (
                      <RepeatOneIcon aria-hidden="true" className="h-8 w-8 text-green-500" />
                    ) : (
                      <RepeatIcon 
                        aria-hidden="true" 
                        className={`h-8 w-8 ${repeatMode === "context" ? "text-green-500" : "text-white/60"}`} 
                      />
                    )}
                  </div>
                </MenuItem>
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
          !showVolumeIndicator 
            ? "hidden" 
            : volumeIndicatorAnimation === "showing" 
              ? "opacity-100 volumeInScale" 
              : "opacity-0 volumeOutScale"
        }`}
      >
        <div className="w-14 h-44 bg-slate-700/60 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden">
          <div
            className="bg-white w-full transition-height duration-300 rounded-b-[13px]"
            style={{ height: `${volume}%` }}
          >
            <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7">
              {volume === 0 ? (
                <VolumeOffIcon className="w-7 h-7" />
              ) : volume > 0 && volume <= 60 ? (
                <VolumeLowIcon className="w-7 h-7 ml-1.5" />
              ) : (
                <VolumeLoudIcon className="w-7 h-7" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NowPlaying;