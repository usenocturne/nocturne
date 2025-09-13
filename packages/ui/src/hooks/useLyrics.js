import { useState, useRef, useEffect, useCallback } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";

export function useLyrics(currentPlayback, progressMs) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoScrollSuspended, setAutoScrollSuspended] = useState(false);
  const [resumeOnNextLyric, setResumeOnNextLyric] = useState(false);
  const lyricsContainerRef = useRef(null);
  const trackIdRef = useRef(null);
  const autoScrollTimeoutRef = useRef(null);

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

        if (result && result.lyrics && result.lyrics.lines) {
          setLyrics(result.lyrics.lines);
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
      trackIdRef.current = currentPlayback.item.id;
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

  useEffect(() => {
    if (lyrics.length > 0 && progressMs !== undefined) {
      const currentTimeMs = progressMs;
      
      if (currentTimeMs < 500 && lyricsContainerRef.current && !autoScrollSuspended) {
        lyricsContainerRef.current.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
      
      let newIndex = -1;
      for (let i = lyrics.length - 1; i >= 0; i--) {
        const lyricStartTime = parseInt(lyrics[i].startTimeMs);
        if (currentTimeMs >= lyricStartTime) {
          newIndex = i;
          break;
        }
      }
      
      if (newIndex !== currentLyricIndex) {
        setCurrentLyricIndex(newIndex);
        
        if (resumeOnNextLyric && autoScrollSuspended) {
          setAutoScrollSuspended(false);
          setResumeOnNextLyric(false);
        }
        
        if (newIndex >= 0 && lyricsContainerRef.current && !autoScrollSuspended) {
          const container = lyricsContainerRef.current;
          const lyricElements = container.children;
          if (lyricElements[newIndex]) {
            const lyricElement = lyricElements[newIndex];
            const containerHeight = container.clientHeight;
            const lyricTop = lyricElement.offsetTop;
            const lyricHeight = lyricElement.offsetHeight;
            
            const scrollTo = lyricTop - (containerHeight / 2) + (lyricHeight / 2);
            container.scrollTo({
              top: scrollTo,
              behavior: 'smooth'
            });
          }
        }
      }
    }
  }, [lyrics, progressMs, currentLyricIndex, autoScrollSuspended, resumeOnNextLyric]);

  const suspendAutoScroll = useCallback((durationMs) => {
    setAutoScrollSuspended(true);
    setResumeOnNextLyric(false);
    
    if (autoScrollTimeoutRef.current) {
      clearTimeout(autoScrollTimeoutRef.current);
    }
    
    if (durationMs && durationMs > 0) {
      autoScrollTimeoutRef.current = setTimeout(() => {
        setAutoScrollSuspended(false);
      }, durationMs);
    }
  }, []);

  const resumeAutoScrollOnNextLyric = useCallback(() => {
    setResumeOnNextLyric(true);
  }, []);

  const scrollToTop = useCallback(() => {
    if (lyricsContainerRef.current) {
      lyricsContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }, []);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    if (!container) return;

    let isUserScrolling = false;
    let scrollTimeout;

    const handleScroll = () => {
      if (!isUserScrolling) return;
      
      setAutoScrollSuspended(true);
      setResumeOnNextLyric(false);
      
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (autoScrollTimeoutRef.current) clearTimeout(autoScrollTimeoutRef.current);
      
      scrollTimeout = setTimeout(() => {
        setAutoScrollSuspended(false);
      }, 5000);
    };

    const handleWheel = () => {
      isUserScrolling = true;
      setTimeout(() => { isUserScrolling = false; }, 50);
    };

    const handleTouchStart = () => {
      isUserScrolling = true;
    };

    const handleTouchEnd = () => {
      setTimeout(() => { isUserScrolling = false; }, 50);
    };

    container.addEventListener('scroll', handleScroll);
    container.addEventListener('wheel', handleWheel);
    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [showLyrics]);

  useEffect(() => {
    return () => {
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
      }
    };
  }, []);

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
    scrollToTop,
  };
}
