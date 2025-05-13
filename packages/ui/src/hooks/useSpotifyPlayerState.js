import { useState, useEffect, useRef, useCallback } from "react";
import { networkAwareRequest, waitForNetwork } from '../utils/networkAwareRequest';

let globalWebSocket = null;
let globalConnectionId = null;
let connectionCount = 0;
let isConnecting = false;
let isAttemptingReconnect = false;
let connectionErrors = 0;
let retryTimeout = null;
let eventSubscribers = [];
let lastFetchTimestamp = 0;
let pendingFetch = null;
let keepAliveInterval = null;
let isInitialized = false;

export function useSpotifyPlayerState(accessToken, immediateLoad = false) {
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
  const reconnectTimeoutRef = useRef(null);
  const maxRetryAttempts = 5;

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

      if (currentAlbum?.id && currentAlbum.id !== lastPlayedAlbumIdRef.current) {
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
    if (!accessToken || !navigator.onLine) {
      setCurrentPlayback(null);
      return;
    }

    const now = Date.now();
    if (!forceRefresh && (now - lastFetchTimestamp < 1000 || pendingFetch)) {
      return;
    }

    try {
      await waitForNetwork();
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
      
      if (err.name === 'NetworkError' || !navigator.onLine) {
        resetPlaybackState();
        cleanupWebSocket();
      }
    } finally {
      pendingFetch = false;
      setIsLoading(false);
    }
  }, [accessToken, processPlaybackState, resetPlaybackState]);

  const cleanupWebSocket = useCallback(() => {
    connectionCount = Math.max(0, connectionCount - 1);
    
    if (connectionCount <= 0) {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }

      isAttemptingReconnect = false;
      isConnecting = false;

      if (globalWebSocket) {
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        globalWebSocket.onclose = null;
        globalWebSocket.onerror = null;
        globalWebSocket.onmessage = null;
        globalWebSocket.onopen = null;

        if (globalWebSocket.readyState === WebSocket.OPEN || globalWebSocket.readyState === WebSocket.CONNECTING) {
          globalWebSocket.close();
        }
        globalWebSocket = null;
        globalConnectionId = null;
        isInitialized = false;
        connectionErrors = 0;
      }
    }
    webSocketRef.current = null;
  }, []);

  const connectWebSocket = useCallback(async () => {
    if (!accessToken || isConnecting || isAttemptingReconnect || !navigator.onLine) {
      return;
    }

    isAttemptingReconnect = true;

    try {
      await waitForNetwork();
    } catch (error) {
      isAttemptingReconnect = false;
      return;
    }

    connectionCount++;

    if (globalWebSocket && globalWebSocket.readyState === WebSocket.OPEN) {
      webSocketRef.current = globalWebSocket;
      connectionIdRef.current = globalConnectionId;
      if (!initialStateLoadedRef.current) {
        await networkAwareRequest(() => fetchCurrentPlayback());
      }
      isAttemptingReconnect = false;
      return;
    }

    if (isInitialized && globalWebSocket && globalWebSocket.readyState === WebSocket.CONNECTING) {
      webSocketRef.current = globalWebSocket;
      isAttemptingReconnect = false;
      return;
    }

    if (globalWebSocket) {
      globalWebSocket.onclose = null;
      globalWebSocket.onerror = null;
      globalWebSocket.onmessage = null;
      globalWebSocket.onopen = null;

      if (globalWebSocket.readyState === WebSocket.OPEN || globalWebSocket.readyState === WebSocket.CONNECTING) {
        globalWebSocket.close();
      }
      globalWebSocket = null;
      globalConnectionId = null;
    }

    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }

    isConnecting = true;
    isInitialized = true;

    try {
      await networkAwareRequest(async () => {
        if (globalWebSocket) {
          isConnecting = false;
          isAttemptingReconnect = false;
          return;
        }

        globalWebSocket = new WebSocket(`wss://dealer.spotify.com/?access_token=${accessToken}`);
        webSocketRef.current = globalWebSocket;

        globalWebSocket.onopen = () => {
          isConnecting = false;
          isAttemptingReconnect = false;
          connectionErrors = 0;

          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
          }
          
          keepAliveInterval = setInterval(() => {
            if (globalWebSocket && globalWebSocket.readyState === WebSocket.OPEN) {
              globalWebSocket.send(JSON.stringify({ type: "ping" }));
            } else {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
          }, 15000);
        };

        globalWebSocket.onmessage = async (event) => {
          const message = JSON.parse(event.data);

          if ("headers" in message && message.headers["Spotify-Connection-Id"]) {
            globalConnectionId = message.headers["Spotify-Connection-Id"];
            connectionIdRef.current = globalConnectionId;
            
            try {
              const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(globalConnectionId)}`;
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
                await networkAwareRequest(() => fetchCurrentPlayback());
              }
            } catch (error) {
              console.error("Error setting up notifications:", error);
              if (error.name === 'NetworkError' || !navigator.onLine) {
                cleanupWebSocket();
              }
            }
          } else if (message.type === "message" && message.payloads) {
            for (const payload of message.payloads) {
              if (payload.events) {
                for (const eventData of payload.events) {
                  if (eventData.type === "PLAYER_STATE_CHANGED" && eventData.event?.state) {
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

        globalWebSocket.onerror = (error) => {
          console.error('WebSocket error:', error);
          isConnecting = false;
          isAttemptingReconnect = false;
          connectionErrors += 1;

          if (connectionErrors > maxRetryAttempts) {
            cleanupWebSocket();
          }
        };

        globalWebSocket.onclose = (event) => {
          isConnecting = false;
          isAttemptingReconnect = false;

          if (connectionCount > 0 && navigator.onLine) {
            const backoffTime = Math.min(1000 * Math.pow(1.5, Math.min(connectionErrors, 5)), 15000);

            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }

            reconnectTimeoutRef.current = setTimeout(async () => {
              if (connectionCount > 0) {
                try {
                  await waitForNetwork();
                  if (navigator.onLine) {
                    await networkAwareRequest(() => fetchCurrentPlayback());
                    connectWebSocket();
                  }
                } catch (error) {
                  console.error("Failed to reconnect websocket:", error);
                  isAttemptingReconnect = false;
                  if (connectionCount > 0) {
                    const nextRetryTime = Math.min(backoffTime * 2, 30000);
                    reconnectTimeoutRef.current = setTimeout(() => {
                      isAttemptingReconnect = false;
                      connectWebSocket();
                    }, nextRetryTime);
                  }
                }
              } else {
                isAttemptingReconnect = false;
              }
            }, backoffTime);
          } else {
            isAttemptingReconnect = false;
          }
        };
      }).catch(error => {
        isConnecting = false;
        isAttemptingReconnect = false;
      });
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      isConnecting = false;
      isAttemptingReconnect = false;
      connectionErrors += 1;
    }
  }, [accessToken, fetchCurrentPlayback, cleanupWebSocket]);

  useEffect(() => {
    const subscriberId = subscriberIdRef.current;
    eventSubscribers.push({
      id: subscriberId,
      onPlaybackState: processPlaybackState,
    });
    return () => {
      eventSubscribers = eventSubscribers.filter(sub => sub.id !== subscriberId);
    };
  }, [processPlaybackState]);

  useEffect(() => {
    if (accessToken) {
      connectWebSocket();
      fetchCurrentPlayback(true);

      const handleNetworkRestored = () => {
        if (!globalWebSocket || 
            (globalWebSocket.readyState !== WebSocket.OPEN && 
             globalWebSocket.readyState !== WebSocket.CONNECTING)) {
          connectWebSocket();
          fetchCurrentPlayback(true);
        }
      };

      window.addEventListener("online", handleNetworkRestored);
      window.addEventListener("networkRestored", handleNetworkRestored);

      return () => {
        cleanupWebSocket();
        window.removeEventListener("online", handleNetworkRestored);
        window.removeEventListener("networkRestored", handleNetworkRestored);
      };
    }
    return () => {
      cleanupWebSocket();
    };
  }, [accessToken, connectWebSocket, cleanupWebSocket, fetchCurrentPlayback]);

  useEffect(() => {
    if (reconnectTimeoutRef.current) {
      return () => {
        clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, []);

  useEffect(() => {
    if (accessToken && immediateLoad && !initialStateLoadedRef.current) {
      fetchCurrentPlayback(true);
    }
  }, [accessToken, immediateLoad, fetchCurrentPlayback]);

  useEffect(() => {
    const handleNetworkRestored = async () => {
      cleanupWebSocket();
      connectionErrors = 0;
      isAttemptingReconnect = false;
      setupWebSocket();
      await fetchCurrentPlayback(true);
    };

    window.addEventListener('networkRestored', handleNetworkRestored);

    return () => {
      window.removeEventListener('networkRestored', handleNetworkRestored);
    };
  }, [setupWebSocket, fetchCurrentPlayback, cleanupWebSocket]);

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState: fetchCurrentPlayback,
  };
}
