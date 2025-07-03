import { useState, useEffect, useRef } from "react";

export function useLyrics(accessToken, currentPlayback) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [estimatedProgress, setEstimatedProgress] = useState(0);

  const lyricsContainerRef = useRef(null);
  const trackIdRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);

  const parseLRC = (lrc) => {
    const lines = lrc.split("\n");
    return lines
      .map((line) => {
        const match = line.match(/\[(\d{2}):(\d{2}\.\d{2})\](.*)/);
        if (match) {
          const [, minutes, seconds, text] = match;
          const time = parseInt(minutes) * 60 + parseFloat(seconds);
          return { time, text: text.trim() };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  };

  const fetchSpotifyLyrics = async (trackId, imageUrl) => {
    try {
      const encodedImageUrl = encodeURIComponent(imageUrl);
      const response = await fetch(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}/image/${encodedImageUrl}?format=json&vocalRemoval=false&market=from_token`,
        {
          headers: {
            'accept': 'application/json',
            'app-platform': 'WebPlayer',
            'authorization': `Bearer ${accessToken}`,
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data && data.lyrics && data.lyrics.lines) {
        return data.lyrics.lines.map(line => ({
          time: line.startTimeMs / 1000,
          text: line.words
        }));
      }
      throw new Error('No lyrics in response');
    } catch (err) {
      console.log('Failed to fetch Spotify lyrics:', err);
      return null;
    }
  };

  const tryFetchLyrics = async (trackName, artistName, trackId, imageUrl) => {
    setIsLoading(true);
    setError(null);

    try {
      if (trackId && imageUrl) {
        const spotifyLyrics = await fetchSpotifyLyrics(trackId, imageUrl);
        if (spotifyLyrics) {
          setLyrics(spotifyLyrics);
          setIsLoading(false);
          return;
        }
      }
      
      const encodedTrack = encodeURIComponent(trackName);
      const encodedArtist = encodeURIComponent(artistName);

      const response = await fetch(
        `https://lrclib.net/api/get?artist_name=${encodedArtist}&track_name=${encodedTrack}`
      );

      if (response.status === 404) {
        setError("Lyrics not available");
        setLyrics([]);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data && data.syncedLyrics) {
        const parsedLyrics = parseLRC(data.syncedLyrics);
        setLyrics(parsedLyrics);
      } else {
        setError("Lyrics not available");
        setLyrics([]);
      }
    } catch (err) {
      setError(err.message);
      setLyrics([]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleLyrics = async () => {
    const newShowLyrics = !showLyrics;
    setShowLyrics(newShowLyrics);

    if (newShowLyrics) {
      try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.ok) {
          const freshPlayerState = await response.json();

          if (freshPlayerState?.progress_ms !== undefined) {
            setEstimatedProgress(freshPlayerState.progress_ms);
            lastUpdateTimeRef.current = Date.now();
          }
        }
      } catch (error) {
        console.error("Failed to sync playback position:", error);
        if (currentPlayback?.progress_ms !== undefined) {
          setEstimatedProgress(currentPlayback.progress_ms);
          lastUpdateTimeRef.current = Date.now();
        }
      }

      if (
        currentPlayback?.item &&
        (lyrics.length === 0 || trackIdRef.current !== currentPlayback.item.id)
      ) {
        trackIdRef.current = currentPlayback.item.id;
        await tryFetchLyrics(
          currentPlayback.item.name,
          currentPlayback.item.artists[0].name,
          currentPlayback.item.id,
          currentPlayback.item.album.images[0]?.url
        );
      }
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    if (showLyrics && currentPlayback?.is_playing) {
      setEstimatedProgress(currentPlayback.progress_ms);
      lastUpdateTimeRef.current = Date.now();

      progressIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;
        lastUpdateTimeRef.current = now;

        setEstimatedProgress((prev) => {
          const duration = currentPlayback?.item?.duration_ms || Infinity;
          return Math.min(prev + elapsed, duration);
        });
      }, 100);
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [
    showLyrics,
    currentPlayback?.is_playing,
    currentPlayback?.progress_ms,
    currentPlayback?.item?.duration_ms,
  ]);

  useEffect(() => {
    if (currentPlayback?.progress_ms !== undefined && showLyrics) {
      setEstimatedProgress(currentPlayback.progress_ms);
      lastUpdateTimeRef.current = Date.now();
    }
  }, [currentPlayback?.progress_ms, showLyrics]);

  useEffect(() => {
    if (!showLyrics || lyrics.length === 0) return;

    const currentTimeSeconds = estimatedProgress / 1000;
    const newIndex = lyrics.findIndex(
      (lyric) => lyric.time > currentTimeSeconds
    );
    setCurrentLyricIndex(
      newIndex === -1 ? lyrics.length - 1 : Math.max(0, newIndex - 1)
    );
  }, [estimatedProgress, lyrics, showLyrics]);

  useEffect(() => {
    if (currentLyricIndex >= 0 && lyricsContainerRef.current) {
      const container = lyricsContainerRef.current;
      const lyricElements = container.children;
      if (lyricElements.length > currentLyricIndex) {
        const lyricElement = lyricElements[currentLyricIndex];
        if (lyricElement) {
          requestAnimationFrame(() => {
            const containerRect = container.getBoundingClientRect();
            const elementRect = lyricElement.getBoundingClientRect();
            const offset = elementRect.top - containerRect.top - containerRect.height / 2 + elementRect.height / 2;
            
            container.scrollTo({
              top: container.scrollTop + offset,
              behavior: 'smooth'
            });
          });
        }
      }
    }
  }, [currentLyricIndex]);

  useEffect(() => {
    if (
      showLyrics &&
      currentPlayback?.item &&
      currentPlayback.item.id !== trackIdRef.current
    ) {
      trackIdRef.current = currentPlayback.item.id;
      setLyrics([]);
      setCurrentLyricIndex(-1);

      tryFetchLyrics(
        currentPlayback.item.name,
        currentPlayback.item.artists[0].name,
        currentPlayback.item.id,
        currentPlayback.item.album.images[0]?.url
      );

      setEstimatedProgress(currentPlayback.progress_ms || 0);
      lastUpdateTimeRef.current = Date.now();
    }
  }, [currentPlayback?.item?.id, showLyrics]);

  return {
    showLyrics,
    lyrics,
    currentLyricIndex,
    isLoading,
    error,
    lyricsContainerRef,
    toggleLyrics,
  };
}
