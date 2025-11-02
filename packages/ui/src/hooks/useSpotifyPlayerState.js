import { useState, useEffect, useRef, useCallback } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useNocturned, addGlobalWsListener } from "./useNocturned";

let lastFetchTimestamp = 0;
let pendingFetch = null;
let podcastPollingInterval = null;
let isPodcastPlaying = false;
let lastPodcastFetch = 0;
let podcastFetchDebounceTimeout = null;
let initialPlaybackFetchDone = false;
let phoneMediaArtworkBlobUrl = null;
let lastSpotifyDeviceStateChange = 0;
let phoneVolumeListeners = [];
let nowPlayingUpdateTimeout = null;
let isReceivingNowPlayingUpdatesGlobal = false;
let isProcessingArtwork = false;
let artworkCache = new Map();
const MAX_ARTWORK_CACHE_SIZE = 10;

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
        (data?.item &&
          data.item.show &&
          !data.item.album &&
          !data.item.artists);
      const hasIncompleteEpisodeData =
        data.currently_playing_type === "episode" && !data.item;

      if (isEpisode && !isPodcastPlaying) {
        isPodcastPlaying = true;
        setTimeout(() => {
          if (podcastPollingInterval || !isPodcastPlaying) return;

          podcastPollingInterval = setInterval(async () => {
            if (isPodcastPlaying && isSpotifyReady) {
              try {
                const now = Date.now();
                if (now - lastPodcastFetch < 25000) return;

                lastPodcastFetch = now;
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
        const trackUri = data.item?.uri;
        const cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

        let itemWithArtwork = data.item;
        if (cachedArtworkUrl && data.item?.album?.images) {
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
        const cachedArtworkUrl = trackUri ? artworkCache.get(trackUri) : null;

        const currentAlbum = data.item.is_local || data.item.is_phone_media
          ? {
              id: `local-${data.item.uri}`,
              name: data.item.album?.name || data.item.name,
              images: cachedArtworkUrl
                ? [{ url: cachedArtworkUrl }]
                : data.item.album?.images || [
                    { url: "/images/not-playing.webp" },
                  ],
              artists: data.item.artists,
              type: "local-track",
              uri: data.item.uri,
            }
          : {
              ...data.item.album,
              images: cachedArtworkUrl
                ? [{ url: cachedArtworkUrl }]
                : data.item.album?.images,
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
            : currentShow?.images,
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

          const isEpisode =
            playerState.track?.uri?.startsWith("spotify:episode:");

          const transformedState = {
            is_playing:
              playerState.is_paused === false || playerState.is_paused === 0,
            timestamp: Date.now(),
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
                        playerState.track.metadata.author_name ||
                        "Unknown Publisher",
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
                    name: playerState.track.metadata.title,
                    album: {
                      id: playerState.track.metadata.album_uri?.split(":")[2],
                      uri: playerState.track.metadata.album_uri,
                      name: playerState.track.metadata.album_title,
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
                        : playerState.track.metadata.is_narration === "true" ||
                            playerState.track.metadata.album_artist_name ===
                              "DJ X"
                          ? [{ url: "/images/radio-cover/dj.webp" }]
                          : [],
                    },
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
    const handlePhoneMediaEvent = (data) => {
      if (data.type === "event" && data.topic === "media.nowPlaying.update") {
        setIsReceivingNowPlayingUpdates(true);
        isReceivingNowPlayingUpdatesGlobal = true;
        isProcessingArtwork = false;

        if (nowPlayingUpdateTimeout) {
          clearTimeout(nowPlayingUpdateTimeout);
        }

        nowPlayingUpdateTimeout = setTimeout(() => {
          setIsReceivingNowPlayingUpdates(false);
          isReceivingNowPlayingUpdatesGlobal = false;
        }, 5000);

        const timeSinceSpotifyStateChange =
          Date.now() - lastSpotifyDeviceStateChange;
        if (timeSinceSpotifyStateChange < 5000) {
          return;
        }

        const media = data.data?.MediaItemAttributes;
        const playback = data.data?.PlaybackAttributes;

        if (!media || !playback) return;

        if (playback.PlaybackAppName === "Spotify") {
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

        const shuffleState =
          playback.PlaybackShuffleMode === "albums" ||
          playback.PlaybackShuffleMode === "songs";

        const repeatState =
          playback.PlaybackRepeatMode === "one"
            ? "track"
            : playback.PlaybackRepeatMode === "all"
              ? "context"
              : "off";

        const hasTitle =
          media.MediaItemTitle && media.MediaItemTitle.trim() !== "";
        const hasArtist =
          media.MediaItemArtist && media.MediaItemArtist.trim() !== "";
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
        const elapsedMs = playback.PlaybackElapsedTimeInMilliseconds || 0;

        const transformedState = {
          is_playing: playback.PlaybackStatus === "playing",
          timestamp: Date.now(),
          progress_ms: elapsedMs,

          context: null,

          item: {
            id: `local-media-${title}`,
            uri: `local:media:${title}`,
            type: "track",
            name: title,
            album: {
              id: `local-album-${albumName}`,
              uri: `local:album:${albumName}`,
              name: albumName,
              images:
                isNotPlaying || !phoneMediaArtworkBlobUrl
                  ? [{ url: "/images/not-playing.webp" }]
                  : [{ url: phoneMediaArtworkBlobUrl }],
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
        if (!isReceivingNowPlayingUpdatesGlobal) {
          return;
        }

        const artworkData = data.data?.data;

        if (artworkData && artworkData.trim() !== "") {
          const trackUri = currentPlaybackRef.current?.item?.uri;
          const cachedUrl = trackUri ? artworkCache.get(trackUri) : null;
          const currentImageUrl =
            currentPlaybackRef.current?.item?.album?.images?.[0]?.url;

          if (
            currentImageUrl &&
            currentImageUrl === cachedUrl &&
            currentImageUrl.startsWith("blob:")
          ) {
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
            const oldBlobUrl = phoneMediaArtworkBlobUrl;
            phoneMediaArtworkBlobUrl = URL.createObjectURL(blob);

            const trackUri = currentPlaybackRef.current?.item?.uri;
            if (trackUri) {
              if (artworkCache.has(trackUri)) {
                const oldCachedUrl = artworkCache.get(trackUri);
                if (oldCachedUrl && oldCachedUrl !== phoneMediaArtworkBlobUrl) {
                  URL.revokeObjectURL(oldCachedUrl);
                }
              }
              artworkCache.set(trackUri, phoneMediaArtworkBlobUrl);
              cleanupArtworkCache();
            }

            setCurrentPlayback((prevPlayback) => {
              if (
                prevPlayback?.item?.is_phone_media &&
                prevPlayback.item.album?.images
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
              if (prevAlbum?.images) {
                return {
                  ...prevAlbum,
                  images: [{ url: phoneMediaArtworkBlobUrl }],
                };
              }
              return prevAlbum;
            });

            if (oldBlobUrl && oldBlobUrl !== localMediaArtworkBlobUrl) {
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
  }, [processPlaybackState]);

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
