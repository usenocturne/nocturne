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
import { normalizeInlineImageSource } from "../utils/imageSource";

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
  rejectCurrentArtwork: () => void;
  acceptsArtwork: (data: unknown) => boolean;
  acceptsFailure: () => boolean;
  current: () => MediaGeneration;
};
type PhoneMediaAttributes = Record<string, unknown>;
type PhoneMediaTiming = {
  durationMs: number;
  progressMs: number | null;
  playbackRate: number;
  timestamp: number;
};
type SpotifyPhoneMediaUpdate = {
  media: PhoneMediaAttributes;
  playback: PhoneMediaAttributes;
  timestamp: number;
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
let artworkDeviceOwners = new Map<string, string | null>();
const MAX_ARTWORK_CACHE_SIZE = 10;
let pendingSpotifyMediaUpdate: SpotifyPhoneMediaUpdate | null = null;
let latestSpotifyPhoneMediaUpdate: SpotifyPhoneMediaUpdate | null = null;
let spotifyFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
let cachedActiveDeviceType: string | null = null;
let progressResetSignal: ProgressResetSignal = null;
let nowPlayingTrackLatch: NowPlayingTrackLatch | null = null;
let lastDealerEventTimestamp = 0;
let lastCanonicalDealerStateTimestamp = 0;
const NOWPLAYING_PRECEDENCE_WINDOW_MS = 30000;
const DEALER_FRESH_THRESHOLD_MS = 8000;
const PHONE_ARTWORK_CONTEXT_TTL_MS = 10000;
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

export const normalizeSpotifyDeviceType = (
  deviceType: unknown,
): string | null =>
  typeof deviceType === "string" && deviceType.trim().length > 0
    ? deviceType.trim().toUpperCase()
    : null;

const hasNonEmptyText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const isSpotifyPlaybackApp = (appName: unknown): boolean =>
  typeof appName === "string" && appName.trim().toLowerCase() === "spotify";

export const hasCompleteSpotifyMediaMetadata = (
  media: PhoneMediaAttributes | null | undefined,
): boolean =>
  Boolean(
    hasNonEmptyText(media?.MediaItemTitle) &&
    hasNonEmptyText(media?.MediaItemArtist),
  );

export const isEmptyPhoneMediaUpdate = (
  media: PhoneMediaAttributes | null | undefined,
  playback: PhoneMediaAttributes | null | undefined,
): boolean =>
  !hasNonEmptyText(media?.MediaItemTitle) &&
  !hasNonEmptyText(media?.MediaItemArtist) &&
  typeof playback?.PlaybackStatus === "string" &&
  playback.PlaybackStatus.trim().toLowerCase() === "stopped";

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const normalizePhoneMediaTiming = (
  media: PhoneMediaAttributes,
  playback: PhoneMediaAttributes,
  serverTimestampMs?: unknown,
): PhoneMediaTiming => {
  const rawDuration =
    media.MediaItemPlaybackDurationInMilliseconds ?? media.MediaItemDuration;
  const parsedDuration = finiteNumber(rawDuration);
  const durationMs =
    parsedDuration !== null && parsedDuration > 0 ? parsedDuration : 0;

  const rawProgress =
    playback.PlaybackElapsedTimeInMilliseconds ?? playback.PlaybackElapsedTime;
  const parsedProgress = finiteNumber(rawProgress);
  const unclampedProgress =
    parsedProgress !== null && parsedProgress >= 0 ? parsedProgress : null;
  const progressMs =
    unclampedProgress !== null && durationMs > 0
      ? Math.min(unclampedProgress, durationMs)
      : unclampedProgress;

  const normalizedRate = finiteNumber(playback.PlaybackRate);
  const speedHundredths = finiteNumber(playback.PlaybackSpeed);
  const fallbackRate = speedHundredths !== null ? speedHundredths / 100 : null;
  const candidateRate = normalizedRate ?? fallbackRate;
  const playbackRate =
    candidateRate !== null && candidateRate > 0 ? candidateRate : 1;

  const parsedTimestamp = finiteNumber(serverTimestampMs);
  const timestamp =
    parsedTimestamp !== null && parsedTimestamp > 0
      ? parsedTimestamp
      : Date.now();

  return { durationMs, progressMs, playbackRate, timestamp };
};

export const getPhoneMediaTrackId = (
  appName: unknown,
  title: string,
  artist: string,
  albumName: string,
): string =>
  [
    typeof appName === "string" ? appName : "unknown-app",
    title,
    artist,
    albumName,
  ].join(":");

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
    let currentArtworkRejected = false;
    return {
      recordMetadata(data) {
        metadataGeneration = normalizeMediaGeneration(data);
        currentArtworkRejected = false;
      },
      rejectCurrentArtwork() {
        currentArtworkRejected = true;
      },
      acceptsArtwork(data) {
        return (
          !currentArtworkRejected &&
          mediaGenerationsCorrelate(
            metadataGeneration,
            normalizeMediaGeneration(data),
          )
        );
      },
      acceptsFailure() {
        return !currentArtworkRejected;
      },
      current() {
        return metadataGeneration;
      },
    };
  };

const mediaGenerationCorrelator = createMediaGenerationCorrelator();

export const acceptsPhoneMediaArtworkEvent = (
  correlator: MediaGenerationCorrelator,
  data: unknown,
  isFailure: boolean,
): boolean =>
  isFailure ? correlator.acceptsFailure() : correlator.acceptsArtwork(data);

export const isCurrentMediaArtwork = (data: unknown): boolean =>
  mediaGenerationCorrelator.acceptsArtwork(data);

export const shouldClearDisplayedMediaForEmptyUpdate = (
  currentItem: SpotifyTrack | null | undefined,
  isEmptyUpdate: boolean,
): boolean =>
  Boolean(
    isEmptyUpdate &&
    (currentItem?.is_phone_media || currentItem?.is_spotify_pending),
  );

export const isSpotifyLocalItem = (
  item: SpotifyTrack | null | undefined,
): boolean =>
  Boolean(item?.is_local || item?.uri?.startsWith("spotify:local:"));

export const isCanonicalSpotifyItem = (
  item: SpotifyTrack | null | undefined,
): boolean =>
  Boolean(
    item?.uri?.startsWith("spotify:") &&
    !item.is_spotify_pending &&
    !item.is_phone_media &&
    !isSpotifyLocalItem(item),
  );

export const isResolvedSpotifyItem = (
  item: SpotifyTrack | null | undefined,
): boolean =>
  Boolean(
    item?.uri?.startsWith("spotify:") &&
    !item.is_spotify_pending &&
    !item.is_phone_media,
  );

export const shouldIgnoreInactiveForeignMedia = (
  currentPlayback: SpotifyPlayback | null | undefined,
  playbackAppName: unknown,
  playbackStatus: unknown,
): boolean => {
  if (
    currentPlayback?.is_playing !== true ||
    !isResolvedSpotifyItem(currentPlayback.item) ||
    typeof playbackAppName !== "string" ||
    playbackAppName.trim().length === 0 ||
    isSpotifyPlaybackApp(playbackAppName)
  ) {
    return false;
  }

  return playbackStatus !== "playing" && playbackStatus !== "loading";
};

export const shouldIgnoreSpotifyPhoneMediaUpdate = (
  currentPlayback: SpotifyPlayback | null | undefined,
  playbackAppName: unknown,
): boolean => {
  if (
    !isSpotifyPlaybackApp(playbackAppName) ||
    !isResolvedSpotifyItem(currentPlayback?.item)
  ) {
    return false;
  }
  const normalizedDeviceType = normalizeSpotifyDeviceType(
    currentPlayback?.device?.type,
  );
  return Boolean(
    normalizedDeviceType &&
    normalizedDeviceType !== "UNKNOWN" &&
    normalizedDeviceType !== "SMARTPHONE",
  );
};

export const reconcilePlaybackDevice = (
  incomingPlayback: SpotifyPlayback,
  previousPlayback: SpotifyPlayback | null | undefined,
): SpotifyPlayback => {
  const isSameTrack = Boolean(
    incomingPlayback.item?.uri &&
    incomingPlayback.item.uri === previousPlayback?.item?.uri,
  );
  if (!isSameTrack || !previousPlayback?.device) return incomingPlayback;

  const incomingDevice = incomingPlayback.device;
  const incomingDeviceId = incomingDevice?.id?.trim();
  const previousDeviceId = previousPlayback.device.id?.trim();
  if (
    incomingDeviceId &&
    previousDeviceId &&
    incomingDeviceId !== previousDeviceId
  ) {
    return incomingPlayback;
  }

  return {
    ...incomingPlayback,
    device: {
      ...previousPlayback.device,
      ...incomingDevice,
    },
  };
};

type ArtworkDevice = {
  id?: string | null;
  type?: string | null;
} | null;

export const canUsePhonePushedArtwork = (
  item: SpotifyTrack | null | undefined,
  device: ArtworkDevice | undefined,
  ownerDeviceId: string | null | undefined,
): boolean => {
  if (!isResolvedSpotifyItem(item)) return true;

  const deviceType = normalizeSpotifyDeviceType(device?.type);
  if (deviceType && deviceType !== "UNKNOWN" && deviceType !== "SMARTPHONE") {
    return false;
  }

  return Boolean(!ownerDeviceId || !device?.id || ownerDeviceId === device.id);
};

export const reconcilePolledPlaybackTiming = (
  incomingPlayback: SpotifyPlayback,
  previousPlayback: SpotifyPlayback | null | undefined,
  nowMs = Date.now(),
): SpotifyPlayback => {
  const isSamePlayingTrack = Boolean(
    incomingPlayback.is_playing &&
    previousPlayback?.is_playing &&
    incomingPlayback.item?.uri &&
    incomingPlayback.item.uri === previousPlayback.item?.uri,
  );
  if (!isSamePlayingTrack || incomingPlayback.progress_ms !== 0) {
    return incomingPlayback;
  }

  const previousProgress = finiteNumber(previousPlayback?.progress_ms);
  const previousTimestamp = finiteNumber(previousPlayback?.timestamp);
  if (previousProgress === null || previousTimestamp === null) {
    return incomingPlayback;
  }

  const estimatedProgress =
    previousProgress + Math.max(0, nowMs - previousTimestamp);
  const durationMs = finiteNumber(incomingPlayback.item?.duration_ms) ?? 0;
  const isNearNaturalRestart =
    durationMs > 0 && estimatedProgress >= Math.max(0, durationMs - 5000);
  if (estimatedProgress <= 2000 || isNearNaturalRestart) {
    return incomingPlayback;
  }

  return {
    ...incomingPlayback,
    progress_ms: Math.min(estimatedProgress, durationMs || Infinity),
    timestamp: nowMs,
  };
};

export const getPushedArtworkTargetUri = (
  item: SpotifyTrack | null | undefined,
  pendingTitle: string | null = null,
): string | null => {
  const normalizedPendingTitle = pendingTitle?.trim().toLowerCase();
  const normalizedItemTitle = item?.name?.trim().toLowerCase();
  const isSameLocalTrack = Boolean(
    isSpotifyLocalItem(item) &&
    normalizedPendingTitle &&
    normalizedItemTitle === normalizedPendingTitle,
  );
  const isSameCanonicalTrack = Boolean(
    isCanonicalSpotifyItem(item) &&
    normalizedPendingTitle &&
    normalizedItemTitle === normalizedPendingTitle,
  );

  if (pendingTitle && !isSameLocalTrack && !isSameCanonicalTrack) {
    return `spotify:pending:${pendingTitle}`;
  }
  if (isCanonicalSpotifyItem(item)) {
    return isSameCanonicalTrack ? item.uri || null : null;
  }
  return item?.uri || null;
};

export const isPendingSpotifyTrackChange = (
  item: SpotifyTrack | null | undefined,
  pendingTitle: string | null,
): boolean =>
  Boolean(
    isResolvedSpotifyItem(item) &&
    pendingTitle &&
    item?.name?.trim().toLowerCase() !== pendingTitle.trim().toLowerCase(),
  );

export const consumeProgressResetSignal = () => {
  const signal = progressResetSignal;
  progressResetSignal = null;
  return signal;
};

export const isSpotifyLocalImageUrl = (
  url: string | null | undefined,
): boolean =>
  Boolean(
    url?.startsWith("spotify:localfileimage:") ||
    url?.startsWith("https://spotify:localfileimage:") ||
    url?.startsWith("http://spotify:localfileimage:"),
  );

export const normalizeImageUrl = (url: string | null | undefined) => {
  if (!url) return url;
  if (isSpotifyLocalImageUrl(url)) {
    return "/images/not-playing.webp";
  }
  const inlineSource = normalizeInlineImageSource(url);
  if (inlineSource !== url) {
    return inlineSource;
  }
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/")
  ) {
    return url;
  }
  return `https://${url}`;
};

const getNamedArtists = (artists: SpotifyTrack["artists"]) =>
  Array.isArray(artists)
    ? artists.filter(
        (artist) =>
          typeof artist?.name === "string" && artist.name.trim().length > 0,
      )
    : [];

const decodeSpotifyLocalSegment = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    return decodeURIComponent(value.replaceAll("+", " ")).trim();
  } catch {
    return value.replaceAll("+", " ").trim();
  }
};

const deriveSpotifyLocalArtistName = (item: SpotifyTrack): string => {
  const firstArtist = item.artists?.[0];
  const artistUriSegment = firstArtist?.uri?.startsWith("spotify:local:")
    ? firstArtist.uri.slice("spotify:local:".length).split(":")[0]
    : "";
  const trackUriSegment = item.uri?.startsWith("spotify:local:")
    ? item.uri.split(":")[2]
    : "";

  return (
    decodeSpotifyLocalSegment(artistUriSegment) ||
    decodeSpotifyLocalSegment(firstArtist?.id) ||
    decodeSpotifyLocalSegment(trackUriSegment)
  );
};

export const reconcilePlaybackItem = (
  incomingItem: SpotifyTrack | null | undefined,
  previousItem: SpotifyTrack | null | undefined,
): SpotifyTrack | null | undefined => {
  if (!incomingItem) return incomingItem;

  const isLocal = isSpotifyLocalItem(incomingItem);
  const sameTitle = Boolean(
    incomingItem.name?.trim() &&
    previousItem?.name?.trim() &&
    incomingItem.name.trim().toLowerCase() ===
      previousItem.name.trim().toLowerCase(),
  );
  const sameTrack = Boolean(
    (incomingItem.uri &&
      previousItem?.uri &&
      incomingItem.uri === previousItem.uri) ||
    (isLocal && sameTitle && previousItem?.is_spotify_pending),
  );
  const incomingNamedArtists = getNamedArtists(incomingItem.artists);
  const previousNamedArtists = sameTrack
    ? getNamedArtists(previousItem?.artists)
    : [];
  let artists =
    incomingNamedArtists.length > 0
      ? incomingNamedArtists
      : incomingItem.artists;

  if (previousNamedArtists.length > incomingNamedArtists.length && sameTrack) {
    artists = previousItem?.artists;
  } else if (isLocal && incomingNamedArtists.length === 0) {
    const fallbackName = deriveSpotifyLocalArtistName(incomingItem);
    if (fallbackName) {
      artists = [
        {
          ...incomingItem.artists?.[0],
          name: fallbackName,
        },
      ];
    }
  }

  if (!isLocal && artists === incomingItem.artists) {
    return incomingItem;
  }

  return {
    ...incomingItem,
    ...(isLocal ? { is_local: true } : {}),
    artists,
  };
};

export const shouldPreservePushedArtwork = (
  previousItem: SpotifyTrack | null | undefined,
  incomingItem: SpotifyTrack | null | undefined,
): boolean => {
  if (!previousItem || !incomingItem) return false;

  const previousUri = previousItem.uri;
  const incomingUri = incomingItem.uri;
  if (previousUri && incomingUri && previousUri === incomingUri) {
    return true;
  }

  const previousTitle = previousItem.name?.trim().toLowerCase();
  const incomingTitle = incomingItem.name?.trim().toLowerCase();
  if (!previousTitle || !incomingTitle || previousTitle !== incomingTitle) {
    return false;
  }

  return Boolean(
    !previousUri ||
    !incomingUri ||
    previousUri === incomingUri ||
    (isSpotifyLocalItem(incomingItem) && previousItem.is_spotify_pending),
  );
};

export const shouldPreserveDealerBlobArtwork = (
  previousItem: SpotifyTrack | null | undefined,
  incomingItem: Pick<SpotifyTrack, "uri" | "name"> | null | undefined,
): boolean =>
  Boolean(
    previousItem?.album?.images?.[0]?.url?.startsWith("blob:") &&
    shouldPreservePushedArtwork(previousItem, incomingItem as SpotifyTrack),
  );

export const attachPushedArtwork = (
  item: SpotifyTrack,
  artworkUrl: string,
): SpotifyTrack => ({
  ...item,
  album: {
    ...(item.album || {}),
    images: [{ url: artworkUrl }],
  },
});

type DealerArtistMetadata = {
  artists?: SpotifyTrack["artists"];
  artist_name?: string;
  album_artist_name?: string;
  artist?: string;
  artist_uri?: string;
};

export const getDealerArtists = (
  metadata: DealerArtistMetadata | null | undefined,
) => {
  const namedArtists = getNamedArtists(metadata?.artists);
  if (namedArtists.length > 0) {
    return namedArtists.map((artist) => ({
      id: artist.id || artist.uri?.split(":")[2],
      uri:
        artist.uri || (artist.id ? `spotify:artist:${artist.id}` : undefined),
      name: artist.name,
      type: artist.type || "artist",
    }));
  }

  const fallbackName =
    metadata?.artist_name ||
    metadata?.album_artist_name ||
    metadata?.artist ||
    "";
  return fallbackName
    ? [
        {
          id: metadata?.artist_uri?.split(":")[2],
          uri: metadata?.artist_uri,
          name: fallbackName,
          type: "artist",
        },
      ]
    : [];
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
      artworkDeviceOwners.delete(key);
    });
  }
};

const discardCachedArtwork = (trackUri: string) => {
  const artworkUrl = artworkCache.get(trackUri);
  artworkCache.delete(trackUri);
  artworkDeviceOwners.delete(trackUri);
  if (artworkUrl?.startsWith("blob:")) {
    setTimeout(() => URL.revokeObjectURL(artworkUrl), 100);
  }
};

export const getPendingSpotifyArtworkKeys = (
  cacheKeys: Iterable<string>,
): string[] =>
  Array.from(cacheKeys).filter((key) => key.startsWith("spotify:pending:"));

const discardAllPendingSpotifyArtwork = () => {
  const pendingKeys = getPendingSpotifyArtworkKeys(artworkCache.keys());
  pendingKeys.forEach(discardCachedArtwork);
  return pendingKeys;
};

export const replaceDiscardedPendingArtwork = (
  playback: SpotifyPlayback | null,
  album: SpotifyAlbum | null,
  discardedKeys: readonly string[],
): { playback: SpotifyPlayback | null; album: SpotifyAlbum | null } => {
  const itemUri = playback?.item?.uri;
  if (!itemUri || !discardedKeys.includes(itemUri) || !playback?.item) {
    return { playback, album };
  }

  return {
    playback: {
      ...playback,
      item: {
        ...playback.item,
        album: {
          ...playback.item.album,
          images: [{ url: "/images/not-playing.webp" }],
        },
      },
    },
    album: album
      ? {
          ...album,
          images: [{ url: "/images/not-playing.webp" }],
        }
      : album,
  };
};

const getRecentSpotifyPhoneMediaUpdate = () => {
  if (!latestSpotifyPhoneMediaUpdate) return null;
  if (
    Date.now() - latestSpotifyPhoneMediaUpdate.timestamp >
    PHONE_ARTWORK_CONTEXT_TTL_MS
  ) {
    latestSpotifyPhoneMediaUpdate = null;
    return null;
  }
  return latestSpotifyPhoneMediaUpdate;
};

const promotePendingSpotifyArtwork = (
  item: SpotifyTrack | null | undefined,
  device: ArtworkDevice | undefined,
): string | null => {
  if (!isCanonicalSpotifyItem(item)) return null;

  const mediaUpdate = getRecentSpotifyPhoneMediaUpdate();
  const pendingTitle = mediaUpdate?.media.MediaItemTitle;
  const itemTitle = item?.name;
  if (
    !pendingTitle ||
    !item?.uri ||
    !itemTitle ||
    itemTitle.trim().toLowerCase() !== pendingTitle.trim().toLowerCase()
  ) {
    return null;
  }

  const pendingArtworkUri = `spotify:pending:${pendingTitle}`;
  const pendingArtworkUrl = artworkCache.get(pendingArtworkUri);
  if (!pendingArtworkUrl) return null;
  const pendingOwnerDeviceId = artworkDeviceOwners.get(pendingArtworkUri);
  if (!canUsePhonePushedArtwork(item, device, pendingOwnerDeviceId)) {
    discardCachedArtwork(pendingArtworkUri);
    return null;
  }

  artworkCache.set(item.uri, pendingArtworkUrl);
  artworkDeviceOwners.set(item.uri, pendingOwnerDeviceId || device?.id || null);
  if (artworkCache.get(pendingArtworkUri) === pendingArtworkUrl) {
    artworkCache.delete(pendingArtworkUri);
    artworkDeviceOwners.delete(pendingArtworkUri);
  }
  currentArtworkTrackUri = item.uri;
  cleanupArtworkCache();
  return pendingArtworkUrl;
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

    data = reconcilePlaybackDevice(data, currentPlaybackRef.current);

    const incomingDeviceType = normalizeSpotifyDeviceType(data.device?.type);
    if (incomingDeviceType) {
      cachedActiveDeviceType = incomingDeviceType;
    }

    const reconciledItem = reconcilePlaybackItem(
      data.item as SpotifyTrack | null | undefined,
      currentPlaybackRef.current?.item as SpotifyTrack | null | undefined,
    );
    if (reconciledItem !== data.item) {
      data = { ...data, item: reconciledItem };
    }

    promotePendingSpotifyArtwork(
      data.item as SpotifyTrack | null | undefined,
      data.device,
    );

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
    const currentArtworkOwner = currentItem?.uri
      ? artworkDeviceOwners.get(currentItem.uri)
      : null;
    const preservedBlobArtwork =
      hasBlobArtwork &&
      canUsePhonePushedArtwork(
        data.item as SpotifyTrack | null | undefined,
        data.device,
        currentArtworkOwner,
      ) &&
      shouldPreservePushedArtwork(
        currentItem as SpotifyTrack | null | undefined,
        data.item as SpotifyTrack | null | undefined,
      )
        ? currentBlobUrl
        : null;

    setCurrentPlayback((prevPlayback) => {
      const trackUri = data.item?.uri;
      let cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;
      const cachedArtworkOwner = trackUri
        ? artworkDeviceOwners.get(trackUri)
        : null;
      if (
        trackUri &&
        cachedArtworkUrl &&
        !canUsePhonePushedArtwork(
          data.item as SpotifyTrack | null | undefined,
          data.device,
          cachedArtworkOwner,
        )
      ) {
        discardCachedArtwork(trackUri);
        cachedArtworkUrl = null;
      }

      const prevBlobArtwork = prevPlayback?.item?.album?.images?.[0]?.url;
      const hasPrevBlobArtwork = prevBlobArtwork?.startsWith("blob:");
      const prevTrackUri = prevPlayback?.item?.uri;
      const incomingTrackUri = data.item?.uri;
      const isPendingToLocalTransition = Boolean(
        isSpotifyLocalItem(data.item as SpotifyTrack | null | undefined) &&
        prevPlayback?.item?.is_spotify_pending,
      );
      const shouldPreservePrevBlob =
        hasPrevBlobArtwork &&
        canUsePhonePushedArtwork(
          data.item as SpotifyTrack | null | undefined,
          data.device,
          prevTrackUri ? artworkDeviceOwners.get(prevTrackUri) : null,
        ) &&
        shouldPreservePushedArtwork(
          prevPlayback?.item as SpotifyTrack | null | undefined,
          data.item as SpotifyTrack | null | undefined,
        );

      let itemWithArtwork = data.item;
      if (shouldPreservePrevBlob && data.item) {
        if (isPendingToLocalTransition && incomingTrackUri) {
          artworkCache.set(incomingTrackUri, prevBlobArtwork);
          artworkDeviceOwners.set(
            incomingTrackUri,
            (prevTrackUri && artworkDeviceOwners.get(prevTrackUri)) ||
              data.device?.id ||
              null,
          );
          if (
            prevTrackUri &&
            artworkCache.get(prevTrackUri) === prevBlobArtwork
          ) {
            artworkCache.delete(prevTrackUri);
            artworkDeviceOwners.delete(prevTrackUri);
          }
          currentArtworkTrackUri = incomingTrackUri;
          cleanupArtworkCache();
        }
        itemWithArtwork = {
          ...data.item,
          album: {
            ...data.item.album,
            images: [{ url: prevBlobArtwork }],
          },
        };
      } else if (cachedArtworkUrl && data.item) {
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
      if (
        trackUri &&
        cachedArtworkUrl &&
        !canUsePhonePushedArtwork(
          data.item as SpotifyTrack,
          data.device,
          artworkDeviceOwners.get(trackUri),
        )
      ) {
        discardCachedArtwork(trackUri);
        cachedArtworkUrl = null;
      }

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

  const clearPendingSpotifyArtworkContext = useCallback(() => {
    const discardedKeys = discardAllPendingSpotifyArtwork();
    if (discardedKeys.length === 0) return;
    const displayedPlayback = currentPlaybackRef.current;
    if (
      !displayedPlayback?.item?.uri ||
      !discardedKeys.includes(displayedPlayback.item.uri)
    ) {
      return;
    }

    setCurrentPlayback((prevPlayback) => {
      const nextPlayback = replaceDiscardedPendingArtwork(
        prevPlayback,
        null,
        discardedKeys,
      ).playback;
      currentPlaybackRef.current = nextPlayback;
      return nextPlayback;
    });
    setCurrentlyPlayingAlbum(
      (prevAlbum) =>
        replaceDiscardedPendingArtwork(
          displayedPlayback,
          prevAlbum,
          discardedKeys,
        ).album,
    );
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
            cachedActiveDeviceType = normalizeSpotifyDeviceType(
              cluster.devices[activeDeviceId].device_type,
            );
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

          const previousItem = currentPlaybackRef.current?.item;
          const prevBlobUrl = previousItem?.album?.images?.[0]?.url;
          const shouldPreserveBlobArtwork =
            playerState.track &&
            shouldPreserveDealerBlobArtwork(previousItem, {
              uri: playerState.track.uri,
              name: playerState.track.metadata?.title,
            });

          const isEpisode =
            playerState.track?.uri?.startsWith("spotify:episode:");
          const isLocalTrack =
            playerState.track?.uri?.startsWith("spotify:local:") ||
            isSpotifyLocalImageUrl(playerState.track?.metadata?.image_url);

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
                              url: normalizeImageUrl(
                                playerState.track.metadata.image_url,
                              ),
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
                                      url: normalizeImageUrl(
                                        playerState.track.metadata.image_url,
                                      ),
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
                        : getDealerArtists(playerState.track.metadata),
                    duration_ms: parseInt(playerState.duration) || 0,
                    is_local: isLocalTrack,
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

        const isSpotifyPlayback = isSpotifyPlaybackApp(
          playback.PlaybackAppName,
        );
        const isSpotifyPhoneMedia =
          isSpotifyPlayback && !getSpotifySkippedState();
        const hasCompleteMetadata = hasCompleteSpotifyMediaMetadata(media);
        const isEmpty = isEmptyPhoneMediaUpdate(media, playback);
        const incomingMediaGeneration = normalizeMediaGeneration(data.data);
        const previousMediaGeneration = mediaGenerationCorrelator.current();
        const mediaGenerationChanged =
          incomingMediaGeneration !== previousMediaGeneration;

        const rejectPhoneMediaContext = () => {
          clearPendingSpotifyArtworkContext();
          mediaGenerationCorrelator.recordMetadata(data.data);
          mediaGenerationCorrelator.rejectCurrentArtwork();
          latestSpotifyPhoneMediaUpdate = null;
          pendingSpotifyMediaUpdate = null;
          if (spotifyFallbackTimeout) {
            clearTimeout(spotifyFallbackTimeout);
            spotifyFallbackTimeout = null;
          }
        };

        if (
          shouldIgnoreSpotifyPhoneMediaUpdate(
            currentPlaybackRef.current,
            playback.PlaybackAppName,
          )
        ) {
          rejectPhoneMediaContext();
          return;
        }

        if (isEmpty) {
          rejectPhoneMediaContext();
          if (
            shouldClearDisplayedMediaForEmptyUpdate(
              currentPlaybackRef.current?.item,
              isEmpty,
            )
          ) {
            currentPlaybackRef.current = null;
            setCurrentPlayback(null);
            setCurrentlyPlayingAlbum(null);
          }
          return;
        }

        if (
          shouldIgnoreInactiveForeignMedia(
            currentPlaybackRef.current,
            playback.PlaybackAppName,
            playback.PlaybackStatus,
          )
        ) {
          mediaGenerationCorrelator.rejectCurrentArtwork();
          return;
        }

        markPlayerEvent();

        if (
          isSpotifyPlayback &&
          media.MediaItemArtist?.startsWith("Listening on ")
        ) {
          rejectPhoneMediaContext();
          return;
        }

        if (mediaGenerationChanged) {
          clearPendingSpotifyArtworkContext();
        }
        mediaGenerationCorrelator.recordMetadata(data.data);
        beginNowPlayingUpdateWindow();
        isProcessingArtwork = false;

        if (isSpotifyPlayback && !hasCompleteMetadata) {
          if (mediaGenerationChanged) {
            mediaGenerationCorrelator.rejectCurrentArtwork();
            latestSpotifyPhoneMediaUpdate = null;
            pendingSpotifyMediaUpdate = null;
            if (spotifyFallbackTimeout) {
              clearTimeout(spotifyFallbackTimeout);
              spotifyFallbackTimeout = null;
            }
          }
          return;
        }

        const spotifyPhoneMediaUpdate = isSpotifyPhoneMedia
          ? {
              media,
              playback,
              timestamp: Date.now(),
            }
          : null;
        latestSpotifyPhoneMediaUpdate = spotifyPhoneMediaUpdate;

        if (isSpotifyPhoneMedia) {
          const currentItem = currentPlaybackRef.current?.item;
          const incomingTitle = media.MediaItemTitle?.trim();
          const isSameLocalTrack = Boolean(
            isSpotifyLocalItem(
              currentItem as SpotifyTrack | null | undefined,
            ) &&
            incomingTitle &&
            currentItem?.name?.trim().toLowerCase() ===
              incomingTitle.toLowerCase(),
          );

          if (isSameLocalTrack) {
            pendingSpotifyMediaUpdate = null;
            if (spotifyFallbackTimeout) {
              clearTimeout(spotifyFallbackTimeout);
              spotifyFallbackTimeout = null;
            }

            setCurrentPlayback((prevPlayback) => {
              if (!prevPlayback?.item) return prevPlayback;
              const artistName = media.MediaItemArtist?.trim();
              const hasNamedArtist =
                getNamedArtists(prevPlayback.item.artists).length > 0;
              const durationMs =
                media.MediaItemDuration ||
                media.MediaItemPlaybackDurationInMilliseconds;
              const updatedPlayback = {
                ...prevPlayback,
                is_playing: playback.PlaybackStatus === "playing",
                timestamp: Date.now(),
                item: {
                  ...prevPlayback.item,
                  ...(artistName && !hasNamedArtist
                    ? {
                        artists: [
                          {
                            ...prevPlayback.item.artists?.[0],
                            name: artistName,
                          },
                        ],
                      }
                    : {}),
                  ...(durationMs && durationMs > 0
                    ? { duration_ms: durationMs }
                    : {}),
                  is_local: true,
                },
              };
              currentPlaybackRef.current = updatedPlayback;
              return updatedPlayback;
            });
            return;
          }

          pendingSpotifyMediaUpdate = spotifyPhoneMediaUpdate;

          if (spotifyFallbackTimeout) {
            clearTimeout(spotifyFallbackTimeout);
          }

          const commitSpotifyPendingPlaceholder = () => {
            const currentItem = currentPlaybackRef.current?.item;
            const hasRealSpotifyData = isResolvedSpotifyItem(
              currentItem as SpotifyTrack | null | undefined,
            );

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

          const hasRealSpotifyData = isResolvedSpotifyItem(
            currentItem as SpotifyTrack | null | undefined,
          );

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
                clearPendingSpotifyArtworkContext();
                mediaGenerationCorrelator.rejectCurrentArtwork();
                pendingSpotifyMediaUpdate = null;
                if (spotifyFallbackTimeout) {
                  clearTimeout(spotifyFallbackTimeout);
                  spotifyFallbackTimeout = null;
                }
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

        const hasTitle = hasNonEmptyText(media.MediaItemTitle);
        const hasArtist = hasNonEmptyText(media.MediaItemArtist);

        if (!hasTitle && !hasArtist) {
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
        const phoneMediaAlbumName =
          media.MediaItemAlbumName || media.MediaItemAlbum || null;
        const albumName = isNotPlaying
          ? "Not Playing"
          : phoneMediaAlbumName || title;
        const timing = normalizePhoneMediaTiming(
          media,
          playback,
          data.server_timestamp_ms,
        );

        const newTrackUri = `local:media:${title}`;
        const newTrackId = getPhoneMediaTrackId(
          playback.PlaybackAppName,
          title,
          artist,
          albumName,
        );
        const cachedArtworkForTrack = artworkCache.get(newTrackUri);

        const transformedState = {
          is_playing: playback.PlaybackStatus === "playing",
          timestamp: timing.timestamp,
          progress_ms: timing.progressMs,

          context: null,

          item: {
            id: `local-media-${newTrackId}`,
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
            duration_ms: timing.durationMs,
            is_phone_media: true,
            phone_media_album_name: phoneMediaAlbumName,
          },

          shuffle_state: shuffleState,
          repeat_state: repeatState,

          device: null,

          currently_playing_type: "track",

          playback_speed: timing.playbackRate,

          currently_active_application: playback.PlaybackAppName || null,
        };

        processPlaybackState(transformedState);
      } else if (
        data.type === "event" &&
        (data.topic === "media.now_playing.artwork" ||
          data.topic === "media.nowPlaying.artwork")
      ) {
        if (
          !acceptsPhoneMediaArtworkEvent(
            mediaGenerationCorrelator,
            data.data,
            false,
          )
        ) {
          return;
        }

        beginNowPlayingUpdateWindow();

        const artworkData = data.data?.data;

        if (artworkData && artworkData.trim() !== "") {
          const currentItem = currentPlaybackRef.current?.item;
          const artworkOwnerDeviceId =
            currentPlaybackRef.current?.device?.id || null;
          const hasRealSpotifyData = isCanonicalSpotifyItem(currentItem);
          const pendingArtworkUpdate = getRecentSpotifyPhoneMediaUpdate();
          const pendingArtworkTitle = pendingArtworkUpdate
            ? pendingArtworkUpdate.media.MediaItemTitle || "Unknown Title"
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

            const contentType =
              data.data?.content_type ?? data.data?.contentType;
            const blob = new Blob([bytes], {
              type:
                typeof contentType === "string" &&
                contentType.startsWith("image/")
                  ? contentType
                  : "image/jpeg",
            });
            const nextArtworkBlobUrl = URL.createObjectURL(blob);

            if (
              hasRealSpotifyData &&
              pendingArtworkUpdate &&
              !pendingArtworkIsTrackChange &&
              artworkTargetUri !== currentItem?.uri
            ) {
              const previousPendingArtwork = artworkCache.get(artworkTargetUri);
              if (
                previousPendingArtwork?.startsWith("blob:") &&
                previousPendingArtwork !== nextArtworkBlobUrl
              ) {
                URL.revokeObjectURL(previousPendingArtwork);
              }
              artworkCache.set(artworkTargetUri, nextArtworkBlobUrl);
              artworkDeviceOwners.set(artworkTargetUri, artworkOwnerDeviceId);
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
              artworkDeviceOwners.set(newTrackUri, artworkOwnerDeviceId);

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
              artworkDeviceOwners.set(trackUri, artworkOwnerDeviceId);
              currentArtworkTrackUri = trackUri;
              cleanupArtworkCache();

              setCurrentPlayback((prevPlayback) => {
                if (prevPlayback?.item?.uri === trackUri) {
                  const updatedPlayback = {
                    ...prevPlayback,
                    item: attachPushedArtwork(
                      prevPlayback.item,
                      phoneMediaArtworkBlobUrl,
                    ),
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
        if (
          !acceptsPhoneMediaArtworkEvent(
            mediaGenerationCorrelator,
            data.data,
            true,
          )
        ) {
          return;
        }

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

              processPlaybackState(
                reconcilePolledPlaybackTiming(
                  playerData,
                  currentPlaybackRef.current,
                ),
              );
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
    clearPendingSpotifyArtworkContext,
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
          processPlaybackState(
            reconcilePolledPlaybackTiming(data, currentPlaybackRef.current),
          );
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
