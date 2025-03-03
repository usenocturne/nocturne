import { useState, useEffect, useCallback, useRef } from "react";

export function useMediaState(accessToken, handleError) {
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingTrackUri, setCurrentlyPlayingTrackUri] =
    useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumsQueue, setAlbumsQueue] = useState([]);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [radio, setRadio] = useState([]);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [currentRepeat, setCurrentRepeat] = useState("off");

  const webSocketRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const connectionIdRef = useRef(null);
  const isConnectingRef = useRef(false);
  const retryTimeoutRef = useRef(null);
  const connectionErrorsRef = useRef(0);
  const lastFetchTimeRef = useRef(0);
  const initialStateLoadedRef = useRef(false);
  const hasEstablishedConnectionRef = useRef(false);

  const processPlaybackState = useCallback(
    (data) => {
      if (!data) return;

      if (data.context?.uri) {
        if (!data.context.uri.includes("collection")) {
          localStorage.removeItem("playingLikedSongs");
        }
        const mixFlags = Object.keys(localStorage).filter((key) =>
          key.startsWith("playingMix-")
        );
        mixFlags.forEach((flag) => {
          if (localStorage.getItem(flag) !== data.context.uri) {
            localStorage.removeItem(flag);
          }
        });
      } else if (!data.item) {
        localStorage.removeItem("playingLikedSongs");
        Object.keys(localStorage)
          .filter((key) => key.startsWith("playingMix-"))
          .forEach((key) => localStorage.removeItem(key));
      }

      setCurrentPlayback({
        ...data,
        device: {
          ...data.device,
          volume_percent: data.device?.volume_percent,
        },
        shuffle_state: data.shuffle_state,
        repeat_state: data.repeat_state,
      });

      setIsShuffleEnabled(data.shuffle_state);
      setCurrentRepeat(data.repeat_state);

      if (data?.item) {
        setCurrentlyPlayingTrackUri(data.item.uri);

        if (data.item.type === "track") {
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

          if (
            !currentlyPlayingAlbum ||
            currentlyPlayingAlbum.id !== currentAlbum.id ||
            (currentAlbum.type === "local" &&
              currentAlbum.uri !== currentlyPlayingAlbum.uri)
          ) {
            setCurrentlyPlayingAlbum(currentAlbum);
            setAlbumsQueue((prevQueue) => {
              const updatedQueue = prevQueue.filter((album) =>
                album.type === "local"
                  ? album.uri !== currentAlbum.uri
                  : album.id !== currentAlbum.id
              );
              return [currentAlbum, ...updatedQueue];
            });
          }
        } else if (data.item.type === "episode") {
          const currentShow = data.item.show;
          if (
            !currentlyPlayingAlbum ||
            currentlyPlayingAlbum.id !== currentShow.id
          ) {
            setCurrentlyPlayingAlbum(currentShow);
            setAlbumsQueue((prevQueue) => {
              const updatedQueue = prevQueue.filter(
                (album) => album.id !== currentShow.id
              );
              return [currentShow, ...updatedQueue];
            });
          }
        }
      }

      initialStateLoadedRef.current = true;
    },
    [currentlyPlayingAlbum]
  );

  const fetchInitialPlaybackState = useCallback(async () => {
    if (!accessToken) return;

    const now = Date.now();
    if (now - lastFetchTimeRef.current < 3000) {
      return;
    }

    lastFetchTimeRef.current = now;

    try {
      const response = await fetch(
        "https://api.spotify.com/v1/me/player?type=episode,track",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 204) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
        setCurrentlyPlayingTrackUri(null);
        localStorage.removeItem("playingLikedSongs");
        initialStateLoadedRef.current = true;
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          localStorage.removeItem("playingLikedSongs");
        } else {
          processPlaybackState(data);
        }
        initialStateLoadedRef.current = true;
      }
    } catch (error) {}
  }, [accessToken, processPlaybackState]);

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

    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!accessToken || webSocketRef.current || isConnectingRef.current || hasEstablishedConnectionRef.current) {
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

        const ping = () => {
          if (
            webSocketRef.current &&
            webSocketRef.current.readyState === WebSocket.OPEN
          ) {
            webSocketRef.current.send(JSON.stringify({ type: "ping" }));
          }
        };

        ping();
        pingIntervalRef.current = setInterval(ping, 15000);
      };

      webSocketRef.current.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if ("headers" in message && message.headers["Spotify-Connection-Id"]) {
          connectionIdRef.current = message.headers["Spotify-Connection-Id"];
          hasEstablishedConnectionRef.current = true;

          try {
            const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(
              connectionIdRef.current
            )}`;

            const response = await fetch(url, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            });

            if (response.ok) {
              if (!initialStateLoadedRef.current) {
                await fetchInitialPlaybackState();
              }
            }
          } catch (error) {}
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
          hasEstablishedConnectionRef.current = false;
        }
      };

      webSocketRef.current.onclose = () => {
        isConnectingRef.current = false;

        if (webSocketRef.current) {
          cleanupWebSocket();
        }

        if (connectionErrorsRef.current <= 3) {
          hasEstablishedConnectionRef.current = false;
          const backoffTime = Math.min(
            1000 * Math.pow(2, connectionErrorsRef.current),
            30000
          );

          retryTimeoutRef.current = setTimeout(() => {
            if (!initialStateLoadedRef.current) {
              fetchInitialPlaybackState();
            }
            connectWebSocket();
          }, backoffTime);
        } else if (!initialStateLoadedRef.current) {
          fetchInitialPlaybackState();
        }
      };
    } catch (error) {
      isConnectingRef.current = false;
      connectionErrorsRef.current += 1;
    }
  }, [
    accessToken,
    fetchInitialPlaybackState,
    processPlaybackState,
    cleanupWebSocket,
  ]);

  useEffect(() => {
    if (accessToken) {
      isConnectingRef.current = false;
      connectionErrorsRef.current = 0;
      initialStateLoadedRef.current = false;

      fetchInitialPlaybackState();
      
      if (!hasEstablishedConnectionRef.current) {
        connectWebSocket();
      }
    }

    return () => {
      if (!hasEstablishedConnectionRef.current) {
        cleanupWebSocket();
      }
    };
  }, [
    accessToken,
    connectWebSocket,
    fetchInitialPlaybackState,
    cleanupWebSocket,
  ]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setIsShuffleEnabled(currentPlayback.shuffle_state);
      localStorage.setItem("shuffleEnabled", currentPlayback.shuffle_state);
    }
    if (currentPlayback?.repeat_state) {
      setCurrentRepeat(currentPlayback.repeat_state);
      localStorage.setItem("repeatMode", currentPlayback.repeat_state);
    }
  }, [currentPlayback?.shuffle_state, currentPlayback?.repeat_state]);

  const fetchCurrentPlayback = useCallback(() => {
    return Promise.resolve(currentPlayback);
  }, [currentPlayback]);

  return {
    currentPlayback,
    currentlyPlayingTrackUri,
    currentlyPlayingAlbum,
    albumsQueue,
    recentAlbums,
    playlists,
    artists,
    radio,
    isShuffleEnabled,
    currentRepeat,
    setCurrentPlayback,
    setCurrentlyPlayingTrackUri,
    setCurrentlyPlayingAlbum,
    setAlbumsQueue,
    setRecentAlbums,
    setPlaylists,
    setArtists,
    setRadio,
    setIsShuffleEnabled,
    setCurrentRepeat,
    fetchCurrentPlayback,
  };
}
