import { useCallback, useState, useContext, useRef, useEffect } from "react";
import React from "react";
import { generateRandomString } from "../utils/helpers";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { sendNocturneWsRequest } from "./useNocturned";

export const DeviceSwitcherContext = React.createContext({
  openDeviceSwitcher: (playbackIntent = null) => {},
});

export function useSpotifyPlayerControls(currentPlayback = null) {
  const [volume, setVolumeState] = useState(50);
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false);
  const volumeTimeoutRef = useRef(null);
  const volumeQueueRef = useRef([]);
  const isVolumeProcessingRef = useRef(false);
  const lastVolumeUpdateTimeRef = useRef(0);
  const lastManualVolumeChangeRef = useRef(0);
  const cachedDeviceTypeRef = useRef(null);
  const deviceTypeCacheTimeRef = useRef(0);
  const { openDeviceSwitcher } = useContext(DeviceSwitcherContext);

  const isLocalMedia = currentPlayback?.item?.is_local === true;
  const isPhoneMedia = currentPlayback?.item?.is_phone_media === true;
  const isSmartphoneDevice = currentPlayback?.device?.type === "Smartphone";

  const {
    isSpotifyReady,
    isLoading,
    error,
    playTrack: playTrackWS,
    pausePlayback: pausePlaybackWS,
    skipToNext: skipToNextWS,
    skipToPrevious: skipToPreviousWS,
    seekToPosition: seekToPositionWS,
    setVolume: setVolumeWS,
    toggleShuffle: toggleShuffleWS,
    setRepeatMode: setRepeatModeWS,
    checkIsTrackSaved,
    saveTrack,
    removeTrack,
    transferPlayback,
    getDevices,
    getPlayerState,
    sendSpotifyCommand,
  } = useSpotifyWebSocket();

  useEffect(() => {
    return () => {
      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current);
      }
    };
  }, []);

  const getCachedDeviceType = useCallback(async () => {
    const now = Date.now();
    const cacheAge = now - deviceTypeCacheTimeRef.current;
    const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

    if (cachedDeviceTypeRef.current && cacheAge < CACHE_TTL) {
      return cachedDeviceTypeRef.current;
    }

    try {
      const playerState = await getPlayerState();
      const deviceType = playerState?.device?.type || null;

      cachedDeviceTypeRef.current = deviceType;
      deviceTypeCacheTimeRef.current = now;

      return deviceType;
    } catch (err) {
      console.error("Error fetching device type:", err);
      return cachedDeviceTypeRef.current || null;
    }
  }, [getPlayerState]);

  const updateVolumeFromDevice = useCallback(
    (deviceVolume) => {
      if (isPhoneMedia || isSmartphoneDevice) {
        return;
      }

      const now = Date.now();
      const timeSinceManualChange = now - lastManualVolumeChangeRef.current;

      if (
        !isAdjustingVolume &&
        deviceVolume !== undefined &&
        timeSinceManualChange > 1000
      ) {
        setVolumeState(deviceVolume);
      }
    },
    [isAdjustingVolume, isPhoneMedia, isSmartphoneDevice],
  );

  const playTrack = useCallback(
    async (trackUri, contextUri = null, uris = null, deviceId = null) => {
      if (!isSpotifyReady) return false;

      try {
        const result = await playTrackWS(trackUri, contextUri, uris, deviceId);
        setTimeout(async () => {
          try {
            await getPlayerState();
          } catch (err) {
            console.error(
              "Error fetching player state after play:",
              err.message,
            );
          }
        }, 100);
        return true;
      } catch (err) {
        if (err.message.includes("NO_ACTIVE_DEVICE") && !deviceId) {
          if (openDeviceSwitcher) {
            console.log(
              "No active device, opening device switcher with playback intent.",
            );
            openDeviceSwitcher({
              trackUriToPlay: trackUri,
              contextUriToPlay: contextUri,
              urisToPlay: uris,
            });
          }
        }
        console.error("Error playing track:", err.message);
        return false;
      }
    },
    [isSpotifyReady, playTrackWS, openDeviceSwitcher, getPlayerState],
  );

  const pausePlayback = useCallback(async () => {
    if (!isSpotifyReady) return false;

    try {
      await pausePlaybackWS();
      setTimeout(async () => {
        try {
          await getPlayerState();
        } catch (err) {
          console.error(
            "Error fetching player state after pause:",
            err.message,
          );
        }
      }, 100);
      return true;
    } catch (err) {
      console.error("Error pausing playback:", err.message);
      return false;
    }
  }, [isSpotifyReady, pausePlaybackWS, getPlayerState]);

  const skipToNext = useCallback(async () => {
    if (!isSpotifyReady) return false;

    try {
      await skipToNextWS();
      setTimeout(async () => {
        try {
          await getPlayerState();
        } catch (err) {
          console.error(
            "Error fetching player state after skip next:",
            err.message,
          );
        }
      }, 100);
      return true;
    } catch (err) {
      console.error("Error skipping to next track:", err.message);
      return false;
    }
  }, [isSpotifyReady, skipToNextWS, getPlayerState]);

  const skipToPrevious = useCallback(async () => {
    if (!isSpotifyReady) return false;

    try {
      await skipToPreviousWS();
      setTimeout(async () => {
        try {
          await getPlayerState();
        } catch (err) {
          console.error(
            "Error fetching player state after skip previous:",
            err.message,
          );
        }
      }, 100);
      return true;
    } catch (err) {
      console.error("Error skipping to previous track:", err.message);
      return false;
    }
  }, [isSpotifyReady, skipToPreviousWS, getPlayerState]);

  const seekToPosition = useCallback(
    async (positionMs) => {
      if (!isSpotifyReady) return false;

      try {
        await seekToPositionWS(positionMs);
        return true;
      } catch (err) {
        console.error("Error seeking to position:", err.message);
        return false;
      }
    },
    [isSpotifyReady, seekToPositionWS],
  );

  const processVolumeQueue = useCallback(async () => {
    if (
      isVolumeProcessingRef.current ||
      volumeQueueRef.current.length === 0 ||
      !isSpotifyReady
    ) {
      return;
    }

    isVolumeProcessingRef.current = true;

    const latestVolume = volumeQueueRef.current.pop();
    volumeQueueRef.current = [];

    const now = Date.now();
    const timeSinceLastUpdate = now - lastVolumeUpdateTimeRef.current;
    const minInterval = 100;

    const processRequest = async () => {
      try {
        await setVolumeWS(latestVolume);
        lastVolumeUpdateTimeRef.current = Date.now();
      } catch (err) {
        console.error("Error setting volume:", err.message);
        if (err.message.includes("NO_ACTIVE_DEVICE")) {
          if (openDeviceSwitcher) {
            openDeviceSwitcher();
          }
        }
      } finally {
        const processingDelay = Math.max(0, minInterval - (Date.now() - now));

        volumeTimeoutRef.current = setTimeout(() => {
          isVolumeProcessingRef.current = false;
          if (volumeQueueRef.current.length > 0) {
            processVolumeQueue();
          } else {
            setIsAdjustingVolume(false);
          }
        }, processingDelay);
      }
    };

    if (timeSinceLastUpdate < minInterval) {
      const delay = minInterval - timeSinceLastUpdate;
      setTimeout(processRequest, delay);
    } else {
      await processRequest();
    }
  }, [isSpotifyReady, setVolumeWS, openDeviceSwitcher]);

  const setVolume = useCallback(
    async (volumePercent) => {
      if (!isSpotifyReady) return false;

      const deviceType = await getCachedDeviceType();

      if (deviceType === "Smartphone") {
        return false;
      }

      const boundedVolume = Math.max(
        0,
        Math.min(100, Math.round(volumePercent)),
      );

      if (boundedVolume !== volume) {
        lastManualVolumeChangeRef.current = Date.now();
        setVolumeState(boundedVolume);
        setIsAdjustingVolume(true);

        volumeQueueRef.current.push(boundedVolume);

        if (!isVolumeProcessingRef.current) {
          processVolumeQueue();
        }
      }

      return true;
    },
    [isSpotifyReady, processVolumeQueue, volume, getCachedDeviceType],
  );

  const checkIsTrackLiked = useCallback(
    async (trackId) => {
      if (!isSpotifyReady || !trackId) return false;

      try {
        const result = await checkIsTrackSaved(trackId);
        return result?.results?.[0] === 1;
      } catch (err) {
        console.error("Error checking if track is liked:", err.message);
        return false;
      }
    },
    [isSpotifyReady, checkIsTrackSaved],
  );

  const likeTrack = useCallback(
    async (trackId) => {
      if (!isSpotifyReady || !trackId) return false;

      try {
        await saveTrack(trackId);
        return true;
      } catch (err) {
        console.error("Error liking track:", err.message);
        return false;
      }
    },
    [isSpotifyReady, saveTrack],
  );

  const unlikeTrack = useCallback(
    async (trackId) => {
      if (!isSpotifyReady || !trackId) return false;

      try {
        await removeTrack(trackId);
        return true;
      } catch (err) {
        console.error("Error unliking track:", err.message);
        return false;
      }
    },
    [isSpotifyReady, removeTrack],
  );

  const toggleShuffle = useCallback(
    async (state) => {
      if (!isSpotifyReady) return false;

      try {
        await toggleShuffleWS(state);
        return true;
      } catch (err) {
        console.error("Error toggling shuffle:", err.message);
        return false;
      }
    },
    [isSpotifyReady, toggleShuffleWS],
  );

  const setRepeatMode = useCallback(
    async (state) => {
      if (!isSpotifyReady) return false;

      try {
        await setRepeatModeWS(state);
        return true;
      } catch (err) {
        console.error("Error setting repeat mode:", err.message);
        return false;
      }
    },
    [isSpotifyReady, setRepeatModeWS],
  );

  const playDJMix = useCallback(
    async (deviceId = null) => {
      if (!isSpotifyReady) return false;

      try {
        const params = {};
        if (deviceId) {
          params.device_id = deviceId;
        }
        await sendSpotifyCommand("spotify.dj.start", params);
        return true;
      } catch (err) {
        console.error("Error playing DJ mix:", err);
        return false;
      }
    },
    [isSpotifyReady, sendSpotifyCommand],
  );

  const sendDJSignal = useCallback(
    async (deviceId = null) => {
      if (!isSpotifyReady) return false;

      try {
        const params = {};
        if (deviceId) {
          params.device_id = deviceId;
        }
        await sendSpotifyCommand("spotify.dj.signal", params);
        return true;
      } catch (err) {
        console.error("Error sending DJ signal:", err);
        return false;
      }
    },
    [isSpotifyReady, sendSpotifyCommand],
  );

  const getCurrentDeviceOptions = useCallback(async () => {
    if (!isSpotifyReady) return null;

    try {
      return {
        playback_speed: currentPlayback?.playback_speed || 1,
      };
    } catch (err) {
      console.error("Error getting device options:", err);
      return null;
    }
  }, [isSpotifyReady, currentPlayback]);

  const setPlaybackSpeed = useCallback(
    async (speed) => {
      if (!isSpotifyReady) return false;

      try {
        const playerState = await getPlayerState();
        const deviceId = playerState?.device?.id;

        if (!deviceId) {
          console.error("No active device found for speed change");
          return false;
        }

        await sendSpotifyCommand("spotify.player.speed", {
          speed: speed,
          device_id: deviceId,
        });

        return true;
      } catch (err) {
        console.error("Error setting playback speed:", err);
        return false;
      }
    },
    [isSpotifyReady, sendSpotifyCommand, getPlayerState],
  );

  const sendPhoneMediaControl = useCallback(async (method) => {
    try {
      await sendNocturneWsRequest(method, {});
      return true;
    } catch (err) {
      console.error(`Error sending phone media control (${method}):`, err);
      return false;
    }
  }, []);

  const phoneMediaPlayPause = useCallback(
    () => sendPhoneMediaControl("media.control.playPause"),
    [sendPhoneMediaControl],
  );

  const phoneMediaNext = useCallback(
    () => sendPhoneMediaControl("media.control.next"),
    [sendPhoneMediaControl],
  );

  const phoneMediaPrevious = useCallback(
    () => sendPhoneMediaControl("media.control.previous"),
    [sendPhoneMediaControl],
  );

  const phoneMediaShuffle = useCallback(
    () => sendPhoneMediaControl("media.control.shuffle"),
    [sendPhoneMediaControl],
  );

  const phoneMediaRepeat = useCallback(
    () => sendPhoneMediaControl("media.control.repeat"),
    [sendPhoneMediaControl],
  );

  const phoneMediaVolumeUp = useCallback(
    () => sendPhoneMediaControl("media.control.volumeUp"),
    [sendPhoneMediaControl],
  );

  const phoneMediaVolumeDown = useCallback(
    () => sendPhoneMediaControl("media.control.volumeDown"),
    [sendPhoneMediaControl],
  );

  return {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    setVolume,
    volume,
    isAdjustingVolume,
    updateVolumeFromDevice,
    toggleShuffle,
    setRepeatMode,
    checkIsTrackLiked,
    likeTrack,
    unlikeTrack,
    playDJMix,
    sendDJSignal,
    setPlaybackSpeed,
    getCurrentDeviceOptions,
    isLoading,
    error,
    phoneMediaPlayPause,
    phoneMediaNext,
    phoneMediaPrevious,
    phoneMediaShuffle,
    phoneMediaRepeat,
    phoneMediaVolumeUp,
    phoneMediaVolumeDown,
  };
}
