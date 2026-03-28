import { useState, useEffect, useRef, useCallback } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useNocturned, addGlobalWsListener } from "./useNocturned";

let lastFetchTimestamp = 0;
let pendingFetch = null;
let initialPlaybackFetchDone = false;
let phoneMediaArtworkBlobUrl = null;
let currentArtworkTrackUri = null;
let lastSpotifyDeviceStateChange = 0;
let phoneVolumeListeners = [];
let nowPlayingUpdateTimeout = null;
let isReceivingNowPlayingUpdatesGlobal = false;
let isProcessingArtwork = false;
let artworkCache = new Map();
const MAX_ARTWORK_CACHE_SIZE = 10;
let lastEaSessionStartTime = 0;
let pendingSpotifyMediaUpdate = null;
let spotifyFallbackTimeout = null;
let cachedActiveDeviceType = null;
let progressResetSignal = null;
let nowPlayingTrackLatch = null;
const NOWPLAYING_PRECEDENCE_WINDOW_MS = 300000;

export const getActiveDeviceType = () => cachedActiveDeviceType;

export const consumeProgressResetSignal = () => {
  const signal = progressResetSignal;
  progressResetSignal = null;
  return signal;
};

const normalizeImageUrl = (url) => {
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

const normalizeImageArray = (images) => {
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

export const subscribeToPhoneVolume = (listener) => {
  phoneVolumeListeners.push(listener);
  return () => {
    phoneVolumeListeners = phoneVolumeListeners.filter((l) => l !== listener);
  };
};

const notifyPhoneVolumeListeners = (volumePercent) => {
  phoneVolumeListeners.forEach((listener) => {
    try {
      listener(volumePercent);
    } catch (err) {
      console.error("Phone volume listener error:", err);
    }
  });
};

export function useSpotifyPlayerState(immediateLoad = false) {
  const { isSpotifyReady, getPlayerState } = useSpotifyWebSocket();
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialFetchInProgress, setInitialFetchInProgress] = useState(false);
  const [isReceivingNowPlayingUpdates, setIsReceivingNowPlayingUpdates] =
    useState(false);

  const initialStateLoadedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const currentPlaybackRef = useRef(null);

  const processPlaybackState = useCallback((data) => {
    if (!data) return;

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

    if (data?.item && data.item.type === "track") {
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
    } else if (data?.item && data.item.type === "episode") {
      const currentShow = data.item.show;
      const trackUri = data.item.uri;
      const cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

      const showAsAlbum = {
        ...currentShow,
        images: cachedArtworkUrl
          ? [{ url: cachedArtworkUrl }]
          : normalizeImageArray(currentShow?.images),
        artists: currentShow.publisher
          ? [
              {
                id: `publisher-${currentShow.id}`,
                name: currentShow.publisher,
                type: "show",
              },
            ]
          : [],
        type: "show",
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
  }, []);

  const resetPlaybackState = useCallback(
    (force = false) => {
      if (force || !initialFetchInProgress) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
      }
      initialStateLoadedRef.current = true;
    },
    [initialFetchInProgress],
  );

  const fetchCurrentPlayback = useCallback(
    async (forceRefresh = false) => {
      if (!isSpotifyReady) {
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
          return;
        }

        if (err.message.includes("204") || err.message.includes("No content")) {
          resetPlaybackState();
          return;
        }

        if (err.name === "NetworkError") {
          resetPlaybackState();
        }
      } finally {
        pendingFetch = false;
        setIsLoading(false);
        setInitialFetchInProgress(false);
      }
    },
    [isSpotifyReady, getPlayerState, processPlaybackState, resetPlaybackState],
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

  useEffect(() => {
    if (isSpotifyReady && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [isSpotifyReady, fetchCurrentPlayback]);

  useEffect(() => {
    if (isSpotifyReady && immediateLoad && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [isSpotifyReady, immediateLoad, fetchCurrentPlayback]);

  useEffect(() => {
    if (!isSpotifyReady) return;

    const handlePlayerStateChanged = (data) => {
      if (
        data.type === "event" &&
        data.topic === "spotify.player.device_state_changed"
      ) {
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
            const latchAge =
              Date.now() - nowPlayingTrackLatch.timestamp;
            if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
              const incomingDeviceTitle = playerState.track?.metadata?.title
                ?.toLowerCase()
                ?.trim();
              if (
                incomingDeviceTitle &&
                incomingDeviceTitle !== nowPlayingTrackLatch.title
              ) {
                nowPlayingTrackLatch.timestamp = Date.now();
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
  }, [isSpotifyReady, processPlaybackState]);

  useEffect(() => {
    const handleEaSessionStart = (data) => {
      if (data.type === "event" && data.topic === "ea.session.started") {
        lastEaSessionStartTime = Date.now();
      }
    };

    const cleanup = addGlobalWsListener(`ea-session-tracker-${Date.now()}`, {
      onMessage: handleEaSessionStart,
    });

    return cleanup;
  }, []);

  useEffect(() => {
    const handlePhoneMediaEvent = (data) => {
      if (data.type === "event" && data.topic === "media.nowPlaying.update") {
        const media = data.data?.MediaItemAttributes;
        const playback = data.data?.PlaybackAttributes;

        if (!media || !playback) return;

        if (
          playback.PlaybackAppName === "Spotify" &&
          media.MediaItemArtist?.startsWith("Listening on ")
        ) {
          return;
        }

        beginNowPlayingUpdateWindow();
        isProcessingArtwork = false;

        if (playback.PlaybackAppName === "Spotify") {
          pendingSpotifyMediaUpdate = {
            media,
            playback,
            timestamp: Date.now(),
          };

          if (spotifyFallbackTimeout) {
            clearTimeout(spotifyFallbackTimeout);
          }

          spotifyFallbackTimeout = setTimeout(() => {
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
                pendingMedia.MediaItemPlaybackDurationInMilliSeconds || 0;

              const newTrackUri = `spotify:pending:${title}`;
              const cachedArtwork =
                artworkCache.get(newTrackUri) || phoneMediaArtworkBlobUrl;

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
            spotifyFallbackTimeout = null;
          }, 10000);

          const currentItem = currentPlaybackRef.current?.item;
          const hasRealSpotifyData =
            currentItem?.uri?.startsWith("spotify:") &&
            !currentItem?.is_spotify_pending;

          if (hasRealSpotifyData) {
            const incomingTitle = media.MediaItemTitle;
            const currentTitle = currentItem?.name;
            const isTitleChange =
              incomingTitle &&
              currentTitle &&
              incomingTitle.toLowerCase().trim() !==
                currentTitle.toLowerCase().trim();

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
                item: {
                  ...prevPlayback.item,
                  ...(isTitleChange
                    ? { id: `spotify-transitional-${Date.now()}` }
                    : {}),
                  name: title,
                  artists: artist
                    ? [{ ...prevPlayback.item.artists?.[0], name: artist }]
                    : prevPlayback.item.artists,
                  ...(iap2Duration && iap2Duration > 0
                    ? { duration_ms: iap2Duration }
                    : {}),
                },
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
          if (
            currentPlaybackRef.current?.item &&
            !currentPlaybackRef.current?.item?.is_phone_media
          ) {
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
          const timeSinceConnection = Date.now() - lastEaSessionStartTime;
          if (timeSinceConnection < 10000) {
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
        const albumName = isNotPlaying
          ? "Not Playing"
          : media.MediaItemAlbumName || title;
        const durationMs = media.MediaItemPlaybackDurationInMilliSeconds || 0;

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
        };

        processPlaybackState(transformedState);
      } else if (
        data.type === "event" &&
        data.topic === "media.nowPlaying.artwork"
      ) {
        beginNowPlayingUpdateWindow();

        const artworkData = data.data?.data;

        if (artworkData && artworkData.trim() !== "") {
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
            const oldBlobUrl = phoneMediaArtworkBlobUrl;
            phoneMediaArtworkBlobUrl = URL.createObjectURL(blob);

            const currentItem = currentPlaybackRef.current?.item;
            const currentIsPending = currentItem?.is_spotify_pending;
            const hasRealSpotifyData =
              currentItem?.uri?.startsWith("spotify:") && !currentIsPending;
            if (pendingSpotifyMediaUpdate && !hasRealSpotifyData) {
              const { media, playback } = pendingSpotifyMediaUpdate;
              const title = media.MediaItemTitle || "Unknown Title";
              const artist = media.MediaItemArtist || "Unknown Artist";
              const albumName = media.MediaItemAlbumName || title;
              const durationMs =
                media.MediaItemPlaybackDurationInMilliSeconds || 0;

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

            const trackUri = currentPlaybackRef.current?.item?.uri;

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
        data.topic === "media.nowPlaying.artwork.failed"
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
                const latchAge =
                  Date.now() - nowPlayingTrackLatch.timestamp;
                if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
                  const fetchedTitle = playerData.item?.name
                    ?.toLowerCase()
                    ?.trim();
                  if (
                    fetchedTitle &&
                    fetchedTitle !== nowPlayingTrackLatch.title
                  ) {
                    nowPlayingTrackLatch.timestamp = Date.now();
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
        const volumePercent = data.data?.volumePercent;
        if (volumePercent !== undefined) {
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
  }, [processPlaybackState, beginNowPlayingUpdateWindow, getPlayerState]);

  const refreshPlaybackState = useCallback(
    async (forceRefresh = false) => {
      if (!isSpotifyReady) return;

      if (currentPlaybackRef.current?.item?.is_phone_media) {
        return;
      }

      try {
        const data = await getPlayerState();

        if (!data || Object.keys(data).length === 0) {
          resetPlaybackState();
        } else {
          if (nowPlayingTrackLatch) {
            const latchAge =
              Date.now() - nowPlayingTrackLatch.timestamp;
            if (latchAge < NOWPLAYING_PRECEDENCE_WINDOW_MS) {
              const fetchedTitle = data.item?.name
                ?.toLowerCase()
                ?.trim();
              if (
                fetchedTitle &&
                fetchedTitle !== nowPlayingTrackLatch.title
              ) {
                nowPlayingTrackLatch.timestamp = Date.now();
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
          processPlaybackState(data);
        }
      } catch (err) {
        console.error("Error refreshing playback state:", err);
        setError(err.message);
      }
    },
    [isSpotifyReady, getPlayerState, resetPlaybackState, processPlaybackState],
  );

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
  };
}
