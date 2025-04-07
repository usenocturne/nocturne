import { useState, useEffect, useRef, useCallback } from "react";
import { generateRandomString } from "../utils/helpers";

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
        fetchCurrentPlayback();
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
      globalWebSocket = new WebSocket(
        `wss://gue1-dealer.spotify.com/?access_token=${accessToken}`
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
          connectionIdRef.current = globalConnectionId;

          try {
            const deviceId = generateRandomString(40);
            
            await fetch("https://gue1-spclient.spotify.com/track-playback/v1/devices", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                device: { device_id: deviceId },
                connection_id: globalConnectionId
              })
            });

            await fetch("https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_" + deviceId, {
              method: "PUT",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "x-spotify-connection-id": globalConnectionId
              },
              body: JSON.stringify({
                member_type: "CONNECT_STATE",
                device: {
                  device_info: {
                    capabilities: {
                      can_be_player: false,
                      hidden: true,
                      needs_full_player_state: true
                    }
                  }
                }
              })
            });

            if (!initialStateLoadedRef.current) {
              await fetchCurrentPlayback();
            }
          } catch (error) {
            console.error("Error setting up notifications:", error);
          }
        } else if (message.type === "message" && message.payloads) {
          for (const payload of message.payloads) {
            if (payload.update_reason !== "DEVICE_STATE_CHANGED") {
              continue;
            }
            
            if (payload.cluster?.player_state) {
              const state = payload.cluster.player_state;
              const track = state.track;
              
              if (!track) return;

              const imageId = track.metadata?.image_url?.split(":").pop();
              const imageUrl = imageId ? `https://i.scdn.co/image/${imageId}` : "/images/not-playing.webp";
              const artistId = track.metadata?.artist_uri?.split(":").pop();
              let artistName = "";

              if (artistId) {
                try {
                  const artistResponse = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
                    headers: {
                      "Authorization": `Bearer ${accessToken}`
                    }
                  });
                  if (artistResponse.ok) {
                    const artistData = await artistResponse.json();
                    artistName = artistData.name;
                  }
                } catch (error) {
                  console.error("Error fetching artist details:", error);
                }
              }

              const currentPlayback = {
                item: {
                  id: track.uri?.split(":").pop(),
                  name: track.metadata?.title || "Not Playing",
                  type: "track",
                  artists: [{ name: artistName || "Unknown Artist" }],
                  album: {
                    name: track.metadata?.album_title || "",
                    images: [{ url: imageUrl }]
                  },
                  duration_ms: parseInt(state.duration) || 0
                },
                is_playing: state.is_playing && !state.is_paused,
                progress_ms: parseInt(state.position_as_of_timestamp) || 0,
                shuffle_state: state.options?.shuffling_context || false,
                repeat_state: state.options?.repeating_track ? "track" : 
                            state.options?.repeating_context ? "context" : "off",
              };

              eventSubscribers.forEach((subscriber) => {
                if (subscriber.onPlaybackState) {
                  subscriber.onPlaybackState(currentPlayback);
                }
              });
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

          retryTimeout = setTimeout(() => {
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
