import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSpotifyPlayerState } from "./useSpotifyPlayerState";
import { useSpotifyPlayerControls } from "./useSpotifyPlayerControls";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useImageLoader } from "./useImageLoader";
import { getCachedTimezone } from "./useCurrentTime";
import {
  getSpotifySkippedState,
  getAppReadyState,
  subscribeSpotifySkippedState,
} from "./useNocturned";

import type {
  ActiveSection,
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyTrack,
  SpotifyPlayback,
  UnknownRecord,
} from "../types";

type InitialDataLoadListener = (loaded: boolean) => void;
type LoadingMap = {
  recentAlbums: boolean;
  userPlaylists: boolean;
  topArtists: boolean;
  likedSongs: boolean;
  radioMixes: boolean;
  userShows: boolean;
};
type ErrorMap = Record<keyof LoadingMap, string | null>;
type NextTokens = {
  userPlaylists: string | null;
  topArtists: string | null;
  likedSongs: string | null;
  userShows: string | null;
  recentTracks: string | null;
};
type OffsetMap = {
  userPlaylists: number;
  topArtists: number;
  likedSongs: number;
  userShows: number;
  recentTracks?: number;
};
type SectionTimeouts = {
  playlists: ReturnType<typeof setTimeout> | null;
  artists: ReturnType<typeof setTimeout> | null;
  liked: ReturnType<typeof setTimeout> | null;
  shows: ReturnType<typeof setTimeout> | null;
};

/** @typedef {import("@schema/spotify").SpotifyRadioMixesRequest} SpotifyRadioMixesRequest */

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const SLOW_RETRY_DELAY = 15000;
const INITIAL_DATA_RETRY_DELAYS_MS = Array.from(
  { length: MAX_RETRIES + 1 },
  (_, attempt) => (attempt === 0 ? 0 : RETRY_DELAY * 2 ** (attempt - 1)),
);
const createFallbackRadioMixes = () => [
  {
    id: "top-mix",
    name: "Your Top Mix",
    images: [{ url: "/images/radio-cover/top.webp" }],
    tracks: { total: 50 },
    trackCount: 50,
    type: "static",
    sortOrder: 1,
  },
  {
    id: "discoveries-mix",
    name: "Discoveries",
    images: [{ url: "/images/radio-cover/discoveries.webp" }],
    tracks: { total: 50 },
    trackCount: 50,
    type: "static",
    sortOrder: 2,
  },
];

type InitialDataLoadAttempt = (signal: AbortSignal) => Promise<boolean>;
type InitialCollection = "playlists" | "artists" | "shows";
type InitialDataRetryOptions = {
  signal: AbortSignal;
  retryDelays?: readonly number[];
  wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
  onError?: (error: unknown) => void;
};

const toRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

export const getSpotifyProfileIdentity = (value: unknown) => {
  const root = toRecord(value);
  const data = toRecord(root?.data);
  const profileRoot = toRecord(data?.me) ?? toRecord(root?.me) ?? root;
  const profile = toRecord(profileRoot?.profile);
  const directIdentity =
    profileRoot?.id ??
    profile?.id ??
    profileRoot?.username ??
    profile?.username;
  if (typeof directIdentity === "string" && directIdentity.trim()) {
    return directIdentity.trim();
  }

  const uri = profileRoot?.uri ?? profile?.uri;
  if (typeof uri !== "string" || !uri.trim()) return null;
  return uri.split(":").pop()?.trim() || null;
};

export const hasSpotifyCollectionEnvelope = (
  value: unknown,
  collectionKey: string,
) => Array.isArray(toRecord(value)?.[collectionKey]);

export const getInitialCollectionLimit = (
  collection: InitialCollection,
  prefetchMockingbirdLibrary: boolean,
) => {
  if (!prefetchMockingbirdLibrary) return 5;
  return collection === "playlists" ? 50 : 20;
};

export const shouldEnrichPlaylistTrackCount = (
  index: number,
  isLoadMore: boolean,
  prefetchMockingbirdLibrary: boolean,
) => !prefetchMockingbirdLibrary || isLoadMore || index < 5;

export const shouldCommitSpotifyLoadState = (
  signal: AbortSignal | null,
  activeSignal: AbortSignal | null,
) => !signal || (!signal.aborted && signal === activeSignal);

export const shouldAttemptMockingbirdPrefetch = (
  completed: boolean,
  enabled: boolean,
  initialDataLoaded: boolean,
  dataFetchInProgress: boolean,
) => !completed && enabled && initialDataLoaded && !dataFetchInProgress;

export const prepareInitialDataLoadGeneration = (
  currentGeneration: number,
  nextGeneration: number,
  cancelCurrent: () => void,
) => {
  if (nextGeneration <= 0 || currentGeneration === nextGeneration) return false;
  cancelCurrent();
  return true;
};

const throwIfInitialLoadCancelled = (signal: AbortSignal | null) => {
  if (signal?.aborted) throw new Error("Request cancelled");
};

const waitForInitialDataRetry = (
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      resolve(false);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });

export async function retryInitialDataLoadAfterAppReady(
  attempt: InitialDataLoadAttempt,
  {
    signal,
    retryDelays = INITIAL_DATA_RETRY_DELAYS_MS,
    wait = waitForInitialDataRetry,
    onError = (error) =>
      console.error("Initial Spotify data attempt failed:", error),
  }: InitialDataRetryOptions,
) {
  for (const delayMs of retryDelays) {
    if (signal.aborted) return false;
    if (delayMs > 0 && !(await wait(delayMs, signal))) return false;
    if (signal.aborted) return false;

    try {
      if (await attempt(signal)) return true;
    } catch (error) {
      if (signal.aborted) return false;
      onError(error);
    }
  }

  return false;
}

let initialDataLoadComplete = false;
const initialDataLoadSubscribers = new Set<InitialDataLoadListener>();

const emitInitialDataLoadState = () => {
  initialDataLoadSubscribers.forEach((listener) => {
    try {
      listener(initialDataLoadComplete);
    } catch (err) {
      console.error("Initial data load listener error:", err);
    }
  });
};

export const subscribeInitialDataLoadState = (
  listener: InitialDataLoadListener,
) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  initialDataLoadSubscribers.add(listener);
  listener(initialDataLoadComplete);

  return () => {
    initialDataLoadSubscribers.delete(listener);
  };
};

export const getInitialDataLoadState = () => initialDataLoadComplete;

export function useSpotifyData(
  activeSection: ActiveSection,
  skipInitialFetch = false,
  _startWithNowPlaying = false,
  prefetchMockingbirdLibrary = false,
) {
  const [recentAlbums, setRecentAlbums] = useState<SpotifyAlbum[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [topArtists, setTopArtists] = useState<SpotifyArtist[]>([]);
  const [likedSongs, setLikedSongs] = useState<SpotifyPlaylist>({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "/images/liked-songs.webp" }],
    type: "liked-songs",
  });
  const [radioMixes, setRadioMixes] = useState<SpotifyPlaylist[]>([]);
  const [userShows, setUserShows] = useState<SpotifyShow[]>([]);
  const [spotifyUserId, setSpotifyUserId] = useState<string | null>(null);

  const [nextTokens, setNextTokens] = useState<NextTokens>({
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    userShows: null,
    recentTracks: null,
  });

  const [lastOffsets, setLastOffsets] = useState<Required<OffsetMap>>({
    userPlaylists: 0,
    topArtists: 0,
    likedSongs: 0,
    userShows: 0,
    recentTracks: 0,
  });

  const [itemCounts, setItemCounts] = useState({
    recentAlbums: 0,
    userPlaylists: 0,
    topArtists: 0,
    likedSongs: 0,
    userShows: 0,
  });

  const [sectionsAccessed, setSectionsAccessed] = useState<Set<ActiveSection>>(
    new Set(),
  );

  const [isLoading, setIsLoading] = useState<LoadingMap>({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
    radioMixes: true,
    userShows: true,
  });

  const [errors, setErrors] = useState<ErrorMap>({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    radioMixes: null,
    userShows: null,
  });

  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [initialLoadRetryEpoch, setInitialLoadRetryEpoch] = useState(0);
  const dataFetchingInProgressRef = useRef(false);
  const initialLoadGenerationRef = useRef(0);
  const lastPlayedAlbumIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const slowRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previousMockingbirdPrefetchRef = useRef(prefetchMockingbirdLibrary);
  const mockingbirdPrefetchEnabledRef = useRef(prefetchMockingbirdLibrary);
  mockingbirdPrefetchEnabledRef.current = prefetchMockingbirdLibrary;
  const extractedCurrentAlbumRef = useRef<SpotifyAlbum | null>(null);
  const sectionTimeoutRefs = useRef<SectionTimeouts>({
    playlists: null,
    artists: null,
    liked: null,
    shows: null,
  });

  const sectionLoadingRefs = useRef({
    playlists: false,
    artists: false,
    liked: false,
    shows: false,
  });

  const offsetRefs = useRef({
    userPlaylists: 0,
    topArtists: 0,
    likedSongs: 0,
    userShows: 0,
  });

  const currentCountsRef = useRef({
    userPlaylists: 0,
    topArtists: 0,
    likedSongs: 0,
    userShows: 0,
  });

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading: playerIsLoading,
    error: playerError,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
    playerEventSequence,
  } = useSpotifyPlayerState();

  const playerControls = useSpotifyPlayerControls(currentPlayback);
  const { loadImage, getImageSize } = useImageLoader();

  const {
    appReady,
    appReadyGeneration,
    isSpotifyReady,
    sendSpotifyCommand,
    getUserPlaylists,
    getUserTopTracks,
    getUserTopArtists,
    getUserTracks,
    getRecentlyPlayed,
    getUserShows,
    getPlayerState,
    getPlaylist,
    getUserProfile,
  } = useSpotifyWebSocket();

  const checkSpotifyReady = useCallback(
    () => isSpotifyReady && getAppReadyState().ready,
    [isSpotifyReady],
  );

  useEffect(() => {
    const handleSkippedChange = (isSkipped) => {
      if (isSkipped && !initialDataLoaded) {
        setInitialDataLoaded(true);
        initialDataLoadComplete = true;
        emitInitialDataLoadState();
        setIsLoading({
          recentAlbums: false,
          userPlaylists: false,
          topArtists: false,
          likedSongs: false,
          radioMixes: false,
          userShows: false,
        });
      }
    };

    handleSkippedChange(getSpotifySkippedState());

    const unsubscribe = subscribeSpotifySkippedState(handleSkippedChange);
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [initialDataLoaded]);

  const extractAlbumFromPlayerState = useCallback((playerStateData) => {
    if (!playerStateData?.item) return null;

    const normalizeImgs = (imgs) => {
      if (!imgs || !Array.isArray(imgs)) return imgs;
      return imgs.map((img) => {
        if (!img?.url) return img;
        const url = img.url;
        if (
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("blob:") ||
          url.startsWith("/")
        ) {
          return img;
        }
        return { ...img, url: `https://${url}` };
      });
    };

    const itemUri = playerStateData.item.uri || "";
    const contextUri =
      typeof playerStateData.context?.uri === "string"
        ? playerStateData.context.uri
        : "";
    const isEpisode =
      playerStateData.item.type === "episode" ||
      itemUri.startsWith("spotify:episode:") ||
      contextUri.startsWith("spotify:episode:") ||
      contextUri.startsWith("spotify:show:");

    if (isEpisode) {
      if (playerStateData.item.show) {
        return {
          ...playerStateData.item.show,
          images: normalizeImgs(playerStateData.item.show.images),
          type: "show",
        };
      }
      const showUri = contextUri.startsWith("spotify:show:")
        ? contextUri
        : contextUri.startsWith("spotify:episode:")
          ? contextUri
          : itemUri;
      const showId = showUri ? showUri.split(":")[2] || "" : "";
      const albumLikeName = playerStateData.item.album?.name;
      const albumLikeImages = normalizeImgs(
        playerStateData.item.album?.images || [],
      );
      return {
        id: showId,
        uri: showUri,
        name: albumLikeName || "Unknown Show",
        publisher: albumLikeName,
        images: albumLikeImages,
        type: "show",
      };
    }

    if (playerStateData.item.type === "track" || playerStateData.item.album) {
      const currentAlbum =
        playerStateData.item.is_local || playerStateData.item.is_phone_media
          ? {
              id: `local-${playerStateData.item.uri}`,
              name:
                playerStateData.item.album?.name || playerStateData.item.name,
              images: [{ url: "/images/not-playing.webp" }],
              artists: playerStateData.item.artists,
              type: "local-track",
              uri: playerStateData.item.uri,
            }
          : {
              ...playerStateData.item.album,
              images: normalizeImgs(playerStateData.item.album?.images),
            };
      return currentAlbum;
    }

    return null;
  }, []);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      extractedCurrentAlbumRef.current = currentlyPlayingAlbum;
    }
  }, [currentlyPlayingAlbum]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      if (lastPlayedAlbumIdRef.current !== currentlyPlayingAlbum.id) {
        lastPlayedAlbumIdRef.current = currentlyPlayingAlbum.id;

        if (currentlyPlayingAlbum.type === "local-track") {
          return;
        }

        setRecentAlbums((prevAlbums) => {
          const filteredAlbums = prevAlbums.filter(
            (album) => album.id !== currentlyPlayingAlbum.id,
          );
          return [currentlyPlayingAlbum, ...filteredAlbums].slice(0, 50);
        });

        if (activeSection === "recents") {
          setTimeout(() => {
            const event = new CustomEvent("albumOrderChanged", {
              detail: { albumId: currentlyPlayingAlbum.id },
            });
            window.dispatchEvent(event);
          }, 50);
        }
      }
    }
  }, [currentlyPlayingAlbum, activeSection]);

  const fetchRecentlyPlayed = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return;

      try {
        setIsLoading((prev) => ({ ...prev, recentAlbums: true }));

        if (!extractedCurrentAlbumRef.current) {
          try {
            const playerStateResponse = await getPlayerState(signal);
            const playerState =
              playerStateResponse?.result?.result ||
              playerStateResponse?.result ||
              playerStateResponse;

            if (playerState) {
              const extractedAlbum = extractAlbumFromPlayerState(playerState);
              if (extractedAlbum) {
                extractedCurrentAlbumRef.current = extractedAlbum;
              }
            }
          } catch (playerStateError) {
            if (signal?.aborted) throw playerStateError;
            console.error(
              "Failed to get player state for album extraction:",
              playerStateError,
            );
          }
        }

        throwIfInitialLoadCancelled(signal);
        const data = await getRecentlyPlayed({ limit: 10 }, signal);
        if (!hasSpotifyCollectionEnvelope(data, "albums")) {
          throw new Error("Invalid recently played response");
        }
        throwIfInitialLoadCancelled(signal);
        const uniqueAlbums = [];
        const albumIds = new Set();

        if (data.albums && Array.isArray(data.albums)) {
          data.albums.forEach((album) => {
            if (album && album.id && !albumIds.has(album.id)) {
              albumIds.add(album.id);
              uniqueAlbums.push({
                id: album.id,
                name: album.name,
                uri: album.uri,
                images: album.images || [],
                artists: album.artists || [],
                type: "album",
              });
            }
          });
        }

        if (extractedCurrentAlbumRef.current?.id) {
          const currentAlbum = extractedCurrentAlbumRef.current;

          if (currentAlbum.type === "local-track") {
            setRecentAlbums(uniqueAlbums);
            setItemCounts((prev) => ({
              ...prev,
              recentAlbums: uniqueAlbums.length,
            }));
          } else {
            const filteredAlbums = uniqueAlbums.filter(
              (album) => album.id !== currentAlbum.id,
            );
            const finalAlbums = [currentAlbum, ...filteredAlbums];
            setRecentAlbums(finalAlbums);
            setItemCounts((prev) => ({
              ...prev,
              recentAlbums: finalAlbums.length,
            }));

            if (activeSection === "recents") {
              setTimeout(() => {
                const event = new CustomEvent("albumOrderChanged", {
                  detail: { albumId: currentAlbum.id },
                });
                window.dispatchEvent(event);
              }, 50);
            }
          }
        } else {
          setRecentAlbums(uniqueAlbums);
          setItemCounts((prev) => ({
            ...prev,
            recentAlbums: uniqueAlbums.length,
          }));
        }

        setErrors((prev) => ({ ...prev, recentAlbums: null }));
        return uniqueAlbums;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching recently played:", err);
        setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
        throw err;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
        }
      }
    },
    [
      checkSpotifyReady,
      getRecentlyPlayed,
      getPlayerState,
      extractAlbumFromPlayerState,
      activeSection,
    ],
  );

  const fetchUserPlaylists = useCallback(
    async (isLoadMore = false, signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return;

      if (isLoadMore && sectionLoadingRefs.current.playlists) {
        return;
      }

      try {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, userPlaylists: true }));
        } else {
          sectionLoadingRefs.current.playlists = true;
        }

        let nextOffset = 0;
        if (isLoadMore) {
          nextOffset = lastOffsets.userPlaylists + 5;
        }

        const limit = isLoadMore
          ? 5
          : getInitialCollectionLimit("playlists", prefetchMockingbirdLibrary);
        const params = { limit, offset: nextOffset };

        const data = await getUserPlaylists(params, signal);
        if (!hasSpotifyCollectionEnvelope(data, "items")) {
          throw new Error("Invalid playlists response");
        }
        throwIfInitialLoadCancelled(signal);
        const items = data.items || [];

        const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";
        const itemsWithCounts = await Promise.all(
          items.map(async (playlist, index) => {
            if (playlist.id === DJ_PLAYLIST_ID) {
              return playlist;
            }
            if (
              playlist.id &&
              playlist.tracks?.total == null &&
              shouldEnrichPlaylistTrackCount(
                index,
                isLoadMore,
                prefetchMockingbirdLibrary,
              )
            ) {
              try {
                const playlistInfo = await getPlaylist(
                  playlist.id,
                  "tracks.total",
                  signal,
                );
                return {
                  ...playlist,
                  tracks: { total: playlistInfo.tracks?.total || 0 },
                };
              } catch (error) {
                if (signal?.aborted) throw error;
                console.warn(
                  `Failed to fetch track count for ${playlist.name}:`,
                  error,
                );
                return playlist;
              }
            }
            return playlist;
          }),
        );
        throwIfInitialLoadCancelled(signal);

        setLastOffsets((prev) => ({
          ...prev,
          userPlaylists: nextOffset + Math.max(0, itemsWithCounts.length - 5),
        }));

        const currentOffset = nextOffset;
        const hasMoreFromServer =
          data.next ||
          (data.total && currentOffset + itemsWithCounts.length < data.total);

        if (isLoadMore) {
          let newLength = 0;
          setUserPlaylists((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newUniqueItems = itemsWithCounts.filter(
              (item) => !existingIds.has(item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            newLength = limitedItems.length;
            return limitedItems;
          });

          setItemCounts((prevCounts) => ({
            ...prevCounts,
            userPlaylists: newLength,
          }));

          if (hasMoreFromServer && newLength < 50) {
            setNextTokens((prevTokens) => ({
              ...prevTokens,
              userPlaylists: data.next || "has-more",
            }));
          } else {
            setNextTokens((prevTokens) => ({
              ...prevTokens,
              userPlaylists: null,
            }));
          }
        } else {
          setUserPlaylists(itemsWithCounts);
          setItemCounts((prev) => ({
            ...prev,
            userPlaylists: itemsWithCounts.length,
          }));

          if (hasMoreFromServer && itemsWithCounts.length < 50) {
            setNextTokens((prev) => ({
              ...prev,
              userPlaylists: data.next || "has-more",
            }));
          }
        }

        setErrors((prev) => ({ ...prev, userPlaylists: null }));
        return itemsWithCounts;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching user playlists:", err);
        setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
        throw err;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          if (!isLoadMore) {
            setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
          } else {
            sectionLoadingRefs.current.playlists = false;
          }
        }
      }
    },
    [
      checkSpotifyReady,
      getUserPlaylists,
      getPlaylist,
      lastOffsets,
      prefetchMockingbirdLibrary,
    ],
  );

  const fetchTopArtists = useCallback(
    async (isLoadMore = false, signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return;

      if (isLoadMore && sectionLoadingRefs.current.artists) {
        return;
      }

      try {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, topArtists: true }));
        } else {
          sectionLoadingRefs.current.artists = true;
        }

        let nextOffset = 0;
        if (isLoadMore) {
          nextOffset = offsetRefs.current.topArtists + 5;
        }

        const limit = isLoadMore
          ? 5
          : getInitialCollectionLimit("artists", prefetchMockingbirdLibrary);
        const params = { limit, offset: nextOffset };

        const data = await getUserTopArtists(params, signal);
        if (!hasSpotifyCollectionEnvelope(data, "items")) {
          throw new Error("Invalid top artists response");
        }
        throwIfInitialLoadCancelled(signal);
        const items = data.items || [];

        offsetRefs.current.topArtists =
          nextOffset + Math.max(0, items.length - 5);

        if (isLoadMore) {
          let newLength = 0;
          setTopArtists((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newUniqueItems = items.filter(
              (item) => !existingIds.has(item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            newLength = limitedItems.length;
            return limitedItems;
          });

          setItemCounts((prevCounts) => ({
            ...prevCounts,
            topArtists: newLength,
          }));

          if (data.next && newLength < 50) {
            setNextTokens((prevTokens) => ({
              ...prevTokens,
              topArtists: data.next,
            }));
          } else {
            setNextTokens((prevTokens) => ({
              ...prevTokens,
              topArtists: null,
            }));
          }
        } else {
          setTopArtists(items);
          setItemCounts((prev) => ({ ...prev, topArtists: items.length }));

          if (data.next && items.length < 50) {
            setNextTokens((prev) => ({ ...prev, topArtists: data.next }));
          } else if (items.length === 5 && data.total > 5) {
            setNextTokens((prev) => ({ ...prev, topArtists: "has-more" }));
          }
        }

        setErrors((prev) => ({ ...prev, topArtists: null }));
        return items;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching top artists:", err);
        setErrors((prev) => ({ ...prev, topArtists: err.message }));
        throw err;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          if (!isLoadMore) {
            setIsLoading((prev) => ({ ...prev, topArtists: false }));
          } else {
            sectionLoadingRefs.current.artists = false;
          }
        }
      }
    },
    [checkSpotifyReady, getUserTopArtists, prefetchMockingbirdLibrary],
  );

  const fetchLikedSongs = useCallback(
    async (isLoadMore = false, signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return;

      if (isLoadMore && sectionLoadingRefs.current.liked) {
        return;
      }

      try {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, likedSongs: true }));
        } else {
          sectionLoadingRefs.current.liked = true;
        }

        let nextOffset = 0;
        if (isLoadMore) {
          nextOffset = lastOffsets.likedSongs + 5;
        }

        const params = { limit: 5, offset: nextOffset };

        const data = await getUserTracks(params, signal);
        if (!hasSpotifyCollectionEnvelope(data, "items")) {
          throw new Error("Invalid liked songs response");
        }
        throwIfInitialLoadCancelled(signal);

        setLastOffsets((prev) => ({ ...prev, likedSongs: nextOffset }));

        let newItemsLength = 0;
        let resultLikedSongs = null;

        setLikedSongs((prevLikedSongs) => {
          const updatedLikedSongs = {
            ...prevLikedSongs,
            tracks: {
              total: data.total || 0,
              items: isLoadMore
                ? (() => {
                    const existingItems = prevLikedSongs.tracks?.items || [];
                    const existingIds = new Set(
                      existingItems.map((item) => item.track?.id),
                    );
                    const newUniqueItems = (data.items || []).filter(
                      (item) => !existingIds.has(item.track?.id),
                    );
                    return [...existingItems, ...newUniqueItems];
                  })()
                : data.items || [],
            },
          };

          if (updatedLikedSongs.tracks.items) {
            updatedLikedSongs.tracks.items =
              updatedLikedSongs.tracks.items.slice(0, 50);
            newItemsLength = updatedLikedSongs.tracks.items.length;
          }

          resultLikedSongs = updatedLikedSongs;
          return updatedLikedSongs;
        });

        setItemCounts((prev) => ({
          ...prev,
          likedSongs: newItemsLength,
        }));

        if (data.next && newItemsLength < 50) {
          setNextTokens((prev) => ({ ...prev, likedSongs: data.next }));
        } else if (!isLoadMore && newItemsLength === 5 && data.total > 5) {
          setNextTokens((prev) => ({ ...prev, likedSongs: "has-more" }));
        } else {
          setNextTokens((prev) => ({ ...prev, likedSongs: null }));
        }

        setErrors((prev) => ({ ...prev, likedSongs: null }));
        return resultLikedSongs;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching liked songs:", err);
        setErrors((prev) => ({ ...prev, likedSongs: err.message }));
        throw err;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          if (!isLoadMore) {
            setIsLoading((prev) => ({ ...prev, likedSongs: false }));
          } else {
            sectionLoadingRefs.current.liked = false;
          }
        }
      }
    },
    [checkSpotifyReady, getUserTracks, lastOffsets],
  );

  const fetchUserShows = useCallback(
    async (isLoadMore = false, signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return;

      if (isLoadMore && sectionLoadingRefs.current.shows) {
        return;
      }

      try {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, userShows: true }));
        } else {
          sectionLoadingRefs.current.shows = true;
        }

        let nextOffset = 0;
        if (isLoadMore) {
          nextOffset = lastOffsets.userShows + 5;
        }

        const limit = isLoadMore
          ? 5
          : getInitialCollectionLimit("shows", prefetchMockingbirdLibrary);
        const params = { limit, offset: nextOffset };

        const data = await getUserShows(params, signal);
        if (!hasSpotifyCollectionEnvelope(data, "items")) {
          throw new Error("Invalid shows response");
        }
        throwIfInitialLoadCancelled(signal);
        const items = data.items || [];

        setLastOffsets((prev) => ({
          ...prev,
          userShows: nextOffset + Math.max(0, items.length - 5),
        }));

        if (isLoadMore) {
          let newLength = 0;
          setUserShows((prev) => {
            const existingIds = new Set(
              prev.map((item) => item.show?.id || item.id),
            );
            const newUniqueItems = items.filter(
              (item) => !existingIds.has(item.show?.id || item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            newLength = limitedItems.length;
            return limitedItems;
          });

          setItemCounts((prevCounts) => ({
            ...prevCounts,
            userShows: newLength,
          }));

          if (data.next && newLength < 50) {
            setNextTokens((prev) => ({ ...prev, userShows: data.next }));
          } else {
            setNextTokens((prev) => ({ ...prev, userShows: null }));
          }
        } else {
          setUserShows(items);
          setItemCounts((prev) => ({ ...prev, userShows: items.length }));

          if (data.next && items.length < 50) {
            setNextTokens((prev) => ({ ...prev, userShows: data.next }));
          } else if (items.length === 5 && data.total > 5) {
            setNextTokens((prev) => ({ ...prev, userShows: "has-more" }));
          }
        }

        setErrors((prev) => ({ ...prev, userShows: null }));
        return items;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching user shows:", err);
        setErrors((prev) => ({ ...prev, userShows: err.message }));
        throw err;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          if (!isLoadMore) {
            setIsLoading((prev) => ({ ...prev, userShows: false }));
          } else {
            sectionLoadingRefs.current.shows = false;
          }
        }
      }
    },
    [checkSpotifyReady, getUserShows, lastOffsets, prefetchMockingbirdLibrary],
  );

  const fetchRadioMixes = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!checkSpotifyReady()) return [];

      try {
        setIsLoading((prev) => ({ ...prev, radioMixes: true }));

        const result = await sendSpotifyCommand(
          "spotify.radio.mixes",
          /** @type {SpotifyRadioMixesRequest} */ {},
          signal,
        );
        if (!hasSpotifyCollectionEnvelope(result, "sections")) {
          throw new Error("Invalid radio mixes response");
        }
        throwIfInitialLoadCancelled(signal);

        const nocturneMixes = createFallbackRadioMixes();

        if (result?.sections?.[0]?.items) {
          const items = result.sections[0].items;

          const spotifyMixes = items
            .filter((item) => {
              const format = item.format;
              const name = item.name;
              return (
                (format === "daily-mix" ||
                  format === "release-radar" ||
                  format === "discover-weekly") &&
                name !== "DJ"
              );
            })
            .map((item, index) => {
              const imageUrl = item.image_url || "";

              let type = "spotify-radio";
              let id = item.uri.split(":").pop();

              if (item.format === "daily-mix") {
                type = "daily-mix";
              } else if (item.format === "release-radar") {
                type = "release-radar";
              } else if (item.format === "discover-weekly") {
                type = "discover-weekly";
              }

              return {
                id,
                name: item.name,
                images: [{ url: imageUrl }],
                uri: item.uri,
                type,
                sortOrder: index + 100,
                tracks: { total: 0 },
                trackCount: 0,
              };
            });

          const mixes = [...nocturneMixes, ...spotifyMixes];

          if (mixes.length > 0) {
            const mixesWithCounts = await Promise.all(
              mixes.map(async (mix) => {
                if (mix.uri && mix.trackCount === 0) {
                  try {
                    const playlistId = mix.uri.split(":").pop();
                    const playlistInfo = await getPlaylist(
                      playlistId,
                      "tracks.total",
                      signal,
                    );
                    return {
                      ...mix,
                      tracks: { total: playlistInfo.tracks?.total || 0 },
                      trackCount: playlistInfo.tracks?.total || 0,
                    };
                  } catch (error) {
                    if (signal?.aborted) throw error;
                    console.warn(
                      `Failed to fetch track count for ${mix.name}:`,
                      error,
                    );
                    return mix;
                  }
                }
                return mix;
              }),
            );
            throwIfInitialLoadCancelled(signal);

            setRadioMixes(mixesWithCounts);
            setErrors((prev) => ({ ...prev, radioMixes: null }));
            return mixesWithCounts;
          }
        }

        const fallbackMixes = createFallbackRadioMixes();

        setRadioMixes(fallbackMixes);
        setErrors((prev) => ({ ...prev, radioMixes: null }));
        return fallbackMixes;
      } catch (err) {
        if (
          !shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          throw err;
        }
        console.error("Error fetching radio mixes:", err);
        setErrors((prev) => ({ ...prev, radioMixes: err.message }));
        const fallbackMixes = createFallbackRadioMixes();
        setRadioMixes(fallbackMixes);
        return fallbackMixes;
      } finally {
        if (
          shouldCommitSpotifyLoadState(
            signal,
            abortControllerRef.current?.signal ?? null,
          )
        ) {
          setIsLoading((prev) => ({ ...prev, radioMixes: false }));
        }
      }
    },
    [checkSpotifyReady, sendSpotifyCommand, getPlaylist],
  );

  const loadMoreForSection = useCallback(
    async (section) => {
      if (!checkSpotifyReady()) return;

      if (section === "recents") {
        return null;
      }

      const currentOffset =
        section === "playlists"
          ? lastOffsets.userPlaylists
          : section === "artists"
            ? offsetRefs.current.topArtists
            : section === "liked"
              ? lastOffsets.likedSongs
              : lastOffsets.userShows;

      const nextOffset = currentOffset + 5;

      if (nextOffset >= 50) {
        return null;
      }

      switch (section) {
        case "playlists":
          if (nextTokens.userPlaylists) {
            return await fetchUserPlaylists(true);
          }
          break;
        case "artists":
          if (nextTokens.topArtists) {
            return await fetchTopArtists(true);
          }
          break;
        case "liked":
          if (nextTokens.likedSongs) {
            return await fetchLikedSongs(true);
          }
          break;
        case "shows":
          if (nextTokens.userShows) {
            return await fetchUserShows(true);
          }
          break;
        default:
          break;
      }

      return null;
    },
    [
      isSpotifyReady,
      nextTokens,
      fetchUserPlaylists,
      fetchTopArtists,
      fetchLikedSongs,
      fetchUserShows,
      lastOffsets,
      offsetRefs,
    ],
  );

  const handleSectionAccess = useCallback(
    async (section) => {
      Object.keys(sectionTimeoutRefs.current).forEach((key) => {
        if (key !== section && sectionTimeoutRefs.current[key]) {
          clearTimeout(sectionTimeoutRefs.current[key]);
          sectionTimeoutRefs.current[key] = null;
        }
      });

      const shouldStartLoading = () => {
        if (section === "recents") return false;

        const currentOffset =
          section === "playlists"
            ? lastOffsets.userPlaylists
            : section === "artists"
              ? offsetRefs.current.topArtists
              : section === "liked"
                ? lastOffsets.likedSongs
                : lastOffsets.userShows;

        const nextOffset = currentOffset + 5;
        const tokenKey =
          section === "playlists"
            ? "userPlaylists"
            : section === "artists"
              ? "topArtists"
              : section === "liked"
                ? "likedSongs"
                : "userShows";

        return nextOffset < 50 && nextTokens[tokenKey];
      };

      if (!sectionsAccessed.has(section)) {
        setSectionsAccessed((prev) => new Set([...prev, section]));
      }

      const shouldLoad = shouldStartLoading();
      if (shouldLoad) {
        const loadMore = async () => {
          const sectionMap = {
            library: "playlists",
            playlists: "playlists",
            artists: "artists",
            liked: "liked",
            shows: "shows",
            podcasts: "shows",
          };

          const currentMappedSection = sectionMap[activeSection];
          if (currentMappedSection !== section) {
            return;
          }

          const result = await loadMoreForSection(section);
          if (result && result.length > 0) {
            const currentOffset =
              section === "playlists"
                ? lastOffsets.userPlaylists
                : section === "artists"
                  ? offsetRefs.current.topArtists
                  : section === "liked"
                    ? lastOffsets.likedSongs
                    : lastOffsets.userShows;

            const nextOffset = currentOffset + 5;
            const tokenKey =
              section === "playlists"
                ? "userPlaylists"
                : section === "artists"
                  ? "topArtists"
                  : section === "liked"
                    ? "likedSongs"
                    : "userShows";

            if (nextOffset < 50 && nextTokens[tokenKey]) {
              sectionTimeoutRefs.current[section] = setTimeout(() => {
                const stillOnSameSection =
                  sectionMap[activeSection] === section;
                if (stillOnSameSection) {
                  loadMore();
                }
              }, 3000);
            }
          }
        };

        sectionTimeoutRefs.current[section] = setTimeout(
          () => loadMore(),
          3000,
        );
      }
    },
    [
      sectionsAccessed,
      loadMoreForSection,
      nextTokens,
      lastOffsets,
      offsetRefs,
      activeSection,
    ],
  );

  useEffect(() => {
    if (!activeSection || !initialDataLoaded) return;

    const sectionMap = {
      library: "playlists",
      playlists: "playlists",
      artists: "artists",
      liked: "liked",
      shows: "shows",
      podcasts: "shows",
    };

    const mappedSection = sectionMap[activeSection];
    if (mappedSection) {
      handleSectionAccess(mappedSection);
    }
  }, [activeSection, initialDataLoaded, handleSectionAccess]);

  const loadInitialData = useCallback(
    async (generation: number) => {
      if (
        skipInitialFetch ||
        generation <= 0 ||
        initialDataLoaded ||
        dataFetchingInProgressRef.current
      ) {
        return;
      }
      const readyState = getAppReadyState();
      if (
        !checkSpotifyReady() ||
        !readyState.ready ||
        readyState.generation !== generation
      ) {
        return;
      }

      if (slowRetryTimeoutRef.current) {
        clearTimeout(slowRetryTimeoutRef.current);
        slowRetryTimeoutRef.current = null;
      }
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      dataFetchingInProgressRef.current = true;

      setIsLoading({
        recentAlbums: true,
        userPlaylists: true,
        topArtists: true,
        likedSongs: true,
        radioMixes: true,
        userShows: true,
      });

      const loaded = await retryInitialDataLoadAfterAppReady(
        async (signal) => {
          if (
            signal.aborted ||
            !checkSpotifyReady() ||
            getAppReadyState().generation !== generation
          ) {
            return false;
          }

          try {
            console.log("0/6: Fetching user profile...");
            const profile = await getUserProfile(signal);
            const profileIdentity = getSpotifyProfileIdentity(profile);
            if (!profileIdentity) {
              console.warn("Spotify profile is not ready yet");
              return false;
            }
            throwIfInitialLoadCancelled(signal);
            setSpotifyUserId(profileIdentity);
          } catch (error) {
            console.error("Failed to fetch user profile:", error);
            return false;
          }

          const requests: Array<[string, string, () => Promise<unknown>]> = [
            [
              "recently played",
              "fetchRecentlyPlayed",
              () => fetchRecentlyPlayed(signal),
            ],
            [
              "user playlists",
              "fetchUserPlaylists",
              () => fetchUserPlaylists(false, signal),
            ],
            [
              "top artists",
              "fetchTopArtists",
              () => fetchTopArtists(false, signal),
            ],
            [
              "liked songs",
              "fetchLikedSongs",
              () => fetchLikedSongs(false, signal),
            ],
            ["radio mixes", "fetchRadioMixes", () => fetchRadioMixes(signal)],
            [
              "user shows",
              "fetchUserShows",
              () => fetchUserShows(false, signal),
            ],
          ];
          const failedRequests: string[] = [];

          for (const [
            index,
            [label, requestName, request],
          ] of requests.entries()) {
            if (signal.aborted) return false;
            try {
              console.log(`${index + 1}/6: Fetching ${label}...`);
              await request();
            } catch (error) {
              console.error(`Failed to fetch ${label}:`, error);
              failedRequests.push(requestName);
            }

            if (
              index < requests.length - 1 &&
              !(await waitForInitialDataRetry(200, signal))
            ) {
              return false;
            }
          }

          if (failedRequests.length > 0) {
            console.error(
              "Some data fetching operations failed:",
              failedRequests,
            );
            return false;
          }

          return true;
        },
        { signal: controller.signal },
      );

      if (
        loaded &&
        !controller.signal.aborted &&
        getAppReadyState().generation === generation
      ) {
        if (slowRetryTimeoutRef.current) {
          clearTimeout(slowRetryTimeoutRef.current);
          slowRetryTimeoutRef.current = null;
        }
        setInitialDataLoaded(true);
        initialDataLoadComplete = true;
        emitInitialDataLoadState();
      } else if (!controller.signal.aborted) {
        console.error("Initial Spotify data load exhausted its retries");
        setIsLoading({
          recentAlbums: false,
          userPlaylists: false,
          topArtists: false,
          likedSongs: false,
          radioMixes: false,
          userShows: false,
        });
        slowRetryTimeoutRef.current = setTimeout(() => {
          if (
            getAppReadyState().ready &&
            getAppReadyState().generation === generation
          ) {
            initialLoadGenerationRef.current = 0;
            setInitialLoadRetryEpoch((epoch) => epoch + 1);
          }
        }, SLOW_RETRY_DELAY);
      }

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        dataFetchingInProgressRef.current = false;
      }
    },
    [
      checkSpotifyReady,
      fetchLikedSongs,
      fetchRadioMixes,
      fetchRecentlyPlayed,
      fetchTopArtists,
      fetchUserPlaylists,
      fetchUserShows,
      getUserProfile,
      initialDataLoaded,
      skipInitialFetch,
    ],
  );

  useEffect(() => {
    if (skipInitialFetch || initialDataLoaded) return;

    if (!appReady || !isSpotifyReady || appReadyGeneration <= 0) {
      if (slowRetryTimeoutRef.current) {
        clearTimeout(slowRetryTimeoutRef.current);
        slowRetryTimeoutRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      dataFetchingInProgressRef.current = false;
      initialLoadGenerationRef.current = 0;
      return;
    }

    if (
      !prepareInitialDataLoadGeneration(
        initialLoadGenerationRef.current,
        appReadyGeneration,
        () => {
          if (slowRetryTimeoutRef.current) {
            clearTimeout(slowRetryTimeoutRef.current);
            slowRetryTimeoutRef.current = null;
          }
          abortControllerRef.current?.abort();
          abortControllerRef.current = null;
          dataFetchingInProgressRef.current = false;
        },
      )
    ) {
      return;
    }
    initialLoadGenerationRef.current = appReadyGeneration;
    void loadInitialData(appReadyGeneration);
  }, [
    appReady,
    appReadyGeneration,
    initialDataLoaded,
    initialLoadRetryEpoch,
    isSpotifyReady,
    loadInitialData,
    skipInitialFetch,
  ]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      if (slowRetryTimeoutRef.current) {
        clearTimeout(slowRetryTimeoutRef.current);
      }
      Object.keys(sectionTimeoutRefs.current).forEach((key) => {
        if (sectionTimeoutRefs.current[key]) {
          clearTimeout(sectionTimeoutRefs.current[key]);
        }
        sectionLoadingRefs.current[key] = false;
      });
    },
    [],
  );

  const refreshData = useCallback(async () => {
    if (!checkSpotifyReady()) {
      console.log("Spotify not ready, skipping refresh");
      return false;
    }

    if (dataFetchingInProgressRef.current) {
      console.log("Skipping refresh - data fetching already in progress");
      return false;
    }

    if (!initialDataLoaded) {
      const generation = getAppReadyState().generation;
      initialLoadGenerationRef.current = generation;
      await loadInitialData(generation);
      return false;
    }

    dataFetchingInProgressRef.current = true;
    console.log("Starting data refresh...");

    setIsLoading((prev) => ({
      ...prev,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
    }));

    try {
      await fetchUserPlaylists();
      await fetchTopArtists();
      await fetchLikedSongs();
      await fetchRadioMixes();
      await fetchUserShows();
      return true;
    } catch (error) {
      console.error("Error refreshing data:", error);
      return false;
    } finally {
      dataFetchingInProgressRef.current = false;
    }
  }, [
    checkSpotifyReady,
    isSpotifyReady,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    initialDataLoaded,
    loadInitialData,
  ]);

  useEffect(() => {
    if (!prefetchMockingbirdLibrary) {
      previousMockingbirdPrefetchRef.current = false;
      return;
    }

    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const attemptPrefetch = async () => {
      if (
        !shouldAttemptMockingbirdPrefetch(
          previousMockingbirdPrefetchRef.current,
          mockingbirdPrefetchEnabledRef.current,
          initialDataLoaded,
          dataFetchingInProgressRef.current,
        )
      ) {
        if (
          !disposed &&
          !previousMockingbirdPrefetchRef.current &&
          mockingbirdPrefetchEnabledRef.current &&
          initialDataLoaded
        ) {
          retryTimeout = setTimeout(() => void attemptPrefetch(), 250);
        }
        return;
      }

      const refreshed = await refreshData();
      if (refreshed && mockingbirdPrefetchEnabledRef.current) {
        previousMockingbirdPrefetchRef.current = true;
        return;
      }
      if (!disposed && mockingbirdPrefetchEnabledRef.current) {
        retryTimeout = setTimeout(() => void attemptPrefetch(), 1000);
      }
    };

    void attemptPrefetch();
    return () => {
      disposed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [initialDataLoaded, prefetchMockingbirdLibrary, refreshData]);

  const isLoadingData = Object.values(isLoading).some(Boolean);
  const isLoadingAll = isLoadingData || playerIsLoading;

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
    playerEventSequence,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    spotifyUserId,
    initialDataLoaded,
    isLoading: {
      data: isLoadingData,
      player: playerIsLoading,
      all: isLoadingAll,
      recentAlbums: isLoading.recentAlbums,
      userPlaylists: isLoading.userPlaylists,
      topArtists: isLoading.topArtists,
      likedSongs: isLoading.likedSongs,
      radioMixes: isLoading.radioMixes,
      userShows: isLoading.userShows,
    },
    errors,
    refreshData,
    refreshRecentlyPlayed: fetchRecentlyPlayed,
    handleSectionAccess,
    loadMoreForSection,
    hasMoreItems: {
      userPlaylists:
        !!nextTokens.userPlaylists && itemCounts.userPlaylists < 50,
      topArtists: !!nextTokens.topArtists && itemCounts.topArtists < 50,
      likedSongs: !!nextTokens.likedSongs && itemCounts.likedSongs < 50,
      userShows: !!nextTokens.userShows && itemCounts.userShows < 50,
    },
    itemCounts,
    refreshUserPlaylists: fetchUserPlaylists,
    refreshTopArtists: fetchTopArtists,
    refreshLikedSongs: fetchLikedSongs,
    refreshRadioMixes: fetchRadioMixes,
    refreshUserShows: fetchUserShows,
  };
}
