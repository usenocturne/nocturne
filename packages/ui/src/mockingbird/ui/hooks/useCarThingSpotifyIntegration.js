import { useEffect, useRef, useCallback } from "react";
import { runInAction } from "mobx";
import {
  sendNocturneWsRequest,
  addGlobalWsListener,
} from "../../../hooks/useNocturned";
import {
  subscribeToPhoneVolume,
  getActiveDeviceType,
} from "../../../hooks/useSpotifyPlayerState";
import { getNpvImageUrl } from "../helpers/ImageSizeHelper";
import { injectArtwork, retryImage } from "../utils/imageProxy";

const getArtistNames = (artistName, artists) => {
  if (artists && artists?.length > 0) {
    return artists
      .filter((artist) => !!artist?.name)
      .map((artist) => artist.name)
      .join(", ");
  }
  return artistName;
};

const getPlaylistName = async (context) => {
  if (!context?.uri) return null;

  try {
    const contextUri = context.uri;

    if (contextUri.includes("spotify:playlist:")) {
      const playlistId = contextUri.replace("spotify:playlist:", "");
      const result = await sendNocturneWsRequest("spotify.playlist.get", {
        id: playlistId,
        fields: "name",
      });
      return result?.name || null;
    } else if (contextUri.includes("spotify:album:")) {
      const albumId = contextUri.replace("spotify:album:", "");
      const result = await sendNocturneWsRequest("spotify.album.get", {
        id: albumId,
      });
      return result?.name || null;
    } else if (contextUri.includes("spotify:artist:")) {
      const artistId = contextUri.replace("spotify:artist:", "");
      const result = await sendNocturneWsRequest("spotify.artist.get", {
        id: artistId,
      });
      return result?.name || null;
    } else if (contextUri.includes("spotify:show:")) {
      const showId = contextUri.replace("spotify:show:", "");
      const result = await sendNocturneWsRequest("spotify.show.get", {
        content_id: showId,
      });
      return result?.name || null;
    }
  } catch (error) {
    console.error("Error fetching context name:", error);
  }

  return null;
};

export function useCarThingSpotifyIntegration(
  carThingStores,
  currentPlayback,
  playerControls,
) {
  const playTrack = playerControls?.playTrack;
  const pausePlayback = playerControls?.pausePlayback;
  const skipToNext = playerControls?.skipToNext;
  const skipToPrevious = playerControls?.skipToPrevious;
  const toggleShuffle = playerControls?.toggleShuffle;
  const likeTrack = playerControls?.likeTrack;
  const unlikeTrack = playerControls?.unlikeTrack;
  const checkIsTrackLiked = playerControls?.checkIsTrackLiked;
  const seekToPosition = playerControls?.seekToPosition;
  const setRepeatMode = playerControls?.setRepeatMode;
  const setVolume = playerControls?.setVolume;
  const volume = playerControls?.volume ?? 50;
  const phoneMediaPlay = playerControls?.phoneMediaPlay;
  const phoneMediaPause = playerControls?.phoneMediaPause;
  const phoneMediaNext = playerControls?.phoneMediaNext;
  const phoneMediaPrevious = playerControls?.phoneMediaPrevious;
  const phoneMediaVolumeUp = playerControls?.phoneMediaVolumeUp;
  const phoneMediaVolumeDown = playerControls?.phoneMediaVolumeDown;

  const getQueue = useCallback(async () => {
    try {
      const result = await sendNocturneWsRequest(
        "spotify.player.queue",
        {},
        { timeoutMs: 5000 },
      );
      return result;
    } catch (error) {
      return null;
    }
  }, []);

  const lastCheckedTrackId = useRef(null);
  const likeCheckTimeoutRef = useRef(null);
  const lastTrackId = useRef(null);
  const lastSeekPositionRef = useRef(null);
  const lastSeekTimeRef = useRef(0);
  const currentImageUrlsRef = useRef([]);
  const volumeRef = useRef(50);
  const volumeDebounceRef = useRef(null);

  useEffect(() => {
    if (!carThingStores || !currentPlayback) return;

    const { npvStore } = carThingStores;
    const currentTrackId = currentPlayback.item?.id;
    const isPlaying = currentPlayback.is_playing;
    const isShuffled = currentPlayback.shuffle_state;

    const trackChanged =
      currentTrackId && lastTrackId.current !== currentTrackId;

    runInAction(() => {
      if (currentPlayback.item) {
        if (trackChanged) {
          npvStore.playingInfoUiState.swipeHandler.setSwipeDirection("LEFT");
        }
        lastTrackId.current = currentTrackId;

        npvStore.playingInfoUiState.title =
          currentPlayback.item.name || "Unknown Track";

        if (currentPlayback.item.type === "episode") {
          npvStore.playingInfoUiState.subtitle =
            currentPlayback.item.show?.name || "Unknown Podcast";
        } else {
          npvStore.playingInfoUiState.subtitle = getArtistNames(
            "Unknown Artist",
            currentPlayback.item.artists,
          );
        }
        const getContextTitle = async () => {
          const contextType = currentPlayback.context?.type;
          const contextUri = currentPlayback.context?.uri || "";

          if (
            !currentPlayback.context &&
            currentPlayback.actions?.disallows?.toggling_shuffle
          ) {
            return "Queue";
          }

          if (!currentPlayback.context) {
            if (currentPlayback.item.type === "episode") {
              return currentPlayback.item.show?.name || "";
            }
            return currentPlayback.item.album?.name || "";
          }

          if (contextType === "show" || contextType === "episode") {
            return (
              currentPlayback.item.show?.name ||
              currentPlayback.item.album?.name ||
              ""
            );
          }

          if (
            contextType === "track" ||
            contextType === "album" ||
            contextType === "search"
          ) {
            return currentPlayback.item.album?.name || "";
          }

          if (contextType === "artist") {
            return getArtistNames("", currentPlayback.item.artists) || "";
          }

          if (contextType === "station") {
            const contextTitle = await getPlaylistName(currentPlayback.context);
            return !contextTitle ? "Radio" : `Radio · ${contextTitle}`;
          }

          if (
            contextType === "collection" ||
            contextUri.includes(":collection")
          ) {
            return contextUri.includes("your-episodes")
              ? "Your Episodes"
              : "Liked Songs";
          }

          const contextTitle = await getPlaylistName(currentPlayback.context);
          if (contextTitle) {
            return contextTitle;
          }

          return "";
        };

        getContextTitle().then((title) => {
          runInAction(() => {
            npvStore.playingInfoUiState.contextHeaderTitle = title;
          });
        });

        let imageUri = "";
        const rawImages =
          currentPlayback.item.type === "episode"
            ? currentPlayback.item.show?.images ||
              currentPlayback.item.images ||
              []
            : currentPlayback.item.album?.images || [];
        if (currentPlayback.item.type === "episode") {
          imageUri =
            getNpvImageUrl(currentPlayback.item.show?.images) ||
            getNpvImageUrl(currentPlayback.item.images) ||
            "";
        } else {
          imageUri = getNpvImageUrl(currentPlayback.item.album?.images) || "";
        }
        currentImageUrlsRef.current = rawImages
          .map((img) => img?.url)
          .filter(Boolean);

        npvStore.playingInfoUiState.currentItem = {
          uid: currentPlayback.item.id || "unknown",
          uri: currentPlayback.item.uri || "",
          image_uri: imageUri,
          name: currentPlayback.item.name || "Unknown Track",
          artist_name:
            currentPlayback.item.type === "episode"
              ? currentPlayback.item.show?.name || "Unknown Podcast"
              : getArtistNames("Unknown Artist", currentPlayback.item.artists),
        };

        if (carThingStores.queueStore) {
          carThingStores.queueStore.updateCurrent(
            imageUri,
            currentTrackId,
            currentPlayback.item.uri,
          );

          if (trackChanged)
            getQueue()
              .then((queueData) => {
                if (
                  queueData &&
                  queueData.queue &&
                  Array.isArray(queueData.queue)
                ) {
                  const formattedQueue = queueData.queue.map((item, index) => ({
                    queue_index: index,
                    uid: item.uid || "",
                    uri: item.uri,
                    name: item.name,

                    artist_name:
                      item.artist_name ||
                      (item.artists
                        ? item.artists.map((artist) => artist.name).join(", ")
                        : item.album_name || ""),
                    image_uri:
                      item.image_url || item.album?.images?.[0]?.url || "",
                    provider: "spotify",
                    identifier: item.id || item.uri?.split(":").pop() || "",
                    explicit: item.explicit || false,
                  }));

                  runInAction(() => {
                    carThingStores.queueStore.updateQueue(formattedQueue);
                  });
                }
              })
              .catch((error) => {
                console.error("Failed to fetch queue:", error);
              });
        }

        npvStore.controlButtonsUiState.isPlaying = isPlaying || false;
        npvStore.controlButtonsUiState.isShuffled = isShuffled || false;

        const isOtherMedia =
          !!currentPlayback.currently_active_application ||
          !!currentPlayback?.item?.is_phone_media;
        const isEpisode = currentPlayback.item.type === "episode";
        const isPodcastContext = currentPlayback.context?.type === "show";
        const isPodcast = isEpisode || isPodcastContext;

        if (isOtherMedia) {
          npvStore.controlButtonsUiState.controlButtonSet = "other_media";
          npvStore.controlButtonsUiState.showOtherMediaControls = true;
          npvStore.controlButtonsUiState.showPodcastControls = false;
        } else if (isPodcast) {
          npvStore.controlButtonsUiState.controlButtonSet = "podcast";
          npvStore.controlButtonsUiState.showPodcastControls = true;
          npvStore.controlButtonsUiState.showOtherMediaControls = false;
        } else {
          npvStore.controlButtonsUiState.controlButtonSet = "music";
          npvStore.controlButtonsUiState.showPodcastControls = false;
          npvStore.controlButtonsUiState.showOtherMediaControls = false;
        }

        const repeatState = currentPlayback.repeat_state;
        const newOnRepeat = repeatState === "context";
        const newOnRepeatOnce = repeatState === "track";

        npvStore.playingInfoUiState.onRepeat = newOnRepeat;
        npvStore.playingInfoUiState.onRepeatOnce = newOnRepeatOnce;
        npvStore.playingInfoUiState.isPlayingSpotify = !isOtherMedia;

        if (carThingStores.imageStore && imageUri) {
          carThingStores.imageStore.loadColor(imageUri);
        }

        npvStore.volumeUiState.isPlayingSpotify = !isOtherMedia;

        const deviceVolume = currentPlayback.device?.volume_percent;
        if (deviceVolume !== undefined && !volumeDebounceRef.current) {
          volumeRef.current = deviceVolume;
          const pct = deviceVolume / 100;
          npvStore.volumeUiState.displayVolume = pct;
          npvStore.volumeUiState.volume = pct;
          npvStore.volumeUiState.isVolumeAbove0 = deviceVolume > 0;
          if (carThingStores.volumeStore) {
            carThingStores.volumeStore.localVolume = pct;
            carThingStores.volumeStore.receivedVolume = pct;
          }
        }
      }

      if (carThingStores.playerStore) {
        const contextUri =
          currentPlayback.context?.uri || "spotify:track:unknown";

        carThingStores.playerStore.state.is_playing = isPlaying || false;
        carThingStores.playerStore.state.context_uri = contextUri;
        carThingStores.playerStore.state.track = currentPlayback.item;
        carThingStores.playerStore.state.currently_active_application =
          currentPlayback.currently_active_application || null;
      }
    });

    if (trackChanged && carThingStores.shelfStore) {
      const isPodcast = currentPlayback.item?.type === "episode";
      const currentAlbum = isPodcast
        ? currentPlayback.item?.show
        : currentPlayback.item?.album;
      const currentAlbumId = currentAlbum?.id;

      if (
        currentAlbumId &&
        currentAlbum.name &&
        currentAlbum.name !== "Not Playing"
      ) {
        const swiperUiState =
          carThingStores.shelfStore.shelfController.swiperUiState;
        const isNewAlbum =
          swiperUiState.allShelfItems[0]?.identifier !==
          `current-playing-${currentAlbumId}`;

        runInAction(() => {
          if (isNewAlbum) {
            swiperUiState.animateSliding = true;
            swiperUiState.selectedItemIndex = 0;
          }
          carThingStores.shelfStore.pushCurrentAlbum({
            id: currentAlbum.id,
            uri:
              currentAlbum.uri ||
              (isPodcast
                ? `spotify:show:${currentAlbum.id}`
                : `spotify:album:${currentAlbum.id}`),
            name: currentAlbum.name || "",
            images: currentAlbum.images || [],
            artists: isPodcast
              ? [{ name: currentAlbum.publisher || "Podcast" }]
              : currentPlayback.item?.artists || [],
          });
        });
      }
    }

    if (
      currentTrackId &&
      currentTrackId !== lastCheckedTrackId.current &&
      checkIsTrackLiked
    ) {
      lastCheckedTrackId.current = currentTrackId;

      if (likeCheckTimeoutRef.current) {
        clearTimeout(likeCheckTimeoutRef.current);
      }

      likeCheckTimeoutRef.current = setTimeout(() => {
        checkIsTrackLiked(currentTrackId)
          .then((saved) => {
            runInAction(() => {
              npvStore.controlButtonsUiState.isSaved = saved;
            });
          })
          .catch((error) => {
            console.warn("Failed to check if track is liked:", error);
            runInAction(() => {
              npvStore.controlButtonsUiState.isSaved = false;
            });
          });
      }, 500);
    }
  }, [
    currentPlayback,
    currentPlayback?.item?.id,
    currentPlayback?.is_playing,
    currentPlayback?.shuffle_state,
    carThingStores,
    getQueue,
    checkIsTrackLiked,
  ]);

  useEffect(() => {
    if (!carThingStores?.npvStore || !playerControls) return;

    const { npvStore } = carThingStores;

    runInAction(() => {
      npvStore.controlButtonsUiState.handlePlayClick = () => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaPlay?.();
        } else {
          playTrack?.();
        }
      };
      npvStore.controlButtonsUiState.handlePauseClick = () => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaPause?.();
        } else {
          pausePlayback?.();
        }
      };
      npvStore.controlButtonsUiState.handleSkipNextClick = () => {
        npvStore.playingInfoUiState.swipeHandler.setSwipeDirection("LEFT");
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaNext?.();
        } else {
          skipToNext?.();
        }
      };
      npvStore.controlButtonsUiState.handleSkipPrevClick = () => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaPrevious?.();
        } else {
          const progressMs = currentPlayback?.progress_ms || 0;
          if (progressMs > 3000) {
            seekToPosition?.(0);
            lastSeekPositionRef.current = 0;
            lastSeekTimeRef.current = Date.now();
          } else {
            npvStore.playingInfoUiState.swipeHandler.setSwipeDirection("RIGHT");
            skipToPrevious?.();
          }
        }
      };
      npvStore.controlButtonsUiState.handleShuffleClick = () =>
        toggleShuffle?.(true);
      npvStore.controlButtonsUiState.handleUnshuffleClick = () =>
        toggleShuffle?.(false);

      npvStore.controlButtonsUiState.handleRepeatClick = () => {
        const onRepeat = npvStore.playingInfoUiState.onRepeat;
        const onRepeatOnce = npvStore.playingInfoUiState.onRepeatOnce;

        let nextMode;
        if (!onRepeat && !onRepeatOnce) {
          nextMode = "context";
        } else if (onRepeat) {
          nextMode = "track";
        } else {
          nextMode = "off";
        }

        setRepeatMode?.(nextMode);
        runInAction(() => {
          npvStore.playingInfoUiState.onRepeat = nextMode === "context";
          npvStore.playingInfoUiState.onRepeatOnce = nextMode === "track";
        });
      };

      npvStore.controlButtonsUiState.handlePodcastSpeedClick = () => {
        const currentSpeed = npvStore.controlButtonsUiState.podcastSpeed;
        const speeds = [0.5, 0.8, 1, 1.2, 1.5, 1.8, 2, 2.5, 3, 3.5];
        const currentIndex = speeds.indexOf(currentSpeed);
        const nextIndex = (currentIndex + 1) % speeds.length;
        const nextSpeed = speeds[nextIndex];

        runInAction(() => {
          npvStore.controlButtonsUiState.podcastSpeed = nextSpeed;
        });

        sendNocturneWsRequest("spotify.player.state", {}, { timeoutMs: 3000 })
          .then((state) => {
            const deviceId = state?.device?.id;
            return sendNocturneWsRequest("spotify.player.speed", {
              speed: nextSpeed,
              ...(deviceId ? { device_id: deviceId } : {}),
            });
          })
          .catch(() => {});
      };

      npvStore.controlButtonsUiState.handleSeekBackClick = () => {
        const now = Date.now();
        const useLastSeek =
          lastSeekPositionRef.current !== null &&
          now - lastSeekTimeRef.current < 3000;
        const currentPos = useLastSeek
          ? lastSeekPositionRef.current
          : currentPlayback?.progress_ms || 0;
        const newPosition = Math.max(0, currentPos - 15000);
        lastSeekPositionRef.current = newPosition;
        lastSeekTimeRef.current = now;
        seekToPosition?.(newPosition);
      };

      npvStore.controlButtonsUiState.handleSeekForwardClick = () => {
        const duration = currentPlayback?.item?.duration_ms || 0;
        if (!duration) return;
        const now = Date.now();
        const useLastSeek =
          lastSeekPositionRef.current !== null &&
          now - lastSeekTimeRef.current < 3000;
        const currentPos = useLastSeek
          ? lastSeekPositionRef.current
          : currentPlayback?.progress_ms || 0;
        const newPosition = Math.min(duration, currentPos + 15000);
        lastSeekPositionRef.current = newPosition;
        lastSeekTimeRef.current = now;
        seekToPosition?.(newPosition);
      };

      npvStore.controlButtonsUiState.handleAddToSavedEpisodesClick =
        async () => {
          runInAction(() => {
            npvStore.controlButtonsUiState.isSaved = true;
          });
        };

      npvStore.controlButtonsUiState.handleRemoveFromSavedEpisodesClick =
        async () => {
          runInAction(() => {
            npvStore.controlButtonsUiState.isSaved = false;
          });
        };
    });

    runInAction(() => {
      npvStore.controlButtonsUiState.handleLikeClick = async () => {
        const currentTrackId = lastTrackId.current;
        if (currentTrackId && likeTrack) {
          await likeTrack(currentTrackId);
          runInAction(() => {
            npvStore.controlButtonsUiState.isSaved = true;
          });
        }
      };

      npvStore.controlButtonsUiState.handleUnlikeClick = async () => {
        const currentTrackId = lastTrackId.current;
        if (currentTrackId && unlikeTrack) {
          await unlikeTrack(currentTrackId);
          runInAction(() => {
            npvStore.controlButtonsUiState.isSaved = false;
          });
        }
      };
    });

    if (carThingStores.volumeStore) {
      const adjustVolume = (delta) => {
        const activeDeviceType = getActiveDeviceType();
        if (
          carThingStores.playerStore.isOtherMediaPlaying ||
          activeDeviceType === "SMARTPHONE"
        ) {
          if (delta > 0) {
            phoneMediaVolumeUp?.();
          } else {
            phoneMediaVolumeDown?.();
          }
          runInAction(() => {
            npvStore.volumeUiState.resetShowVolumeTimer();
          });
          return;
        }

        const current = volumeRef.current;
        const newVolume = Math.max(0, Math.min(100, current + delta));
        volumeRef.current = newVolume;

        runInAction(() => {
          const pct = newVolume / 100;
          npvStore.volumeUiState.displayVolume = pct;
          npvStore.volumeUiState.volume = pct;
          npvStore.volumeUiState.isVolumeAbove0 = newVolume > 0;
          npvStore.volumeUiState.resetShowVolumeTimer();
        });

        if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
        volumeDebounceRef.current = setTimeout(() => {
          volumeDebounceRef.current = null;
        }, 1500);

        sendNocturneWsRequest(
          "spotify.player.volume",
          { volume_percent: Math.round(newVolume) },
          { timeoutMs: 3000 },
        ).catch(() => {});
      };

      const increaseVolume = () => adjustVolume(6.25);
      const decreaseVolume = () => adjustVolume(-6.25);

      carThingStores.volumeStore.increaseVolume = increaseVolume;
      carThingStores.volumeStore.decreaseVolume = decreaseVolume;

      window.carThingVolumeUp = increaseVolume;
      window.carThingVolumeDown = decreaseVolume;
      window.carThingShowVolume = () =>
        npvStore.volumeUiState.resetShowVolumeTimer();
    }

    npvStore.npvController.next = () => {
      npvStore.playingInfoUiState.swipeHandler.setSwipeDirection("LEFT");
      if (carThingStores.playerStore.isOtherMediaPlaying) {
        phoneMediaNext?.();
      } else {
        skipToNext?.();
      }
    };

    npvStore.npvController.previous = () => {
      npvStore.playingInfoUiState.swipeHandler.setSwipeDirection("RIGHT");
      if (carThingStores.playerStore.isOtherMediaPlaying) {
        phoneMediaPrevious?.();
      } else {
        skipToPrevious?.();
      }
    };

    window.carThingSkipNext = () => npvStore.npvController.next();
    window.carThingSkipPrev = () => npvStore.npvController.previous();

    if (carThingStores.playerStore) {
      carThingStores.playerStore.skipToIndex = (queueIndex, uid) => {
        if (!uid) {
          console.warn(
            "skipToIndex: no uid provided, cannot jump to queue item",
          );
          return;
        }
        const contextUri = carThingStores.playerStore.state.context_uri || "";
        const params = { uid };
        if (contextUri) {
          params.context_uri = contextUri;
        }
        sendNocturneWsRequest("spotify.player.next", params, {
          timeoutMs: 5000,
        }).catch((err) => {
          console.error("skipToIndex failed:", err);
        });
      };
      carThingStores.playerStore.setPlaying = (playing) => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          if (playing) phoneMediaPlay?.();
          else phoneMediaPause?.();
        } else {
          if (playing) playTrack?.();
          else pausePlayback?.();
        }
      };

      carThingStores.playerStore.play = () => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaPlay?.();
        } else {
          playTrack?.();
        }
      };

      carThingStores.playerStore.pause = () => {
        if (carThingStores.playerStore.isOtherMediaPlaying) {
          phoneMediaPause?.();
        } else {
          pausePlayback?.();
        }
      };
    }
  }, [
    carThingStores,
    playerControls,
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    toggleShuffle,
    likeTrack,
    unlikeTrack,
  ]);

  useEffect(() => {
    return () => {
      if (likeCheckTimeoutRef.current) {
        clearTimeout(likeCheckTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const cleanup = addGlobalWsListener("carthing-artwork", {
      onMessage: (data) => {
        if (data.type !== "event") return;

        if (data.topic === "media.nowPlaying.artwork") {
          const base64 = data.data?.data;
          if (
            base64 &&
            base64.trim() !== "" &&
            currentImageUrlsRef.current.length > 0
          ) {
            injectArtwork(currentImageUrlsRef.current, base64);
          }
        } else if (data.topic === "media.nowPlaying.artwork.failed") {
          const urls = currentImageUrlsRef.current;
          for (const url of urls) {
            retryImage(url);
          }
        }
      },
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (!carThingStores?.npvStore) return;
    const { npvStore } = carThingStores;

    return subscribeToPhoneVolume((volumePercent) => {
      const pct = volumePercent / 100;
      volumeRef.current = volumePercent;
      runInAction(() => {
        npvStore.volumeUiState.displayVolume = pct;
        npvStore.volumeUiState.volume = pct;
        npvStore.volumeUiState.isVolumeAbove0 = volumePercent > 0;
        npvStore.volumeUiState.resetShowVolumeTimer();
      });
    });
  }, [carThingStores]);

  return {
    currentPlayback,
    isLoading: false,
  };
}
