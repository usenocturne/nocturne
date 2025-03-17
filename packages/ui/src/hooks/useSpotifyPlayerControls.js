import { useCallback, useState, useContext } from "react";
import React from "react";

export const DeviceSwitcherContext = React.createContext({
  openDeviceSwitcher: () => { },
});

export function useSpotifyPlayerControls(accessToken) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { openDeviceSwitcher } = useContext(DeviceSwitcherContext);

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

          const errorMessage = errorData.error?.message || `HTTP error! status: ${response.status}`;

          // TODO: make this hand off the chosen song if there is one (e.g. pressing a song in a playlist while theres no active device should start playing that song, not resume original playback)
          if (errorData.error?.reason == "NO_ACTIVE_DEVICE") {
            if (openDeviceSwitcher) {
              openDeviceSwitcher();
            }
          }

          throw new Error(errorMessage);
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
    [accessToken, openDeviceSwitcher]
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

  const playDJMix = useCallback(async () => {
    if (!accessToken) return false;

    try {
      setIsLoading(true);
      setError(null);

      const deviceResponse = await fetch(
        "https://api.spotify.com/v1/me/player",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      let deviceId = null;
      if (deviceResponse.status !== 204) {
        const deviceData = await deviceResponse.json();
        deviceId = deviceData.device?.id;
      }

      const response = await fetch(
        `https://gue1-spclient.spotify.com/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
        {
          method: "POST",
          headers: {
            "accept-language": "en",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: '{"command": {"endpoint": "play", "context": {"entity_uri": "spotify:playlist:37i9dQZF1EYkqdzj48dyYq", "uri": "spotify:playlist:37i9dQZF1EYkqdzj48dyYq", "url": "hm:\\/\\/lexicon-session-provider\\/context-resolve\\/v2\\/session?contextUri=spotify:playlist:37i9dQZF1EYkqdzj48dyYq"}}}',
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (err) {
      console.error("Error playing DJ mix:", err);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const sendDJSignal = useCallback(async () => {
    if (!accessToken) return false;

    try {
      setIsLoading(true);
      setError(null);

      const deviceResponse = await fetch(
        "https://api.spotify.com/v1/me/player",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      let deviceId = null;
      if (deviceResponse.status !== 204) {
        const deviceData = await deviceResponse.json();
        deviceId = deviceData.device?.id;
      }

      if (!deviceId) {
        throw new Error("No active device found");
      }

      const response = await fetch(
        `https://gue1-spclient.spotify.com/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
        {
          method: "POST",
          headers: {
            "accept-language": "en",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: '{"command": {"endpoint": "signal", "signal_id": "jump"}}',
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (err) {
      console.error("Error sending DJ signal:", err);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  return {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    setVolume,
    toggleShuffle,
    setRepeatMode,
    checkIsTrackLiked,
    likeTrack,
    unlikeTrack,
    playDJMix,
    sendDJSignal,
    isLoading,
    error,
  };
}
