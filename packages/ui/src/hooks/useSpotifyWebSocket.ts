import { useState, useCallback, useRef, useEffect } from "react";
import { getErrorMessage } from "../utils/helpers";
import type { WsResponse } from "../types";
import {
  dispatchSpotifyRequest,
  waitForSpotifySocket,
  withSpotifyImageDeadline,
  type PendingSpotifyRequest,
} from "./spotifyRequestLifecycle";
import {
  normalizeSpotifyDevices,
  type SpotifyMethodResponses,
} from "./spotifyResponses";

type PlayParams = {
  context_uri?: string;
  uris?: string[];
  offset?: { uri: string } | { position: number };
  device_id?: string;
};
export type PageParams = {
  fields?: string;
  limit?: number;
  offset?: number;
  before?: number;
  after?: number;
  time_range?: string;
};
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
const LOCAL_FILE_IMAGE_FALLBACK = "/images/not-playing.webp";

export const getSpotifyImageFetchFallback = (url: string): string | null =>
  url.startsWith("spotify:localfileimage:") ||
  url.startsWith("https://spotify:localfileimage:") ||
  url.startsWith("http://spotify:localfileimage:")
    ? LOCAL_FILE_IMAGE_FALLBACK
    : null;

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

const hasNonEmptyStringField = (value: object, keys: string[]) =>
  keys.some((key) => {
    const field = Reflect.get(value, key);
    return typeof field === "string" && field.trim().length > 0;
  });

export const isMetadataOnlyLyricsRequest = (method: string, params: object) =>
  method === "spotify.track.lyrics" &&
  hasNonEmptyStringField(params, ["trackName", "track_name"]) &&
  hasNonEmptyStringField(params, ["artistName", "artist_name"]) &&
  !hasNonEmptyStringField(params, [
    "contentId",
    "content_id",
    "trackId",
    "track_id",
    "id",
  ]);

export function useSpotifyWebSocket() {
  const { wsConnected, addMessageListener, removeMessageListener } =
    useNocturned();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequestsRef = useRef(new Map<string, PendingSpotifyRequest>());
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

  function requestSpotify<M extends keyof SpotifyMethodResponses>(
    method: M,
    params?: object,
    signal?: AbortSignal | null,
  ): Promise<SpotifyMethodResponses[M]>;
  function requestSpotify<T = unknown>(
    method: string,
    params?: object,
    signal?: AbortSignal | null,
  ): Promise<T>;
  async function requestSpotify(
    method: string,
    params: object = {},
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    if (signal?.aborted) throw new Error("Request cancelled");
    if (
      getSpotifySkippedState() &&
      !isMetadataOnlyLyricsRequest(method, params)
    )
      throw new Error("Spotify authorization was skipped");
    if (!getAppReadyState().ready) throw new Error("App session not ready");
    const subState = getAppSubscribedState();
    if (
      !subState.subscribed &&
      !subState.hasLifetime &&
      getAppReadyState().platform !== "web"
    )
      throw new Error("Subscription required");
    const socket = getGlobalWebSocket();
    if (!socket) throw new Error("WebSocket not available");
    const readySocket =
      socket.readyState === WebSocket.CONNECTING
        ? await waitForSpotifySocket(getGlobalWebSocket, signal)
        : socket;
    if (
      readySocket.readyState === WebSocket.CLOSED ||
      readySocket.readyState === WebSocket.CLOSING
    )
      throw new Error("WebSocket is closed");
    return dispatchSpotifyRequest(
      readySocket,
      pendingRequestsRef.current,
      method,
      params,
      signal,
    );
  }
  const sendSpotifyCommand = useCallback(requestSpotify, [
    wsConnected,
    deviceConnected,
  ]);

  const handleSpotifyResponse = useCallback((data: WsResponse) => {
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
                : getErrorMessage(data.error) || "Spotify command failed",
            ),
          );
        } else {
          let result = data.result;
          if (
            result &&
            typeof result === "object" &&
            "result" in result &&
            result.result
          ) {
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
          setError(getErrorMessage(err));
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const playTrack = useCallback(
    async (
      trackUri: string | null,
      contextUri: string | null = null,
      uris: string[] | null = null,
      deviceId: string | null = null,
    ) => {
      try {
        setIsLoading(true);
        setError(null);

        /** @type {SpotifyPlayerPlayRequest} */
        const params: PlayParams = {};
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const playTrackAtPosition = useCallback(
    async (
      contextUri: string,
      position: number,
      deviceId: string | null = null,
    ) => {
      try {
        setIsLoading(true);
        setError(null);

        /** @type {SpotifyPlayerPlayRequest} */
        const params: PlayParams = {
          context_uri: contextUri,
          offset: { position },
        };

        if (deviceId) {
          params.device_id = deviceId;
        }

        await sendSpotifyCommand("spotify.player.play", params);
        return true;
      } catch (err) {
        setError(getErrorMessage(err));
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
      setError(getErrorMessage(err));
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
      setError(getErrorMessage(err));
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
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const seekToPosition = useCallback(
    async (positionMs: number) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const setVolume = useCallback(
    async (volumePercent: number) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const toggleShuffle = useCallback(
    async (state: boolean) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const setRepeatMode = useCallback(
    async (state: "off" | "track" | "context") => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const transferPlayback = useCallback(
    async (deviceId: string, shouldPlay = false) => {
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
        setError(getErrorMessage(err));
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
      return { devices: normalizeSpotifyDevices(result) };
    } catch (err) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sendSpotifyCommand]);

  const getUserPlaylists = useCallback(
    async (
      params: PageParams = { limit: 5 },
      signal: AbortSignal | null = null,
    ) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserTopTracks = useCallback(
    async (params: PageParams = { limit: 5, time_range: "medium_term" }) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserTopArtists = useCallback(
    async (
      params: PageParams = { limit: 5 },
      signal: AbortSignal | null = null,
    ) => {
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
        setError(getErrorMessage(err));
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserTracks = useCallback(
    async (
      params: PageParams = { limit: 5 },
      signal: AbortSignal | null = null,
    ) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getRecentlyPlayed = useCallback(
    async (params: PageParams = {}, signal: AbortSignal | null = null) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const checkIsTrackSaved = useCallback(
    async (trackId: string) => {
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
        if (!Array.isArray(result) && result?.results) {
          return result.results;
        }
        return result;
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const saveTrack = useCallback(
    async (trackId: string) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const removeTrack = useCallback(
    async (trackId: string) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getArtist = useCallback(
    async (artistId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyArtistGetRequest} */
        const params = { contentId: artistId };
        const result = await sendSpotifyCommand("spotify.artist.get", params);
        return result;
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getArtistTopTracks = useCallback(
    async (artistId: string) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getAlbum = useCallback(
    async (albumId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyAlbumGetRequest} */
        const params = { contentId: albumId };
        const result = await sendSpotifyCommand("spotify.album.get", params);
        return result;
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getAlbumTracks = useCallback(
    async (albumId: string, params: PageParams = {}) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getPlaylist = useCallback(
    async (
      playlistId: string,
      fields: string | null = null,
      signal: AbortSignal | null = null,
    ) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyPlaylistGetRequest} */
        const params: { contentId: string; fields?: string } = {
          contentId: playlistId,
        };
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getPlaylistTracks = useCallback(
    async (playlistId: string, params: PageParams = {}) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getShow = useCallback(
    async (showId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        /** @type {SpotifyShowGetRequest} */
        const params = { contentId: showId };
        const result = await sendSpotifyCommand("spotify.show.get", params);
        return result;
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getShowEpisodes = useCallback(
    async (showId: string, params: PageParams = { limit: 5 }) => {
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
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sendSpotifyCommand],
  );

  const getUserShows = useCallback(
    async (
      params: PageParams = { limit: 5 },
      signal: AbortSignal | null = null,
    ) => {
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
        setError(getErrorMessage(err));
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
      const localFallback = getSpotifyImageFetchFallback(url);
      if (localFallback) {
        return { data: localFallback, content_type: "image/webp" };
      }

      return withSpotifyImageDeadline(
        (requestSignal) =>
          sendSpotifyCommand("spotify.image.fetch", { url }, requestSignal),
        signal,
        SPOTIFY_IMAGE_FETCH_TIMEOUT_MS,
      );
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
