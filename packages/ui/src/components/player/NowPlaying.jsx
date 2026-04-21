import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";
import { subscribeToPhoneVolume } from "../../hooks/useSpotifyPlayerState";
import { useNavigation } from "../../hooks/useNavigation";
import { useLyrics } from "../../hooks/useLyrics";
import { useGestureControls } from "../../hooks/useGestureControls";
import { useElapsedTime } from "../../hooks/useElapsedTime";
import { useButtonMapping } from "../../hooks/useButtonMapping";
import { useSettings } from "../../contexts/SettingsContext";
import ButtonMappingOverlay from "../common/overlays/ButtonMappingOverlay";
import DeviceSwitcherModal from "./DeviceSwitcherModal";
import VolumeOverlay from "./VolumeOverlay";
import PlaybackTimeLabel from "./PlaybackTimeLabel";
import { getProgressSnapshot } from "../../hooks/usePlaybackProgress";
import ProgressBar from "./ProgressBar";
import ScrollingText from "../common/ScrollingText";
import SpotifyImage from "../common/SpotifyImage";
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

function NowPlaying({
  currentPlayback,
  playbackProgress,
  onClose,
  updateGradientColors,
  onOpenDeviceSwitcher,
  onNavigateToArtist,
  onNavigateToAlbum,
  setIgnoreNextRelease,
  isReceivingNowPlayingUpdates = false,
}) {
  const [isLiked, setIsLiked] = useState(false);
  const [isCheckingLike, setIsCheckingLike] = useState(false);
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false);
  const [volumeOverlayState, setVolumeOverlayState] = useState({
    visible: false,
    animation: "hidden",
  });
  const [suppressFillTransition, setSuppressFillTransition] = useState(false);
  const [phoneVolume, setPhoneVolume] = useState(null);
  const [phoneMediaVolumeDirection, setPhoneMediaVolumeDirection] =
    useState(null);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);
  const [showDeviceSwitcher, setShowDeviceSwitcher] = useState(false);

  const volumeTimerRef = useRef(null);
  const volumeLastAdjustedRef = useRef(0);
  const lastWheelEventRef = useRef(0);
  const wheelDeltaAccumulatorRef = useRef(0);
  const containerRef = useRef(null);
  const currentTrackIdRef = useRef(null);
  const prevVolumeRef = useRef(null);
  const manualVolumeChangeRef = useRef(false);
  const phoneVolumeTimeoutRef = useRef(null);

  const isDJPlaylist =
    currentPlayback?.context?.uri === "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";
  const isPodcast = currentPlayback?.item?.type === "episode";
  const isDJTrack = currentPlayback?.item?.album?.images?.[0]?.url?.includes(
    "/images/radio-cover/dj.webp",
  );
  const isLocalMedia = currentPlayback?.item?.is_local === true;
  const isPhoneMedia = currentPlayback?.item?.is_phone_media === true;
  const isSpotifyPending = currentPlayback?.item?.is_spotify_pending === true;
  const isSmartphoneDevice =
    currentPlayback?.device?.type?.toUpperCase() === "SMARTPHONE";
  const contentContainerRef = useRef(null);

  const { elapsedTimeEnabled } = useElapsedTime();
  const { settings } = useSettings();

  const { getPlaylist } = useSpotifyWebSocket();

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
    adjustVolumeByDelta,
    volume,
    updateVolumeFromDevice,
    toggleShuffle,
    setRepeatMode: setRepeatModeApi,
    setPlaybackSpeed: setPlaybackSpeedApi,
    getCurrentDeviceOptions,
    transferPlayback,
    phoneMediaPlay,
    phoneMediaPause,
    phoneMediaNext,
    phoneMediaPrevious,
    phoneMediaShuffle,
    phoneMediaRepeat,
    phoneMediaVolumeUp,
    phoneMediaVolumeDown,
  } = useSpotifyPlayerControls(currentPlayback);

  const { isPlaying, duration, updateProgress, triggerRefresh } =
    playbackProgress;

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

  useLayoutEffect(() => {
    if (volumeOverlayState.visible) {
      setSuppressFillTransition(true);
      const raf = requestAnimationFrame(() => {
        setSuppressFillTransition(false);
      });
      return () => cancelAnimationFrame(raf);
    }
    setSuppressFillTransition(false);
  }, [volumeOverlayState.visible]);

  useEffect(() => {
    const unsubscribe = subscribeToPhoneVolume((volumePercent) => {
      if (isPhoneMedia || isSmartphoneDevice) {
        setPhoneVolume(volumePercent);
        setPhoneMediaVolumeDirection(null);
        manualVolumeChangeRef.current = true;
        showVolumeOverlay();

        if (phoneVolumeTimeoutRef.current) {
          clearTimeout(phoneVolumeTimeoutRef.current);
          phoneVolumeTimeoutRef.current = null;
        }
      }
    });

    return () => {
      unsubscribe();
      if (volumeTimerRef.current) {
        clearTimeout(volumeTimerRef.current);
      }
      if (phoneVolumeTimeoutRef.current) {
        clearTimeout(phoneVolumeTimeoutRef.current);
      }
    };
  }, [isPhoneMedia, isSmartphoneDevice, showVolumeOverlay]);

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

  useEffect(() => {
    if (isStartingPlayback && currentPlayback?.item) {
      setIsStartingPlayback(false);
    }
  }, [isStartingPlayback, currentPlayback?.item]);

  const handlePlayPause = async () => {
    if (isPhoneMedia) {
      if (currentPlayback?.is_playing) {
        await phoneMediaPause();
      } else {
        await phoneMediaPlay();
      }
      return;
    }

    if (currentPlayback?.is_playing) {
      await pausePlayback();
      return;
    }

    if (currentPlayback?.item) {
      await playTrack();
      return;
    }

    try {
      setIsStartingPlayback(true);

      const connectEndpoint = `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${generateRandomString(40)}`;

      const devicesData = await getDevices();
      const devicesArray = devicesData?.devices || [];

      if (devicesArray.length === 0) {
        setIsStartingPlayback(false);
        return;
      }

      const activeDevice = devicesArray.find((d) => d.is_active);

      if (!activeDevice && devicesArray.length > 1) {
        if (typeof onOpenDeviceSwitcher === "function") {
          onOpenDeviceSwitcher(devicesArray);
        }
        setIsStartingPlayback(false);
        return;
      }

      const target = activeDevice || devicesArray[0];
      const targetDeviceId = target.device_id || target.id;

      try {
        await transferPlayback(targetDeviceId, true);
      } catch (error) {
        console.error("Failed to transfer playback", error);
        setIsStartingPlayback(false);
        return;
      }

      setTimeout(() => {
        if (typeof triggerRefresh === "function") {
          triggerRefresh();
        }
        setIsStartingPlayback(false);
      }, 2000);
    } catch (err) {
      console.error("Error attempting to resume playback:", err);
      if (err.message?.includes("No playback devices available")) {
        if (typeof onOpenDeviceSwitcher === "function") {
          onOpenDeviceSwitcher([]);
        }
      }
      setIsStartingPlayback(false);
    }
  };

  const trackInfo = useMemo(() => {
    const hasCurrentItem = currentPlayback?.item && !isStartingPlayback;

    const trackName = hasCurrentItem
      ? currentPlayback.item.type === "episode"
        ? currentPlayback.item.name
        : currentPlayback.item.name || "Not Playing"
      : "Not Playing";

    const artistName = hasCurrentItem
      ? currentPlayback.item.type === "episode"
        ? currentPlayback.item.show?.publisher ||
          currentPlayback.item.show?.name ||
          ""
        : currentPlayback.item.artists
            ?.map((artist) => artist.name)
            .join(", ") || ""
      : "";

    const firstArtistId =
      hasCurrentItem && currentPlayback?.item?.type === "track"
        ? currentPlayback?.item?.artists?.[0]?.id
        : null;

    const albumId = hasCurrentItem ? currentPlayback?.item?.album?.id : null;

    const albumImages = hasCurrentItem
      ? currentPlayback.item.type === "episode"
        ? currentPlayback.item.images ||
          currentPlayback.item.show?.images ||
          null
        : currentPlayback.item.album?.images || null
      : null;

    const trackId = hasCurrentItem ? currentPlayback?.item?.id : null;

    return {
      trackName,
      artistName,
      albumImages,
      trackId,
      firstArtistId,
      albumId,
    };
  }, [currentPlayback, isStartingPlayback]);

  const {
    trackName,
    artistName,
    albumImages,
    trackId,
    firstArtistId,
    albumId,
  } = trackInfo;

  const contextUri = currentPlayback?.context?.uri;
  const playlistId = useMemo(() => {
    if (contextUri && contextUri.startsWith("spotify:playlist:")) {
      const parts = contextUri.split(":");
      return parts[2] || null;
    }
    return null;
  }, [contextUri]);

  const [playlistDetails, setPlaylistDetails] = useState({
    name: "",
    image: "",
  });

  useEffect(() => {
    const fetchPlaylistDetails = async () => {
      if (!playlistId) {
        setPlaylistDetails({ name: "", image: "" });
        return;
      }
      try {
        const data = await getPlaylist(playlistId, "id,name,images");
        setPlaylistDetails({
          name: data.name || "",
          image: data.images?.[1]?.url || data.images?.[0]?.url || "",
        });
      } catch (err) {
        console.error("Failed to fetch playlist details", err);
        setPlaylistDetails({ name: "", image: "" });
      }
    };

    fetchPlaylistDetails();
  }, [playlistId, getPlaylist]);

  const { showMappingOverlay, activeButton } = useButtonMapping({
    contentId: playlistId,
    contentType: playlistId ? "playlist" : null,
    contentImage: playlistId
      ? playlistDetails.image
      : albumImages?.[1]?.url ||
        albumImages?.[0]?.url ||
        "/images/not-playing.webp",
    contentName: playlistId ? playlistDetails.name : trackName,
    playTrack,
    isActive: !!playlistId && !isLocalMedia && !isPhoneMedia,
    setIgnoreNextRelease,
  });

  const handleWheel = useCallback(
    (e) => {
      if (
        settings.knobSeeksPlaybackEnabled &&
        !isPhoneMedia &&
        !isSpotifyPending
      ) {
        return;
      }

      if (isProgressScrubbing) return;

      e.preventDefault();
      e.stopPropagation();

      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelDeltaAccumulatorRef.current += delta;

      const now = Date.now();
      if (now - lastWheelEventRef.current < 50) {
        return;
      }
      lastWheelEventRef.current = now;

      if (Math.abs(wheelDeltaAccumulatorRef.current) >= 2) {
        const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
        wheelDeltaAccumulatorRef.current = 0;

        if (isPhoneMedia || isSmartphoneDevice) {
          manualVolumeChangeRef.current = true;
          setPhoneMediaVolumeDirection(direction > 0 ? "up" : "down");
          showVolumeOverlay();

          if (direction > 0) {
            phoneMediaVolumeUp();
          } else {
            phoneMediaVolumeDown();
          }
        } else {
          manualVolumeChangeRef.current = true;
          adjustVolumeByDelta(direction * 5);
        }
      }
    },
    [
      isProgressScrubbing,
      adjustVolumeByDelta,
      isPhoneMedia,
      isSmartphoneDevice,
      phoneMediaVolumeUp,
      phoneMediaVolumeDown,
      showVolumeOverlay,
      settings.knobSeeksPlaybackEnabled,
      isSpotifyPending,
    ],
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

  const {
    showLyrics,
    lyrics,
    hasLyrics,
    currentLyricIndex,
    isLoading: lyricsLoading,
    error: lyricsError,
    lyricsContainerRef,
    toggleLyrics,
    suspendAutoScroll,
    resumeAutoScrollOnNextLyric,
    scrollToTop,
    isTimeSynced,
  } = useLyrics(currentPlayback);

  const handleColorsExtracted = useCallback(
    (colors) => {
      if (colors && updateGradientColors) {
        updateGradientColors(colors, "nowPlaying");
      }
    },
    [updateGradientColors],
  );

  const handleSkipNext = useCallback(async () => {
    if (isPhoneMedia) {
      await phoneMediaNext();
    } else {
      await skipToNext();
    }
  }, [isPhoneMedia, phoneMediaNext, skipToNext]);

  const handleSkipPrevious = useCallback(async () => {
    if (isPhoneMedia) {
      await phoneMediaPrevious();
      return;
    }

    const RESTART_THRESHOLD_MS = 3000;
    const currentProgressMs = getProgressSnapshot().progressMs ?? 0;
    if (currentProgressMs > RESTART_THRESHOLD_MS) {
      await seekToPosition(0);
      updateProgress(0);
      if (showLyrics) scrollToTop();
    } else {
      await skipToPrevious();
    }
  }, [
    isPhoneMedia,
    phoneMediaPrevious,
    currentPlayback?.item?.type,
    seekToPosition,
    updateProgress,
    skipToPrevious,
    showLyrics,
    scrollToTop,
  ]);

  const handleSwipeLeft = useCallback(() => {
    handleSkipNext();
  }, [handleSkipNext]);

  const handleSwipeRight = useCallback(() => {
    handleSkipPrevious();
  }, [handleSkipPrevious]);

  const handleSwipeUp = useCallback(() => {
    if (!isPodcast && !isPhoneMedia && !showLyrics) {
      toggleLyrics();
    }
  }, [isPodcast, isPhoneMedia, showLyrics, toggleLyrics]);

  const handleSwipeDown = useCallback(() => {
    if (!isPodcast && !isPhoneMedia && showLyrics) {
      toggleLyrics();
    }
  }, [isPodcast, isPhoneMedia, showLyrics, toggleLyrics]);

  useGestureControls({
    contentRef: contentContainerRef,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onSwipeUp: handleSwipeUp,
    onSwipeDown: handleSwipeDown,
    isActive: true,
  });

  useEffect(() => {
    if (isLocalMedia || isPhoneMedia) {
      setIsLiked(false);
      currentTrackIdRef.current = null;
      return;
    }

    const checkCurrentTrackLiked = async () => {
      if (trackId && !isCheckingLike) {
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
      } else if (!trackId) {
        setIsLiked(false);
        currentTrackIdRef.current = null;
      }
    };

    checkCurrentTrackLiked();
  }, [trackId, isCheckingLike, checkIsTrackLiked, isLocalMedia, isPhoneMedia]);

  useEffect(() => {
    if (!isPhoneMedia && !isSmartphoneDevice) {
      setPhoneVolume(null);
      setPhoneMediaVolumeDirection(null);
    }
  }, [isPhoneMedia, isSmartphoneDevice, trackId]);

  useEffect(() => {
    if (isPhoneMedia && showLyrics) {
      toggleLyrics();
    }
  }, [isPhoneMedia, showLyrics, toggleLyrics]);

  const handleToggleLike = useCallback(async () => {
    if (!trackId || isCheckingLike) return;

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
  }, [trackId, isCheckingLike, isLiked, unlikeTrack, likeTrack]);

  const handleScrubbingChange = (scrubbing) => {
    setIsProgressScrubbing(scrubbing);
  };

  const handleSeek = useCallback(
    async (position) => {
      if (isPhoneMedia) {
        return;
      }

      try {
        if (currentPlayback?.item) {
          await seekToPosition(position);
          updateProgress(position);
        }
      } catch (error) {
        console.error("Error seeking:", error);
      }
    },
    [isPhoneMedia, currentPlayback?.item, seekToPosition, updateProgress],
  );

  const handleLyricClick = useCallback(
    (lyricTimeSeconds, lyricIndex) => {
      if (typeof suspendAutoScroll === "function") suspendAutoScroll(5000);
      if (typeof resumeAutoScrollOnNextLyric === "function")
        resumeAutoScrollOnNextLyric();

      if (lyricsContainerRef.current && lyricIndex >= 0) {
        const container = lyricsContainerRef.current;
        const lyricElements = container.children;
        if (lyricElements[lyricIndex]) {
          const lyricElement = lyricElements[lyricIndex];
          const containerHeight = container.clientHeight;
          const lyricTop = lyricElement.offsetTop;
          const lyricHeight = lyricElement.offsetHeight;

          const scrollTo = lyricTop - containerHeight / 2 + lyricHeight / 2;
          container.scrollTo({
            top: scrollTo,
            behavior: "smooth",
          });
        }
      }

      const targetMs = Math.max(0, Math.floor(lyricTimeSeconds * 1000));
      handleSeek(targetMs);
    },
    [
      handleSeek,
      suspendAutoScroll,
      resumeAutoScrollOnNextLyric,
      lyricsContainerRef,
    ],
  );

  const handleToggleShuffle = useCallback(async () => {
    try {
      if (isPhoneMedia) {
        await phoneMediaShuffle();
      } else {
        const newShuffleState = !shuffleEnabled;
        setShuffleEnabled(newShuffleState);
        await toggleShuffle(newShuffleState);
      }
    } catch (error) {
      console.error("Error toggling shuffle:", error);
      if (!isPhoneMedia) {
        setShuffleEnabled(!shuffleEnabled);
      }
    }
  }, [isPhoneMedia, phoneMediaShuffle, shuffleEnabled, toggleShuffle]);

  const handleToggleRepeat = useCallback(async () => {
    try {
      if (isPhoneMedia) {
        await phoneMediaRepeat();
      } else {
        const nextModeMap = { off: "context", context: "track", track: "off" };
        const newRepeatMode = nextModeMap[repeatMode] || "off";

        setRepeatMode(newRepeatMode);
        await setRepeatModeApi(newRepeatMode);
      }
    } catch (error) {
      console.error("Error toggling repeat mode:", error);
    }
  }, [isPhoneMedia, phoneMediaRepeat, repeatMode, setRepeatModeApi]);

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

  const handleDeviceSwitcherClose = (selectedDeviceId) => {
    setShowDeviceSwitcher(false);
    if (selectedDeviceId) {
      console.log("Device switched to:", selectedDeviceId);
    }
  };

  const displayVolume = useMemo(() => {
    if (isPhoneMedia || isSmartphoneDevice) {
      return phoneVolume !== null ? phoneVolume : 100;
    }
    return volume;
  }, [isPhoneMedia, isSmartphoneDevice, phoneVolume, volume]);

  const VolumeIcon = useMemo(() => {
    if (
      (isPhoneMedia || isSmartphoneDevice) &&
      phoneVolume === null &&
      phoneMediaVolumeDirection
    ) {
      if (phoneMediaVolumeDirection === "up") {
        return (
          <svg
            className="w-12 h-12"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{
              animation: "bounce 0.6s ease-in-out infinite",
            }}
          >
            <path d="M7 14l5-5 5 5z" />
          </svg>
        );
      } else {
        return (
          <svg
            className="w-12 h-12"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{
              animation: "bounce 0.6s ease-in-out infinite",
            }}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        );
      }
    }

    const volumeToCheck =
      (isPhoneMedia || isSmartphoneDevice) && phoneVolume !== null
        ? phoneVolume
        : volume;

    if (volumeToCheck === 0) {
      return <VolumeOffIcon className="w-7 h-7" />;
    } else if (volumeToCheck > 0 && volumeToCheck <= 60) {
      return <VolumeLowIcon className="w-7 h-7 ml-1.5" />;
    } else {
      return <VolumeLoudIcon className="w-7 h-7" />;
    }
  }, [
    volume,
    isPhoneMedia,
    isSmartphoneDevice,
    phoneVolume,
    phoneMediaVolumeDirection,
  ]);

  const PlayPauseIcon = useMemo(() => {
    return currentPlayback?.is_playing ? (
      <PauseIcon className="w-14 h-14" />
    ) : (
      <PlayIcon className="w-14 h-14" />
    );
  }, [currentPlayback?.is_playing]);

  useEffect(() => {
    if (currentPlayback?.is_playing && !isPhoneMedia) {
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
  }, [currentPlayback?.is_playing, isPhoneMedia, triggerRefresh]);

  const handleBackNavigation = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleArtistClick = useCallback(() => {
    if (!isLocalMedia && !isPhoneMedia && firstArtistId && onNavigateToArtist) {
      onNavigateToArtist(firstArtistId, "artist");
    }
  }, [isLocalMedia, isPhoneMedia, firstArtistId, onNavigateToArtist]);

  const handleAlbumClick = useCallback(() => {
    if (!isLocalMedia && !isPhoneMedia && albumId && onNavigateToAlbum) {
      onNavigateToAlbum(albumId, "album");
    }
  }, [isLocalMedia, isPhoneMedia, albumId, onNavigateToAlbum]);

  return (
    <div
      className="flex flex-col gap-1 h-screen w-full z-10 fadeIn-animation"
      ref={containerRef}
    >
      <div ref={contentContainerRef}>
        <div className="md:w-1/3 flex flex-row items-center px-12 pt-10">
          <div
            className={`min-w-[280px] h-[280px] mr-8 ${albumId && !isLocalMedia && !isPhoneMedia ? "cursor-pointer" : ""}`}
            onClick={handleAlbumClick}
          >
            <SpotifyImage
              images={albumImages}
              preferredSizeIndex={1}
              alt={
                currentPlayback?.item?.type === "episode"
                  ? "Podcast Cover"
                  : "Album Art"
              }
              width={280}
              height={280}
              priority={100}
              extractColors={true}
              onColorsExtracted={handleColorsExtracted}
              fallbackSrc="/images/not-playing.webp"
              useDirectUrl={
                albumImages?.[0]?.url?.includes("/images/not-playing.webp") ||
                albumImages?.[0]?.url?.startsWith("blob:")
              }
              skipFetchWhenNowPlaying={true}
              isReceivingNowPlayingUpdates={isReceivingNowPlayingUpdates}
              disableSpotifyFetch={isPhoneMedia || isSpotifyPending}
              className="w-[280px] h-[280px] object-cover rounded-[12px] drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
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
                className={`text-[36px] font-[560] text-white/60 truncate tracking-tight max-w-[380px] ${firstArtistId && !isLocalMedia && !isPhoneMedia ? "cursor-pointer" : ""}`}
                onClick={handleArtistClick}
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
                        isTimeSynced
                          ? index === currentLyricIndex
                            ? "text-white current-lyric-animation"
                            : index === currentLyricIndex - 1 ||
                                index === currentLyricIndex + 1
                              ? "text-white/40"
                              : "text-white/20"
                          : "text-white/80"
                      } ${isTimeSynced ? "cursor-pointer" : ""} select-none`}
                      style={{
                        transform: "translateZ(0)",
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                        WebkitTapHighlightColor: "transparent",
                        outline: "none",
                        boxShadow: "none",
                      }}
                      onClick={
                        isTimeSynced
                          ? () =>
                              handleLyricClick(
                                parseInt(lyric.startTimeMs) / 1000,
                                index,
                              )
                          : undefined
                      }
                      role={isTimeSynced ? "button" : undefined}
                      tabIndex={isTimeSynced ? 0 : undefined}
                      onKeyDown={
                        isTimeSynced
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleLyricClick(
                                  parseInt(lyric.startTimeMs) / 1000,
                                  index,
                                );
                              }
                            }
                          : undefined
                      }
                    >
                      {lyric.words}
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
        style={{
          visibility: isPhoneMedia && !isSpotifyPending ? "hidden" : "visible",
        }}
        aria-hidden={isPhoneMedia && !isSpotifyPending}
      >
        <ProgressBar
          progress={
            isSpotifyPending
              ? null
              : currentPlayback?.item && !isStartingPlayback
                ? 1
                : 0
          }
          isPlaying={isPlaying && !isStartingPlayback}
          durationMs={duration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onScrubbingChange={handleScrubbingChange}
          updateProgress={updateProgress}
          disabled={isPhoneMedia || isSpotifyPending}
          scrubOnWheel={
            settings.knobSeeksPlaybackEnabled &&
            !isPhoneMedia &&
            !isSpotifyPending
          }
        />
      </div>

      {elapsedTimeEnabled && (
        <div
          className={`w-full px-12 pb-1.5 pt-1.5 -mb-1.5 overflow-hidden transition-all duration-200 ease-in-out ${
            isProgressScrubbing
              ? "translate-y-24 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
          style={{
            visibility:
              isPhoneMedia && !isSpotifyPending ? "hidden" : "visible",
          }}
          aria-hidden={isPhoneMedia && !isSpotifyPending}
        >
          <div className="flex justify-between">
            {currentPlayback && currentPlayback.item ? (
              <>
                <span className="text-white/60 text-[20px]">
                  <PlaybackTimeLabel
                    isSpotifyPending={isSpotifyPending}
                    isElapsed={true}
                  />
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
        ) : isLocalMedia || isPhoneMedia ? (
          <div className="w-14 h-14"></div>
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
              onClick={() => sendDJSignal(currentPlayback?.device?.id)}
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
                {!isPodcast && !isLocalMedia && !isPhoneMedia && (
                  <MenuItem onClick={toggleLyrics} disabled={!currentPlayback}>
                    <div
                      className={`group flex items-center justify-between px-4 py-[16px] text-sm ${currentPlayback ? "text-white" : "text-white/50"} font-[560] tracking-tight focus:outline-none outline-none`}
                    >
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
                )}
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
                {!isLocalMedia && !isPhoneMedia && (
                  <MenuItem onClick={() => setShowDeviceSwitcher(true)}>
                    <div className="group flex items-center justify-between px-4 py-[16px] text-sm text-white font-[560] tracking-tight focus:outline-none outline-none">
                      <span className="text-[28px]">Switch Device</span>
                      <DeviceSwitcherIcon
                        aria-hidden="true"
                        className="h-8 w-8 text-white/60"
                      />
                    </div>
                  </MenuItem>
                )}
              </div>
            </MenuItems>
          </Menu>
        </div>
      </div>
      <VolumeOverlay
        visible={volumeOverlayState.visible}
        animation={volumeOverlayState.animation}
        displayVolume={displayVolume}
        suppressFillTransition={suppressFillTransition}
        volumeIcon={VolumeIcon}
      />

      <ButtonMappingOverlay
        show={showMappingOverlay}
        activeButton={activeButton}
      />

      <DeviceSwitcherModal
        isOpen={showDeviceSwitcher}
        onClose={handleDeviceSwitcherClose}
        initialDevices={[]}
      />
    </div>
  );
}

const areNowPlayingPropsEqual = (prev, next) => {
  const keys = Object.keys(next);
  for (const key of keys) {
    if (key === "playbackProgress") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  const pp = prev.playbackProgress || {};
  const np = next.playbackProgress || {};
  return (
    pp.isPlaying === np.isPlaying &&
    pp.duration === np.duration &&
    pp.trackId === np.trackId &&
    pp.updateProgress === np.updateProgress &&
    pp.triggerRefresh === np.triggerRefresh
  );
};

export default React.memo(NowPlaying, areNowPlayingPropsEqual);
