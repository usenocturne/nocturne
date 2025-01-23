import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { getCurrentDevice } from "@/services/deviceService";
import { getDefaultSettingValue } from "@/components/settings/Settings";

export function useNowPlaying({
  accessToken,
  currentPlayback,
  fetchCurrentPlayback,
  showLyrics,
  handleToggleLyrics,
  handleError,
  showBrightnessOverlay,
  drawerOpen,
  isProgressScrubbing,
}) {
  const router = useRouter();
  const [isLiked, setIsLiked] = useState(false);
  const [volume, setVolume] = useState(null);
  const [isVolumeVisible, setIsVolumeVisible] = useState(false);
  const [startTouchPosition, setStartTouchPosition] = useState({ x: 0, y: 0 });
  const [songChangeGestureEnabled, setSongChangeGestureEnabled] =
    useState(true);
  const [showLyricsGestureEnabled, setShowLyricsGestureEnabled] =
    useState(false);
  const volumeTimeoutRef = useRef(null);
  const volumeSyncIntervalRef = useRef(null);
  const previousTrackId = useRef(null);

  const togglePlayPause = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me/player", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.status === 204 || response.status === 404) {
        const device = await getCurrentDevice(accessToken, handleError);

        if (device) {
          await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              device_ids: [device.id],
              play: true,
            }),
          });
        } else {
          handleError(
            "NO_DEVICES_AVAILABLE",
            "No devices available for playback"
          );
          return;
        }
      } else {
        const endpoint = currentPlayback?.is_playing
          ? "https://api.spotify.com/v1/me/player/pause"
          : "https://api.spotify.com/v1/me/player/play";

        await fetch(endpoint, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }

      fetchCurrentPlayback();
    } catch (error) {
      console.error("Error toggling play/pause:", error);
    }
  };

  const skipToNext = async () => {
    try {
      await fetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      fetchCurrentPlayback();
    } catch (error) {
      console.error("Error skipping to next track:", error);
    }
  };

  const skipToPrevious = async () => {
    try {
      if (currentPlayback && currentPlayback.progress_ms > 3000) {
        await fetch("https://api.spotify.com/v1/me/player/seek?position_ms=0", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } else {
        await fetch("https://api.spotify.com/v1/me/player/previous", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
      fetchCurrentPlayback();
    } catch (error) {
      console.error("Error skipping to previous track:", error);
    }
  };

  const changeVolume = async (newVolume) => {
    if (!accessToken) return;
    try {
      const actualNewVolume = Math.max(0, Math.min(100, newVolume));

      await fetch(
        `https://api.spotify.com/v1/me/player/volume?volume_percent=${actualNewVolume}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      setVolume(actualNewVolume);
      setIsVolumeVisible(true);

      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current);
      }
      volumeTimeoutRef.current = setTimeout(() => {
        setIsVolumeVisible(false);
      }, 2000);
    } catch (error) {
      console.error("Error changing volume:", error);
    }
  };

  const handleWheelScroll = useCallback(
    (event) => {
      if (!isProgressScrubbing && !showBrightnessOverlay && !drawerOpen) {
        if (event.deltaX > 0) {
          changeVolume(volume + 7);
        } else if (event.deltaX < 0) {
          changeVolume(volume - 7);
        }
      }
    },
    [showBrightnessOverlay, drawerOpen, volume, isProgressScrubbing]
  );

  const handleTouchStart = useCallback(
    (event) => {
      const touch = event.touches[0];
      setStartTouchPosition({ x: touch.clientX, y: touch.clientY });
    },
    [startTouchPosition]
  );

  const handleTouchEnd = useCallback(
    (event) => {
      if (!currentPlayback) return;

      const touch = event.changedTouches[0];
      const endPosition = { x: touch.clientX, y: touch.clientY };
      const dx = endPosition.x - startTouchPosition.x;
      const dy = endPosition.y - startTouchPosition.y;

      if (
        songChangeGestureEnabled === "true" &&
        Math.abs(dx) > 30 &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        if (dx > 0) {
          //swipe right
          skipToPrevious();
        } else {
          //swipe left
          skipToNext();
        }
      } else if (
        showLyricsGestureEnabled === "true" &&
        Math.abs(dy) > 18 &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        if (dy < 0 && !showLyrics) {
          handleToggleLyrics();
        }
      }
    },
    [startTouchPosition, currentPlayback, showLyrics]
  );

  const checkIfTrackIsLiked = useCallback(
    async (trackId) => {
      if (!accessToken) return;

      try {
        const response = await fetch(
          `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const likedArray = await response.json();
          setIsLiked(likedArray[0]);
        }
      } catch (error) {
        console.error("Error checking if track is liked:", error);
      }
    },
    [accessToken]
  );

  const toggleLikeTrack = async () => {
    if (!accessToken || !currentPlayback?.item) return;

    const trackId = currentPlayback.item.id;
    const endpoint = isLiked
      ? `https://api.spotify.com/v1/me/tracks?ids=${trackId}`
      : `https://api.spotify.com/v1/me/tracks?ids=${trackId}`;

    const method = isLiked ? "DELETE" : "PUT";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        setIsLiked(!isLiked);
      } else {
        console.error("Error toggling like track:", response.status);
      }
    } catch (error) {
      console.error("Error toggling like track:", error);
    }
  };

  useEffect(() => {
    const songChangeGestureEnabledValue = localStorage.getItem(
      "songChangeGestureEnabled"
    );
    const showLyricsGestureEnabledValue = localStorage.getItem(
      "showLyricsGestureEnabled"
    );

    if (songChangeGestureEnabledValue === null) {
      const songChangeGestureDefaultValue = getDefaultSettingValue("playback", "songChangeGestureEnabled");
      localStorage.setItem("songChangeGestureEnabled", songChangeGestureDefaultValue);
      setSongChangeGestureEnabled(songChangeGestureDefaultValue);
    } else {
      setSongChangeGestureEnabled(songChangeGestureEnabledValue);
    }

    if (showLyricsGestureEnabledValue === null) {
      const showLyricsGestureDefaultValue = getDefaultSettingValue("playback", "showLyricsGestureEnabled");
      localStorage.setItem("showLyricsGestureEnabled", showLyricsGestureDefaultValue);
      setShowLyricsGestureEnabled(showLyricsGestureDefaultValue);
    } else {
      setShowLyricsGestureEnabled(showLyricsGestureEnabledValue);
    }
  }, []);

  useEffect(() => {
    if (currentPlayback && currentPlayback.item) {
      const currentTrackId = currentPlayback.item.id;
      if (currentTrackId !== previousTrackId.current) {
        checkIfTrackIsLiked(currentTrackId);
        previousTrackId.current = currentTrackId;
      }
    }
  }, [currentPlayback, checkIfTrackIsLiked]);

  useEffect(() => {
    const syncVolume = () => {
      if (!currentPlayback?.device?.volume_percent) return;
      setVolume(currentPlayback.device.volume_percent);
    };

    syncVolume();
    volumeSyncIntervalRef.current = setInterval(syncVolume, 5000);

    return () => {
      if (volumeSyncIntervalRef.current) {
        clearInterval(volumeSyncIntervalRef.current);
      }
    };
  }, [currentPlayback?.device?.volume_percent]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        togglePlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePlayPause]);

  useEffect(() => {
    const scrollHandler = (event) => {
      if (!drawerOpen) {
        handleWheelScroll(event);
      }
    };

    window.addEventListener("wheel", scrollHandler);
    return () => {
      window.removeEventListener("wheel", scrollHandler);
    };
  }, [volume, accessToken, drawerOpen, handleWheelScroll]);

  return {
    isLiked,
    volume,
    isVolumeVisible,
    togglePlayPause,
    skipToNext,
    skipToPrevious,
    changeVolume,
    toggleLikeTrack,
    handleWheelScroll,
    handleTouchStart,
    handleTouchEnd,
  };
}
