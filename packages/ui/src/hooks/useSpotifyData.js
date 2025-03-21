import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { useSpotifyPlayerState } from "./useSpotifyPlayerState";
import { usePlaybackProgress } from "./usePlaybackProgress";
import { useSpotifyPlayerControls } from "./useSpotifyPlayerControls";

export function useSpotifyData(activeSection) {
  const {
    isAuthenticated,
    accessToken,
    isLoading: authIsLoading,
    refreshTokens,
    error: authError
  } = useAuth();

  const [isInitializing, setIsInitializing] = useState(true);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "https://misc.scdn.co/liked-songs/liked-songs-640.png" }],
    type: "liked-songs",
  });
  const [radioMixes, setRadioMixes] = useState([]);

  const [isLoading, setIsLoading] = useState({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
    radioMixes: true
  });

  const [errors, setErrors] = useState({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    radioMixes: null,
  });

  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [tokenRefreshed, setTokenRefreshed] = useState(false);
  const dataLoadingAttemptedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const effectiveToken = isInitializing ? null : accessToken;

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading: playerIsLoading,
    error: playerError,
    refreshPlaybackState,
  } = useSpotifyPlayerState(effectiveToken);

  const playbackProgress = usePlaybackProgress(effectiveToken);
  const playerControls = useSpotifyPlayerControls(effectiveToken);

  const initializeWithFreshToken = useCallback(async () => {
    if (!isAuthenticated || authIsLoading) return;
    setIsInitializing(true);
    try {
      const refreshSuccessful = await refreshTokens();
      setTokenRefreshed(refreshSuccessful);
    } finally {
      setIsInitializing(false);
    }
  }, [isAuthenticated, authIsLoading, refreshTokens]);

  useEffect(() => {
    if (isAuthenticated && !authIsLoading) {
      initializeWithFreshToken();
    }
  }, [isAuthenticated, authIsLoading, initializeWithFreshToken]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      if (!recentAlbums.length || recentAlbums[0]?.id !== currentlyPlayingAlbum.id) {
        lastPlayedAlbumIdRef.current = currentlyPlayingAlbum.id;
        setRecentAlbums((prevAlbums) => {
          const filteredAlbums = prevAlbums.filter(
            (album) => album.id !== currentlyPlayingAlbum.id
          );
          return [currentlyPlayingAlbum, ...filteredAlbums].slice(0, 50);
        });
        
        if (activeSection === "recents") {
          setTimeout(() => {
            const event = new CustomEvent('albumOrderChanged', { 
              detail: { albumId: currentlyPlayingAlbum.id } 
            });
            window.dispatchEvent(event);
          }, 50);
        }
      }
    }
  }, [currentlyPlayingAlbum, recentAlbums, activeSection]);

  const fetchRecentlyPlayed = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, recentAlbums: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=50",
        {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const uniqueAlbums = [];
      const albumIds = new Set();

      if (currentlyPlayingAlbum?.id) {
        albumIds.add(currentlyPlayingAlbum.id);
        uniqueAlbums.push(currentlyPlayingAlbum);
      }

      data.items.forEach((item) => {
        if (
          item.track &&
          item.track.album &&
          !albumIds.has(item.track.album.id)
        ) {
          albumIds.add(item.track.album.id);
          uniqueAlbums.push(item.track.album);
        }
      });

      setRecentAlbums(uniqueAlbums);
      setErrors((prev) => ({ ...prev, recentAlbums: null }));
      return uniqueAlbums;
    } catch (err) {
      console.error("Error fetching recently played:", err);
      setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
    }
  }, [effectiveToken, currentlyPlayingAlbum]);

  const fetchUserPlaylists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userPlaylists: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/playlists?limit=50",
        {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserPlaylists(data.items);
      setErrors((prev) => ({ ...prev, userPlaylists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching user playlists:", err);
      setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
    }
  }, [effectiveToken]);

  const fetchTopArtists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, topArtists: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/top/artists?limit=50",
        {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setTopArtists(data.items);
      setErrors((prev) => ({ ...prev, topArtists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching top artists:", err);
      setErrors((prev) => ({ ...prev, topArtists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, topArtists: false }));
    }
  }, [effectiveToken]);

  const fetchLikedSongs = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, likedSongs: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/tracks?limit=1",
        {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const updatedLikedSongs = {
        ...likedSongs,
        tracks: { total: data.total },
      };
      setLikedSongs(updatedLikedSongs);
      setErrors((prev) => ({ ...prev, likedSongs: null }));
      return updatedLikedSongs;
    } catch (err) {
      console.error("Error fetching liked songs:", err);
      setErrors((prev) => ({ ...prev, likedSongs: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, likedSongs: false }));
    }
  }, [effectiveToken, likedSongs]);

  const fetchRadioMixes = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, radioMixes: true }));

      const [
        topTracksMediumTerm,
        topTracksLongTerm,
        recentlyPlayed,
        topArtists,
      ] = await Promise.all([
        fetch(
          "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
          {
            headers: { Authorization: `Bearer ${effectiveToken}` },
          }
        ).then((res) => (res.ok ? res.json() : { items: [] })),
        fetch(
          "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
          {
            headers: { Authorization: `Bearer ${effectiveToken}` },
          }
        ).then((res) => (res.ok ? res.json() : { items: [] })),
        fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
          headers: { Authorization: `Bearer ${effectiveToken}` },
        }).then((res) => (res.ok ? res.json() : { items: [] })),
        fetch("https://api.spotify.com/v1/me/top/artists?limit=10", {
          headers: { Authorization: `Bearer ${effectiveToken}` },
        }).then((res) => (res.ok ? res.json() : { items: [] })),
      ]);

      const mixes = [];

      const getUniqueTracksById = (tracks) => {
        const uniqueMap = new Map();
        tracks.forEach((track) => {
          if (!uniqueMap.has(track.id)) {
            uniqueMap.set(track.id, track);
          }
        });
        return Array.from(uniqueMap.values());
      };

      const addUniqueIds = (tracks, mixId) => {
        return tracks.map((track) => ({
          ...track,
          uniqueId: `${mixId}-${track.id}`,
        }));
      };

      if (topTracksMediumTerm.items && topTracksMediumTerm.items.length > 0) {
        mixes.push({
          id: "top-mix",
          name: "Your Top Mix",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: addUniqueIds(topTracksMediumTerm.items, "top-mix"),
          type: "static",
          sortOrder: 1,
        });
      }

      if (recentlyPlayed.items && recentlyPlayed.items.length > 0) {
        const recentTracks = recentlyPlayed.items.map((item) => item.track);
        const uniqueRecentTracks = getUniqueTracksById(recentTracks);
        mixes.push({
          id: "recent-mix",
          name: "Recent Mix",
          images: [{ url: "/images/radio-cover/recent.webp" }],
          tracks: addUniqueIds(uniqueRecentTracks, "recent-mix"),
          type: "static",
          sortOrder: 4,
        });
      }

      const hour = new Date().getHours();
      let timeMix;

      if (hour >= 5 && hour < 12) {
        timeMix = {
          id: "morning-mix",
          name: "Morning Mix",
          images: [{ url: "/images/radio-cover/morning.webp" }],
          type: "time",
          sortOrder: 3,
        };
      } else if (hour >= 12 && hour < 17) {
        timeMix = {
          id: "afternoon-mix",
          name: "Afternoon Mix",
          images: [{ url: "/images/radio-cover/afternoon.webp" }],
          type: "time",
          sortOrder: 3,
        };
      } else {
        timeMix = {
          id: "evening-mix",
          name: "Evening Mix",
          images: [{ url: "/images/radio-cover/evening.webp" }],
          type: "time",
          sortOrder: 3,
        };
      }

      if (
        recentlyPlayed.items &&
        topTracksMediumTerm.items &&
        topTracksLongTerm.items
      ) {
        const trackPlayMap = new Map();

        recentlyPlayed.items.forEach((item) => {
          const playedHour = new Date(item.played_at).getHours();
          const trackId = item.track.id;

          if (!trackPlayMap.has(trackId)) {
            trackPlayMap.set(trackId, {
              track: item.track,
              playTimes: new Set(),
              count: 0,
            });
          }

          const trackData = trackPlayMap.get(trackId);
          trackData.playTimes.add(playedHour);
          trackData.count++;
        });

        const allTracks = [
          ...topTracksMediumTerm.items.map((track) => ({
            ...track,
            weight: 0.6,
          })),
          ...topTracksLongTerm.items.map((track) => ({
            ...track,
            weight: 0.4,
          })),
        ];

        const scoredTracks = allTracks.map((track) => {
          const playData = trackPlayMap.get(track.id);
          let timeScore = 0;

          if (playData) {
            const timeRange =
              timeMix.id === "morning-mix"
                ? { start: 5, end: 12 }
                : timeMix.id === "afternoon-mix"
                ? { start: 12, end: 17 }
                : { start: 17, end: 5 };

            const relevantHours = Array.from(playData.playTimes).filter(
              (hour) => {
                if (timeRange.start < timeRange.end) {
                  return hour >= timeRange.start && hour < timeRange.end;
                } else {
                  return hour >= timeRange.start || hour < timeRange.end;
                }
              }
            );

            timeScore =
              (relevantHours.length / playData.playTimes.size) * playData.count;
          }

          return {
            ...track,
            timeScore: timeScore * (track.weight || 1),
          };
        });

        let timeSortedTracks = scoredTracks
          .sort((a, b) => b.timeScore - a.timeScore)
          .filter(
            (track, index, self) =>
              index === self.findIndex((t) => t.id === track.id)
          )
          .slice(0, 50);

        if (timeSortedTracks.length < 50) {
          const remainingTracks = allTracks
            .filter((track) => !timeSortedTracks.some((t) => t.id === track.id))
            .sort(() => Math.random() - 0.5)
            .slice(0, 50 - timeSortedTracks.length);

          timeSortedTracks = [...timeSortedTracks, ...remainingTracks];
        }

        timeMix.tracks = addUniqueIds(timeSortedTracks, timeMix.id);
        mixes.push(timeMix);
      }

      if (topArtists.items && topArtists.items.length > 0) {
        const artistsToFetch = topArtists.items.slice(0, 5);

        const artistTracksPromises = artistsToFetch.map((artist) =>
          fetch(
            `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
            {
              headers: {
                Authorization: `Bearer ${effectiveToken}`,
              },
            }
          ).then((res) => (res.ok ? res.json() : { tracks: [] }))
        );

        const artistTracksResponses = await Promise.all(artistTracksPromises);

        const allArtistTracks = artistTracksResponses.flatMap(
          (response) => response.tracks || []
        );

        const uniqueArtistTracks = getUniqueTracksById(allArtistTracks)
          .sort(() => Math.random() - 0.5)
          .slice(0, 50);

        if (uniqueArtistTracks.length > 0) {
          mixes.push({
            id: "discoveries-mix",
            name: "Discoveries",
            images: [{ url: "/images/radio-cover/discoveries.webp" }],
            tracks: addUniqueIds(uniqueArtistTracks, "discoveries-mix"),
            type: "static",
            sortOrder: 2,
          });
        }
      }

      if (topTracksLongTerm.items && topTracksMediumTerm.items) {
        const uniqueThrowbackTracks = topTracksLongTerm.items.filter(
          (track) =>
            !topTracksMediumTerm.items.some(
              (topTrack) => topTrack.id === track.id
            )
        );

        if (uniqueThrowbackTracks.length > 0) {
          mixes.push({
            id: "throwback-mix",
            name: "Throwbacks",
            images: [{ url: "/images/radio-cover/throwback.webp" }],
            tracks: addUniqueIds(uniqueThrowbackTracks, "throwback-mix"),
            type: "static",
            sortOrder: 5,
          });
        }
      }

      const getSeasonalInfo = () => {
        const now = new Date();
        const month = now.getMonth();
        const currentYear = now.getFullYear();
        const lastYear = currentYear - 1;

        if (month >= 2 && month <= 4) {
          return {
            id: "spring-mix",
            name: "Spring Mix",
            images: [{ url: "/images/radio-cover/spring.webp" }],
            sortOrder: 6,
          };
        } else if (month >= 5 && month <= 7) {
          return {
            id: "summer-mix",
            name: "Summer Mix",
            images: [{ url: "/images/radio-cover/summer.webp" }],
            sortOrder: 6,
          };
        } else if (month >= 8 && month <= 10) {
          return {
            id: "fall-mix",
            name: "Fall Mix",
            images: [{ url: "/images/radio-cover/fall.webp" }],
            sortOrder: 6,
          };
        } else {
          return {
            id: "winter-mix",
            name: "Winter Mix",
            images: [{ url: "/images/radio-cover/winter.webp" }],
            sortOrder: 6,
          };
        }
      };

      if (topTracksMediumTerm.items && topTracksLongTerm.items) {
        const seasonalInfo = getSeasonalInfo();

        const weightedTracks = [
          ...topTracksMediumTerm.items.map((track) => ({
            ...track,
            weight: 0.6,
          })),
          ...topTracksLongTerm.items.map((track) => ({
            ...track,
            weight: 0.4,
          })),
        ];

        const uniqueTracks = Array.from(
          weightedTracks.reduce((map, track) => {
            const existing = map.get(track.id);
            if (!existing || existing.weight < track.weight) {
              map.set(track.id, track);
            }
            return map;
          }, new Map())
        ).map(([_, track]) => track);

        const seasonalTracks = uniqueTracks
          .sort(() => Math.random() - 0.5)
          .slice(0, 50);

        if (seasonalTracks.length > 0) {
          mixes.push({
            ...seasonalInfo,
            tracks: addUniqueIds(seasonalTracks, seasonalInfo.id),
            type: "seasonal",
          });
        }
      }

      const sortedMixes = mixes.sort((a, b) => a.sortOrder - b.sortOrder);

      setRadioMixes(sortedMixes);
      setErrors((prev) => ({ ...prev, radioMixes: null }));
      return sortedMixes;
    } catch (err) {
      console.error("Error fetching radio mixes:", err);
      setErrors((prev) => ({ ...prev, radioMixes: err.message }));

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
          id: "seasonal-mix",
          name: getSeasonalMixName(),
          images: [{ url: getSeasonalMixImage() }],
          tracks: [],
          type: "seasonal",
          sortOrder: 6,
        },
      ];

      setRadioMixes(fallbackMixes);
      return fallbackMixes;
    } finally {
      setIsLoading((prev) => ({ ...prev, radioMixes: false }));
    }
  }, [effectiveToken]);

  function getSeasonalMixName() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "Spring Mix";
    if (month >= 5 && month <= 7) return "Summer Mix";
    if (month >= 8 && month <= 10) return "Fall Mix";
    return "Winter Mix";
  }

  function getSeasonalMixImage() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "/images/radio-cover/spring.webp";
    if (month >= 5 && month <= 7) return "/images/radio-cover/summer.webp";
    if (month >= 8 && month <= 10) return "/images/radio-cover/fall.webp";
    return "/images/radio-cover/winter.webp";
  }

  const loadInitialData = useCallback(async () => {
    if (
      !accessToken || 
      isInitializing || 
      initialDataLoaded || 
      !tokenRefreshed ||
      dataLoadingAttemptedRef.current
    ) {
      return;
    }
    
    dataLoadingAttemptedRef.current = true;
    
    setIsLoading({
      recentAlbums: true,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true
    });
    
    try {
      await fetchRecentlyPlayed();
      await fetchUserPlaylists();
      await fetchTopArtists();
      await fetchLikedSongs();
      await fetchRadioMixes();
    } catch (error) {
      console.error("Error loading initial data:", error);
    } finally {
      setInitialDataLoaded(true);
    }
  }, [
    accessToken, 
    isInitializing, 
    initialDataLoaded, 
    tokenRefreshed,
    fetchRecentlyPlayed,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes
  ]);

  useEffect(() => {
    if (accessToken && tokenRefreshed && !initialDataLoaded && !isInitializing) {
      loadInitialData();
    }
  }, [accessToken, tokenRefreshed, initialDataLoaded, isInitializing, loadInitialData]);

  const refreshData = useCallback(async () => {
    if (!accessToken) return;
    
    dataLoadingAttemptedRef.current = false;
    
    setIsLoading(prev => ({
      ...prev,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true
    }));
    
    try {
      const tokenRefreshed = await refreshTokens();
      
      if (!tokenRefreshed) {
        console.error("Token refresh failed during data refresh");
        return;
      }
      
      await fetchUserPlaylists();
      await fetchTopArtists();
      await fetchLikedSongs();
      await fetchRadioMixes();
    } catch (error) {
      console.error("Error refreshing data:", error);
    }
  }, [accessToken, refreshTokens, fetchUserPlaylists, fetchTopArtists, fetchLikedSongs, fetchRadioMixes]);

  const isLoadingData = Object.values(isLoading).some(Boolean);
  const isLoadingAll = authIsLoading || isInitializing || isLoadingData || playerIsLoading;

  return {
    isAuthenticated,
    accessToken,
    authIsLoading,
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    playbackProgress,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    isLoading: {
      data: isLoadingData,
      player: playerIsLoading,
      auth: authIsLoading || isInitializing,
      all: isLoadingAll,
      recentAlbums: isLoading.recentAlbums,
      userPlaylists: isLoading.userPlaylists,
      topArtists: isLoading.topArtists,
      likedSongs: isLoading.likedSongs,
      radioMixes: isLoading.radioMixes
    },
    errors,
    refreshData,
    refreshRecentlyPlayed: fetchRecentlyPlayed,
    refreshUserPlaylists: fetchUserPlaylists,
    refreshTopArtists: fetchTopArtists,
    refreshLikedSongs: fetchLikedSongs,
    refreshRadioMixes: fetchRadioMixes,
  };
}
