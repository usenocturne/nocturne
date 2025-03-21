import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { useSpotifyPlayerState } from './useSpotifyPlayerState';

export const PlaybackProgressContext = createContext(null);

export const usePlaybackProgressConsumer = () => {
  const context = useContext(PlaybackProgressContext);

  if (!context) {
    throw new Error('usePlaybackProgressConsumer must be used within a PlaybackProgressContext.Provider');
  }

  return context;
};

export const usePlaybackProgress = (accessToken) => {
  const { currentPlayback, refreshPlaybackState } = useSpotifyPlayerState(accessToken);
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trackId, setTrackId] = useState(null);

  const lastUpdateTimeRef = useRef(Date.now());
  const animationFrameRef = useRef(null);
  const serverProgressRef = useRef(0);
  const lastRefreshTimeRef = useRef(0);
  const frameSkipCounterRef = useRef(0);
  const animationCountRef = useRef(0);

  useEffect(() => {
    if (currentPlayback?.item?.id !== trackId) {
      setTrackId(currentPlayback?.item?.id);
      setDuration(currentPlayback?.item?.duration_ms || 0);
      serverProgressRef.current = currentPlayback?.progress_ms || 0;
      setProgressMs(currentPlayback?.progress_ms || 0);
      lastUpdateTimeRef.current = Date.now();
      animationCountRef.current = 0;
    }
    else if (currentPlayback?.progress_ms !== undefined) {
      serverProgressRef.current = currentPlayback.progress_ms;
      setProgressMs(currentPlayback.progress_ms);
      lastUpdateTimeRef.current = Date.now();
      animationCountRef.current = 0;
    }

    setIsPlaying(currentPlayback?.is_playing || false);
    setDuration(currentPlayback?.item?.duration_ms || 0);
  }, [currentPlayback, trackId]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) return;

    const animate = () => {
      if (animationCountRef.current > 60) {
        frameSkipCounterRef.current = (frameSkipCounterRef.current + 1) % 3;
        if (frameSkipCounterRef.current !== 0) {
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        }
      }

      const now = Date.now();
      const elapsed = now - lastUpdateTimeRef.current;

      if (now - lastRefreshTimeRef.current >= 15000) {
        lastRefreshTimeRef.current = now;
        refreshPlaybackState();
      } else if (elapsed > 30000) {
        refreshPlaybackState(true);
      }

      setProgressMs((prev) => {
        const estimated = Math.min(serverProgressRef.current + elapsed, duration);
        return estimated;
      });

      animationCountRef.current += 1;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, duration, refreshPlaybackState]);

  const updateProgress = useCallback((newProgressMs) => {
    serverProgressRef.current = newProgressMs;
    setProgressMs(newProgressMs);
    lastUpdateTimeRef.current = Date.now();
    animationCountRef.current = 0;
  }, []);

  return {
    progressMs,
    isPlaying,
    duration,
    trackId,
    progressPercentage: duration > 0 ? (progressMs / duration) * 100 : 0,
    updateProgress
  };
}; 