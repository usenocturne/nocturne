import { useState, useEffect, useRef, useCallback } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import {
  useNocturned,
  addGlobalWsListener,
  getSpotifySkippedState,
} from "./useNocturned";
import type {
  SpotifyAlbum,
  SpotifyImage,
  SpotifyPlayback,
  SpotifyTrack,
} from "../types";

type PhoneVolumeListener = (volumePercent: number) => void;
type AlbumChangeEvent = {
  album: SpotifyAlbum | null;
  trackUri?: string | null;
  timestamp: number;
} | null;
type ProgressResetSignal = { at: number; progressMs: number } | null;
type NowPlayingTrackLatch = { title: string; timestamp: number };
type MediaGeneration = number | null;
type MediaGenerationCorrelator = {
  recordMetadata: (data: unknown) => void;
  acceptsArtwork: (data: unknown) => boolean;
  current: () => MediaGeneration;
};

/** @typedef {import("@schema/media_control").MediaNowPlayingUpdateEvent} MediaNowPlayingUpdateEvent */
/** @typedef {import("@schema/media_control").MediaNowPlayingArtworkEvent} MediaNowPlayingArtworkEvent */
/** @typedef {import("@schema/media_control").MediaNowPlayingArtworkFailedEvent} MediaNowPlayingArtworkFailedEvent */
/** @typedef {import("@schema/media_control").PhoneVolumeUpdateEvent} PhoneVolumeUpdateEvent */

let phoneMediaArtworkBlobUrl: string | null = null;
let currentArtworkTrackUri: string | null = null;
let lastSpotifyDeviceStateChange = 0;
let phoneVolumeListeners: PhoneVolumeListener[] = [];
let nowPlayingUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
let isReceivingNowPlayingUpdatesGlobal = false;
let isProcessingArtwork = false;
let artworkCache = new Map<string, string>();
const MAX_ARTWORK_CACHE_SIZE = 10;
let pendingSpotifyMediaUpdate: SpotifyPlayback | null = null;
let spotifyFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
let cachedActiveDeviceType: string | null = null;
let progressResetSignal: ProgressResetSignal = null;
let nowPlayingTrackLatch: NowPlayingTrackLatch | null = null;
let lastDealerEventTimestamp = 0;
let lastCanonicalDealerStateTimestamp = 0;
const NOWPLAYING_PRECEDENCE_WINDOW_MS = 30000;
const DEALER_FRESH_THRESHOLD_MS = 8000;
const APP_READY_PLAYBACK_RETRY_DELAYS_MS = [0, 500, 1000, 2000, 4000];
const APP_READY_PLAYBACK_REQUEST_TIMEOUT_MS = 4000;
const APP_READY_PLAYBACK_OVERALL_TIMEOUT_MS = 12000;

type PlaybackStateFetcher = (
  signal: AbortSignal,
) => Promise<SpotifyPlayback | null | undefined>;
type RetryWaiter = (delayMs: number, signal: AbortSignal) => Promise<boolean>;
type PlaybackWarmupOptions = {
  signal: AbortSignal;
  wait?: RetryWaiter;
  retryDelays?: readonly number[];
  requestTimeoutMs?: number;
  shouldStop?: () => boolean;
};

const waitForRetry: RetryWaiter = (delayMs, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const finish = (completed: boolean) => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      resolve(completed);
    };
    const handleAbort = () => finish(false);
    const timeoutId = setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", handleAbort, { once: true });
  });

const fetchPlaybackStateWithTimeout = async (
  fetchState: PlaybackStateFetcher,
  signal: AbortSignal,
  timeoutMs: number,
) => {
  const requestController = new AbortController();
  const handleAbort = () => requestController.abort();
  signal.addEventListener("abort", handleAbort, { once: true });
  const timeoutId = setTimeout(() => requestController.abort(), timeoutMs);

  try {
    return await fetchState(requestController.signal);
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", handleAbort);
  }
};

export const fetchPlaybackStateAfterAppReady = async (
  fetchState: PlaybackStateFetcher,
  {
    signal,
    wait = waitForRetry,
    retryDelays = APP_READY_PLAYBACK_RETRY_DELAYS_MS,
    requestTimeoutMs = APP_READY_PLAYBACK_REQUEST_TIMEOUT_MS,
    shouldStop = () => false,
  }: PlaybackWarmupOptions,
): Promise<SpotifyPlayback | null> => {
  let lastError: unknown = null;
  let receivedResponse = false;

  for (const delayMs of retryDelays) {
    if (signal.aborted || shouldStop()) return null;
    const completedWait = await wait(delayMs, signal);
    if (!completedWait || signal.aborted || shouldStop()) return null;

    try {
      const playback = await fetchPlaybackStateWithTimeout(
        fetchState,
        signal,
        requestTimeoutMs,
      );
      if (signal.aborted || shouldStop()) return null;
      receivedResponse = true;
      if (playback && Object.keys(playback).length > 0) {
        return playback;
      }
    } catch (err) {
      if (signal.aborted || shouldStop()) return null;
      lastError = err;
    }
  }

  if (!receivedResponse && lastError) {
    throw lastError;
  }

  return null;
};

export const getActiveDeviceType = () => cachedActiveDeviceType;

export const normalizeMediaGeneration = (data: unknown): MediaGeneration => {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const generation = payload.media_generation ?? payload.mediaGeneration;
  return typeof generation === "number" &&
    Number.isSafeInteger(generation) &&
    generation >= 0
    ? generation
    : null;
};

export const mediaGenerationsCorrelate = (
  metadataGeneration: MediaGeneration,
  artworkGeneration: MediaGeneration,
): boolean =>
  metadataGeneration === null
    ? artworkGeneration === null
    : artworkGeneration === metadataGeneration;

export const createMediaGenerationCorrelator =
  (): MediaGenerationCorrelator => {
    let metadataGeneration: MediaGeneration = null;
    return {
      recordMetadata(data) {
        metadataGeneration = normalizeMediaGeneration(data);
      },
      acceptsArtwork(data) {
        return mediaGenerationsCorrelate(
          metadataGeneration,
          normalizeMediaGeneration(data),
        );
      },
      current() {
        return metadataGeneration;
      },
    };
  };

const mediaGenerationCorrelator = createMediaGenerationCorrelator();

export const isCurrentMediaArtwork = (data: unknown): boolean =>
  mediaGenerationCorrelator.acceptsArtwork(data);

export const isCanonicalSpotifyItem = (
  item: SpotifyTrack | null | undefined,
): boolean =>
  Boolean(
    item?.uri?.startsWith("spotify:") &&
    !item.is_spotify_pending &&
    !item.is_phone_media &&
    !item.is_local,
  );

export const shouldIgnoreInactiveForeignMedia = (
  currentPlayback: SpotifyPlayback | null | undefined,
  playbackAppName: unknown,
  playbackStatus: unknown,
): boolean => {
  if (
    currentPlayback?.is_playing !== true ||
    !isCanonicalSpotifyItem(currentPlayback.item) ||
    typeof playbackAppName !== "string" ||
    playbackAppName.length === 0 ||
    playbackAppName === "Spotify"
  ) {
    return false;
  }

  return playbackStatus !== "playing" && playbackStatus !== "loading";
};

export const getPushedArtworkTargetUri = (
  item: SpotifyTrack | null | undefined,
  pendingTitle: string | null = null,
): string | null => {
  if (pendingTitle) {
    return `spotify:pending:${pendingTitle}`;
  }
  if (isCanonicalSpotifyItem(item)) {
    return null;
  }
  return item?.uri || null;
};

export const isPendingSpotifyTrackChange = (
  item: SpotifyTrack | null | undefined,
  pendingTitle: string | null,
): boolean =>
  Boolean(
    isCanonicalSpotifyItem(item) &&
    pendingTitle &&
    item?.name?.trim().toLowerCase() !== pendingTitle.trim().toLowerCase(),
  );

export const consumeProgressResetSignal = () => {
  const signal = progressResetSignal;
  progressResetSignal = null;
  return signal;
};

const normalizeImageUrl = (url: string | null | undefined) => {
  if (!url) return url;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("/")
  ) {
    return url;
  }
  return `https://${url}`;
};

const normalizeImageArray = (images: SpotifyImage[] | null | undefined) => {
  if (!images || !Array.isArray(images)) return images;
  return images.map((img) => ({
    ...img,
    url: normalizeImageUrl(img.url),
  }));
};

const cleanupArtworkCache = () => {
  if (artworkCache.size > MAX_ARTWORK_CACHE_SIZE) {
    const entriesToRemove = artworkCache.size - MAX_ARTWORK_CACHE_SIZE;
    const keysToRemove = Array.from(artworkCache.keys()).slice(
      0,
      entriesToRemove,
    );
    keysToRemove.forEach((key) => {
      const blobUrl = artworkCache.get(key);
      if (blobUrl && blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl);
      }
      artworkCache.delete(key);
    });
  }
};

export const subscribeToPhoneVolume = (listener: PhoneVolumeListener) => {
  phoneVolumeListeners.push(listener);
  return () => {
    phoneVolumeListeners = phoneVolumeListeners.filter((l) => l !== listener);
  };
};

const normalizePhoneVolumePercent = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const volume = Number(value);
  if (!Number.isFinite(volume)) return null;
  return Math.max(0, Math.min(100, Math.round(volume)));
};

const notifyPhoneVolumeListeners = (volumePercent: number) => {
  phoneVolumeListeners.forEach((listener) => {
    try {
      listener(volumePercent);
    } catch (err) {
      console.error("Phone volume listener error:", err);
    }
  });
};

export function useSpotifyPlayerState() {
  const {
    appReady,
    appReadyGeneration,
    wsConnected,
    isSpotifyReady,
    getPlayerState,
  } = useSpotifyWebSocket();
  const [currentPlayback, setCurrentPlayback] =
    useState<SpotifyPlayback | null>(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] =
    useState<SpotifyAlbum | null>(null);
  const [albumChangeEvent, setAlbumChangeEvent] =
    useState<AlbumChangeEvent>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialFetchInProgress, setInitialFetchInProgress] = useState(false);
  const [isReceivingNowPlayingUpdates, setIsReceivingNowPlayingUpdates] =
    useState(false);
  const [playerEventSequence, setPlayerEventSequence] = useState(0);

  const lastPlayedAlbumIdRef = useRef<string | null>(null);
  const currentPlaybackRef = useRef<SpotifyPlayback | null>(null);
  const startupWarmupAbortRef = useRef<AbortController | null>(null);
  const startupWarmupGenerationRef = useRef(0);

  const processPlaybackState = useCallback((data: SpotifyPlayback | null) => {
    if (!data) return;

    const currentIsPhoneMedia =
      currentPlaybackRef.current?.item?.is_phone_media;
    const incomingIsPhoneMedia = data.item?.is_phone_media;
    if (currentIsPhoneMedia && !incomingIsPhoneMedia) {
      const incomingIsSpotifyPending = data.item?.is_spotify_pending;
      const incomingIsRealSpotifyPlaying =
        data.item?.uri?.startsWith("spotify:") && data.is_playing;
      if (!incomingIsSpotifyPending && !incomingIsRealSpotifyPlaying) {
        return;
      }
    }

    if (!data.item?.is_spotify_pending) {
      pendingSpotifyMediaUpdate = null;
      if (spotifyFallbackTimeout) {
        clearTimeout(spotifyFallbackTimeout);
        spotifyFallbackTimeout = null;
      }
    }

    const isEpisode =
      data.currently_playing_type === "episode" ||
      (data?.item && data.item.type === "episode") ||
      (data?.item &&
        typeof data.item.uri === "string" &&
        data.item.uri.startsWith("spotify:episode:")) ||
      (data?.context &&
        typeof data.context.uri === "string" &&
        data.context.uri.startsWith("spotify:episode:")) ||
      (data?.item && data.item.show && !data.item.album && !data.item.artists);
    const hasIncompleteEpisodeData =
      data.currently_playing_type === "episode" && !data.item;

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

    const currentItem = currentPlaybackRef.current?.item;
    const currentBlobUrl = currentItem?.album?.images?.[0]?.url;
    const hasBlobArtwork = currentBlobUrl?.startsWith("blob:");
    const incomingTrackName = data.item?.name?.toLowerCase()?.trim();
    const currentTrackName = currentItem?.name?.toLowerCase()?.trim();
    const currentItemUri = currentItem?.uri;
    const incomingItemUri = data.item?.uri;
    const isSameTrack =
      incomingTrackName &&
      currentTrackName &&
      incomingTrackName === currentTrackName &&
      (!incomingItemUri ||
        !currentItemUri ||
        incomingItemUri === currentItemUri);
    const preservedBlobArtwork =
      hasBlobArtwork && isSameTrack ? currentBlobUrl : null;

    setCurrentPlayback((prevPlayback) => {
      const trackUri = data.item?.uri;
      const cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

      const prevBlobArtwork = prevPlayback?.item?.album?.images?.[0]?.url;
      const hasPrevBlobArtwork = prevBlobArtwork?.startsWith("blob:");
      const prevTrackName = prevPlayback?.item?.name?.toLowerCase()?.trim();
      const prevTrackUri = prevPlayback?.item?.uri;
      const incomingTrackUri = data.item?.uri;
      const urisMatch =
        prevTrackUri && incomingTrackUri && prevTrackUri === incomingTrackUri;
      const shouldPreservePrevBlob =
        hasPrevBlobArtwork &&
        incomingTrackName &&
        prevTrackName &&
        incomingTrackName === prevTrackName &&
        (!incomingTrackUri || !prevTrackUri || urisMatch);

      let itemWithArtwork = data.item;
      if (shouldPreservePrevBlob && data.item?.album?.images) {
        itemWithArtwork = {
          ...data.item,
          album: {
            ...data.item.album,
            images: [{ url: prevBlobArtwork }],
          },
        };
      } else if (cachedArtworkUrl && data.item?.album?.images) {
        itemWithArtwork = {
          ...data.item,
          album: {
            ...data.item.album,
            images: [{ url: cachedArtworkUrl }],
          },
        };
      } else if (data.item && isEpisode && !data.item.type) {
        itemWithArtwork = {
          ...data.item,
          type: "episode",
        };
      }

      if (data.item && isEpisode && !itemWithArtwork?.show?.name) {
        const albumLikeImages =
          itemWithArtwork?.album?.images || data.item?.album?.images || [];
        const albumLikeName =
          itemWithArtwork?.album?.name || data.item?.album?.name;
        const ctxUri =
          typeof data.context?.uri === "string" ? data.context.uri : "";
        const rawItemUri = itemWithArtwork?.uri || data.item?.uri || "";
        const fallbackUri = ctxUri.startsWith("spotify:show:")
          ? ctxUri
          : ctxUri.startsWith("spotify:episode:")
            ? ctxUri
            : rawItemUri || ctxUri || "";
        const existingShow = itemWithArtwork?.show;
        const showUri = existingShow?.uri || fallbackUri;
        const showId =
          existingShow?.id || (showUri ? showUri.split(":")[2] : undefined);
        const showName = existingShow?.name || albumLikeName || "Unknown Show";
        const showPublisher =
          existingShow?.publisher || existingShow?.name || albumLikeName;
        const rawShowImages =
          existingShow?.images?.length > 0
            ? existingShow.images
            : albumLikeImages;
        const normalizedShowImages = normalizeImageArray(rawShowImages) || [];

        itemWithArtwork = {
          ...itemWithArtwork,
          type: "episode",
          images:
            itemWithArtwork?.images?.length > 0
              ? itemWithArtwork.images
              : normalizedShowImages,
          show: {
            id: showId,
            uri: showUri,
            name: showName,
            publisher: showPublisher,
            images: normalizedShowImages,
          },
        };
      }

      if (
        itemWithArtwork?.album?.images &&
        !shouldPreservePrevBlob &&
        !cachedArtworkUrl
      ) {
        itemWithArtwork = {
          ...itemWithArtwork,
          album: {
            ...itemWithArtwork.album,
            images: normalizeImageArray(itemWithArtwork.album.images),
          },
        };
      }

      if (itemWithArtwork?.show?.images && !cachedArtworkUrl) {
        itemWithArtwork = {
          ...itemWithArtwork,
          show: {
            ...itemWithArtwork.show,
            images: normalizeImageArray(itemWithArtwork.show.images),
          },
        };
      }

      const prevDuration = currentPlaybackRef.current?.item?.duration_ms;
      const incomingDuration = itemWithArtwork?.duration_ms;
      const isSameTrack =
        itemWithArtwork?.id === currentPlaybackRef.current?.item?.id ||
        itemWithArtwork?.uri === currentPlaybackRef.current?.item?.uri;

      if (itemWithArtwork && (!incomingDuration || incomingDuration === 0)) {
        if (prevDuration > 0 && isSameTrack) {
          itemWithArtwork = {
            ...itemWithArtwork,
            duration_ms: prevDuration,
          };
        }
      }

      const newPlayback = {
        ...data,
        device: {
          ...data.device,
          volume_percent: data.device?.volume_percent,
        },
        shuffle_state: data.shuffle_state,
        repeat_state: data.repeat_state,
        item: itemWithArtwork,
      };
      currentPlaybackRef.current = newPlayback;
      return newPlayback;
    });

    if (data?.item && data.item.type === "track" && !isEpisode) {
      const trackUri = data.item.uri;
      let cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

      const artworkImages = preservedBlobArtwork
        ? [{ url: preservedBlobArtwork }]
        : cachedArtworkUrl
          ? [{ url: cachedArtworkUrl }]
          : normalizeImageArray(data.item.album?.images);

      const currentAlbum =
        data.item.is_local || data.item.is_phone_media
          ? {
              id: `local-${data.item.uri}`,
              name: data.item.album?.name || data.item.name,
              images: artworkImages || [{ url: "/images/not-playing.webp" }],
              artists: data.item.artists,
              type: "local-track",
              uri: data.item.uri,
              is_phone_media: data.item.is_phone_media || false,
              is_local: data.item.is_local || false,
            }
          : {
              ...data.item.album,
              images: artworkImages,
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
    } else if (isEpisode && data?.item) {
      const trackUri = data.item.uri;
      const cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

      const rawShow = data.item.show;
      const albumLikeImages = data.item.album?.images || [];
      const albumLikeName = data.item.album?.name;
      const contextUri =
        typeof data.context?.uri === "string" ? data.context.uri : "";
      const showUri = rawShow?.uri
        ? rawShow.uri
        : contextUri.startsWith("spotify:show:")
          ? contextUri
          : contextUri.startsWith("spotify:episode:")
            ? contextUri
            : trackUri || "";
      const showId = rawShow?.id || showUri.split(":")[2] || "";
      const showName = rawShow?.name || albumLikeName || "Unknown Show";
      const showPublisher =
        rawShow?.publisher || rawShow?.name || albumLikeName;
      const showImages = rawShow?.images?.length
        ? rawShow.images
        : albumLikeImages;

      const showAsAlbum = {
        id: showId,
        uri: showUri,
        name: showName,
        publisher: showPublisher,
        images: cachedArtworkUrl
          ? [{ url: cachedArtworkUrl }]
          : normalizeImageArray(showImages),
        artists: showPublisher
          ? [
              {
                id: `publisher-${showId}`,
                name: showPublisher,
                type: "show",
              },
            ]
          : [],
        type: "show",
      };
      setCurrentlyPlayingAlbum(showAsAlbum);

      if (showId && data.item.id) {
        localStorage.setItem(`lastPlayedEpisode_${showId}`, data.item.id);
      }
    }
  }, []);

  const resetPlaybackState = useCallback(
    (force = false) => {
      if (force || !initialFetchInProgress) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
      }
    },
    [initialFetchInProgress],
  );

  const beginNowPlayingUpdateWindow = useCallback(() => {
    setIsReceivingNowPlayingUpdates(true);
    isReceivingNowPlayingUpdatesGlobal = true;

    if (nowPlayingUpdateTimeout) {
      clearTimeout(nowPlayingUpdateTimeout);
    }

    nowPlayingUpdateTimeout = setTimeout(() => {
      setIsReceivingNowPlayingUpdates(false);
      isReceivingNowPlayingUpdatesGlobal = false;
    }, 5000);
  }, []);

  const markPlayerEvent = useCallback(() => {
    setPlayerEventSequence((sequence) => sequence + 1);
  }, []);

  useEffect(() => {
    const generation = startupWarmupGenerationRef.current + 1;
    startupWarmupGenerationRef.current = generation;

    if (!wsConnected || !appReady || !isSpotifyReady) {
      setInitialFetchInProgress(false);
      setIsLoading(false);
      return;
    }

    const warmupStartedAt = Date.now();
    const controller = new AbortController();
    startupWarmupAbortRef.current = controller;
    const overallTimeoutId = setTimeout(
      () => controller.abort(),
      APP_READY_PLAYBACK_OVERALL_TIMEOUT_MS,
    );

    setInitialFetchInProgress(true);
    setIsLoading(true);
    setError(null);

    fetchPlaybackStateAfterAppReady(getPlayerState, {
      signal: controller.signal,
      shouldStop: () =>
        startupWarmupGenerationRef.current !== generation ||
        lastCanonicalDealerStateTimestamp > warmupStartedAt,
    })
      .then((playback) => {
        if (
          !controller.signal.aborted &&
          startupWarmupGenerationRef.current === generation &&
          lastCanonicalDealerStateTimestamp <= warmupStartedAt &&
          playback
        ) {
          processPlaybackState(playback);
        }
      })
      .catch((err) => {
        if (
          !controller.signal.aborted &&
          startupWarmupGenerationRef.current === generation
        ) {
          setError(err.message);
          console.error(
            "Failed to fetch player state after app became ready:",
            err,
          );
        }
      })
      .finally(() => {
        clearTimeout(overallTimeoutId);
        if (startupWarmupGenerationRef.current === generation) {
          setInitialFetchInProgress(false);
          setIsLoading(false);
          if (startupWarmupAbortRef.current === controller) {
            startupWarmupAbortRef.current = null;
          }
        }
      });

    return () => {
      clearTimeout(overallTimeoutId);
      controller.abort();
      if (startupWarmupAbortRef.current === controller) {
        startupWarmupAbortRef.current = null;
      }
      if (startupWarmupGenerationRef.current === generation) {
        startupWarmupGenerationRef.current += 1;
      }
    };
  }, [
    wsConnected,
    appReady,
    appReadyGeneration,
    isSpotifyReady,
    getPlayerState,
    processPlaybackState,
  ]);

  useEffect(() => {
    if (!isSpotifyReady) return;

    const handlePlayerStateChanged = (data) => {
      if (
        data.type === "event" &&
        (data.topic === "spotify.player.device_state_changed" ||
          data.topic === "spotify.player.update" ||
          data.topic === "spotify.player.state_changed" ||
          data.topic === "spotify.player.volume_changed")
      ) {
        markPlayerEvent();
        lastDealerEventTimestamp = Date.now();
        const payloads = data.data?.payloads || [];

        if (payloads.length > 0 && payloads[0]?.cluster) {
          const cluster = payloads[0].cluster;
          const activeDeviceId = cluster.active_device_id;
          if (activeDeviceId && cluster.devices?.[activeDeviceId]) {
            cachedActiveDeviceType =
              cluster.devices[activeDeviceId].device_type;
          }
        }

        if (payloads.length > 0 && payloads[0]?.cluster?.player_state) {
          lastCanonicalDealerStateTimestamp = Date.now();
          startupWarmupAbortRef.current?.abort();
          const playerState = payloads[0].cluster.player_state;

          if (currentPlaybackRef.current?.item?.is_phone_media) {
            lastSpotifyDeviceStateChange = Date.now();
          }

          if (
            currentPlaybackRef.current?.item?.is_phone_media &&
            phoneMediaArtworkBlobUrl
          ) {
            URL.revokeObjectURL(phoneMediaArtworkBlobUrl);
            phoneMediaArtworkBlobUrl = null;
          }

          const prevBlobUrl =
            currentPlaybackRef.current?.item?.album?.images?.[0]?.url;
          const hasPrevBlobArtwork = prevBlobUrl?.startsWith("blob:");
          const prevTrackName = currentPlaybackRef.current?.item?.name
            ?.toLowerCase()
            ?.trim();
          const incomingTrackName = playerState.track?.metadata?.title
            ?.toLowerCase()
            ?.trim();
          const isSameTrack =
            incomingTrackName &&
            prevTrackName &&
            incomingTrackName === prevTrackName;
          const shouldPreserveBlobArtwork = hasPrevBlobArtwork && isSameTrack;

          const isEpisode =
            playerState.track?.uri?.startsWith("spotify:episode:");
          const fallbackArtistName =
            playerState.track?.metadata?.artist_name ||
            playerState.track?.metadata?.album_artist_name ||
            playerState.track?.metadata?.artist ||
            "";
          const fallbackArtistUri = playerState.track?.metadata?.artist_uri;

          const transformedState = {
            is_playing:
              playerState.is_paused === false || playerState.is_paused === 0,
            timestamp:
              parseInt(playerState.timestamp) ||
              data.phone_timestamp_ms ||
              data.server_timestamp_ms ||
              Date.now(),
            progress_ms: parseInt(playerState.position_as_of_timestamp) || 0,

            context: playerState.context_uri
              ? {
                  uri: playerState.context_uri,
                  type: playerState.context_uri.split(":")[1],
                  href: null,
                }
              : null,

            item: playerState.track
              ? isEpisode
                ? {
                    id: playerState.track.uri.split(":")[2],
                    uri: playerState.track.uri,
                    type: "episode",
                    name: playerState.track.metadata.title,
                    show: {
                      id: playerState.context_uri?.split(":")[2],
                      uri: playerState.context_uri,
                      name:
                        playerState.track.metadata.album_title ||
                        "Unknown Show",
                      publisher:
                        playerState.track.metadata.album_title ||
                        "Unknown Show",
                      images: playerState.track.metadata.image_url
                        ? [
                            {
                              url: playerState.track.metadata.image_url.startsWith(
                                "http",
                              )
                                ? playerState.track.metadata.image_url
                                : `https://${playerState.track.metadata.image_url}`,
                            },
                          ]
                        : [],
                    },
                    duration_ms: parseInt(playerState.duration) || 0,
                    is_local: false,
                  }
                : {
                    id: playerState.track.uri.split(":")[2],
                    uri: playerState.track.uri,
                    type: "track",
                    name:
                      playerState.track.metadata.title ||
                      (currentPlaybackRef.current?.item?.uri ===
                      playerState.track.uri
                        ? currentPlaybackRef.current.item.name
                        : undefined),
                    album:
                      playerState.track.metadata.album_uri ||
                      playerState.track.metadata.album_title ||
                      playerState.track.metadata.image_url
                        ? {
                            id: playerState.track.metadata.album_uri?.split(
                              ":",
                            )[2],
                            uri: playerState.track.metadata.album_uri,
                            name: playerState.track.metadata.album_title,
                            images: shouldPreserveBlobArtwork
                              ? [{ url: prevBlobUrl }]
                              : playerState.track.metadata.image_url
                                ? [
                                    {
                                      url: playerState.track.metadata.image_url.startsWith(
                                        "http",
                                      )
                                        ? playerState.track.metadata.image_url
                                        : `https://${playerState.track.metadata.image_url}`,
                                    },
                                  ]
                                : playerState.track.metadata.is_narration ===
                                      "true" ||
                                    playerState.track.metadata
                                      .album_artist_name === "DJ X"
                                  ? [{ url: "/images/radio-cover/dj.webp" }]
                                  : [],
                          }
                        : shouldPreserveBlobArtwork
                          ? { images: [{ url: prevBlobUrl }] }
                          : currentPlaybackRef.current?.item?.uri ===
                              playerState.track.uri
                            ? currentPlaybackRef.current.item.album
                            : {},
                    artists:
                      playerState.track.metadata.is_narration === "true" ||
                      playerState.track.metadata.album_artist_name === "DJ X"
                        ? [
                            {
                              id: "dj-x",
                              uri: "spotify:artist:dj-x",
                              name: "DJ X",
                              type: "artist",
                            },
                          ]
                        : playerState.track.metadata.artists
                          ? playerState.track.metadata.artists.map(
                              (artist) => ({
                                id: artist.id || artist.uri?.split(":")[2],
                                uri:
                                  artist.uri || `spotify:artist:${artist.id}`,
                                name: artist.name,
                                type: artist.type || "artist",
                              }),
                            )
                          : fallbackArtistName
                            ? [
                                {
                                  id: fallbackArtistUri?.split(":")[2],
                                  uri: fallbackArtistUri,
                                  name: fallbackArtistName,
                                  type: "artist",
                                },
                              ]
                            : [],
                    duration_ms: parseInt(playerState.duration) || 0,
                    is_local: false,
                  }
              : null,

            shuffle_state:
              playerState.options?.shuffling_context === true ||
              playerState.options?.shuffling_context === 1,
            repeat_state:
              playerState.options?.repeating_track === true ||
              playerState.options?.repeating_track === 1
                ? "track"
                : playerState.options?.repeating_context === true ||
                    playerState.options?.repeating_context === 1
                  ? "context"
                  : "off",

            device:
              payloads[0]?.cluster?.devices &&
              payloads[0]?.cluster?.active_device_id
                ? (() => {
                    const activeDeviceId = payloads[0].cluster.active_device_id;
                    const device = payloads[0].cluster.devices[activeDeviceId];
                    return device
                      ? {
                          id: device.device_id,
                          is_active: true,
                          name: device.name,
                          type: device.device_type,
                          volume_percent: Math.round(
                            (device.volume / 65535) * 100,
                          ),
                        }
                      : null;
                  })()
                : null,

            currently_playing_type: isEpisode ? "episode" : "track",

            playback_speed: playerState.options?.playback_speed || 1,
          };

          if (nowPlayingTrackLatch) {
            const latchAge = Date.now() - nowPlayingTrackLatch.timestamp;
            if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
              const incomingDeviceTitle = playerState.track?.metadata?.title
                ?.toLowerCase()
                ?.trim();
              if (
                incomingDeviceTitle &&
                incomingDeviceTitle !== nowPlayingTrackLatch.title
              ) {
                return;
              }
              if (
                incomingDeviceTitle &&
                incomingDeviceTitle === nowPlayingTrackLatch.title
              ) {
                nowPlayingTrackLatch = null;
              }
            } else {
              nowPlayingTrackLatch = null;
            }
          }

          processPlaybackState(transformedState);
        }
      }
    };

    const cleanup = addGlobalWsListener(`player-state-${Date.now()}`, {
      onMessage: handlePlayerStateChanged,
    });

    return cleanup;
  }, [isSpotifyReady, markPlayerEvent, processPlaybackState]);

  useEffect(() => {
    /**
     * @param {{ type?: string, topic?: string, data?: MediaNowPlayingUpdateEvent | MediaNowPlayingArtworkEvent | MediaNowPlayingArtworkFailedEvent | PhoneVolumeUpdateEvent, server_timestamp_ms?: number }} data
     */
    const handlePhoneMediaEvent = (data) => {
      if (
        data.type === "event" &&
        (data.topic === "media.now_playing.update" ||
          data.topic === "media.nowPlaying.update")
      ) {
        const media =
          data.data?.media_item_attributes ??
          data.data?.mediaItemAttributes ??
          data.data?.MediaItemAttributes;
        const playback =
          data.data?.playback_attributes ??
          data.data?.playbackAttributes ??
          data.data?.PlaybackAttributes;

        if (!media || !playback) return;

        if (
          shouldIgnoreInactiveForeignMedia(
            currentPlaybackRef.current,
            playback.PlaybackAppName,
            playback.PlaybackStatus,
          )
        ) {
          return;
        }

        markPlayerEvent();

        if (
          playback.PlaybackAppName === "Spotify" &&
          media.MediaItemArtist?.startsWith("Listening on ")
        ) {
          return;
        }

        mediaGenerationCorrelator.recordMetadata(data.data);
        beginNowPlayingUpdateWindow();
        isProcessingArtwork = false;

        if (
          playback.PlaybackAppName === "Spotify" &&
          !getSpotifySkippedState()
        ) {
          pendingSpotifyMediaUpdate = {
            media,
            playback,
            timestamp: Date.now(),
          };

          if (spotifyFallbackTimeout) {
            clearTimeout(spotifyFallbackTimeout);
          }

          const commitSpotifyPendingPlaceholder = () => {
            const currentItem = currentPlaybackRef.current?.item;
            const hasRealSpotifyData =
              currentItem?.uri?.startsWith("spotify:") &&
              !currentItem?.is_spotify_pending;

            if (pendingSpotifyMediaUpdate && !hasRealSpotifyData) {
              const { media: pendingMedia, playback: pendingPlayback } =
                pendingSpotifyMediaUpdate;
              const title = pendingMedia.MediaItemTitle || "Unknown Title";
              const artist = pendingMedia.MediaItemArtist || "Unknown Artist";
              const albumName = pendingMedia.MediaItemAlbumName || title;
              const durationMs =
                pendingMedia.MediaItemPlaybackDurationInMilliseconds || 0;

              const newTrackUri = `spotify:pending:${title}`;
              const cachedArtwork = artworkCache.get(newTrackUri);

              const shuffleState =
                pendingPlayback.PlaybackShuffleMode === "albums" ||
                pendingPlayback.PlaybackShuffleMode === "songs";
              const repeatState =
                pendingPlayback.PlaybackRepeatMode === "one"
                  ? "track"
                  : pendingPlayback.PlaybackRepeatMode === "all"
                    ? "context"
                    : "off";

              const placeholderState = {
                is_playing: pendingPlayback.PlaybackStatus === "playing",
                timestamp: Date.now(),
                progress_ms: null,
                context: null,
                item: {
                  id: `spotify-pending-${title}`,
                  uri: newTrackUri,
                  type: "track",
                  name: title,
                  album: {
                    id: `spotify-pending-album-${albumName}`,
                    uri: `spotify:pending:album:${albumName}`,
                    name: albumName,
                    images: cachedArtwork
                      ? [{ url: cachedArtwork }]
                      : [{ url: "/images/not-playing.webp" }],
                  },
                  artists: [
                    {
                      id: `spotify-pending-artist-${artist}`,
                      uri: `spotify:pending:artist:${artist}`,
                      name: artist,
                      type: "artist",
                    },
                  ],
                  duration_ms: durationMs,
                  is_spotify_pending: true,
                },
                shuffle_state: shuffleState,
                repeat_state: repeatState,
                device: null,
                currently_playing_type: "track",
                playback_speed: pendingPlayback.PlaybackRate || 1,
              };

              processPlaybackState(placeholderState);
              pendingSpotifyMediaUpdate = null;
            }
          };

          spotifyFallbackTimeout = setTimeout(() => {
            commitSpotifyPendingPlaceholder();
            spotifyFallbackTimeout = null;
          }, 10000);

          const currentItem = currentPlaybackRef.current?.item;
          const hasRealSpotifyData =
            currentItem?.uri?.startsWith("spotify:") &&
            !currentItem?.is_spotify_pending;

          if (currentItem?.is_phone_media) {
            clearTimeout(spotifyFallbackTimeout);
            spotifyFallbackTimeout = null;
            commitSpotifyPendingPlaceholder();
            return;
          }

          if (hasRealSpotifyData) {
            const incomingTitle = media.MediaItemTitle;
            const currentTitle = currentItem?.name;
            const isTitleChange =
              incomingTitle &&
              currentTitle &&
              incomingTitle.toLowerCase().trim() !==
                currentTitle.toLowerCase().trim();

            if (isTitleChange) {
              const dealerIsFresh =
                lastDealerEventTimestamp > 0 &&
                Date.now() - lastDealerEventTimestamp <
                  DEALER_FRESH_THRESHOLD_MS;
              if (dealerIsFresh) {
                return;
              }
            }

            const title = incomingTitle || currentItem.name;
            const artist = media.MediaItemArtist;
            const isPlaying = playback.PlaybackStatus === "playing";

            if (isTitleChange) {
              progressResetSignal = { position: 0, timestamp: Date.now() };
              nowPlayingTrackLatch = {
                title: incomingTitle.toLowerCase().trim(),
                timestamp: Date.now(),
              };
            }

            setCurrentPlayback((prevPlayback) => {
              if (!prevPlayback?.item) return prevPlayback;

              const iap2Duration = media.MediaItemDuration;

              let newProgressMs;
              if (isTitleChange) {
                newProgressMs = 0;
              } else {
                let estimatedProgress = prevPlayback.progress_ms || 0;
                if (prevPlayback.is_playing && prevPlayback.timestamp) {
                  const elapsed = Date.now() - prevPlayback.timestamp;
                  estimatedProgress += elapsed;
                }
                const duration = iap2Duration || prevPlayback.item?.duration_ms;
                if (duration && duration > 0 && estimatedProgress > duration) {
                  estimatedProgress = duration;
                }
                newProgressMs = estimatedProgress;
              }

              const updatedPlayback = {
                ...prevPlayback,
                is_playing: isPlaying,
                timestamp: Date.now(),
                progress_ms: newProgressMs,
                item: isTitleChange
                  ? {
                      ...prevPlayback.item,
                      id: `spotify-transitional-${Date.now()}`,
                      name: title,
                      artists: artist
                        ? [{ ...prevPlayback.item.artists?.[0], name: artist }]
                        : prevPlayback.item.artists,
                      ...(iap2Duration && iap2Duration > 0
                        ? { duration_ms: iap2Duration }
                        : {}),
                    }
                  : prevPlayback.item,
              };
              currentPlaybackRef.current = updatedPlayback;
              return updatedPlayback;
            });
          }

          return;
        }

        const timeSinceSpotifyStateChange =
          Date.now() - lastSpotifyDeviceStateChange;
        if (timeSinceSpotifyStateChange < 5000) {
          return;
        }

        if (!playback.PlaybackAppName) {
          const currentItem = currentPlaybackRef.current?.item;
          if (currentItem && !currentItem.is_phone_media) {
            const incomingTitle = media.MediaItemTitle?.toLowerCase().trim();
            const currentTitle = currentItem.name?.toLowerCase().trim();
            const incomingArtistRaw = media.MediaItemArtist?.trim();
            const isRealSpotify =
              typeof currentItem.uri === "string" &&
              currentItem.uri.startsWith("spotify:") &&
              !currentItem.is_spotify_pending;
            if (isRealSpotify) {
              const isListeningOnArtifact =
                !!incomingArtistRaw &&
                incomingArtistRaw.startsWith("Listening on ");
              const isSameTitle =
                !!incomingTitle &&
                !!currentTitle &&
                incomingTitle === currentTitle;
              const isComboTitle =
                !!incomingTitle &&
                !!currentTitle &&
                incomingTitle.startsWith(currentTitle + " • ");
              if (isListeningOnArtifact || isSameTitle || isComboTitle) {
                return;
              }
            }
            const titleMatches =
              !!incomingTitle &&
              !!currentTitle &&
              incomingTitle === currentTitle;
            const isPending = currentItem.is_spotify_pending === true;
            const currentIsPlaying =
              currentPlaybackRef.current?.is_playing === true;
            if (titleMatches || !incomingTitle) {
              return;
            }
            if (!isPending && currentIsPlaying) {
              return;
            }
          } else if (!currentItem && pendingSpotifyMediaUpdate) {
            return;
          }
        }

        const hasTitle =
          media.MediaItemTitle && media.MediaItemTitle.trim() !== "";
        const hasArtist =
          media.MediaItemArtist && media.MediaItemArtist.trim() !== "";
        const isStopped = playback.PlaybackStatus === "stopped";
        const isEmpty = !hasTitle && !hasArtist && isStopped;

        if (isEmpty) {
          return;
        }

        const shuffleState =
          playback.PlaybackShuffleMode === "albums" ||
          playback.PlaybackShuffleMode === "songs";

        const repeatState =
          playback.PlaybackRepeatMode === "one"
            ? "track"
            : playback.PlaybackRepeatMode === "all"
              ? "context"
              : "off";

        const isNotPlaying = !hasTitle && !hasArtist;

        const title = isNotPlaying
          ? "Not Playing"
          : media.MediaItemTitle || "Unknown Title";
        const artist = isNotPlaying
          ? ""
          : media.MediaItemArtist || "Unknown Artist";
        const albumName = isNotPlaying
          ? "Not Playing"
          : media.MediaItemAlbumName || title;
        const durationMs = media.MediaItemPlaybackDurationInMilliseconds || 0;

        const newTrackUri = `local:media:${title}`;
        const cachedArtworkForTrack = artworkCache.get(newTrackUri);

        const transformedState = {
          is_playing: playback.PlaybackStatus === "playing",
          timestamp: data.server_timestamp_ms || Date.now(),
          progress_ms: 0,

          context: null,

          item: {
            id: `local-media-${title}`,
            uri: newTrackUri,
            type: "track",
            name: title,
            album: {
              id: `local-album-${albumName}`,
              uri: `local:album:${albumName}`,
              name: albumName,
              images: isNotPlaying
                ? [{ url: "/images/not-playing.webp" }]
                : cachedArtworkForTrack
                  ? [{ url: cachedArtworkForTrack }]
                  : [{ url: "/images/not-playing.webp" }],
            },
            artists: [
              {
                id: `local-artist-${artist}`,
                uri: `local:artist:${artist}`,
                name: artist,
                type: "artist",
              },
            ],
            duration_ms: durationMs,
            is_phone_media: true,
          },

          shuffle_state: shuffleState,
          repeat_state: repeatState,

          device: null,

          currently_playing_type: "track",

          playback_speed: playback.PlaybackRate || 1,

          currently_active_application: playback.PlaybackAppName || null,
        };

        processPlaybackState(transformedState);
      } else if (
        data.type === "event" &&
        (data.topic === "media.now_playing.artwork" ||
          data.topic === "media.nowPlaying.artwork")
      ) {
        if (!mediaGenerationCorrelator.acceptsArtwork(data.data)) {
          return;
        }

        beginNowPlayingUpdateWindow();

        const artworkData = data.data?.data;

        if (artworkData && artworkData.trim() !== "") {
          const currentItem = currentPlaybackRef.current?.item;
          const hasRealSpotifyData = isCanonicalSpotifyItem(currentItem);
          const pendingArtworkTitle = pendingSpotifyMediaUpdate
            ? pendingSpotifyMediaUpdate.media.MediaItemTitle || "Unknown Title"
            : null;
          const pendingArtworkIsTrackChange = isPendingSpotifyTrackChange(
            currentItem,
            pendingArtworkTitle,
          );
          const artworkTargetUri = getPushedArtworkTargetUri(
            currentItem,
            pendingArtworkTitle,
          );

          if (!artworkTargetUri) {
            return;
          }

          if (isProcessingArtwork) {
            return;
          }

          isProcessingArtwork = true;

          try {
            const binaryString = atob(artworkData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: "image/jpeg" });
            const nextArtworkBlobUrl = URL.createObjectURL(blob);

            if (
              hasRealSpotifyData &&
              pendingSpotifyMediaUpdate &&
              !pendingArtworkIsTrackChange
            ) {
              const previousPendingArtwork = artworkCache.get(artworkTargetUri);
              if (
                previousPendingArtwork?.startsWith("blob:") &&
                previousPendingArtwork !== nextArtworkBlobUrl
              ) {
                URL.revokeObjectURL(previousPendingArtwork);
              }
              artworkCache.set(artworkTargetUri, nextArtworkBlobUrl);
              currentArtworkTrackUri = artworkTargetUri;
              cleanupArtworkCache();
              return;
            }

            const oldBlobUrl = phoneMediaArtworkBlobUrl;
            phoneMediaArtworkBlobUrl = nextArtworkBlobUrl;

            if (
              pendingSpotifyMediaUpdate &&
              (!hasRealSpotifyData || pendingArtworkIsTrackChange)
            ) {
              const { media, playback } = pendingSpotifyMediaUpdate;
              const title = media.MediaItemTitle || "Unknown Title";
              const artist = media.MediaItemArtist || "Unknown Artist";
              const albumName = media.MediaItemAlbumName || title;
              const durationMs =
                media.MediaItemPlaybackDurationInMilliseconds || 0;

              const newTrackUri = `spotify:pending:${title}`;
              artworkCache.set(newTrackUri, phoneMediaArtworkBlobUrl);

              const shuffleState =
                playback.PlaybackShuffleMode === "albums" ||
                playback.PlaybackShuffleMode === "songs";
              const repeatState =
                playback.PlaybackRepeatMode === "one"
                  ? "track"
                  : playback.PlaybackRepeatMode === "all"
                    ? "context"
                    : "off";

              const placeholderState = {
                is_playing: playback.PlaybackStatus === "playing",
                timestamp: Date.now(),
                progress_ms: null,
                context: null,
                item: {
                  id: `spotify-pending-${title}`,
                  uri: newTrackUri,
                  type: "track",
                  name: title,
                  album: {
                    id: `spotify-pending-album-${albumName}`,
                    uri: `spotify:pending:album:${albumName}`,
                    name: albumName,
                    images: [{ url: phoneMediaArtworkBlobUrl }],
                  },
                  artists: [
                    {
                      id: `spotify-pending-artist-${artist}`,
                      uri: `spotify:pending:artist:${artist}`,
                      name: artist,
                      type: "artist",
                    },
                  ],
                  duration_ms: durationMs,
                  is_spotify_pending: true,
                },
                shuffle_state: shuffleState,
                repeat_state: repeatState,
                device: null,
                currently_playing_type: "track",
                playback_speed: playback.PlaybackRate || 1,
              };

              processPlaybackState(placeholderState);
              pendingSpotifyMediaUpdate = null;

              if (spotifyFallbackTimeout) {
                clearTimeout(spotifyFallbackTimeout);
                spotifyFallbackTimeout = null;
              }

              if (oldBlobUrl && oldBlobUrl !== phoneMediaArtworkBlobUrl) {
                const isInCache = Array.from(artworkCache.values()).includes(
                  oldBlobUrl,
                );
                if (!isInCache) {
                  setTimeout(() => {
                    URL.revokeObjectURL(oldBlobUrl);
                  }, 100);
                }
              }
              return;
            }

            const trackUri = artworkTargetUri;

            if (trackUri) {
              if (artworkCache.has(trackUri)) {
                const oldCachedUrl = artworkCache.get(trackUri);
                if (oldCachedUrl && oldCachedUrl !== phoneMediaArtworkBlobUrl) {
                  URL.revokeObjectURL(oldCachedUrl);
                }
              }
              artworkCache.set(trackUri, phoneMediaArtworkBlobUrl);
              currentArtworkTrackUri = trackUri;
              cleanupArtworkCache();

              setCurrentPlayback((prevPlayback) => {
                if (
                  prevPlayback?.item?.uri === trackUri &&
                  prevPlayback.item?.album?.images
                ) {
                  const updatedPlayback = {
                    ...prevPlayback,
                    item: {
                      ...prevPlayback.item,
                      album: {
                        ...prevPlayback.item.album,
                        images: [{ url: phoneMediaArtworkBlobUrl }],
                      },
                    },
                  };
                  currentPlaybackRef.current = updatedPlayback;
                  return updatedPlayback;
                }
                return prevPlayback;
              });

              setCurrentlyPlayingAlbum((prevAlbum) => {
                if (
                  prevAlbum?.images &&
                  (prevAlbum?.uri === trackUri ||
                    prevAlbum?.id ===
                      currentPlaybackRef.current?.item?.album?.id)
                ) {
                  return {
                    ...prevAlbum,
                    images: [{ url: phoneMediaArtworkBlobUrl }],
                  };
                }
                return prevAlbum;
              });
            }

            if (oldBlobUrl && oldBlobUrl !== phoneMediaArtworkBlobUrl) {
              const isInCache = Array.from(artworkCache.values()).includes(
                oldBlobUrl,
              );
              if (!isInCache) {
                setTimeout(() => {
                  URL.revokeObjectURL(oldBlobUrl);
                }, 100);
              }
            }
          } catch (err) {
            console.error("Error decoding artwork data:", err);
          } finally {
            setTimeout(() => {
              isProcessingArtwork = false;
            }, 100);
          }
        }
      } else if (
        data.type === "event" &&
        (data.topic === "media.now_playing.artwork.failed" ||
          data.topic === "media.nowPlaying.artwork.failed")
      ) {
        console.log("Artwork file transfer failed, fetching from Spotify API");

        pendingSpotifyMediaUpdate = null;
        if (spotifyFallbackTimeout) {
          clearTimeout(spotifyFallbackTimeout);
          spotifyFallbackTimeout = null;
        }

        getPlayerState()
          .then((playerData) => {
            if (playerData && Object.keys(playerData).length > 0) {
              if (nowPlayingTrackLatch) {
                const latchAge = Date.now() - nowPlayingTrackLatch.timestamp;
                if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
                  const fetchedTitle = playerData.item?.name
                    ?.toLowerCase()
                    ?.trim();
                  if (
                    fetchedTitle &&
                    fetchedTitle !== nowPlayingTrackLatch.title
                  ) {
                    return;
                  }
                  if (
                    fetchedTitle &&
                    fetchedTitle === nowPlayingTrackLatch.title
                  ) {
                    nowPlayingTrackLatch = null;
                  }
                } else {
                  nowPlayingTrackLatch = null;
                }
              }

              if (nowPlayingUpdateTimeout) {
                clearTimeout(nowPlayingUpdateTimeout);
                nowPlayingUpdateTimeout = null;
              }
              setIsReceivingNowPlayingUpdates(false);
              isReceivingNowPlayingUpdatesGlobal = false;

              processPlaybackState(playerData);
            }
          })
          .catch((err) => {
            console.error(
              "Failed to fetch player state after artwork failure:",
              err,
            );
          });
      } else if (
        data.type === "event" &&
        data.topic === "phone.volume.update"
      ) {
        const volumePercent = normalizePhoneVolumePercent(
          data.data?.volume_percent ?? data.data?.volumePercent,
        );
        if (volumePercent !== null) {
          notifyPhoneVolumeListeners(volumePercent);
        }
      }
    };

    const cleanup = addGlobalWsListener(`phone-media-${Date.now()}`, {
      onMessage: handlePhoneMediaEvent,
    });

    return () => {
      cleanup();
    };
  }, [
    processPlaybackState,
    beginNowPlayingUpdateWindow,
    getPlayerState,
    markPlayerEvent,
  ]);

  const refreshPlaybackState = useCallback(
    async (forceRefresh = false) => {
      if (!appReady || !isSpotifyReady) return;

      if (!forceRefresh && currentPlaybackRef.current?.item?.is_phone_media) {
        return;
      }

      try {
        const data = await getPlayerState();

        if (!data || Object.keys(data).length === 0) {
          resetPlaybackState();
        } else {
          if (nowPlayingTrackLatch) {
            const latchAge = Date.now() - nowPlayingTrackLatch.timestamp;
            if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
              const fetchedTitle = data.item?.name?.toLowerCase()?.trim();
              if (fetchedTitle && fetchedTitle !== nowPlayingTrackLatch.title) {
                return;
              }
              if (fetchedTitle && fetchedTitle === nowPlayingTrackLatch.title) {
                nowPlayingTrackLatch = null;
              }
            } else {
              nowPlayingTrackLatch = null;
            }
          }
          processPlaybackState(data);
        }
      } catch (err) {
        console.error("Error refreshing playback state:", err);
        setError(err.message);
      }
    },
    [
      appReady,
      isSpotifyReady,
      getPlayerState,
      resetPlaybackState,
      processPlaybackState,
    ],
  );

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
    playerEventSequence,
  };
}
