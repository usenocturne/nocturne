import { useState, useCallback, useRef, useEffect } from "react";
import {
  useNocturned,
  getGlobalWebSocket,
  getBluetoothConnectionState,
  subscribeBluetoothConnectionState,
  getEaSessionState,
  subscribeEaSessionState,
  getSpotifyAuthState,
  subscribeSpotifyAuthState,
} from "./useNocturned";

const extractAfterFromNextUrl = (nextUrl) => {
  if (!nextUrl) return null;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get("after");
  } catch (error) {
    console.error("Error extracting after timestamp from URL:", error);
    return null;
  }
};

export function useSpotifyWebSocket() {
  const { wsConnected, addMessageListener, removeMessageListener } =
    useNocturned();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const pendingRequestsRef = useRef(new Map());
  const listenerIdRef = useRef(null);
  const messageQueueRef = useRef([]);
  const [deviceConnected, setDeviceConnected] = useState(() => {
    const state = getBluetoothConnectionState();
    return Boolean(state?.connected);
  });
  const [eaSessionReady, setEaSessionReady] = useState(() => {
    return getEaSessionState();
  });
  const [spotifyAuthenticated, setSpotifyAuthenticated] = useState(() => {
    return getSpotifyAuthState();
  });

  useEffect(() => {
    const unsubscribe = subscribeBluetoothConnectionState((state) => {
      setDeviceConnected(Boolean(state?.connected));
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeEaSessionState((isReady) => {
      setEaSessionReady(isReady);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSpotifyAuthState((isAuthenticated) => {
      setSpotifyAuthenticated(isAuthenticated);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const sendSpotifyCommand = useCallback(
    (method, params = {}) => {
      return new Promise((resolve, reject) => {
        const globalWs = getGlobalWebSocket();

        if (!globalWs) {
          reject(new Error("WebSocket not available"));
          return;
        }

        if (globalWs.readyState === WebSocket.CONNECTING) {
          const waitForConnection = () => {
            const ws = getGlobalWebSocket();
            if (!ws) {
              reject(new Error("WebSocket disconnected while waiting"));
              return;
            }

            if (ws.readyState === WebSocket.OPEN) {
              sendMessage(ws, method, params, resolve, reject);
            } else if (
              ws.readyState === WebSocket.CLOSED ||
              ws.readyState === WebSocket.CLOSING
            ) {
              reject(new Error("WebSocket closed while waiting"));
            } else {
              setTimeout(waitForConnection, 100);
            }
          };

          const timeoutId = setTimeout(() => {
            reject(new Error("WebSocket connection timeout"));
          }, 10000);

          const originalResolve = resolve;
          const originalReject = reject;

          resolve = (...args) => {
            clearTimeout(timeoutId);
            originalResolve(...args);
          };

          reject = (...args) => {
            clearTimeout(timeoutId);
            originalReject(...args);
          };

          waitForConnection();
          return;
        }

        if (
          globalWs.readyState === WebSocket.CLOSED ||
          globalWs.readyState === WebSocket.CLOSING
        ) {
          reject(new Error("WebSocket is closed"));
          return;
        }

        sendMessage(globalWs, method, params, resolve, reject);
      });
    },
    [wsConnected, deviceConnected],
  );

  const sendMessage = (ws, method, params, resolve, reject) => {
    const messageId = crypto.randomUUID();
    const message = {
      type: "request",
      id: messageId,
      method,
      params,
    };

    pendingRequestsRef.current.set(messageId, { resolve, reject });

    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(`WebSocket send failed: ${err.message}`);
      reject(err);
      pendingRequestsRef.current.delete(messageId);
    }

    setTimeout(() => {
      if (pendingRequestsRef.current.has(messageId)) {
        pendingRequestsRef.current.delete(messageId);
        reject(new Error("Request timeout"));
      }
    }, 30000);
  };

  const handleSpotifyResponse = useCallback((data) => {
    if (data.type === "response" && data.id) {
      const messageId = data.id;
      const pendingRequest = pendingRequestsRef.current.get(messageId);

      if (pendingRequest) {
        pendingRequestsRef.current.delete(messageId);

        if (data.error) {
          pendingRequest.reject(
            new Error(data.error.message || "Spotify command failed"),
          );
        } else {
          let result = data.result;
          if (result && typeof result === "object" && result.result) {
            result = result.result;
          }
          pendingRequest.resolve(result);
        }
      }
    }
  }, []);

  const isSpotifyReady = wsConnected && eaSessionReady && spotifyAuthenticated;

  useEffect(() => {
    if (!listenerIdRef.current) {
      listenerIdRef.current = addMessageListener(
        "spotify-ws",
        handleSpotifyResponse,
      );
    }

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [addMessageListener, removeMessageListener, handleSpotifyResponse]);

  useEffect(() => {
    if (wsConnected && deviceConnected && eaSessionReady && spotifyAuthenticated && messageQueueRef.current.length > 0) {
      const queue = [...messageQueueRef.current];
      messageQueueRef.current = [];

      queue.forEach(({ method, params, resolve, reject }) => {
        sendSpotifyCommand(method, params).then(resolve).catch(reject);
      });
    }
  }, [wsConnected, deviceConnected, eaSessionReady, spotifyAuthenticated, sendSpotifyCommand]);

  const getPlayerState = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.player.state");
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const playTrack = useCallback(
    async (trackUri, contextUri = null, uris = null, deviceId = null) => {
      try {
        setIsLoading(true);
        setError(null);

        const params = {};
        if (contextUri) {
          params.context_uri = contextUri;
          if (trackUri) {
            params.offset = { uri: trackUri };
          }
        } else if (uris && uris.length > 0) {
          params.uris = uris;
        } else if (trackUri) {
          params.uris = [trackUri];
        }
        if (deviceId) {
          params.device_id = deviceId;
        }

        const result = await sendSpotifyCommand("spotify.player.play", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const playTrackAtPosition = useCallback(
    async (contextUri, position, deviceId = null) => {
      try {
        setIsLoading(true);
        setError(null);

        const params = {
          context_uri: contextUri,
          offset: { position },
        };

        if (deviceId) {
          params.device_id = deviceId;
        }

        const result = await sendSpotifyCommand("spotify.player.play", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const pausePlayback = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.player.pause");
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const skipToNext = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.player.next");
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const skipToPrevious = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.player.previous");
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const seekToPosition = useCallback(
    async (positionMs) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.player.seek", {
          position_ms: positionMs,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const setVolume = useCallback(
    async (volumePercent) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.player.volume", {
          volume_percent: Math.max(0, Math.min(100, Math.round(volumePercent))),
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const toggleShuffle = useCallback(
    async (state) => {
      try {
        setIsLoading(true);
        setError(null);
        const stateString = String(Boolean(state));
        const result = await sendSpotifyCommand("spotify.player.shuffle", {
          state: stateString,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const setRepeatMode = useCallback(
    async (state) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.player.repeat", {
          state,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const transferPlayback = useCallback(
    async (deviceId, shouldPlay = false) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.player.transfer", {
          device_ids: [deviceId],
          play: shouldPlay,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getDevices = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.devices");
      if (result && result.devices && typeof result.devices === "object") {
        const devicesArray = Object.values(result.devices);
        return { devices: devicesArray };
      }
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const getUserPlaylists = useCallback(
    async (params = { limit: 5 }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.playlists", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserTopTracks = useCallback(
    async (params = { limit: 5, time_range: "medium_term" }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.topTracks", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserTopArtists = useCallback(
    async (params = { limit: 5 }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand(
          "spotify.me.topArtists",
          params,
        );
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await sendSpotifyCommand("spotify.me.profile");
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const getUserTracks = useCallback(
    async (params = { limit: 5 }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.tracks", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getRecentlyPlayed = useCallback(
    async (params = { limit: 30, additional_types: "track,episode" }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand(
          "spotify.me.recentlyPlayed",
          params,
        );

        if (result && result.next) {
          result.nextAfter = extractAfterFromNextUrl(result.next);
        }

        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getNextRecentlyPlayed = useCallback(
    async (afterTimestamp, additionalParams = {}) => {
      const params = {
        limit: 30,
        additional_types: "track,episode",
        after: afterTimestamp,
        ...additionalParams,
      };
      return getRecentlyPlayed(params);
    },
    [getRecentlyPlayed],
  );

  const checkIsTrackSaved = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.tracks.contains", {
          ids: [trackId],
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const saveTrack = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.tracks.save", {
          ids: [trackId],
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const removeTrack = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.tracks.remove", {
          ids: [trackId],
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getArtist = useCallback(
    async (artistId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.artist.get", {
          id: artistId,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getArtistTopTracks = useCallback(
    async (artistId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.artist.topTracks", {
          id: artistId,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getAlbum = useCallback(
    async (albumId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.album.get", {
          id: albumId,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getAlbumTracks = useCallback(
    async (albumId, params = {}) => {
      try {
        setIsLoading(true);
        setError(null);
        const requestParams = {
          id: albumId,
          limit: 50,
          ...params,
        };
        const result = await sendSpotifyCommand(
          "spotify.album.tracks",
          requestParams,
        );
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getPlaylist = useCallback(
    async (playlistId, fields = null) => {
      try {
        setIsLoading(true);
        setError(null);
        const params = { id: playlistId };
        if (fields) {
          params.fields = fields;
        }
        const result = await sendSpotifyCommand("spotify.playlist.get", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getPlaylistTracks = useCallback(
    async (playlistId, params = {}) => {
      try {
        setIsLoading(true);
        setError(null);
        const requestParams = {
          id: playlistId,
          limit: 50,
          ...params,
        };
        const result = await sendSpotifyCommand(
          "spotify.playlist.tracks",
          requestParams,
        );
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getShow = useCallback(
    async (showId) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.show.get", {
          content_id: showId,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getShowEpisodes = useCallback(
    async (showId, params = { limit: 5 }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.show.episodes", {
          content_id: showId,
          ...params,
        });
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserShows = useCallback(
    async (params = { limit: 5 }) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand("spotify.me.shows", params);
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const fetchImage = useCallback(
    async (url) => {
      try {
        const result = await sendSpotifyCommand("spotify.image.fetch", { url });
        return result;
      } catch (err) {
        console.error("Error fetching image:", err);
        throw err;
      }
    },
    [sendSpotifyCommand],
  );

  return {
    wsConnected,
    deviceConnected,
    isSpotifyReady,
    isLoading,
    error,
    sendSpotifyCommand,

    getPlayerState,
    playTrack,
    playTrackAtPosition,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    setVolume,
    toggleShuffle,
    setRepeatMode,
    transferPlayback,

    getDevices,
    getUserPlaylists,
    getUserTopTracks,
    getUserTopArtists,
    getUserProfile,
    getUserTracks,
    getRecentlyPlayed,
    getNextRecentlyPlayed,
    checkIsTrackSaved,
    saveTrack,
    removeTrack,

    getArtist,
    getArtistTopTracks,
    getAlbum,
    getAlbumTracks,
    getPlaylist,
    getPlaylistTracks,
    getShow,
    getShowEpisodes,
    getUserShows,

    fetchImage,
  };
}
