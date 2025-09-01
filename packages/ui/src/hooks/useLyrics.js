import { useState, useRef, useEffect, useCallback } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";

export function useLyrics(currentPlayback) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const lyricsContainerRef = useRef(null);
  const trackIdRef = useRef(null);

  const { wsConnected, sendSpotifyCommand } = useSpotifyWebSocket();

  const fetchLyrics = useCallback(
    async (trackId) => {
      if (!wsConnected || !trackId) return;

      try {
        setIsLoading(true);
        setError(null);

        const result = await sendSpotifyCommand("spotify.track.lyrics", {
          track_id: trackId,
        });

        if (result && result.lyrics) {
          setLyrics(result.lyrics);
        } else {
          setError("No lyrics available");
          setLyrics([]);
        }
      } catch (err) {
        console.error("Error fetching lyrics:", err);
        setError(err.message || "Failed to fetch lyrics");
        setLyrics([]);
      } finally {
        setIsLoading(false);
      }
    },
    [wsConnected, sendSpotifyCommand],
  );

  const toggleLyrics = useCallback(async () => {
    const newShowLyrics = !showLyrics;
    setShowLyrics(newShowLyrics);

    if (newShowLyrics && currentPlayback?.item?.id) {
      await fetchLyrics(currentPlayback.item.id);
    }
  }, [showLyrics, currentPlayback?.item?.id, fetchLyrics]);

  useEffect(() => {
    if (
      showLyrics &&
      currentPlayback?.item?.id &&
      currentPlayback.item.id !== trackIdRef.current
    ) {
      trackIdRef.current = currentPlayback.item.id;
      fetchLyrics(currentPlayback.item.id);
    }
  }, [showLyrics, currentPlayback?.item?.id, fetchLyrics]);

  const suspendAutoScroll = () => {
    // TODO: Implement auto-scroll suspension once lyrics format is known
  };

  const resumeAutoScrollOnNextLyric = () => {
    // TODO: Implement auto-scroll resume once lyrics format is known
  };

  const hasLyrics = lyrics.length > 0 && !error;

  return {
    showLyrics,
    lyrics,
    hasLyrics,
    currentLyricIndex,
    isLoading,
    error,
    lyricsContainerRef,
    toggleLyrics,
    suspendAutoScroll,
    resumeAutoScrollOnNextLyric,
  };
}
