import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSpotifyPlayerState } from "./useSpotifyPlayerState";
import { useSpotifyPlayerControls } from "./useSpotifyPlayerControls";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useImageLoader } from "./useImageLoader";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";
import { getCachedTimezone } from "../components/common/navigation/StatusBar";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export function useSpotifyData(activeSection, skipInitialFetch = false) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "/images/liked-songs.webp" }],
    type: "liked-songs",
  });
  const [radioMixes, setRadioMixes] = useState([]);
  const [userShows, setUserShows] = useState([]);
  const [retryCount, setRetryCount] = useState(0);
  const [nextRecentTracksAfter, setNextRecentTracksAfter] = useState(null);
  const [isLazyLoading, setIsLazyLoading] = useState(false);

  const [nextTokens, setNextTokens] = useState({
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    userShows: null,
    recentTracks: null,
  });

  const [lastOffsets, setLastOffsets] = useState({
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

  const [sectionsAccessed, setSectionsAccessed] = useState(new Set());

  const [isLoading, setIsLoading] = useState({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
    radioMixes: true,
    userShows: true,
  });

  const [errors, setErrors] = useState({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    radioMixes: null,
    userShows: null,
  });

  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const dataLoadingAttemptedRef = useRef(false);
  const initialLoadTriggeredRef = useRef(false);
  const dataFetchingInProgressRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lazyLoadTimeoutRef = useRef(null);
  const extractedCurrentAlbumRef = useRef(null);
  const sectionTimeoutRefs = useRef({
    playlists: null,
    artists: null,
    liked: null,
    shows: null,
    recents: null,
  });

  const sectionLoadingRefs = useRef({
    playlists: false,
    artists: false,
    liked: false,
    shows: false,
    recents: false,
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
  } = useSpotifyPlayerState();

  const playerControls = useSpotifyPlayerControls();
  const { loadImage, getImageSize } = useImageLoader();

  const {
    wsConnected,
    sendSpotifyCommand,
    getUserPlaylists,
    getUserTopTracks,
    getUserTopArtists,
    getUserTracks,
    getRecentlyPlayed,
    getNextRecentlyPlayed,
    getUserShows,
    getPlayerState,
  } = useSpotifyWebSocket();

  const scheduleLazyLoad = useCallback(() => {
    if (
      !nextRecentTracksAfter ||
      isLazyLoading ||
      activeSection !== "recents"
    ) {
      return;
    }

    if (itemCounts.recentAlbums >= 50) {
      return;
    }

    if (sectionLoadingRefs.current.recents) {
      return;
    }

    if (lazyLoadTimeoutRef.current) {
      return;
    }

    if (sectionTimeoutRefs.current.recents) {
      return;
    }

    sectionLoadingRefs.current.recents = true;
    sectionLoadingRefs.current.recents = true;

    const delay = 3000;
    lazyLoadTimeoutRef.current = setTimeout(async () => {
      if (
        nextRecentTracksAfter &&
        !isLazyLoading &&
        activeSection === "recents"
      ) {
        try {
          setIsLazyLoading(true);
          const data = await getNextRecentlyPlayed(nextRecentTracksAfter);
          const uniqueAlbums = [];
          const existingAlbumIds = new Set(
            recentAlbums.map((album) => album.id),
          );

          if (data.nextAfter) {
            setNextRecentTracksAfter(data.nextAfter);
          } else {
            setNextRecentTracksAfter(null);
          }

          const items = data.items || [];
          items.forEach((item) => {
            if (
              item.track &&
              item.track.type === "track" &&
              item.track.album &&
              !existingAlbumIds.has(item.track.album.id)
            ) {
              existingAlbumIds.add(item.track.album.id);
              uniqueAlbums.push(item.track.album);
            } else if (
              item.track &&
              item.track.type === "episode" &&
              item.track.show &&
              !existingAlbumIds.has(item.track.show.id)
            ) {
              existingAlbumIds.add(item.track.show.id);
              uniqueAlbums.push(item.track.show);
            }
          });

          setRecentAlbums((prevAlbums) => {
            const existingIds = new Set(prevAlbums.map((album) => album.id));
            const newUniqueAlbums = uniqueAlbums.filter(
              (album) => !existingIds.has(album.id),
            );
            const newTotal = [...prevAlbums, ...newUniqueAlbums];
            const limitedAlbums = newTotal.slice(0, 50);
            setItemCounts((prev) => ({
              ...prev,
              recentAlbums: limitedAlbums.length,
            }));

            if (
              data.nextAfter &&
              limitedAlbums.length < 50 &&
              activeSection === "recents"
            ) {
              setTimeout(() => scheduleLazyLoad(), 100);
            } else {
              sectionLoadingRefs.current.recents = false;
            }

            return limitedAlbums;
          });
        } catch (err) {
          console.error("Error in lazy loading recent tracks:", err);
          sectionLoadingRefs.current.recents = false;
        } finally {
          setIsLazyLoading(false);
        }
      } else {
        sectionLoadingRefs.current.recents = false;
      }
    }, delay);
  }, [
    nextRecentTracksAfter,
    isLazyLoading,
    activeSection,
    getNextRecentlyPlayed,
    recentAlbums,
    itemCounts.recentAlbums,
  ]);

  useEffect(() => {
    if (skipInitialFetch) return;
    if (!initialDataLoaded) {
      loadInitialData();
    }
  }, [skipInitialFetch]);

  // Function to extract album from raw player state response
  const extractAlbumFromPlayerState = useCallback((playerStateData) => {
    if (!playerStateData?.item) return null;
    
    if (playerStateData.item.type === "track" || playerStateData.item.album) {
      const currentAlbum = playerStateData.item.is_local
        ? {
            id: `local-${playerStateData.item.uri}`,
            name: playerStateData.item.album?.name || playerStateData.item.name,
            images: [{ url: "/images/not-playing.webp" }],
            artists: playerStateData.item.artists,
            type: "local-track",
            uri: playerStateData.item.uri,
          }
        : playerStateData.item.album;
      return currentAlbum;
    } else if (playerStateData.item.type === "episode") {
      return playerStateData.item.show;
    }
    
    return null;
  }, []);

  // Effect to extract and save currently playing album data from player state
  useEffect(() => {
    if (currentlyPlayingAlbum?.id && !extractedCurrentAlbumRef.current) {
      console.log("💾 Extracting currently playing album from player state:", currentlyPlayingAlbum.name);
      extractedCurrentAlbumRef.current = currentlyPlayingAlbum;
    }
  }, [currentlyPlayingAlbum]);

  // Effect to handle currently playing album changes during normal operation (after initial load)
  useEffect(() => {
    if (currentlyPlayingAlbum?.id && initialDataLoaded) {
      // Handle changes after initial data is loaded (for real-time updates)
      if (
        recentAlbums.length > 0 &&
        recentAlbums[0]?.id !== currentlyPlayingAlbum.id
      ) {
        console.log('🔄 Real-time update: Moving currently playing album to front:', currentlyPlayingAlbum.name);
        lastPlayedAlbumIdRef.current = currentlyPlayingAlbum.id;
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
  }, [currentlyPlayingAlbum, recentAlbums, activeSection, initialDataLoaded]);

  const fetchRecentlyPlayed = useCallback(
    async (isLoadMore = false) => {
      if (!wsConnected) return;

      try {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, recentAlbums: true }));
          
          // If this is the initial load and we don't have extracted album yet, get player state
          if (!extractedCurrentAlbumRef.current) {
            try {
              console.log("🎯 Fetching player state to extract currently playing album before recently played...");
              const playerStateResponse = await getPlayerState();
              console.log("🎯 Player state response received:", playerStateResponse);
              const playerState = playerStateResponse?.result?.result || playerStateResponse?.result || playerStateResponse;
              console.log("🎯 Extracted player state:", playerState);
              
              if (playerState) {
                const extractedAlbum = extractAlbumFromPlayerState(playerState);
                if (extractedAlbum) {
                  console.log("💾 Extracted album from player state:", extractedAlbum.name);
                  extractedCurrentAlbumRef.current = extractedAlbum;
                }
              }
            } catch (playerStateError) {
              console.log("Failed to get player state for album extraction:", playerStateError);
              // Continue with recently played fetch even if player state fails
            }
          }
        }

        let params = { limit: 5, additional_types: "track,episode" };
        if (isLoadMore) {
          params.offset = lastOffsets.recentTracks + 5;
        }

        const data = await getRecentlyPlayed(params);
        const uniqueAlbums = [];
        const albumIds = new Set();

        setLastOffsets((prev) => ({ ...prev, recentTracks: data.offset || 0 }));

        if (data.nextAfter) {
          setNextRecentTracksAfter(data.nextAfter);
        } else if (data.next) {
          setNextTokens((prev) => ({ ...prev, recentTracks: data.next }));
        }

        const items = data.items || [];
        items.forEach((item) => {
          if (
            item.track &&
            item.track.type === "track" &&
            item.track.album &&
            !albumIds.has(item.track.album.id)
          ) {
            albumIds.add(item.track.album.id);
            uniqueAlbums.push(item.track.album);
          } else if (
            item.track &&
            item.track.type === "episode" &&
            item.track.show &&
            !albumIds.has(item.track.show.id)
          ) {
            albumIds.add(item.track.show.id);
            uniqueAlbums.push(item.track.show);
          }
        });

        if (isLoadMore) {
          setRecentAlbums((prev) => {
            const existingIds = new Set(prev.map((album) => album.id));
            const newUniqueAlbums = uniqueAlbums.filter(
              (album) => !existingIds.has(album.id),
            );
            const newTotal = [...prev, ...newUniqueAlbums];
            const limitedAlbums = newTotal.slice(0, 50);
            setItemCounts((prevCounts) => ({
              ...prevCounts,
              recentAlbums: limitedAlbums.length,
            }));
            return limitedAlbums;
          });
        } else {
          console.log('Setting recentAlbums to:', uniqueAlbums.map(a => a.name));
          
          // Check if we have an extracted currently playing album to add to the front
          if (extractedCurrentAlbumRef.current?.id) {
            const currentAlbum = extractedCurrentAlbumRef.current;
            console.log('🎯 Adding extracted currently playing album to front of recently played:', currentAlbum.name);
            
            // Remove the current album if it already exists in the list
            const filteredAlbums = uniqueAlbums.filter(
              (album) => album.id !== currentAlbum.id,
            );
            
            // Add current album to the front
            const finalAlbums = [currentAlbum, ...filteredAlbums].slice(0, 50);
            setRecentAlbums(finalAlbums);
            setItemCounts((prev) => ({
              ...prev,
              recentAlbums: finalAlbums.length,
            }));
            
            // Trigger scroll animation if we're on recents section
            if (activeSection === "recents") {
              setTimeout(() => {
                const event = new CustomEvent("albumOrderChanged", {
                  detail: { albumId: currentAlbum.id },
                });
                window.dispatchEvent(event);
              }, 50);
            }
          } else {
            console.log('🎯 No extracted currently playing album available yet');
            setRecentAlbums(uniqueAlbums);
            setItemCounts((prev) => ({
              ...prev,
              recentAlbums: uniqueAlbums.length,
            }));
          }
        }

        setErrors((prev) => ({ ...prev, recentAlbums: null }));

        if (
          data.next &&
          (isLoadMore
            ? recentAlbums.length + uniqueAlbums.length
            : uniqueAlbums.length) < 50
        ) {
          setNextTokens((prev) => ({ ...prev, recentTracks: data.next }));
        } else {
          setNextTokens((prev) => ({ ...prev, recentTracks: null }));
        }

        return uniqueAlbums;
      } catch (err) {
        console.error("Error fetching recently played:", err);
        setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
        throw err;
      } finally {
        setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
      }
    },
    [
      wsConnected,
      getRecentlyPlayed,
      currentlyPlayingAlbum,
      lastOffsets,
      recentAlbums.length,
      getPlayerState,
      extractAlbumFromPlayerState,
    ],
  );

  const loadMoreRecentTracks = useCallback(
    async (isLazyLoad = false) => {
      if (!wsConnected || !nextRecentTracksAfter) return [];

      try {
        if (isLazyLoad) {
          setIsLazyLoading(true);
        } else {
          setIsLoading((prev) => ({ ...prev, recentAlbums: true }));
        }

        const data = await getNextRecentlyPlayed(nextRecentTracksAfter);
        const uniqueAlbums = [];
        const existingAlbumIds = new Set(recentAlbums.map((album) => album.id));

        if (data.nextAfter) {
          setNextRecentTracksAfter(data.nextAfter);
        } else {
          setNextRecentTracksAfter(null);
        }

        const items = data.items || [];
        items.forEach((item) => {
          if (
            item.track &&
            item.track.type === "track" &&
            item.track.album &&
            !existingAlbumIds.has(item.track.album.id)
          ) {
            existingAlbumIds.add(item.track.album.id);
            uniqueAlbums.push(item.track.album);
          } else if (
            item.track &&
            item.track.type === "episode" &&
            item.track.show &&
            !existingAlbumIds.has(item.track.show.id)
          ) {
            existingAlbumIds.add(item.track.show.id);
            uniqueAlbums.push(item.track.show);
          }
        });

        setRecentAlbums((prevAlbums) => {
          const existingIds = new Set(prevAlbums.map((album) => album.id));
          const newUniqueAlbums = uniqueAlbums.filter(
            (album) => !existingIds.has(album.id),
          );
          const newTotal = [...prevAlbums, ...newUniqueAlbums];
          const limitedAlbums = newTotal.slice(0, 50);
          setItemCounts((prev) => ({
            ...prev,
            recentAlbums: limitedAlbums.length,
          }));
          return limitedAlbums;
        });
        setErrors((prev) => ({ ...prev, recentAlbums: null }));

        if (
          isLazyLoad &&
          nextRecentTracksAfter &&
          itemCounts.recentAlbums < 50 &&
          activeSection === "recents"
        ) {
          scheduleLazyLoad();
        }

        return uniqueAlbums;
      } catch (err) {
        console.error("Error loading more recent tracks:", err);
        setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
        throw err;
      } finally {
        if (isLazyLoad) {
          setIsLazyLoading(false);
        } else {
          setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
        }
      }
    },
    [
      wsConnected,
      getNextRecentlyPlayed,
      nextRecentTracksAfter,
      recentAlbums,
      activeSection,
      itemCounts.recentAlbums,
    ],
  );

  const fetchUserPlaylists = useCallback(
    async (isLoadMore = false) => {
      if (!wsConnected) return;

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

        const params = { limit: 5, offset: nextOffset };

        const data = await getUserPlaylists(params);
        const items = data.items || [];

        setLastOffsets((prev) => ({
          ...prev,
          userPlaylists: data.offset || 0,
        }));

        if (isLoadMore) {
          setUserPlaylists((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newUniqueItems = items.filter(
              (item) => !existingIds.has(item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            setItemCounts((prevCounts) => ({
              ...prevCounts,
              userPlaylists: limitedItems.length,
            }));
            return limitedItems;
          });

          if (data.next && itemCounts.userPlaylists + items.length < 50) {
            setNextTokens((prev) => ({ ...prev, userPlaylists: data.next }));
          } else {
            setNextTokens((prev) => ({ ...prev, userPlaylists: null }));
          }
        } else {
          setUserPlaylists(items);
          setItemCounts((prev) => ({ ...prev, userPlaylists: items.length }));

          if (data.next && items.length < 50) {
            setNextTokens((prev) => ({ ...prev, userPlaylists: data.next }));
          } else if (items.length === 5 && data.total > 5) {
            setNextTokens((prev) => ({ ...prev, userPlaylists: "has-more" }));
          }
        }

        setErrors((prev) => ({ ...prev, userPlaylists: null }));
        return items;
      } catch (err) {
        console.error("Error fetching user playlists:", err);
        setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
        throw err;
      } finally {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
        } else {
          sectionLoadingRefs.current.playlists = false;
        }
      }
    },
    [wsConnected, getUserPlaylists, lastOffsets],
  );

  const fetchTopArtists = useCallback(
    async (isLoadMore = false) => {
      if (!wsConnected) return;

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

        const params = { limit: 5, offset: nextOffset };

        const data = await getUserTopArtists(params);
        const items = data.items || [];

        offsetRefs.current.topArtists = data.offset || 0;

        if (isLoadMore) {
          setTopArtists((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newUniqueItems = items.filter(
              (item) => !existingIds.has(item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            setItemCounts((prevCounts) => ({
              ...prevCounts,
              topArtists: limitedItems.length,
            }));
            return limitedItems;
          });

          if (data.next && itemCounts.topArtists + items.length < 50) {
            setNextTokens((prev) => ({ ...prev, topArtists: data.next }));
          } else {
            setNextTokens((prev) => ({ ...prev, topArtists: null }));
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
        console.error("Error fetching top artists:", err);
        setErrors((prev) => ({ ...prev, topArtists: err.message }));
        throw err;
      } finally {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, topArtists: false }));
        } else {
          sectionLoadingRefs.current.artists = false;
        }
      }
    },
    [wsConnected, getUserTopArtists],
  );

  const fetchLikedSongs = useCallback(
    async (isLoadMore = false) => {
      if (!wsConnected) return;

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

        const data = await getUserTracks(params);

        setLastOffsets((prev) => ({ ...prev, likedSongs: data.offset || 0 }));
        const updatedLikedSongs = {
          ...likedSongs,
          tracks: {
            total: data.total || 0,
            items: isLoadMore
              ? (() => {
                  const existingItems = likedSongs.tracks?.items || [];
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
          updatedLikedSongs.tracks.items = updatedLikedSongs.tracks.items.slice(
            0,
            50,
          );
          setItemCounts((prev) => ({
            ...prev,
            likedSongs: updatedLikedSongs.tracks.items.length,
          }));
        }

        if (data.next && updatedLikedSongs.tracks.items.length < 50) {
          setNextTokens((prev) => ({ ...prev, likedSongs: data.next }));
        } else if (
          !isLoadMore &&
          updatedLikedSongs.tracks.items.length === 5 &&
          data.total > 5
        ) {
          setNextTokens((prev) => ({ ...prev, likedSongs: "has-more" }));
        } else {
          setNextTokens((prev) => ({ ...prev, likedSongs: null }));
        }

        setLikedSongs(updatedLikedSongs);
        setErrors((prev) => ({ ...prev, likedSongs: null }));
        return updatedLikedSongs;
      } catch (err) {
        console.error("Error fetching liked songs:", err);
        setErrors((prev) => ({ ...prev, likedSongs: err.message }));
        throw err;
      } finally {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, likedSongs: false }));
        } else {
          sectionLoadingRefs.current.liked = false;
        }
      }
    },
    [wsConnected, getUserTracks, lastOffsets],
  );

  const fetchUserShows = useCallback(
    async (isLoadMore = false) => {
      if (!wsConnected) return;

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

        const params = { limit: 5, offset: nextOffset };

        const data = await getUserShows(params);
        const items = data.items || [];

        setLastOffsets((prev) => ({ ...prev, userShows: data.offset || 0 }));

        if (isLoadMore) {
          setUserShows((prev) => {
            const existingIds = new Set(
              prev.map((item) => item.show?.id || item.id),
            );
            const newUniqueItems = items.filter(
              (item) => !existingIds.has(item.show?.id || item.id),
            );
            const newTotal = [...prev, ...newUniqueItems];
            const limitedItems = newTotal.slice(0, 50);
            setItemCounts((prevCounts) => ({
              ...prevCounts,
              userShows: limitedItems.length,
            }));
            return limitedItems;
          });

          if (data.next && itemCounts.userShows + items.length < 50) {
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
        console.error("Error fetching user shows:", err);
        setErrors((prev) => ({ ...prev, userShows: err.message }));
        throw err;
      } finally {
        if (!isLoadMore) {
          setIsLoading((prev) => ({ ...prev, userShows: false }));
        } else {
          sectionLoadingRefs.current.shows = false;
        }
      }
    },
    [wsConnected, getUserShows, lastOffsets],
  );

  const fetchRadioMixes = useCallback(async () => {
    if (!wsConnected) return [];

    try {
      setIsLoading((prev) => ({ ...prev, radioMixes: true }));

      const result = await sendSpotifyCommand("spotify.radio.mixes");

      if (result && result.mixes) {
        setRadioMixes(result.mixes);
        setErrors((prev) => ({ ...prev, radioMixes: null }));
        return result.mixes;
      } else {
        const fallbackMixes = [
          {
            id: "top-mix",
            name: "Your Top Mix",
            images: [{ url: "/images/radio-cover/top.webp" }],
            tracks: [],
            type: "static",
            sortOrder: 1,
          },
          {
            id: "discoveries-mix",
            name: "Discoveries",
            images: [{ url: "/images/radio-cover/discoveries.webp" }],
            tracks: [],
            type: "static",
            sortOrder: 2,
          },
        ];

        setRadioMixes(fallbackMixes);
        setErrors((prev) => ({ ...prev, radioMixes: null }));
        return fallbackMixes;
      }
    } catch (err) {
      console.error("Error fetching radio mixes:", err);
      setErrors((prev) => ({ ...prev, radioMixes: err.message }));
      return [];
    } finally {
      setIsLoading((prev) => ({ ...prev, radioMixes: false }));
    }
  }, [wsConnected, sendSpotifyCommand]);

  const loadMoreForSection = useCallback(
    async (section) => {
      if (!wsConnected) return;

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
      wsConnected,
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

      if (section !== "recents") {
        if (lazyLoadTimeoutRef.current) {
          clearTimeout(lazyLoadTimeoutRef.current);
          lazyLoadTimeoutRef.current = null;
        }
        sectionLoadingRefs.current.recents = false;
      }

      if (section === "recents") {
        if (sectionLoadingRefs.current.recents) {
          return;
        }
        if (lazyLoadTimeoutRef.current) {
          return;
        }
      }

      const shouldStartLoading = () => {
        const currentOffset =
          section === "playlists"
            ? lastOffsets.userPlaylists
            : section === "artists"
              ? offsetRefs.current.topArtists
              : section === "liked"
                ? lastOffsets.likedSongs
                : section === "recents"
                  ? lastOffsets.recentTracks
                  : lastOffsets.userShows;

        const nextOffset = currentOffset + 5;
        const tokenKey =
          section === "playlists"
            ? "userPlaylists"
            : section === "artists"
              ? "topArtists"
              : section === "liked"
                ? "likedSongs"
                : section === "recents"
                  ? "recentTracks"
                  : "userShows";

        return nextOffset < 50 && nextTokens[tokenKey];
      };

      if (!sectionsAccessed.has(section)) {
        setSectionsAccessed((prev) => new Set([...prev, section]));
      }

      if (shouldStartLoading()) {
        const loadMore = async () => {
          const sectionMap = {
            playlists: "playlists",
            artists: "artists",
            liked: "liked",
            shows: "shows",
            podcasts: "shows",
            recents: "recents",
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
                    : section === "recents"
                      ? lastOffsets.recentTracks
                      : lastOffsets.userShows;

            const nextOffset = currentOffset + 5;
            const tokenKey =
              section === "playlists"
                ? "userPlaylists"
                : section === "artists"
                  ? "topArtists"
                  : section === "liked"
                    ? "likedSongs"
                    : section === "recents"
                      ? "recentTracks"
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

    if (activeSection === "recents") {
      if (nextRecentTracksAfter && itemCounts.recentAlbums < 50) {
        scheduleLazyLoad();
      }
    } else {
      if (lazyLoadTimeoutRef.current) {
        clearTimeout(lazyLoadTimeoutRef.current);
        lazyLoadTimeoutRef.current = null;
      }
    }

    const sectionMap = {
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
  }, [
    activeSection,
    initialDataLoaded,
    handleSectionAccess,
    nextRecentTracksAfter,
    itemCounts.recentAlbums,
    scheduleLazyLoad,
  ]);

  useEffect(() => {
    if (!initialDataLoaded || activeSection !== "recents") return;

    const hasTimestampPagination = nextRecentTracksAfter;

    if (
      hasTimestampPagination &&
      itemCounts.recentAlbums < 50 &&
      !lazyLoadTimeoutRef.current
    ) {
      scheduleLazyLoad();
    }
  }, [
    nextRecentTracksAfter,
    initialDataLoaded,
    activeSection,
    itemCounts.recentAlbums,
    scheduleLazyLoad,
  ]);

  const loadInitialData = useCallback(async () => {
    if (skipInitialFetch) return;
    if (!wsConnected) {
      console.log("WebSocket not connected, skipping data load");
      return;
    }
    if (
      initialLoadTriggeredRef.current ||
      isInitializing ||
      initialDataLoaded ||
      dataLoadingAttemptedRef.current ||
      dataFetchingInProgressRef.current
    ) {
      return;
    }

    initialLoadTriggeredRef.current = true;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    dataLoadingAttemptedRef.current = true;
    dataFetchingInProgressRef.current = true;
    console.log("Starting initial data load via WebSocket...", {
      wsConnected,
      initialDataLoaded,
      isInitializing,
    });

    setIsLoading({
      recentAlbums: true,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
    });

    try {
      await waitForNetwork();

      abortControllerRef.current = new AbortController();

      console.log("Fetching data sequentially...");
      const failedRequests = [];

      try {
        console.log("1/6: Fetching recently played...");
        const recentAlbumsResult = await fetchRecentlyPlayed();

        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error("Failed to fetch recently played:", error);
        failedRequests.push("fetchRecentlyPlayed");
      }

      try {
        console.log("2/6: Fetching user playlists...");
        await fetchUserPlaylists();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error("Failed to fetch user playlists:", error);
        failedRequests.push("fetchUserPlaylists");
      }

      try {
        console.log("3/6: Fetching top artists...");
        await fetchTopArtists();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error("Failed to fetch top artists:", error);
        failedRequests.push("fetchTopArtists");
      }

      try {
        console.log("4/6: Fetching liked songs...");
        await fetchLikedSongs();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error("Failed to fetch liked songs:", error);
        failedRequests.push("fetchLikedSongs");
      }

      try {
        console.log("5/6: Fetching radio mixes...");
        await fetchRadioMixes();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error("Failed to fetch radio mixes:", error);
        failedRequests.push("fetchRadioMixes");
      }

      try {
        console.log("6/6: Fetching user shows...");
        await fetchUserShows();
        console.log("Sequential data loading completed!");
      } catch (error) {
        console.error("Failed to fetch user shows:", error);
        failedRequests.push("fetchUserShows");
      }

       console.log("Sequential data loading completed!");

      if (failedRequests.length > 0) {
        console.error("Some data fetching operations failed:", failedRequests);

        if (retryCount < MAX_RETRIES) {
          setRetryCount((prev) => prev + 1);
          retryTimeoutRef.current = setTimeout(
            () => {
              dataLoadingAttemptedRef.current = false;
              dataFetchingInProgressRef.current = false;
              loadInitialData();
            },
            RETRY_DELAY * Math.pow(2, retryCount),
          );
          return;
        }
      }

      setInitialDataLoaded(true);
      setRetryCount(0);
      dataFetchingInProgressRef.current = false;
    } catch (error) {
      console.error("Error loading initial data:", error);

      if (retryCount < MAX_RETRIES) {
        setRetryCount((prev) => prev + 1);
        retryTimeoutRef.current = setTimeout(
          () => {
            dataLoadingAttemptedRef.current = false;
            dataFetchingInProgressRef.current = false;
            loadInitialData();
          },
          RETRY_DELAY * Math.pow(2, retryCount),
        );
      } else {
        dataFetchingInProgressRef.current = false;
      }
    }
  }, [
    wsConnected,
    isInitializing,
    initialDataLoaded,
    retryCount,
    fetchRecentlyPlayed,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    skipInitialFetch,
    currentlyPlayingAlbum,
  ]);

  useEffect(() => {
    if (skipInitialFetch) return;
    if (wsConnected && !initialDataLoaded && !isInitializing) {
      loadInitialData();
    }

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (lazyLoadTimeoutRef.current) {
        clearTimeout(lazyLoadTimeoutRef.current);
      }
      Object.keys(sectionTimeoutRefs.current).forEach((key) => {
        if (sectionTimeoutRefs.current[key]) {
          clearTimeout(sectionTimeoutRefs.current[key]);
        }
        sectionLoadingRefs.current[key] = false;
      });
    };
  }, [
    wsConnected,
    initialDataLoaded,
    isInitializing,
    loadInitialData,
    skipInitialFetch,
  ]);

  const refreshData = useCallback(async () => {
    if (!wsConnected) return;

    if (dataFetchingInProgressRef.current) {
      console.log("Skipping refresh - data fetching already in progress");
      return;
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
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      dataFetchingInProgressRef.current = false;
    }
  }, [
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    initialDataLoaded,
  ]);

  const isLoadingData = Object.values(isLoading).some(Boolean);
  const isLoadingAll = isInitializing || isLoadingData || playerIsLoading;

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
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
    loadMoreRecentTracks,
    hasMoreRecentTracks: !!nextRecentTracksAfter,
    isLazyLoading,
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
