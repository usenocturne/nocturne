import { useCallback, useState } from "react";

export function useSpotifyPlayerControls(accessToken) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const playTrack = useCallback(
    async (trackUri, contextUri = null, uris = null) => {
      if (!accessToken) return false;

      try {
        setIsLoading(true);
        setError(null);

        const payload = {};

        if (contextUri) {
          payload.context_uri = contextUri;

          if (trackUri) {
            payload.offset = { uri: trackUri };
          }
        } else if (uris && uris.length > 0) {
          payload.uris = uris;
        } else if (trackUri) {
          payload.uris = [trackUri];
        }

        const response = await fetch(
          "https://api.spotify.com/v1/me/player/play",
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error playing track:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const pausePlayback = useCallback(async () => {
    if (!accessToken) return false;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/pause",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({
          error: { message: `HTTP error! status: ${response.status}` },
        }));
        throw new Error(
          errorData.error?.message || `HTTP error! status: ${response.status}`
        );
      }

      return true;
    } catch (err) {
      console.error("Error pausing playback:", err);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const skipToNext = useCallback(async () => {
    if (!accessToken) return false;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/next",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({
          error: { message: `HTTP error! status: ${response.status}` },
        }));
        throw new Error(
          errorData.error?.message || `HTTP error! status: ${response.status}`
        );
      }

      return true;
    } catch (err) {
      console.error("Error skipping to next track:", err);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const skipToPrevious = useCallback(async () => {
    if (!accessToken) return false;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/previous",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({
          error: { message: `HTTP error! status: ${response.status}` },
        }));
        throw new Error(
          errorData.error?.message || `HTTP error! status: ${response.status}`
        );
      }

      return true;
    } catch (err) {
      console.error("Error skipping to previous track:", err);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const seekToPosition = useCallback(
    async (positionMs) => {
      if (!accessToken) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error seeking to position:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const checkIsTrackLiked = useCallback(
    async (trackId) => {
      if (!accessToken || !trackId) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        const data = await response.json();
        return data[0] || false;
      } catch (err) {
        console.error("Error checking if track is liked:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const likeTrack = useCallback(
    async (trackId) => {
      if (!accessToken || !trackId) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/tracks?ids=${trackId}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ids: [trackId] }),
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error liking track:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const unlikeTrack = useCallback(
    async (trackId) => {
      if (!accessToken || !trackId) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/tracks?ids=${trackId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ids: [trackId] }),
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error unliking track:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const setVolume = useCallback(
    async (volumePercent) => {
      if (!accessToken) return false;

      const volume = Math.max(0, Math.min(100, Math.round(volumePercent)));

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error setting volume:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const toggleShuffle = useCallback(
    async (state) => {
      if (!accessToken) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/player/shuffle?state=${state}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error toggling shuffle:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  const setRepeatMode = useCallback(
    async (state) => {
      if (!accessToken) return false;

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `https://api.spotify.com/v1/me/player/repeat?state=${state}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json().catch(() => ({
            error: { message: `HTTP error! status: ${response.status}` },
          }));
          throw new Error(
            errorData.error?.message || `HTTP error! status: ${response.status}`
          );
        }

        return true;
      } catch (err) {
        console.error("Error setting repeat mode:", err);
        setError(err.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken]
  );

  return {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    setVolume,
    toggleShuffle,
    setRepeatMode,
    seekToPosition,
    checkIsTrackLiked,
    likeTrack,
    unlikeTrack,
    isLoading,
    error,
  };
}
