import { useState, useCallback, useRef, useEffect } from "react";
import {
  useNocturned,
  getGlobalWebSocket,
  getBluetoothConnectionState,
  subscribeBluetoothConnectionState,
  getAppReadyState,
  subscribeAppReadyState,
  getAppSubscribedState,
  subscribeAppSubscribedState,
  getSpotifyAuthState,
  subscribeSpotifyAuthState,
  getSpotifySkippedState,
  subscribeSpotifySkippedState,
} from "./useNocturned";
type PendingRequest = {
  resolve: (value: UiLooseData | PromiseLike<UiLooseData>) => void;
  reject: (reason?: unknown) => void;
};
type SpotifyCommandReadiness = {
  wsConnected: boolean;
  appReady: boolean;
  spotifyAuthenticated: boolean;
  spotifySkipped: boolean;
  appSubscribed: boolean;
  appHasLifetime: boolean;
  platform: string | null;
};

/** @typedef {import("@schema/spotify").SpotifyPlayerPlayRequest} SpotifyPlayerPlayRequest */
/** @typedef {import("@schema/spotify").SpotifyPlayerSeekRequest} SpotifyPlayerSeekRequest */
/** @typedef {import("@schema/spotify").SpotifyPlayerVolumeRequest} SpotifyPlayerVolumeRequest */
/** @typedef {import("@schema/spotify").SpotifyPlayerShuffleRequest} SpotifyPlayerShuffleRequest */
/** @typedef {import("@schema/spotify").SpotifyPlayerRepeatRequest} SpotifyPlayerRepeatRequest */
/** @typedef {import("@schema/spotify").SpotifyPlayerTransferRequest} SpotifyPlayerTransferRequest */
/** @typedef {import("@schema/spotify").SpotifyMePlaylistsRequest} SpotifyMePlaylistsRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTopTracksRequest} SpotifyMeTopTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTopArtistsRequest} SpotifyMeTopArtistsRequest */
/** @typedef {import("@schema/spotify").SpotifyMeRecentlyPlayedRequest} SpotifyMeRecentlyPlayedRequest */
/** @typedef {import("@schema/spotify").SpotifyMeShowsRequest} SpotifyMeShowsRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTracksContainsRequest} SpotifyMeTracksContainsRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTracksRemoveRequest} SpotifyMeTracksRemoveRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTracksSaveRequest} SpotifyMeTracksSaveRequest */
/** @typedef {import("@schema/spotify").SpotifyArtistGetRequest} SpotifyArtistGetRequest */
/** @typedef {import("@schema/spotify").SpotifyArtistTopTracksRequest} SpotifyArtistTopTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyAlbumGetRequest} SpotifyAlbumGetRequest */
/** @typedef {import("@schema/spotify").SpotifyAlbumTracksRequest} SpotifyAlbumTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyPlaylistGetRequest} SpotifyPlaylistGetRequest */
/** @typedef {import("@schema/spotify").SpotifyPlaylistTracksRequest} SpotifyPlaylistTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyShowGetRequest} SpotifyShowGetRequest */
/** @typedef {import("@schema/spotify").SpotifyShowEpisodesRequest} SpotifyShowEpisodesRequest */
/** @typedef {import("@schema/spotify").SpotifyImageFetchRequest} SpotifyImageFetchRequest */

const SPOTIFY_IMAGE_FETCH_TIMEOUT_MS = 30000;

const generateUUID = () => crypto.randomUUID();

export const isSpotifyCommandSessionReady = ({
  wsConnected,
  appReady,
  spotifyAuthenticated,
  spotifySkipped,
  appSubscribed,
  appHasLifetime,
  platform,
}: SpotifyCommandReadiness) =>
  wsConnected &&
  appReady &&
  spotifyAuthenticated &&
  !spotifySkipped &&
  (appSubscribed || appHasLifetime || platform === "web");

export function useSpotifyWebSocket() {
  const { wsConnected, addMessageListener, removeMessageListener } =
    useNocturned();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  const listenerIdRef = useRef<string | null>(null);
  const [deviceConnected, setDeviceConnected] = useState(() => {
    const state = getBluetoothConnectionState();
    return Boolean(state?.connected);
  });
  const [appReady, setAppReady] = useState(() => {
    return getAppReadyState().ready;
  });
  const [appReadyGeneration, setAppReadyGeneration] = useState(() => {
    return getAppReadyState().generation;
  });
  const [spotifyAuthenticated, setSpotifyAuthenticated] = useState(() => {
    return getSpotifyAuthState();
  });
  const [spotifySkipped, setSpotifySkipped] = useState(() => {
    return getSpotifySkippedState();
  });
  const [appSubscribed, setAppSubscribed] = useState(true);
  const [appHasLifetime, setAppHasLifetime] = useState(true);

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
    const unsubscribe = subscribeAppReadyState((state) => {
      setAppReady(state.ready);
      setAppReadyGeneration(state.generation);
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

  useEffect(() => {
    const unsubscribe = subscribeSpotifySkippedState((isSkipped) => {
      setSpotifySkipped(isSkipped);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppSubscribedState((state) => {
      setAppSubscribed(state.subscribed);
      setAppHasLifetime(!!state.hasLifetime);
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const sendSpotifyCommand = useCallback(
    (
      method: string,
      params: object = {},
      signal: AbortSignal | null = null,
    ) => {
      return new Promise<UiLooseData>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Request cancelled"));
          return;
        }

        if (getSpotifySkippedState()) {
          reject(new Error("Spotify authorization was skipped"));
          return;
        }

        if (!getAppReadyState().ready) {
          reject(new Error("App session not ready"));
          return;
        }

        const subState = getAppSubscribedState();
        if (
          !subState.subscribed &&
          !subState.hasLifetime &&
          getAppReadyState().platform !== "web"
        ) {
          reject(new Error("Subscription required"));
          return;
        }

        const globalWs = getGlobalWebSocket();

        if (!globalWs) {
          reject(new Error("WebSocket not available"));
          return;
        }

        if (globalWs.readyState === WebSocket.CONNECTING) {
          const timeoutId = setTimeout(() => {
            reject(new Error("WebSocket connection timeout"));
          }, 10000);

          const resolveWithCleanup = (
            value: UiLooseData | PromiseLike<UiLooseData>,
          ) => {
            clearTimeout(timeoutId);
            resolve(value);
          };

          const rejectWithCleanup = (reason?: unknown) => {
            clearTimeout(timeoutId);
            reject(reason);
          };

          const waitForConnection = () => {
            if (signal?.aborted) {
              rejectWithCleanup(new Error("Request cancelled"));
              return;
            }

            const ws = getGlobalWebSocket();
            if (!ws) {
              rejectWithCleanup(
                new Error("WebSocket disconnected while waiting"),
              );
              return;
            }

            if (ws.readyState === WebSocket.OPEN) {
              sendMessage(
                ws,
                method,
                params,
                resolveWithCleanup,
                rejectWithCleanup,
                signal,
              );
            } else if (
              ws.readyState === WebSocket.CLOSED ||
              ws.readyState === WebSocket.CLOSING
            ) {
              rejectWithCleanup(new Error("WebSocket closed while waiting"));
            } else {
              setTimeout(waitForConnection, 100);
            }
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

        sendMessage(globalWs, method, params, resolve, reject, signal);
      });
    },
    [wsConnected, deviceConnected],
  );

  const sendMessage = (
    ws: WebSocket,
    method: string,
    params: object,
    resolve: (value: UiLooseData | PromiseLike<UiLooseData>) => void,
    reject: (reason?: unknown) => void,
    signal: AbortSignal | null,
  ) => {
    const messageId = generateUUID();
    const message = {
      type: "request",
      id: messageId,
      method,
      params,
    };

    const timeoutId = setTimeout(() => {
      if (pendingRequestsRef.current.has(messageId)) {
        pendingRequestsRef.current.delete(messageId);
        reject(new Error("Request timeout"));
      }
    }, 30000);

    const abortHandler = () => {
      if (pendingRequestsRef.current.has(messageId)) {
        clearTimeout(timeoutId);
        pendingRequestsRef.current.delete(messageId);
        reject(new Error("Request cancelled"));
      }
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler);
    }

    pendingRequestsRef.current.set(messageId, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }
        reject(reason);
      },
    });

    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`WebSocket send failed: ${message}`);
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      reject(err);
      pendingRequestsRef.current.delete(messageId);
    }
  };

  const handleSpotifyResponse = useCallback((data) => {
    if ((data.type === "response" || data.type === "error") && data.id) {
      const messageId = data.id;
      const pendingRequest = pendingRequestsRef.current.get(messageId);

      if (pendingRequest) {
        pendingRequestsRef.current.delete(messageId);

        if (data.error) {
          pendingRequest.reject(
            new Error(
              typeof data.error === "string"
                ? data.error
                : data.error.message || "Spotify command failed",
            ),
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

  const isSpotifyReady = isSpotifyCommandSessionReady({
    wsConnected,
    appReady,
    spotifyAuthenticated,
    spotifySkipped,
    appSubscribed,
    appHasLifetime,
    platform: getAppReadyState().platform,
  });

  useEffect(() => {
    listenerIdRef.current = addMessageListener(
      "spotify-ws",
      handleSpotifyResponse,
    );

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
        listenerIdRef.current = null;
      }
    };
  }, [addMessageListener, removeMessageListener, handleSpotifyResponse]);

  const getPlayerState = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand(
          "spotify.player.state",
          {},
          signal,
        );
        return result;
      } catch (err) {
        if (!signal?.aborted) {
          setError(err.message);
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const playTrack = useCallback(
    async (trackUri, contextUri = null, uris = null, deviceId = null) => {
      try {
        setIsLoading(true);
        setError(null);

        /** @type {SpotifyPlayerPlayRequest} */
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

        /** @type {SpotifyPlayerPlayRequest} */
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
        /** @type {SpotifyPlayerSeekRequest} */
        const params = {
          position_ms: positionMs,
        };
        const result = await sendSpotifyCommand("spotify.player.seek", params);
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
        /** @type {SpotifyPlayerVolumeRequest} */
        const params = {
          volume_percent: Math.max(0, Math.min(100, Math.round(volumePercent))),
        };
        const result = await sendSpotifyCommand(
          "spotify.player.volume",
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

  const toggleShuffle = useCallback(
    async (state) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlayerShuffleRequest} */
        const params = { state: Boolean(state) };
        const result = await sendSpotifyCommand(
          "spotify.player.shuffle",
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

  const setRepeatMode = useCallback(
    async (state) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlayerRepeatRequest} */
        const params = {
          state,
        };
        const result = await sendSpotifyCommand(
          "spotify.player.repeat",
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

  const transferPlayback = useCallback(
    async (deviceId, shouldPlay = false) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlayerTransferRequest} */
        const params = {
          device_ids: [deviceId],
          play: shouldPlay,
        };
        const result = await sendSpotifyCommand(
          "spotify.player.transfer",
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
    async (params = { limit: 5 }, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMePlaylistsRequest} */
        const typedParams = params;
        const result = await sendSpotifyCommand(
          "spotify.me.playlists",
          typedParams,
          signal,
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

  const getUserTopTracks = useCallback(
    async (params = { limit: 5, time_range: "medium_term" }) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeTopTracksRequest} */
        const typedParams = params;
        const result = await sendSpotifyCommand(
          "spotify.me.top_tracks",
          typedParams,
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

  const getUserTopArtists = useCallback(
    async (params = { limit: 5 }, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeTopArtistsRequest} */
        const typedParams = params;
        const result = await sendSpotifyCommand(
          "spotify.me.top_artists",
          typedParams,
          signal,
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

  const getUserProfile = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand(
          "spotify.me.profile",
          {},
          signal,
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

  const getUserTracks = useCallback(
    async (params = { limit: 5 }, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await sendSpotifyCommand(
          "spotify.me.tracks",
          params,
          signal,
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

  const getRecentlyPlayed = useCallback(
    async (params = {}, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeRecentlyPlayedRequest} */
        const typedParams = params;
        const result = await sendSpotifyCommand(
          "spotify.me.recently_played",
          typedParams,
          signal,
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

  const checkIsTrackSaved = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeTracksContainsRequest} */
        const params = {
          ids: [trackId],
        };
        const result = await sendSpotifyCommand(
          "spotify.me.tracks.contains",
          params,
        );
        if (result && result.results) {
          return result.results;
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

  const saveTrack = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeTracksSaveRequest} */
        const params = {
          ids: [trackId],
        };
        const result = await sendSpotifyCommand(
          "spotify.me.tracks.save",
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

  const removeTrack = useCallback(
    async (trackId) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeTracksRemoveRequest} */
        const params = {
          ids: [trackId],
        };
        const result = await sendSpotifyCommand(
          "spotify.me.tracks.remove",
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

  const getArtist = useCallback(
    async (artistId) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyArtistGetRequest} */
        const params = { contentId: artistId };
        const result = await sendSpotifyCommand("spotify.artist.get", params);
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
        /** @type {SpotifyArtistTopTracksRequest} */
        const params = { contentId: artistId };
        const result = await sendSpotifyCommand(
          "spotify.artist.top_tracks",
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

  const getAlbum = useCallback(
    async (albumId) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyAlbumGetRequest} */
        const params = { contentId: albumId };
        const result = await sendSpotifyCommand("spotify.album.get", params);
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
        /** @type {SpotifyAlbumTracksRequest} */
        const requestParams = {
          contentId: albumId,
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
    async (playlistId, fields = null, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlaylistGetRequest} */
        const params = { contentId: playlistId };
        if (fields) {
          params.fields = fields;
        }
        const result = await sendSpotifyCommand(
          "spotify.playlist.get",
          params,
          signal,
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

  const getPlaylistTracks = useCallback(
    async (playlistId, params = {}) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlaylistTracksRequest} */
        const requestParams = {
          contentId: playlistId,
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
        /** @type {SpotifyShowGetRequest} */
        const params = { contentId: showId };
        const result = await sendSpotifyCommand("spotify.show.get", params);
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
        /** @type {SpotifyShowEpisodesRequest} */
        const requestParams = {
          contentId: showId,
          ...params,
        };
        const result = await sendSpotifyCommand(
          "spotify.show.episodes",
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

  const getUserShows = useCallback(
    async (params = { limit: 5 }, signal: AbortSignal | null = null) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyMeShowsRequest} */
        const typedParams = params;
        const result = await sendSpotifyCommand(
          "spotify.me.shows",
          typedParams,
          signal,
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

  const fetchImage = useCallback(
    async (url: string, signal: AbortSignal | null = null) => {
      if (signal?.aborted) {
        throw new Error("Request cancelled");
      }

      const timeoutError = new Error("Spotify image fetch timed out");
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      /** @type {SpotifyImageFetchRequest} */
      const params = { url };
      const fetchPromise = sendSpotifyCommand(
        "spotify.image.fetch",
        params,
        signal,
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(timeoutError);
        }, SPOTIFY_IMAGE_FETCH_TIMEOUT_MS);
      });

      const abortPromise = signal
        ? new Promise<never>((_, reject) => {
            const abortHandler = () => {
              reject(new Error("Request cancelled"));
            };
            signal.addEventListener("abort", abortHandler, { once: true });
          })
        : null;

      try {
        const promises = abortPromise
          ? [fetchPromise, timeoutPromise, abortPromise]
          : [fetchPromise, timeoutPromise];
        const result = await Promise.race(promises);
        return result;
      } catch (err) {
        if (err === timeoutError) {
          fetchPromise.catch(() => {});
        }
        throw err;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },
    [sendSpotifyCommand],
  );

  return {
    wsConnected,
    deviceConnected,
    appReady,
    appReadyGeneration,
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
