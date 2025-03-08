import { useState, useEffect, useCallback } from "react";

export function useSpotifyData(
  accessToken,
  albumChangeEvent,
  activeSection,
  currentlyPlayingAlbum
) {
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "https://misc.scdn.co/liked-songs/liked-songs-640.png" }],
    type: "liked-songs",
  });
  const [isLoading, setIsLoading] = useState({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
  });
  const [errors, setErrors] = useState({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
  });
  const [hasInitialData, setHasInitialData] = useState(false);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      setRecentAlbums((prevAlbums) => {
        if (!prevAlbums.length) return [currentlyPlayingAlbum];
        const existingIndex = prevAlbums.findIndex(
          (album) => album.id === currentlyPlayingAlbum.id
        );
        if (existingIndex === 0) return prevAlbums;
        return [
          currentlyPlayingAlbum,
          ...prevAlbums.filter(
            (album) => album.id !== currentlyPlayingAlbum.id
          ),
        ].slice(0, 50);
      });
    }
  }, [currentlyPlayingAlbum]);

  const fetchRecentlyPlayed = useCallback(async () => {
    if (!accessToken || hasInitialData) return;

    try {
      setIsLoading((prev) => ({ ...prev, recentAlbums: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=50",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
      setHasInitialData(true);
      setErrors((prev) => ({ ...prev, recentAlbums: null }));
    } catch (err) {
      console.error("Error fetching recently played:", err);
      setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
    } finally {
      setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
    }
  }, [accessToken, currentlyPlayingAlbum, hasInitialData]);

  const fetchUserPlaylists = useCallback(async () => {
    if (!accessToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userPlaylists: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/playlists?limit=50",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserPlaylists(data.items);
      setErrors((prev) => ({ ...prev, userPlaylists: null }));
    } catch (err) {
      console.error("Error fetching user playlists:", err);
      setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
    } finally {
      setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
    }
  }, [accessToken]);

  const fetchTopArtists = useCallback(async () => {
    if (!accessToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, topArtists: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/top/artists?limit=50",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setTopArtists(data.items);
      setErrors((prev) => ({ ...prev, topArtists: null }));
    } catch (err) {
      console.error("Error fetching top artists:", err);
      setErrors((prev) => ({ ...prev, topArtists: err.message }));
    } finally {
      setIsLoading((prev) => ({ ...prev, topArtists: false }));
    }
  }, [accessToken]);

  const fetchLikedSongs = useCallback(async () => {
    if (!accessToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, likedSongs: true }));

      const response = await fetch(
        "https://api.spotify.com/v1/me/tracks?limit=1",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setLikedSongs((prev) => ({
        ...prev,
        tracks: { total: data.total },
      }));
      setErrors((prev) => ({ ...prev, likedSongs: null }));
    } catch (err) {
      console.error("Error fetching liked songs:", err);
      setErrors((prev) => ({ ...prev, likedSongs: err.message }));
    } finally {
      setIsLoading((prev) => ({ ...prev, likedSongs: false }));
    }
  }, [accessToken]);

  useEffect(() => {
    if (albumChangeEvent?.album?.id) {
      setRecentAlbums((prevAlbums) => {
        const newAlbum = albumChangeEvent.album;
        const filteredAlbums = prevAlbums.filter(
          (album) => album.id !== newAlbum.id
        );
        return [newAlbum, ...filteredAlbums].slice(0, 50);
      });
    }
  }, [albumChangeEvent]);

  useEffect(() => {
    if (accessToken) {
      fetchRecentlyPlayed();
      fetchUserPlaylists();
      fetchTopArtists();
      fetchLikedSongs();
    }
  }, [
    accessToken,
    fetchRecentlyPlayed,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
  ]);

  const refreshData = useCallback(() => {
    fetchUserPlaylists();
    fetchTopArtists();
    fetchLikedSongs();
  }, [fetchUserPlaylists, fetchTopArtists, fetchLikedSongs]);

  return {
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    isLoading,
    errors,
    refreshData,
    refreshRecentlyPlayed: fetchRecentlyPlayed,
    refreshUserPlaylists: fetchUserPlaylists,
    refreshTopArtists: fetchTopArtists,
    refreshLikedSongs: fetchLikedSongs,
  };
}
