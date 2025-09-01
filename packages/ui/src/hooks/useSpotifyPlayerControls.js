import { useCallback, useState, useContext, useRef, useEffect } from "react";
import React from "react";
import { generateRandomString } from "../utils/helpers";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";

export const DeviceSwitcherContext = React.createContext({
  openDeviceSwitcher: (playbackIntent = null) => {},
});

export function useSpotifyPlayerControls() {
  const [volume, setVolumeState] = useState(50);
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false);
  const volumeTimeoutRef = useRef(null);
  const volumeQueueRef = useRef([]);
  const isVolumeProcessingRef = useRef(false);
  const lastVolumeUpdateTimeRef = useRef(0);
  const { openDeviceSwitcher } = useContext(DeviceSwitcherContext);
  const {
    wsConnected,
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
  } = useSpotifyWebSocket();

  useEffect(() => {
    return () => {
      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current);
      }
    };
  }, []);

  const updateVolumeFromDevice = useCallback(
    (deviceVolume) => {
      if (!isAdjustingVolume && deviceVolume !== undefined) {
        setVolumeState(deviceVolume);
      }
    },
    [isAdjustingVolume],
  );

  const playTrack = useCallback(
    async (trackUri, contextUri = null, uris = null, deviceId = null) => {
      if (!wsConnected) return false;

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
    [wsConnected, playTrackWS, openDeviceSwitcher, getPlayerState],
  );

  const pausePlayback = useCallback(async () => {
    if (!wsConnected) return false;

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
  }, [wsConnected, pausePlaybackWS, getPlayerState]);

  const skipToNext = useCallback(async () => {
    if (!wsConnected) return false;

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
  }, [wsConnected, skipToNextWS, getPlayerState]);

  const skipToPrevious = useCallback(async () => {
    if (!wsConnected) return false;

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
  }, [wsConnected, skipToPreviousWS, getPlayerState]);

  const seekToPosition = useCallback(
    async (positionMs) => {
      if (!wsConnected) return false;

      try {
        await seekToPositionWS(positionMs);
        return true;
      } catch (err) {
        console.error("Error seeking to position:", err.message);
        return false;
      }
    },
    [wsConnected, seekToPositionWS],
  );

  const processVolumeQueue = useCallback(async () => {
    if (
      isVolumeProcessingRef.current ||
      volumeQueueRef.current.length === 0 ||
      !wsConnected
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
  }, [wsConnected, setVolumeWS, openDeviceSwitcher]);

  const setVolume = useCallback(
    async (volumePercent) => {
      if (!wsConnected) return false;

      const boundedVolume = Math.max(
        0,
        Math.min(100, Math.round(volumePercent)),
      );

      if (boundedVolume !== volume) {
        setVolumeState(boundedVolume);
        setIsAdjustingVolume(true);

        volumeQueueRef.current.push(boundedVolume);

        if (!isVolumeProcessingRef.current) {
          processVolumeQueue();
        }
      }

      return true;
    },
    [wsConnected, processVolumeQueue, volume],
  );

  const checkIsTrackLiked = useCallback(
    async (trackId) => {
      if (!wsConnected || !trackId) return false;

      try {
        const result = await checkIsTrackSaved(trackId);
        return (result && result[0]) || false;
      } catch (err) {
        console.error("Error checking if track is liked:", err.message);
        return false;
      }
    },
    [wsConnected, checkIsTrackSaved],
  );

  const likeTrack = useCallback(
    async (trackId) => {
      if (!wsConnected || !trackId) return false;

      try {
        await saveTrack(trackId);
        return true;
      } catch (err) {
        console.error("Error liking track:", err.message);
        return false;
      }
    },
    [wsConnected, saveTrack],
  );

  const unlikeTrack = useCallback(
    async (trackId) => {
      if (!wsConnected || !trackId) return false;

      try {
        await removeTrack(trackId);
        return true;
      } catch (err) {
        console.error("Error unliking track:", err.message);
        return false;
      }
    },
    [wsConnected, removeTrack],
  );

  const toggleShuffle = useCallback(
    async (state) => {
      if (!wsConnected) return false;

      try {
        await toggleShuffleWS(state);
        return true;
      } catch (err) {
        console.error("Error toggling shuffle:", err.message);
        return false;
      }
    },
    [wsConnected, toggleShuffleWS],
  );

  const setRepeatMode = useCallback(
    async (state) => {
      if (!wsConnected) return false;

      try {
        await setRepeatModeWS(state);
        return true;
      } catch (err) {
        console.error("Error setting repeat mode:", err.message);
        return false;
      }
    },
    [wsConnected, setRepeatModeWS],
  );

  const playDJMix = useCallback(async () => {
    if (!wsConnected) return false;

    try {
      console.log("DJ mix functionality disabled in WebSocket mode");
      return false;
    } catch (err) {
      console.error("Error playing DJ mix:", err);
      return false;
    }
  }, [wsConnected]);

  const sendDJSignal = useCallback(async () => {
    if (!wsConnected) return false;

    try {
      console.log("DJ signal functionality disabled in WebSocket mode");
      return false;
    } catch (err) {
      console.error("Error sending DJ signal:", err);
      return false;
    }
  }, [wsConnected]);

  const getCurrentDeviceOptions = useCallback(async () => {
    if (!wsConnected) return null;

    try {
      console.log("Device options functionality disabled in WebSocket mode");
      return null;
    } catch (err) {
      console.error("Error getting device options:", err);
      return null;
    }
  }, [wsConnected]);

  const setPlaybackSpeed = useCallback(
    async (speed) => {
      if (!wsConnected) return false;

      try {
        console.log("Playback speed functionality disabled in WebSocket mode");
        return false;
      } catch (err) {
        console.error("Error setting playback speed:", err);
        return false;
      }
    },
    [wsConnected],
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
  };
}
