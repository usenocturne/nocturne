import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useNavigation } from "../../hooks/useNavigation";
import { useLyrics } from "../../hooks/useLyrics";
import { useGestureControls } from "../../hooks/useGestureControls";
import { useElapsedTime } from "../../hooks/useElapsedTime";
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
  SpeedIcon,
} from "../common/icons";
import { generateRandomString } from "../../utils/helpers";

export default function NowPlaying({
  accessToken,
  currentPlayback,
  playbackProgress,
  onClose,
  updateGradientColors,
  onOpenDeviceSwitcher,
  onNavigateToArtist,
  onNavigateToAlbum,
}) {
  const [isLiked, setIsLiked] = useState(false);
  const [isCheckingLike, setIsCheckingLike] = useState(false);
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false);
  const [volumeOverlayState, setVolumeOverlayState] = useState({
    visible: false,
    animation: "hidden",
  });
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

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

  const { elapsedTimeEnabled } = useElapsedTime();

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
    setPlaybackSpeed: setPlaybackSpeedApi,
    getCurrentDeviceOptions,
  } = useSpotifyPlayerControls(accessToken);

  const {
    progressMs,
    isPlaying,
    duration,
    progressPercentage,
    updateProgress,
    triggerRefresh,
  } = playbackProgress;

  const convertTimeToLength = (ms, elapsed) => {
    let totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedMinutes = minutes.toString().padStart(2, "0");
    const formattedSeconds = seconds.toString().padStart(2, "0");

    if (hours > 0) {
      return `${
        !elapsed ? "-" : ""
      }${hours}:${formattedMinutes}:${formattedSeconds}`;
    }

    return `${!elapsed ? "-" : ""}${formattedMinutes}:${formattedSeconds}`;
  };

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
      animation: "showing",
    });

    volumeTimerRef.current = setTimeout(() => {
      setVolumeOverlayState((prev) => ({
        ...prev,
        animation: "hiding",
      }));

      setTimeout(() => {
        setVolumeOverlayState({
          visible: false,
          animation: "hidden",
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
      return;
    }

    if (currentPlayback?.item) {
      await playTrack();
      return;
    }

    try {
      if (!accessToken) return;

      const connectEndpoint = `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${generateRandomString(40)}`;

      const devicesRes = await fetch(connectEndpoint, {
        method: "PUT",
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-spotify-connection-id": generateRandomString(148),
        },
        body: JSON.stringify({
          member_type: "CONNECT_STATE",
          device: {
            device_info: {
              capabilities: {
                can_be_player: false,
                hidden: true,
                needs_full_player_state: true,
              },
            },
          },
        }),
      });

      if (!devicesRes.ok) {
        console.error("Failed to retrieve devices", devicesRes.status);
        return;
      }

      const data = await devicesRes.json();
      const devicesArray = Object.values(data.devices || {});

      if (devicesArray.length === 0) return;

      const activeDevice = devicesArray.find((d) => d.is_active);

      if (!activeDevice && devicesArray.length > 1) {
        if (typeof onOpenDeviceSwitcher === "function") {
          onOpenDeviceSwitcher(devicesArray);
        }
        return;
      }

      const target = activeDevice || devicesArray[0];
      const targetDeviceId = target.device_id || target.id;

      const transferRes = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_ids: [targetDeviceId],
          play: true,
        }),
      });

      if (!transferRes.ok && transferRes.status !== 204) {
        console.error("Failed to transfer playback", await transferRes.text());
        return;
      }

      setTimeout(() => {
        if (typeof triggerRefresh === "function") {
          triggerRefresh();
        }
      }, 1000);
    } catch (err) {
      console.error("Error attempting to resume playback:", err);
    }
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

    const firstArtistId =
      currentPlayback?.item?.type === "track" &&
      currentPlayback?.item?.artists?.[0]?.id;

    const albumId = currentPlayback?.item?.album?.id;

    const albumArt = currentPlayback?.item
      ? currentPlayback.item.type === "episode"
        ? currentPlayback.item.show.images[1]?.url || "/images/not-playing.webp"
        : currentPlayback.item.type === "local" ||
            !currentPlayback.item?.album?.images?.[1]?.url ||
            !currentPlayback.item?.album?.images?.[1]
          ? "/images/not-playing.webp"
          : currentPlayback.item.album.images[1].url
      : "/images/not-playing.webp";

    const trackId = currentPlayback?.item?.id;

    return { trackName, artistName, albumArt, trackId, firstArtistId, albumId };
  }, [currentPlayback]);

  const { trackName, artistName, albumArt, trackId, firstArtistId, albumId } =
    trackInfo;

  const handleWheel = useCallback(
    (e) => {
      if (isProgressScrubbing) return;

      const now = Date.now();
      if (now - lastWheelEventRef.current < 50) {
        e.preventDefault();
        return;
      }
      lastWheelEventRef.current = now;

      e.preventDefault();
      e.stopPropagation();

      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelDeltaAccumulatorRef.current += delta;

      if (Math.abs(wheelDeltaAccumulatorRef.current) >= 2) {
        const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
        const newVolume = Math.max(0, Math.min(100, volume + direction * 5));

        wheelDeltaAccumulatorRef.current = 0;

        if (newVolume !== volume) {
          manualVolumeChangeRef.current = true;
          setVolume(newVolume);
        }
      }
    },
    [isProgressScrubbing, volume, setVolume],
  );

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
  }, [
    currentPlayback?.item?.type,
    progressMs,
    duration,
    seekToPosition,
    updateProgress,
    skipToNext,
  ]);

  const handleSkipPrevious = useCallback(async () => {
    const RESTART_THRESHOLD_MS = 3000;
    if (progressMs > RESTART_THRESHOLD_MS) {
      await seekToPosition(0);
      updateProgress(0);
    } else {
      await skipToPrevious();
    }
  }, [
    currentPlayback?.item?.type,
    progressMs,
    seekToPosition,
    updateProgress,
    skipToPrevious,
  ]);

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
    } catch (error) {
      setIsLiked(!isLiked);
      console.error("Error toggling track like:", error);
    }
  }, [
    trackId,
    currentPlayback?.item?.type,
    isCheckingLike,
    isLiked,
    unlikeTrack,
    likeTrack,
  ]);

  const handleScrubbingChange = (scrubbing) => {
    setIsProgressScrubbing(scrubbing);
  };

  const handleSeek = useCallback(
    async (position) => {
      try {
        if (currentPlayback?.item) {
          await seekToPosition(position);
          updateProgress(position);
        }
      } catch (error) {
        console.error("Error seeking:", error);
      }
    },
    [currentPlayback?.item, seekToPosition, updateProgress],
  );

  const handleToggleShuffle = useCallback(async () => {
    try {
      const newShuffleState = !shuffleEnabled;
      setShuffleEnabled(newShuffleState);
      await toggleShuffle(newShuffleState);
    } catch (error) {
      console.error("Error toggling shuffle:", error);
      setShuffleEnabled(!shuffleEnabled);
    }
  }, [shuffleEnabled, toggleShuffle]);

  const handleToggleRepeat = useCallback(async () => {
    try {
      const nextModeMap = { off: "context", context: "track", track: "off" };
      const newRepeatMode = nextModeMap[repeatMode] || "off";

      setRepeatMode(newRepeatMode);
      await setRepeatModeApi(newRepeatMode);
    } catch (error) {
      console.error("Error toggling repeat mode:", error);
    }
  }, [repeatMode, setRepeatModeApi]);

  const fetchCurrentPlaybackSpeed = useCallback(async () => {
    try {
      const options = await getCurrentDeviceOptions();
      if (options && options.playback_speed !== undefined) {
        setPlaybackSpeed(options.playback_speed);
      }
    } catch (error) {
      console.error("Error fetching current playback speed:", error);
    }
  }, [getCurrentDeviceOptions]);

  const handleSpeedChange = async (speed) => {
    setPlaybackSpeed(speed);
    const success = await setPlaybackSpeedApi(speed);
    if (!success) {
      console.error(`Failed to set playback speed to ${speed}x`);
    }
  };

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

  useEffect(() => {
    if (currentPlayback?.is_playing) {
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          triggerRefresh();
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    }
  }, [currentPlayback?.is_playing]);

  const handleBackNavigation = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <div
      className="flex flex-col gap-1 h-screen w-full z-10 fadeIn-animation"
      ref={containerRef}
    >
      <div ref={contentContainerRef}>
        <div className="md:w-1/3 flex flex-row items-center px-12 pt-10">
          <div
            className={`min-w-[280px] mr-8 ${albumId ? "cursor-pointer" : ""}`}
            onClick={() =>
              albumId &&
              onNavigateToAlbum &&
              onNavigateToAlbum(albumId, "album")
            }
          >
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
              <h4
                className={`text-[36px] font-[560] text-white/60 truncate tracking-tight max-w-[380px] ${firstArtistId ? "cursor-pointer" : ""}`}
                onClick={() =>
                  firstArtistId &&
                  onNavigateToArtist &&
                  onNavigateToArtist(firstArtistId, "artist")
                }
              >
                {artistName}
              </h4>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-[280px]">
              <div
                className="flex-1 text-left overflow-y-auto h-[280px] w-[380px] transform-gpu will-change-scroll"
                ref={lyricsContainerRef}
                style={{
                  scrollBehavior: "smooth",
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  perspective: "1000px",
                }}
              >
                {lyricsLoading ? (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300 transform-gpu will-change-auto">
                    Loading lyrics...
                  </p>
                ) : lyricsError ? (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300 transform-gpu will-change-auto">
                    Lyrics not available
                  </p>
                ) : lyrics.length > 0 ? (
                  lyrics.map((lyric, index) => (
                    <p
                      key={index}
                      className={`text-[40px] font-[580] tracking-tight transition-colors duration-300 transform-gpu will-change-auto ${
                        index === currentLyricIndex
                          ? "text-white current-lyric-animation"
                          : index === currentLyricIndex - 1 ||
                              index === currentLyricIndex + 1
                            ? "text-white/40"
                            : "text-white/20"
                      }`}
                      style={{
                        transform: "translateZ(0)",
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                      }}
                    >
                      {lyric.text}
                    </p>
                  ))
                ) : (
                  <p className="text-white text-[40px] font-[580] tracking-tight transition-colors duration-300 transform-gpu will-change-auto">
                    Lyrics not available
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`px-12 ${elapsedTimeEnabled ? "pt-1 pb-1" : "pt-4 pb-7"}`}
      >
        <ProgressBar
          progress={progressPercentage}
          isPlaying={isPlaying}
          durationMs={duration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onScrubbingChange={handleScrubbingChange}
          updateProgress={updateProgress}
        />
      </div>

      {elapsedTimeEnabled && (
        <div
          className={`w-full px-12 pb-1.5 pt-1.5 -mb-1.5 overflow-hidden transition-all duration-200 ease-in-out ${
            isProgressScrubbing
              ? "translate-y-24 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          <div className="flex justify-between">
            {currentPlayback && currentPlayback.item ? (
              <>
                <span className="text-white/60 text-[20px]">
                  {convertTimeToLength(progressMs, true)}
                </span>
                <span className="text-white/60 text-[20px]">
                  {convertTimeToLength(currentPlayback.item.duration_ms, true)}
                </span>
              </>
            ) : (
              <>
                <span className="text-white/60 text-[20px]">--:--</span>
                <span className="text-white/60 text-[20px]">--:--</span>
              </>
            )}
          </div>
        </div>
      )}

      <div
        className={`flex justify-between items-center w-full px-12 mt-1 transition-all duration-200 ease-in-out ${
          isProgressScrubbing
            ? "translate-y-24 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        {currentPlayback?.item?.type === "episode" ? (
          <Menu as="div" className="relative inline-block text-left">
            {({ open }) => (
              <>
                <MenuButton
                  className="focus:outline-none outline-none border-none bg-transparent appearance-none"
                  onClick={() => {
                    if (!open) {
                      fetchCurrentPlaybackSpeed();
                    }
                  }}
                  style={{
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    boxShadow: "none",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <SpeedIcon className="w-14 h-14 fill-white/60" />
                </MenuButton>

                <MenuItems
                  transition
                  className="absolute left-0 bottom-full z-10 mb-2 w-[16rem] origin-bottom-left divide-y divide-slate-100/25 bg-[#161616] rounded-[13px] shadow-xl transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
                >
                  <div className="py-1">
                    {[0.5, 0.8, 1, 1.2, 1.5, 2].map((speed) => (
                      <MenuItem
                        key={speed}
                        onClick={() => handleSpeedChange(speed)}
                      >
                        <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
                          <span className="text-[24px]">{speed}x</span>
                          {playbackSpeed === speed && (
                            <div className="w-2 h-2 bg-white rounded-full"></div>
                          )}
                        </div>
                      </MenuItem>
                    ))}
                  </div>
                </MenuItems>
              </>
            )}
          </Menu>
        ) : (
          <div
            className="flex-shrink-0 focus:outline-none outline-none border-none bg-transparent appearance-none"
            onClick={handleToggleLike}
            style={{
              WebkitAppearance: "none",
              MozAppearance: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {isLiked ? (
              <HeartIconFilled className="w-14 h-14" />
            ) : (
              <HeartIcon className="w-14 h-14" />
            )}
          </div>
        )}

        <div className="flex justify-center items-center flex-1">
          <div
            onClick={handleSkipPrevious}
            className="mx-6 focus:outline-none outline-none border-none bg-transparent appearance-none"
            style={{
              WebkitAppearance: "none",
              MozAppearance: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <BackIcon className="w-14 h-14" />
          </div>
          <div
            onClick={handlePlayPause}
            className="transition-opacity duration-100 mx-6 focus:outline-none outline-none border-none bg-transparent appearance-none"
            style={{
              WebkitAppearance: "none",
              MozAppearance: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {PlayPauseIcon}
          </div>
          <div
            onClick={handleSkipNext}
            className="mx-6 focus:outline-none outline-none border-none bg-transparent appearance-none"
            style={{
              WebkitAppearance: "none",
              MozAppearance: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <ForwardIcon className="w-14 h-14" />
          </div>
        </div>

        <div className="flex items-center">
          {isDJPlaylist && (
            <div
              onClick={sendDJSignal}
              className="focus:outline-none outline-none border-none bg-transparent appearance-none"
              style={{
                WebkitAppearance: "none",
                MozAppearance: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <DJIcon className="w-14 h-14 fill-white/60 mr-4 mb-1" />
            </div>
          )}
          <Menu as="div" className="relative inline-block text-left">
            <MenuButton
              className="focus:outline-none outline-none border-none bg-transparent appearance-none"
              style={{
                WebkitAppearance: "none",
                MozAppearance: "none",
                boxShadow: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <MenuIcon className="w-14 h-14 fill-white/60" />
            </MenuButton>

            <MenuItems
              transition
              className="absolute right-0 bottom-full z-10 mb-2 w-[22rem] origin-bottom-right divide-y divide-slate-100/25 bg-[#161616] rounded-[13px] shadow-xl transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
            >
              <div className="py-1">
                <MenuItem onClick={toggleLyrics}>
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
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
                      <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
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
                      <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
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
                  <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
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
        className={`fixed top-[4.5rem] transform transition-opacity duration-300 ${
          !volumeOverlayState.visible
            ? "hidden"
            : volumeOverlayState.animation === "showing"
              ? "opacity-100 volumeInScale"
              : volumeOverlayState.animation === "hiding"
                ? "opacity-0 volumeOutScale"
                : "hidden"
        }`}
        style={{
          right: "-6px",
          zIndex: 50,
        }}
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
}
