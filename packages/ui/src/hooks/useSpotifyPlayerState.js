import { useState, useEffect, useRef, useCallback } from "react";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";
import { useNetwork } from "./useNetwork";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useNocturned, addGlobalWsListener } from "./useNocturned";

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
let podcastPollingInterval = null;
let isPodcastPlaying = false;
let lastPodcastFetch = 0;
let podcastFetchDebounceTimeout = null;
let initialPlaybackFetchDone = false;
export function useSpotifyPlayerState(immediateLoad = false) {
  const { isConnected: isNetworkConnected } = useNetwork();
  const { wsConnected, getPlayerState } = useSpotifyWebSocket();
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialFetchInProgress, setInitialFetchInProgress] = useState(false);

  const webSocketRef = useRef(null);
  const connectionIdRef = useRef(null);
  const initialStateLoadedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const subscriberIdRef = useRef(`subscriber-${Date.now()}-${Math.random()}`);
  const reconnectTimeoutRef = useRef(null);
  const maxRetryAttempts = 5;
  const currentPlaybackRef = useRef(null);

  const stopPodcastPolling = useCallback(() => {
    if (podcastPollingInterval) {
      clearInterval(podcastPollingInterval);
      podcastPollingInterval = null;
    }
    if (podcastFetchDebounceTimeout) {
      clearTimeout(podcastFetchDebounceTimeout);
      podcastFetchDebounceTimeout = null;
    }
    isPodcastPlaying = false;
    lastPodcastFetch = 0;
  }, []);

  const processPlaybackState = useCallback(
    (data) => {
      if (!data) return;

      const isEpisode =
        data.currently_playing_type === "episode" ||
        (data?.item && data.item.type === "episode") ||
        (data?.item && data.item.show && !data.item.album && !data.item.artists);
      const hasIncompleteEpisodeData =
        data.currently_playing_type === "episode" && !data.item;

      if (isEpisode && !isPodcastPlaying) {
        isPodcastPlaying = true;
        setTimeout(() => {
          if (podcastPollingInterval || !isPodcastPlaying) return;

          podcastPollingInterval = setInterval(async () => {
            if (isPodcastPlaying && wsConnected && isNetworkConnected) {
              try {
                const now = Date.now();
                if (now - lastPodcastFetch < 25000) return;

                lastPodcastFetch = now;
                await waitForNetwork();
                const polledData = await getPlayerState();

                if (polledData && Object.keys(polledData).length > 0) {
                  const wasPolling = isPodcastPlaying;
                  isPodcastPlaying = false;
                  processPlaybackState(polledData);
                  isPodcastPlaying = wasPolling;
                }
              } catch (err) {
                console.error("Error polling podcast data:", err);
              }
            }
          }, 30000);
        }, 2000);
      } else if (!isEpisode && isPodcastPlaying) {
        setTimeout(() => {
          if (!isEpisode) {
            stopPodcastPolling();
          }
        }, 1000);
      }

      if (
        hasIncompleteEpisodeData &&
        currentPlaybackRef.current?.item?.type === "episode"
      ) {
        setCurrentPlayback((prevPlayback) => {
          const updatedPlayback = {
            ...prevPlayback,
            device: {
              ...prevPlayback?.device,
              ...data.device,
              volume_percent: data.device?.volume_percent,
            },
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            is_playing: data.is_playing,
            progress_ms: data.progress_ms,
            timestamp: data.timestamp,
          };
          currentPlaybackRef.current = updatedPlayback;
          return updatedPlayback;
        });
        return;
      }

      setCurrentPlayback((prevPlayback) => {
        const newPlayback = {
          ...data,
          device: {
            ...data.device,
            volume_percent: data.device?.volume_percent,
          },
          shuffle_state: data.shuffle_state,
          repeat_state: data.repeat_state,
          
          item: data.item && isEpisode && !data.item.type ? {
            ...data.item,
            type: "episode"
          } : data.item,
        };
        currentPlaybackRef.current = newPlayback;
        return newPlayback;
      });

      if (data?.item && data.item.type === "track") {
        const currentAlbum = data.item.is_local
          ? {
              id: `local-${data.item.uri}`,
              name: data.item.album?.name || data.item.name,
              images: [{ url: "/images/not-playing.webp" }],
              artists: data.item.artists,
              type: "local-track",
              uri: data.item.uri,
            }
          : {
              ...data.item.album,
              artists: data.item.artists, 
            };

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
        
        const showAsAlbum = {
          ...currentShow,
          artists: currentShow.publisher ? [{
            id: `publisher-${currentShow.id}`,
            name: currentShow.publisher,
            type: "show"
          }] : [],
          type: "show"
        };
        setCurrentlyPlayingAlbum(showAsAlbum);

        if (currentShow?.id && data.item.id) {
          localStorage.setItem(
            `lastPlayedEpisode_${currentShow.id}`,
            data.item.id,
          );
        }
      }

      initialStateLoadedRef.current = true;
    },
    [stopPodcastPolling],
  );

  const resetPlaybackState = useCallback(
    (force = false) => {
      stopPodcastPolling();
      if (force || !initialFetchInProgress) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
      }
      initialStateLoadedRef.current = true;
    },
    [stopPodcastPolling, initialFetchInProgress],
  );

  const fetchCurrentPlayback = useCallback(
    async (forceRefresh = false) => {
      if (!wsConnected || !isNetworkConnected) {
        if (!initialStateLoadedRef.current) {
          setCurrentPlayback(null);
        }
        return;
      }

      const now = Date.now();
      if (!forceRefresh && (now - lastFetchTimestamp < 1000 || pendingFetch)) {
        return;
      }

      const isInitialFetch = !initialStateLoadedRef.current;
      if (isInitialFetch) {
        setInitialFetchInProgress(true);
      }

      try {
        await waitForNetwork();
        lastFetchTimestamp = now;
        pendingFetch = true;
        setIsLoading(true);

        const data = await getPlayerState();

        if (!data || Object.keys(data).length === 0) {
          resetPlaybackState();
        } else {
          processPlaybackState(data);
        }
      } catch (err) {
        console.error("Error fetching current playback:", err);
        setError(err.message);

        if (err.message.includes("401") || err.message.includes("403")) {
          resetPlaybackState(true);
          cleanupWebSocket();
          return;
        }

        if (err.message.includes("204") || err.message.includes("No content")) {
          resetPlaybackState();
          return;
        }

        if (err.name === "NetworkError" || !isNetworkConnected) {
          resetPlaybackState();
          cleanupWebSocket();
        }
      } finally {
        pendingFetch = false;
        setIsLoading(false);
        setInitialFetchInProgress(false);
      }
    },
    [
      wsConnected,
      getPlayerState,
      processPlaybackState,
      resetPlaybackState,
      isNetworkConnected,
    ],
  );

  const cleanupWebSocket = useCallback(() => {
    connectionCount = Math.max(0, connectionCount - 1);

    if (connectionCount <= 0) {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (podcastPollingInterval) {
        clearInterval(podcastPollingInterval);
        podcastPollingInterval = null;
      }
      if (podcastFetchDebounceTimeout) {
        clearTimeout(podcastFetchDebounceTimeout);
        podcastFetchDebounceTimeout = null;
      }
      isPodcastPlaying = false;
      lastPodcastFetch = 0;

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

        if (
          globalWebSocket.readyState === WebSocket.OPEN ||
          globalWebSocket.readyState === WebSocket.CONNECTING
        ) {
          try {
            globalWebSocket.close(1000, "Client cleanup");
          } catch (e) {
            /* ignore */
          }
        }
        globalWebSocket = null;
        globalConnectionId = null;
        isInitialized = false;
        connectionErrors = 0;
      }
    }
    webSocketRef.current = null;
  }, [reconnectTimeoutRef]);

  const connectWebSocket = useCallback(async () => {
    if (
      (isConnecting &&
        globalWebSocket &&
        globalWebSocket.readyState === WebSocket.CONNECTING) ||
      isAttemptingReconnect ||
      !isNetworkConnected
    ) {
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

    if (globalWebSocket) {
      if (globalWebSocket.readyState === WebSocket.OPEN) {
        webSocketRef.current = globalWebSocket;
        connectionIdRef.current = globalConnectionId;
        if (!initialStateLoadedRef.current) {
          await networkAwareRequest(() => fetchCurrentPlayback());
        }
        isAttemptingReconnect = false;
        return;
      }
      if (globalWebSocket.readyState === WebSocket.CONNECTING) {
        webSocketRef.current = globalWebSocket;
        isAttemptingReconnect = false;
        return;
      }
      globalWebSocket.onopen = null;
      globalWebSocket.onmessage = null;
      globalWebSocket.onerror = null;
      globalWebSocket.onclose = null;
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      if (
        globalWebSocket.readyState !== WebSocket.CLOSING &&
        globalWebSocket.readyState !== WebSocket.CLOSED
      ) {
        try {
          globalWebSocket.close(1000, "Replacing defunct WebSocket");
        } catch (e) {
          /* ignore */
        }
      }
      globalWebSocket = null;
      globalConnectionId = null;
    }

    connectionErrors = 0;

    if (isConnecting) {
      isAttemptingReconnect = false;
      connectionCount = Math.max(0, connectionCount - 1);
      return;
    }

    isConnecting = true;

    try {
      throw new Error(
        "WebSocket connection should be handled by useSpotifyWebSocket hook",
      );
      webSocketRef.current = globalWebSocket;

      globalWebSocket.onopen = () => {
        isConnecting = false;
        isAttemptingReconnect = false;
        connectionErrors = 0;
        isInitialized = true;

        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }

        keepAliveInterval = setInterval(() => {
          if (
            globalWebSocket &&
            globalWebSocket.readyState === WebSocket.OPEN
          ) {
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
            console.log("WebSocket connection established");

            if (!initialStateLoadedRef.current) {
              await networkAwareRequest(() => fetchCurrentPlayback());
            }
          } catch (error) {
            console.error("Error setting up notifications:", error);
            if (error.name === "NetworkError" || !isNetworkConnected) {
              cleanupWebSocket();
            }
          }
        } else if (message.type === "message" && message.payloads) {
          // Old PLAYER_STATE_CHANGED handler removed - now handled by global listener
        }
      };

      globalWebSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (isConnecting) isConnecting = false;
        if (isAttemptingReconnect) isAttemptingReconnect = false;
        connectionErrors += 1;

        if (connectionErrors > maxRetryAttempts) {
          if (
            globalWebSocket &&
            (globalWebSocket.readyState === WebSocket.OPEN ||
              globalWebSocket.readyState === WebSocket.CONNECTING)
          ) {
            try {
              globalWebSocket.close(1008, "Too many errors");
            } catch (e) {
              /*ignore*/
            }
          }
        }
      };

      globalWebSocket.onclose = (event) => {
        const wasGloballyConnecting = isConnecting;
        isConnecting = false;
        isAttemptingReconnect = false;

        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        if (connectionCount > 0 && isNetworkConnected) {
          const backoffTime = Math.min(
            1000 *
              Math.pow(
                1.5,
                Math.min(
                  connectionErrors,
                  wasGloballyConnecting
                    ? connectionErrors + 1
                    : connectionErrors,
                ),
              ),
            15000,
          );
          connectionErrors++;

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = setTimeout(async () => {
            if (connectionCount > 0 && isNetworkConnected) {
              try {
                await waitForNetwork();
                if (isNetworkConnected) {
                  await fetchCurrentPlayback();
                  connectWebSocket();
                } else {
                  isAttemptingReconnect = false;
                }
              } catch (error) {
                console.error("Failed during pre-reconnect sequence:", error);
                isAttemptingReconnect = false;
                if (connectionCount > 0 && isNetworkConnected) {
                  const nextRetryTime = Math.min(backoffTime * 2, 30000);
                  reconnectTimeoutRef.current = setTimeout(() => {
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
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      isConnecting = false;
      isAttemptingReconnect = false;
      connectionErrors += 1;
      connectionCount = Math.max(0, connectionCount - 1);
      if (globalWebSocket === webSocketRef.current) {
        globalWebSocket = null;
      }
    }
  }, [
    fetchCurrentPlayback,
    cleanupWebSocket,
    processPlaybackState,
    isNetworkConnected,
  ]);

  useEffect(() => {
    const subscriberId = subscriberIdRef.current;
    eventSubscribers.push({
      id: subscriberId,
      onPlaybackState: processPlaybackState,
    });
    return () => {
      eventSubscribers = eventSubscribers.filter(
        (sub) => sub.id !== subscriberId,
      );
    };
  }, [processPlaybackState]);

  useEffect(() => {
    if (wsConnected) {
      if (!initialPlaybackFetchDone) {
        initialPlaybackFetchDone = true;
        fetchCurrentPlayback(true);
      }

      const handleNetworkRestored = () => {
        if (
          !globalWebSocket ||
          (globalWebSocket.readyState !== WebSocket.OPEN &&
            globalWebSocket.readyState !== WebSocket.CONNECTING)
        ) {
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
  }, [wsConnected, connectWebSocket, cleanupWebSocket, fetchCurrentPlayback]);

  useEffect(() => {
    if (reconnectTimeoutRef.current) {
      return () => {
        clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, []);

  useEffect(() => {
    if (wsConnected && immediateLoad && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [wsConnected, immediateLoad, fetchCurrentPlayback]);

  useEffect(() => {
    const handleNetworkRestored = async () => {
      if (
        globalWebSocket &&
        (globalWebSocket.readyState === WebSocket.OPEN ||
          globalWebSocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      cleanupWebSocket();
      connectionErrors = 0;
      isAttemptingReconnect = false;
      connectWebSocket();
      await fetchCurrentPlayback(true);
    };

    window.addEventListener("networkRestored", handleNetworkRestored);

    return () => {
      window.removeEventListener("networkRestored", handleNetworkRestored);
    };
  }, [connectWebSocket, fetchCurrentPlayback, cleanupWebSocket]);

  useEffect(() => {
    if (!wsConnected) return;

    const handlePlayerStateChanged = (data) => {
      if (
        data.type === "event" &&
        data.topic === "spotify.player.device_state_changed"
      ) {
        const payloads = data.data?.payloads || [];
        if (payloads.length > 0 && payloads[0]?.cluster?.player_state) {
          const playerState = payloads[0].cluster.player_state;
          
          const isEpisode = playerState.track?.uri?.startsWith('spotify:episode:');
          
          const transformedState = {
            is_playing: playerState.is_paused === 0,
            timestamp: Date.now(),
            progress_ms: parseInt(playerState.position_as_of_timestamp) || 0,
            
            context: playerState.context_uri ? {
              uri: playerState.context_uri,
              type: playerState.context_uri.split(':')[1],
              href: null
            } : null,
            
            item: playerState.track ? (isEpisode ? {
             
              id: playerState.track.uri.split(':')[2],
              uri: playerState.track.uri,
              type: "episode",
              name: playerState.track.metadata.title,
              show: {
                id: playerState.context_uri?.split(':')[2],
                uri: playerState.context_uri,
                name: playerState.track.metadata.album_title || "Unknown Show",
                publisher: playerState.track.metadata.author_name || "Unknown Publisher",
                images: playerState.track.metadata.image_url ? [
                  { url: playerState.track.metadata.image_url.startsWith('http') ? 
                    playerState.track.metadata.image_url : 
                    `https://${playerState.track.metadata.image_url}` }
                ] : []
              },
              duration_ms: parseInt(playerState.duration) || 0,
              is_local: false
            } : {
              
              id: playerState.track.uri.split(':')[2],
              uri: playerState.track.uri,
              type: "track",
              name: playerState.track.metadata.title,
              album: {
                id: playerState.track.metadata.album_uri?.split(':')[2],
                uri: playerState.track.metadata.album_uri,
                name: playerState.track.metadata.album_title,
                images: playerState.track.metadata.is_narration === "true" || 
                        playerState.track.metadata.album_artist_name === "DJ X" ? [
                  { url: "/images/radio-cover/dj.webp" }
                ] : playerState.track.metadata.image_url ? [
                  { url: playerState.track.metadata.image_url.startsWith('http') ? 
                    playerState.track.metadata.image_url : 
                    `https://${playerState.track.metadata.image_url}` }
                ] : []
              },
              artists: playerState.track.metadata.is_narration === "true" || 
                      playerState.track.metadata.album_artist_name === "DJ X" ? [{
                id: "dj-x",
                uri: "spotify:artist:dj-x",
                name: "DJ X",
                type: "artist"
              }] : playerState.track.metadata.artists ? 
                playerState.track.metadata.artists.map(artist => ({
                  id: artist.id || artist.uri?.split(':')[2],
                  uri: artist.uri || `spotify:artist:${artist.id}`,
                  name: artist.name,
                  type: artist.type || 'artist'
                })) : [],
              duration_ms: parseInt(playerState.duration) || 0,
              is_local: false
            }) : null,
            
            
            shuffle_state: playerState.options?.shuffling_context === 1,
            repeat_state: playerState.options?.repeating_track === 1 ? "track" : 
                         playerState.options?.repeating_context === 1 ? "context" : "off",
            
            
            device: payloads[0]?.cluster?.devices && payloads[0]?.cluster?.active_device_id ? 
              (() => {
                const activeDeviceId = payloads[0].cluster.active_device_id;
                const device = payloads[0].cluster.devices[activeDeviceId];
                return device ? {
                  id: device.device_id,
                  is_active: true,
                  name: device.name,
                  type: device.device_type,
                  volume_percent: Math.round((device.volume / 65535) * 100)
                } : null;
              })() : null,
            
            
            currently_playing_type: isEpisode ? "episode" : "track",
            
            
            playback_speed: playerState.options?.playback_speed || 1
          };
          
          processPlaybackState(transformedState);
        }
      }
    };

    const cleanup = addGlobalWsListener(`player-state-${Date.now()}`, {
      onMessage: handlePlayerStateChanged,
    });

    return cleanup;
  }, [wsConnected, processPlaybackState]);

  const refreshPlaybackState = useCallback(
    async (forceRefresh = false) => {
      if (!wsConnected) return;

      try {
        const data = await getPlayerState();

        if (!data || Object.keys(data).length === 0) {
          resetPlaybackState();
        } else {
          processPlaybackState(data);
        }
      } catch (err) {
        console.error("Error refreshing playback state:", err);
        setError(err.message);
      }
    },
    [wsConnected, getPlayerState, resetPlaybackState, processPlaybackState],
  );

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState,
  };
}
