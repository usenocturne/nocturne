import { useState, useEffect } from "react";

export function usePlaybackControls({
  currentPlayback,
  accessToken,
  fetchCurrentPlayback,
}) {
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");

  useEffect(() => {
    if (currentPlayback) {
      setIsShuffled(currentPlayback.shuffle_state);
      setRepeatMode(currentPlayback.repeat_state);
    }
  }, [currentPlayback]);

  const toggleShuffle = async () => {
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=${!isShuffled}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setIsShuffled(!isShuffled);
        fetchCurrentPlayback();
      }
    } catch (error) {
      console.error("Error toggling shuffle:", error);
    }
  };

  const toggleRepeat = async () => {
    const nextMode =
      repeatMode === "off"
        ? "context"
        : repeatMode === "context"
        ? "track"
        : "off";
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/me/player/repeat?state=${nextMode}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setRepeatMode(nextMode);
        fetchCurrentPlayback();
      }
    } catch (error) {
      console.error("Error toggling repeat:", error);
    }
  };

  return {
    isShuffled,
    repeatMode,
    toggleShuffle,
    toggleRepeat,
  };
}
