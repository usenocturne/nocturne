import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useProgressValue } from "./usePlaybackProgress";

/** @typedef {import("@schema/spotify").SpotifyTrackLyricsRequest} SpotifyTrackLyricsRequest */

const normalizeLyricsKeyPart = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const getLyricsTrackKey = (item: UiLooseData) => {
  if (!item) return "";
  if (typeof item.uri === "string" && item.uri.trim()) return item.uri.trim();

  return [item.id, item.name, item.artists?.[0]?.name]
    .map(normalizeLyricsKeyPart)
    .filter(Boolean)
    .join("|");
};

export function useLyrics(currentPlayback) {
  const { progressMs } = useProgressValue();
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<UiContentItem[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoScrollSuspended, setAutoScrollSuspended] = useState(false);
  const [resumeOnNextLyric, setResumeOnNextLyric] = useState(false);
  const lyricsContainerRef = useRef(null);
  const lyricsTrackKeyRef = useRef<string | null>(null);
  const autoScrollTimeoutRef = useRef(null);

  const { isSpotifyReady, sendSpotifyCommand } = useSpotifyWebSocket();

  const isTimeSynced = useMemo(() => {
    if (lyrics.length < 2) return false;
    const timestamps = lyrics.map((l) => parseInt(l.startTimeMs) || 0);
    const uniqueTimestamps = new Set(timestamps);
    return uniqueTimestamps.size > 1;
  }, [lyrics]);

  const fetchLyrics = useCallback(
    async (trackId, trackName, artistName, trackKey) => {
      if (!isSpotifyReady || !trackId) return;
      const requestKey = trackKey || trackId;

      try {
        setIsLoading(true);
        setError(null);

        void trackName;
        void artistName;
        /** @type {SpotifyTrackLyricsRequest} */
        const params = { contentId: trackId };
        const result = await sendSpotifyCommand("spotify.track.lyrics", params);

        if (lyricsTrackKeyRef.current !== requestKey) return;

        if (result && result.lyrics && result.lyrics.lines) {
          setLyrics(result.lyrics.lines);
        } else {
          setError("No lyrics available");
          setLyrics([]);
        }
      } catch (err) {
        if (lyricsTrackKeyRef.current !== requestKey) return;
        console.error("Error fetching lyrics:", err);
        setError(err.message || "Failed to fetch lyrics");
        setLyrics([]);
      } finally {
        if (lyricsTrackKeyRef.current === requestKey) {
          setIsLoading(false);
        }
      }
    },
    [isSpotifyReady, sendSpotifyCommand],
  );

  const toggleLyrics = useCallback(async () => {
    const newShowLyrics = !showLyrics;
    setShowLyrics(newShowLyrics);

    if (newShowLyrics && currentPlayback?.item?.id) {
      const trackKey = getLyricsTrackKey(currentPlayback.item);
      lyricsTrackKeyRef.current = trackKey;
      const trackName = currentPlayback.item.name;
      const artistName = currentPlayback.item.artists?.[0]?.name || "";
      await fetchLyrics(
        currentPlayback.item.id,
        trackName,
        artistName,
        trackKey,
      );
    }
  }, [showLyrics, currentPlayback?.item, fetchLyrics]);

  useEffect(() => {
    if (!currentPlayback || currentPlayback?.item?.type === "episode") {
      setShowLyrics(false);
      return;
    }

    if (
      showLyrics &&
      currentPlayback?.item?.id &&
      getLyricsTrackKey(currentPlayback.item) !== lyricsTrackKeyRef.current
    ) {
      const trackKey = getLyricsTrackKey(currentPlayback.item);
      lyricsTrackKeyRef.current = trackKey;
      const trackName = currentPlayback.item.name;
      const artistName = currentPlayback.item.artists?.[0]?.name || "";
      fetchLyrics(currentPlayback.item.id, trackName, artistName, trackKey);
    }
  }, [showLyrics, currentPlayback?.item, fetchLyrics]);

  useEffect(() => {
    if (lyrics.length > 0 && progressMs !== undefined) {
      if (!isTimeSynced) {
        if (currentLyricIndex !== 0) {
          setCurrentLyricIndex(0);
        }
        return;
      }

      const currentTimeMs = progressMs;

      if (
        currentTimeMs < 500 &&
        lyricsContainerRef.current &&
        !autoScrollSuspended
      ) {
        lyricsContainerRef.current.scrollTo({
          top: 0,
          behavior: "smooth",
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

        if (
          newIndex >= 0 &&
          lyricsContainerRef.current &&
          !autoScrollSuspended
        ) {
          const container = lyricsContainerRef.current;
          const lyricElements = container.children;
          if (lyricElements[newIndex]) {
            const lyricElement = lyricElements[newIndex];
            const containerHeight = container.clientHeight;
            const lyricTop = lyricElement.offsetTop;
            const lyricHeight = lyricElement.offsetHeight;

            const scrollTo = lyricTop - containerHeight / 2 + lyricHeight / 2;
            container.scrollTo({
              top: scrollTo,
              behavior: "smooth",
            });
          }
        }
      }
    }
  }, [
    lyrics,
    progressMs,
    currentLyricIndex,
    autoScrollSuspended,
    resumeOnNextLyric,
    isTimeSynced,
  ]);

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
        behavior: "smooth",
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
      if (autoScrollTimeoutRef.current)
        clearTimeout(autoScrollTimeoutRef.current);

      scrollTimeout = setTimeout(() => {
        setAutoScrollSuspended(false);
      }, 5000);
    };

    const handleWheel = () => {
      isUserScrolling = true;
      setTimeout(() => {
        isUserScrolling = false;
      }, 50);
    };

    const handleTouchStart = () => {
      isUserScrolling = true;
    };

    const handleTouchEnd = () => {
      setTimeout(() => {
        isUserScrolling = false;
      }, 50);
    };

    container.addEventListener("scroll", handleScroll);
    container.addEventListener("wheel", handleWheel);
    container.addEventListener("touchstart", handleTouchStart);
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
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
    isTimeSynced,
  };
}
