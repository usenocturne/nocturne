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
export function useSpotifyPlayerState(immediateLoad = false) {
  const { wsConnected, getPlayerState } = useSpotifyWebSocket();
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialFetchInProgress, setInitialFetchInProgress] = useState(false);

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
        (data?.item && data.item.show && !data.item.album && !data.item.artists);
      const hasIncompleteEpisodeData =
        data.currently_playing_type === "episode" && !data.item;

      if (isEpisode && !isPodcastPlaying) {
        isPodcastPlaying = true;
        setTimeout(() => {
          if (podcastPollingInterval || !isPodcastPlaying) return;

          podcastPollingInterval = setInterval(async () => {
            if (isPodcastPlaying && wsConnected) {
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
        const newPlayback = {
          ...data,
          device: {
            ...data.device,
            volume_percent: data.device?.volume_percent,
          },
          shuffle_state: data.shuffle_state,
          repeat_state: data.repeat_state,
          
          item: data.item && isEpisode && !data.item.type ? {
            ...data.item,
            type: "episode"
          } : data.item,
        };
        currentPlaybackRef.current = newPlayback;
        return newPlayback;
      });

      if (data?.item && data.item.type === "track") {
        const currentAlbum = data.item.is_local
          ? {
              id: `local-${data.item.uri}`,
              name: data.item.album?.name || data.item.name,
              images: [{ url: "/images/not-playing.webp" }],
              artists: data.item.artists,
              type: "local-track",
              uri: data.item.uri,
            }
          : {
              ...data.item.album,
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
        
        const showAsAlbum = {
          ...currentShow,
          artists: currentShow.publisher ? [{
            id: `publisher-${currentShow.id}`,
            name: currentShow.publisher,
            type: "show"
          }] : [],
          type: "show"
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
      if (!wsConnected) {
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
    [
      wsConnected,
      getPlayerState,
      processPlaybackState,
      resetPlaybackState,
    ],
  );




  useEffect(() => {
    if (wsConnected && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [wsConnected, fetchCurrentPlayback]);


  useEffect(() => {
    if (wsConnected && immediateLoad && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [wsConnected, immediateLoad, fetchCurrentPlayback]);


  useEffect(() => {
    if (!wsConnected) return;

    const handlePlayerStateChanged = (data) => {
      if (
        data.type === "event" &&
        data.topic === "spotify.player.device_state_changed"
      ) {
        const payloads = data.data?.payloads || [];
        if (payloads.length > 0 && payloads[0]?.cluster?.player_state) {
          const playerState = payloads[0].cluster.player_state;
          
          const isEpisode = playerState.track?.uri?.startsWith('spotify:episode:');
          
          const transformedState = {
            is_playing: playerState.is_paused === 0,
            timestamp: Date.now(),
            progress_ms: parseInt(playerState.position_as_of_timestamp) || 0,
            
            context: playerState.context_uri ? {
              uri: playerState.context_uri,
              type: playerState.context_uri.split(':')[1],
              href: null
            } : null,
            
            item: playerState.track ? (isEpisode ? {
             
              id: playerState.track.uri.split(':')[2],
              uri: playerState.track.uri,
              type: "episode",
              name: playerState.track.metadata.title,
              show: {
                id: playerState.context_uri?.split(':')[2],
                uri: playerState.context_uri,
                name: playerState.track.metadata.album_title || "Unknown Show",
                publisher: playerState.track.metadata.author_name || "Unknown Publisher",
                images: playerState.track.metadata.image_url ? [
                  { url: playerState.track.metadata.image_url.startsWith('http') ? 
                    playerState.track.metadata.image_url : 
                    `https://${playerState.track.metadata.image_url}` }
                ] : []
              },
              duration_ms: parseInt(playerState.duration) || 0,
              is_local: false
            } : {
              
              id: playerState.track.uri.split(':')[2],
              uri: playerState.track.uri,
              type: "track",
              name: playerState.track.metadata.title,
              album: {
                id: playerState.track.metadata.album_uri?.split(':')[2],
                uri: playerState.track.metadata.album_uri,
                name: playerState.track.metadata.album_title,
                images: playerState.track.metadata.is_narration === "true" || 
                        playerState.track.metadata.album_artist_name === "DJ X" ? [
                  { url: "/images/radio-cover/dj.webp" }
                ] : playerState.track.metadata.image_url ? [
                  { url: playerState.track.metadata.image_url.startsWith('http') ? 
                    playerState.track.metadata.image_url : 
                    `https://${playerState.track.metadata.image_url}` }
                ] : []
              },
              artists: playerState.track.metadata.is_narration === "true" || 
                      playerState.track.metadata.album_artist_name === "DJ X" ? [{
                id: "dj-x",
                uri: "spotify:artist:dj-x",
                name: "DJ X",
                type: "artist"
              }] : playerState.track.metadata.artists ? 
                playerState.track.metadata.artists.map(artist => ({
                  id: artist.id || artist.uri?.split(':')[2],
                  uri: artist.uri || `spotify:artist:${artist.id}`,
                  name: artist.name,
                  type: artist.type || 'artist'
                })) : [],
              duration_ms: parseInt(playerState.duration) || 0,
              is_local: false
            }) : null,
            
            
            shuffle_state: playerState.options?.shuffling_context === 1,
            repeat_state: playerState.options?.repeating_track === 1 ? "track" : 
                         playerState.options?.repeating_context === 1 ? "context" : "off",
            
            
            device: payloads[0]?.cluster?.devices && payloads[0]?.cluster?.active_device_id ? 
              (() => {
                const activeDeviceId = payloads[0].cluster.active_device_id;
                const device = payloads[0].cluster.devices[activeDeviceId];
                return device ? {
                  id: device.device_id,
                  is_active: true,
                  name: device.name,
                  type: device.device_type,
                  volume_percent: Math.round((device.volume / 65535) * 100)
                } : null;
              })() : null,
            
            
            currently_playing_type: isEpisode ? "episode" : "track",
            
            
            playback_speed: playerState.options?.playback_speed || 1
          };
          
          processPlaybackState(transformedState);
        }
      }
    };

    const cleanup = addGlobalWsListener(`player-state-${Date.now()}`, {
      onMessage: handlePlayerStateChanged,
    });

    return cleanup;
  }, [wsConnected, processPlaybackState]);

  const refreshPlaybackState = useCallback(
    async (forceRefresh = false) => {
      if (!wsConnected) return;

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
    [wsConnected, getPlayerState, resetPlaybackState, processPlaybackState],
  );

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState,
  };
}
