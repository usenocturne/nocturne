import { getDefaultSettingValue } from "@/components/settings/Settings";
import { useState, useEffect, useRef, useCallback } from "react";

export function useLyrics({ currentPlayback }) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [parsedLyrics, setParsedLyrics] = useState([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [lyricsMenuOptionEnabled, setLyricsMenuOptionEnabled] = useState(false);
  const currentTrackId = useRef(null);
  const fetchedTracks = useRef(new Set());
  const lyricsContainerRef = useRef(null);

  const parseLRC = (lrc) => {
    const lines = lrc.split("\n");
    return lines
      .map((line) => {
        const match = line.match(/\[(\d{2}):(\d{2}\.\d{2})\](.*)/);
        if (match) {
          const [, minutes, seconds, text] = match;
          const time = parseInt(minutes) * 60 + parseFloat(seconds);
          return {
            time: Math.max(0, time - 1.0),
            text: text.trim(),
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  };

  const fetchLyrics = useCallback(async () => {
    if (!currentPlayback?.item) return;

    const trackId = currentPlayback.item.id;
    if (fetchedTracks.current.has(trackId)) return;

    setIsLoadingLyrics(true);
    setLyricsUnavailable(false);
    const trackName = currentPlayback.item.name;
    const artistName = currentPlayback.item.artists[0].name;

    try {
      const response = await fetch(
        `/api/v1/app/lyrics?name=${encodeURIComponent(
          trackName
        )}&artist=${encodeURIComponent(artistName)}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const parsed = parseLRC(data.lyrics);
      setParsedLyrics(parsed);
      currentTrackId.current = trackId;
    } catch (error) {
      console.error("Error fetching lyrics:", error);
      setParsedLyrics([]);
      setLyricsUnavailable(true);
    } finally {
      setIsLoadingLyrics(false);
      fetchedTracks.current.add(trackId);
    }
  }, [currentPlayback]);

  const handleToggleLyrics = useCallback(() => {
    setShowLyrics((prev) => {
      if (
        !prev &&
        !lyricsUnavailable &&
        !fetchedTracks.current.has(currentPlayback?.item?.id)
      ) {
        fetchLyrics();
      }
      return !prev;
    });
  }, [fetchLyrics, lyricsUnavailable, currentPlayback]);

  useEffect(() => {
    const lyricsEnabled = localStorage.getItem("lyricsMenuEnabled");
    if (lyricsEnabled === null) {
      const lyricsEnabledDefaultValue = getDefaultSettingValue("playback", "lyricsMenuEnabled")
      localStorage.setItem("lyricsMenuEnabled", lyricsEnabledDefaultValue);
      setLyricsMenuOptionEnabled(lyricsEnabledDefaultValue);
    } else {
      setLyricsMenuOptionEnabled(lyricsEnabled === "true");
    }
  }, []);

  useEffect(() => {
    if (currentPlayback?.item) {
      const newTrackId = currentPlayback.item.id;
      if (newTrackId !== currentTrackId.current) {
        setParsedLyrics([]);
        setCurrentLyricIndex(-1);
        setLyricsUnavailable(false);
        if (showLyrics && !fetchedTracks.current.has(newTrackId)) {
          fetchLyrics();
        }
      }
    } else {
      setShowLyrics(false);
      setParsedLyrics([]);
      setCurrentLyricIndex(-1);
      setLyricsUnavailable(false);
    }
  }, [currentPlayback, fetchLyrics, showLyrics]);

  useEffect(() => {
    if (!showLyrics || !currentPlayback || parsedLyrics.length === 0) return;

    const updateCurrentLyric = () => {
      const currentTime = currentPlayback.progress_ms / 1000;
      const newIndex = parsedLyrics.findIndex(
        (lyric) => lyric.time > currentTime
      );
      setCurrentLyricIndex(
        newIndex === -1 ? parsedLyrics.length - 1 : Math.max(0, newIndex - 1)
      );
    };

    updateCurrentLyric();
    const intervalId = setInterval(updateCurrentLyric, 100);

    return () => clearInterval(intervalId);
  }, [showLyrics, currentPlayback, parsedLyrics]);

  useEffect(() => {
    if (currentLyricIndex >= 0 && lyricsContainerRef.current) {
      const container = lyricsContainerRef.current;
      const lyricElement = container.children[currentLyricIndex];
      if (lyricElement) {
        lyricElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentLyricIndex]);

  return {
    showLyrics,
    parsedLyrics,
    currentLyricIndex,
    isLoadingLyrics,
    lyricsUnavailable,
    lyricsMenuOptionEnabled,
    lyricsContainerRef,
    handleToggleLyrics,
  };
}
