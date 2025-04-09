import { useState, useEffect, useRef, useCallback } from "react";
import { networkAwareRequest } from '../utils/networkAwareRequest';

let globalWebSocket = null;
let globalConnectionId = null;
let connectionCount = 0;
let isConnecting = false;
let connectionErrors = 0;
let retryTimeout = null;
let eventSubscribers = [];
let lastFetchTimestamp = 0;
let pendingFetch = null;

export function useSpotifyPlayerState(accessToken) {
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const webSocketRef = useRef(null);
  const connectionIdRef = useRef(null);
  const initialStateLoadedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const subscriberIdRef = useRef(`subscriber-${Date.now()}-${Math.random()}`);

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

  const fetchCurrentPlayback = useCallback(async (forceRefresh = false) => {
    if (!accessToken) return;

    const now = Date.now();
    
    if (!forceRefresh && 
        (now - lastFetchTimestamp < 1000 || pendingFetch)) {
      return;
    }

    try {
      lastFetchTimestamp = now;
      pendingFetch = true;
      setIsLoading(true);

      const response = await networkAwareRequest(() => 
        fetch("https://api.spotify.com/v1/me/player?type=episode,track", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
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
      pendingFetch = false;
      setIsLoading(false);
    }
  }, [accessToken, processPlaybackState, resetPlaybackState]);

  useEffect(() => {
    const subscriberId = subscriberIdRef.current;

    eventSubscribers.push({
      id: subscriberId,
      onPlaybackState: processPlaybackState,
    });

    return () => {
      eventSubscribers = eventSubscribers.filter(
        (sub) => sub.id !== subscriberId
      );
    };
  }, [processPlaybackState]);

  const cleanupWebSocket = useCallback(() => {
    connectionCount--;

    if (connectionCount <= 0) {
      connectionCount = 0;

      if (globalWebSocket) {
        globalWebSocket.onclose = null;
        globalWebSocket.onerror = null;
        globalWebSocket.onmessage = null;
        globalWebSocket.onopen = null;

        if (
          globalWebSocket.readyState === WebSocket.OPEN ||
          globalWebSocket.readyState === WebSocket.CONNECTING
        ) {
          globalWebSocket.close();
        }
        globalWebSocket = null;
        globalConnectionId = null;
      }

      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    }

    webSocketRef.current = null;
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!accessToken || isConnecting) {
      return;
    }

    connectionCount++;

    if (globalWebSocket && globalWebSocket.readyState === WebSocket.OPEN) {
      webSocketRef.current = globalWebSocket;
      connectionIdRef.current = globalConnectionId;

      if (!initialStateLoadedRef.current) {
        networkAwareRequest(() => fetchCurrentPlayback());
      }
      return;
    }

    isConnecting = true;

    if (globalWebSocket) {
      globalWebSocket.onclose = null;
      globalWebSocket.onerror = null;
      globalWebSocket.onmessage = null;
      globalWebSocket.onopen = null;

      if (
        globalWebSocket.readyState === WebSocket.OPEN ||
        globalWebSocket.readyState === WebSocket.CONNECTING
      ) {
        globalWebSocket.close();
      }
      globalWebSocket = null;
      globalConnectionId = null;
    }

    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }

    try {
      networkAwareRequest(async () => {
        globalWebSocket = new WebSocket(
          `wss://dealer.spotify.com/?access_token=${accessToken}`
        );
        webSocketRef.current = globalWebSocket;

        globalWebSocket.onopen = () => {
          isConnecting = false;
          connectionErrors = 0;

          const pingIntervalId = setInterval(() => {
            if (
              globalWebSocket &&
              globalWebSocket.readyState === WebSocket.OPEN
            ) {
              globalWebSocket.send(JSON.stringify({ type: "ping" }));
            } else {
              clearInterval(pingIntervalId);
            }
          }, 15000);
        };

        globalWebSocket.onmessage = async (event) => {
          const message = JSON.parse(event.data);

          if ("headers" in message && message.headers["Spotify-Connection-Id"]) {
            globalConnectionId = message.headers["Spotify-Connection-Id"];
            connectionIdRef.current = globalConnectionId;            try {
              const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(
                globalConnectionId
              )}`;

              await networkAwareRequest(() => 
                fetch(url, {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                })
              );

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
                  eventSubscribers.forEach((subscriber) => {
                    if (subscriber.onPlaybackState) {
                      subscriber.onPlaybackState(eventData.event.state);
                    }
                  });
                }
              }
            }
          }
        }
      };

        globalWebSocket.onerror = () => {
          isConnecting = false;
          connectionErrors += 1;

          if (connectionErrors > 3) {
            cleanupWebSocket();
          }
        };

        globalWebSocket.onclose = () => {
          isConnecting = false;

          if (connectionErrors <= 3 && connectionCount > 0) {
            const backoffTime = Math.min(
              1000 * Math.pow(2, connectionErrors),
              30000
            );

            if (!initialStateLoadedRef.current) {
              retryTimeout = setTimeout(() => {
                networkAwareRequest(() => fetchCurrentPlayback());
                connectWebSocket();
              }, backoffTime);
            }
          }
        };
      });
    } catch (error) {
      isConnecting = false;
      connectionErrors += 1;
    }
  }, [accessToken, fetchCurrentPlayback, cleanupWebSocket]);

  useEffect(() => {
    if (accessToken) {
      connectionErrors = 0;
      initialStateLoadedRef.current = false;

      fetchCurrentPlayback();
      connectWebSocket();
    }

    return () => {
      cleanupWebSocket();
    };
  }, [accessToken, fetchCurrentPlayback, connectWebSocket, cleanupWebSocket]);

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState: fetchCurrentPlayback,
  };
}
