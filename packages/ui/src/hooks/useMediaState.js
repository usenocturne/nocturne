import { useState, useEffect, useCallback } from "react";
import { getCurrentDevice } from "@/services/deviceService";
import local from "next/font/local";

export function useMediaState(accessToken, handleError) {
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingTrackUri, setCurrentlyPlayingTrackUri] =
    useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumsQueue, setAlbumsQueue] = useState([]);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [radio, setRadio] = useState([]);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [currentRepeat, setCurrentRepeat] = useState("off");

  const fetchCurrentPlayback = useCallback(async () => {
    if (!accessToken) return;

    try {
      const response = await fetch(
        "https://api.spotify.com/v1/me/player?type=episode,track",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 204) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
        setCurrentlyPlayingTrackUri(null);
        localStorage.removeItem("playingLikedSongs");
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          localStorage.removeItem("playingLikedSongs");
          return;
        }

        if (data.context?.uri) {
          if (!data.context.uri.includes("collection")) {
            localStorage.removeItem("playingLikedSongs");
          }
          const mixFlags = Object.keys(localStorage).filter((key) =>
            key.startsWith("playingMix-")
          );
          mixFlags.forEach((flag) => {
            if (localStorage.getItem(flag) !== data.context.uri) {
              localStorage.removeItem(flag);
            }
          });
        } else if (!data.item) {
          localStorage.removeItem("playingLikedSongs");
          Object.keys(localStorage)
            .filter((key) => key.startsWith("playingMix-"))
            .forEach((key) => localStorage.removeItem(key));
        }

        setCurrentPlayback({
          ...data,
          device: {
            ...data.device,
            volume_percent: data.device?.volume_percent,
          },
          shuffle_state: data.shuffle_state,
          repeat_state: data.repeat_state,
        });

        setIsShuffleEnabled(data.shuffle_state);
        setCurrentRepeat(data.repeat_state);

        if (data?.item) {
          setCurrentlyPlayingTrackUri(data.item.uri);

          if (data.item.type === "track") {
            const currentAlbum = data.item.album;
            if (
              !currentlyPlayingAlbum ||
              currentlyPlayingAlbum.id !== currentAlbum.id
            ) {
              setCurrentlyPlayingAlbum(currentAlbum);
              setAlbumsQueue((prevQueue) => {
                const updatedQueue = prevQueue.filter(
                  (album) => album.id !== currentAlbum.id
                );
                return [currentAlbum, ...updatedQueue];
              });
            }
          } else if (data.item.type === "episode") {
            const currentShow = data.item.show;
            if (
              !currentlyPlayingAlbum ||
              currentlyPlayingAlbum.id !== currentShow.id
            ) {
              setCurrentlyPlayingAlbum(currentShow);
              setAlbumsQueue((prevQueue) => {
                const updatedQueue = prevQueue.filter(
                  (album) => album.id !== currentShow.id
                );
                return [currentShow, ...updatedQueue];
              });
            }
          }
        }
      }
    } catch (error) {
      if (!error.message.includes("Unexpected end of JSON input")) {
        handleError("FETCH_CURRENT_PLAYBACK_ERROR", error.message);
      }
    }
  }, [accessToken, currentlyPlayingAlbum, handleError]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setIsShuffleEnabled(currentPlayback.shuffle_state);
      localStorage.setItem("shuffleEnabled", currentPlayback.shuffle_state);
    }
    if (currentPlayback?.repeat_state) {
      setCurrentRepeat(currentPlayback.repeat_state);
      localStorage.setItem("repeatMode", currentPlayback.repeat_state);
    }
  }, [currentPlayback?.shuffle_state, currentPlayback?.repeat_state]);

  return {
    currentPlayback,
    currentlyPlayingTrackUri,
    currentlyPlayingAlbum,
    albumsQueue,
    recentAlbums,
    playlists,
    artists,
    radio,
    isShuffleEnabled,
    currentRepeat,
    setCurrentPlayback,
    setCurrentlyPlayingTrackUri,
    setCurrentlyPlayingAlbum,
    setAlbumsQueue,
    setRecentAlbums,
    setPlaylists,
    setArtists,
    setRadio,
    setIsShuffleEnabled,
    setCurrentRepeat,
    fetchCurrentPlayback,
  };
}
