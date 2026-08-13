import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { useProgressValue } from "./usePlaybackProgress";

/** @typedef {import("@schema/spotify").SpotifyTrackLyricsRequest} SpotifyTrackLyricsRequest */

const normalizeLyricsKeyPart = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim().toLowerCase()
    : "";

export const isMetadataOnlyLyricsItem = (item: UiLooseData) =>
  Boolean(
    item?.is_phone_media ||
    item?.is_local ||
    item?.uri?.startsWith("spotify:local:"),
  );

export const canFetchLyricsForItem = (
  item: UiLooseData,
  readiness: {
    wsConnected: boolean;
    appReady: boolean;
    isSpotifyReady: boolean;
  },
): boolean =>
  item?.is_phone_media
    ? readiness.wsConnected && readiness.appReady
    : readiness.isSpotifyReady;

export const buildLyricsRequestParams = (item: UiLooseData) => ({
  ...(isMetadataOnlyLyricsItem(item) ? {} : { contentId: item?.id }),
  trackName: item?.name,
  artistName: item?.artists?.[0]?.name,
});

export const getLyricsTrackKey = (item: UiLooseData) => {
  if (!item) return "";
  if (item.is_phone_media) {
    return [
      "phone",
      item.id,
      item.name,
      item.artists?.[0]?.name,
      item.phone_media_album_name,
      item.duration_ms,
    ]
      .map(normalizeLyricsKeyPart)
      .filter(Boolean)
      .join("|");
  }
  if (typeof item.uri === "string" && item.uri.trim()) return item.uri.trim();

  return [item.id, item.name, item.artists?.[0]?.name]
    .map(normalizeLyricsKeyPart)
    .filter(Boolean)
    .join("|");
};

export const isLyricsRequestCurrent = (
  currentGeneration: number,
  requestGeneration: number,
  currentTrackKey: string | null,
  requestTrackKey: string,
): boolean =>
  currentGeneration === requestGeneration &&
  currentTrackKey === requestTrackKey;

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
  const lyricsRequestGenerationRef = useRef(0);
  const autoScrollTimeoutRef = useRef(null);

  const { isSpotifyReady, wsConnected, appReady, sendSpotifyCommand } =
    useSpotifyWebSocket();

  const isTimeSynced = useMemo(() => {
    if (lyrics.length < 2) return false;
    const timestamps = lyrics.map((l) => parseInt(l.startTimeMs) || 0);
    const uniqueTimestamps = new Set(timestamps);
    return uniqueTimestamps.size > 1;
  }, [lyrics]);

  const fetchLyrics = useCallback(
    async (item, trackKey) => {
      if (!item) return;
      const metadataOnly = isMetadataOnlyLyricsItem(item);
      const canFetchLyrics = canFetchLyricsForItem(item, {
        wsConnected,
        appReady,
        isSpotifyReady,
      });
      if (!canFetchLyrics) return;
      const requestKey = trackKey || getLyricsTrackKey(item);
      const requestGeneration = ++lyricsRequestGenerationRef.current;
      const isCurrentRequest = () =>
        isLyricsRequestCurrent(
          lyricsRequestGenerationRef.current,
          requestGeneration,
          lyricsTrackKeyRef.current,
          requestKey,
        );

      try {
        setIsLoading(true);
        setError(null);

        if (metadataOnly) {
          const trackName = item.name;
          const artistName = item.artists?.[0]?.name;
          if (!trackName || !artistName) {
            setError("No lyrics available");
            setLyrics([]);
            return;
          }
        } else if (!item.id) {
          return;
        }

        /** @type {SpotifyTrackLyricsRequest} */
        const params = buildLyricsRequestParams(item);
        const result = await sendSpotifyCommand("spotify.track.lyrics", params);

        if (!isCurrentRequest()) return;

        if (result && result.lyrics && result.lyrics.lines) {
          setLyrics(result.lyrics.lines);
        } else {
          setError("No lyrics available");
          setLyrics([]);
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        console.error("Error fetching lyrics:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch lyrics");
        setLyrics([]);
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false);
        }
      }
    },
    [appReady, isSpotifyReady, sendSpotifyCommand, wsConnected],
  );

  const toggleLyrics = useCallback(async () => {
    const newShowLyrics = !showLyrics;
    setShowLyrics(newShowLyrics);

    if (!newShowLyrics) {
      lyricsRequestGenerationRef.current += 1;
      setIsLoading(false);
      return;
    }

    if (!currentPlayback?.item) return;
    const trackKey = getLyricsTrackKey(currentPlayback.item);
    lyricsTrackKeyRef.current = trackKey;
    setLyrics([]);
    setError(null);
    setCurrentLyricIndex(-1);
    await fetchLyrics(currentPlayback.item, trackKey);
  }, [showLyrics, currentPlayback?.item, fetchLyrics]);

  useEffect(() => {
    if (!currentPlayback || currentPlayback?.item?.type === "episode") {
      lyricsRequestGenerationRef.current += 1;
      lyricsTrackKeyRef.current = null;
      setShowLyrics(false);
      setLyrics([]);
      setError(null);
      setCurrentLyricIndex(-1);
      setIsLoading(false);
      return;
    }

    const trackKey = getLyricsTrackKey(currentPlayback.item);
    if (!trackKey || trackKey === lyricsTrackKeyRef.current) return;

    lyricsRequestGenerationRef.current += 1;
    lyricsTrackKeyRef.current = trackKey;
    setLyrics([]);
    setError(null);
    setCurrentLyricIndex(-1);
    setIsLoading(false);
    if (showLyrics) fetchLyrics(currentPlayback.item, trackKey);
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
      lyricsRequestGenerationRef.current += 1;
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
