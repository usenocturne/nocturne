import { useState, useEffect, useRef, useCallback } from "react";

export function useSpotifyPlayerState(accessToken) {
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const webSocketRef = useRef(null);
  const connectionIdRef = useRef(null);
  const isConnectingRef = useRef(false);
  const retryTimeoutRef = useRef(null);
  const connectionErrorsRef = useRef(0);
  const initialStateLoadedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const lastAccessTokenRef = useRef(null);

  const processPlaybackState = useCallback((data) => {
    if (!data) return;

    setCurrentPlayback({
      ...data,
      device: {
        ...data.device,
        volume_percent: data.device?.volume_percent,
      },
      shuffle_state: data.shuffle_state,
      repeat_state: data.repeat_state,
    });

    if (data?.item && data.item.type === "track") {
      const currentAlbum = data.item.is_local
        ? {
            id: null,
            name: data.item.name,
            images: [{ url: "/images/not-playing.webp" }],
            artists: data.item.artists,
            type: "local",
            uri: data.item.uri,
          }
        : data.item.album;

      setCurrentlyPlayingAlbum(currentAlbum);

      if (
        currentAlbum?.id &&
        currentAlbum.id !== lastPlayedAlbumIdRef.current
      ) {
        lastPlayedAlbumIdRef.current = currentAlbum.id;
        setAlbumChangeEvent({
          album: currentAlbum,
          timestamp: new Date().toISOString(),
        });
      }
    } else if (data?.item && data.item.type === "episode") {
      const currentShow = data.item.show;
      setCurrentlyPlayingAlbum(currentShow);
    }

    initialStateLoadedRef.current = true;
  }, []);

  const resetPlaybackState = useCallback(() => {
    setCurrentPlayback(null);
    setCurrentlyPlayingAlbum(null);
    initialStateLoadedRef.current = true;
  }, []);

  const fetchCurrentPlayback = useCallback(async () => {
    if (!accessToken) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        "https://api.spotify.com/v1/me/player?type=episode,track",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 204) {
        resetPlaybackState();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
          resetPlaybackState();
        } else {
          processPlaybackState(data);
        }
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (err) {
      console.error("Error fetching current playback:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, processPlaybackState, resetPlaybackState]);

  const cleanupWebSocket = useCallback(() => {
    if (webSocketRef.current) {
      webSocketRef.current.onclose = null;
      webSocketRef.current.onerror = null;
      webSocketRef.current.onmessage = null;
      webSocketRef.current.onopen = null;

      if (
        webSocketRef.current.readyState === WebSocket.OPEN ||
        webSocketRef.current.readyState === WebSocket.CONNECTING
      ) {
        webSocketRef.current.close();
      }
      webSocketRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!accessToken || webSocketRef.current || isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;

    try {
      cleanupWebSocket();

      webSocketRef.current = new WebSocket(
        `wss://dealer.spotify.com/?access_token=${accessToken}`
      );

      webSocketRef.current.onopen = () => {
        isConnectingRef.current = false;
        connectionErrorsRef.current = 0;

        const pingIntervalId = setInterval(() => {
          if (
            webSocketRef.current &&
            webSocketRef.current.readyState === WebSocket.OPEN
          ) {
            webSocketRef.current.send(JSON.stringify({ type: "ping" }));
          } else {
            clearInterval(pingIntervalId);
          }
        }, 15000);
      };

      webSocketRef.current.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if ("headers" in message && message.headers["Spotify-Connection-Id"]) {
          connectionIdRef.current = message.headers["Spotify-Connection-Id"];

          try {
            const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(
              connectionIdRef.current
            )}`;

            await fetch(url, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            });

            if (!initialStateLoadedRef.current) {
              await fetchCurrentPlayback();
            }
          } catch (error) {
            console.error("Error setting up notifications:", error);
          }
        } else if (message.type === "message" && message.payloads) {
          for (const payload of message.payloads) {
            if (payload.events) {
              for (const eventData of payload.events) {
                if (
                  eventData.type === "PLAYER_STATE_CHANGED" &&
                  eventData.event?.state
                ) {
                  processPlaybackState(eventData.event.state);
                }
              }
            }
          }
        }
      };

      webSocketRef.current.onerror = () => {
        isConnectingRef.current = false;
        connectionErrorsRef.current += 1;

        if (connectionErrorsRef.current > 3) {
          cleanupWebSocket();
        }
      };

      webSocketRef.current.onclose = () => {
        isConnectingRef.current = false;

        if (webSocketRef.current) {
          cleanupWebSocket();
        }

        if (connectionErrorsRef.current <= 3) {
          const backoffTime = Math.min(
            1000 * Math.pow(2, connectionErrorsRef.current),
            30000
          );

          retryTimeoutRef.current = setTimeout(() => {
            if (!initialStateLoadedRef.current) {
              fetchCurrentPlayback();
            }
            connectWebSocket();
          }, backoffTime);
        } else if (!initialStateLoadedRef.current) {
          fetchCurrentPlayback();
        }
      };
    } catch (error) {
      isConnectingRef.current = false;
      connectionErrorsRef.current += 1;
    }
  }, [
    accessToken,
    cleanupWebSocket,
    fetchCurrentPlayback,
    processPlaybackState,
  ]);

  const resetAndReconnect = useCallback(() => {
    initialStateLoadedRef.current = false;
    connectionErrorsRef.current = 0;
    cleanupWebSocket();
    setCurrentPlayback(null);
    setCurrentlyPlayingAlbum(null);
    fetchCurrentPlayback();
    connectWebSocket();
  }, [cleanupWebSocket, fetchCurrentPlayback, connectWebSocket]);

  useEffect(() => {
    if (!accessToken) return;
    
    if (lastAccessTokenRef.current && lastAccessTokenRef.current !== accessToken) {
      resetAndReconnect();
    } 
    else if (!lastAccessTokenRef.current) {
      resetAndReconnect();
    }
    
    lastAccessTokenRef.current = accessToken;

    return () => {
      cleanupWebSocket();
    };
  }, [accessToken, resetAndReconnect, cleanupWebSocket]);

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState: fetchCurrentPlayback,
  };
}
