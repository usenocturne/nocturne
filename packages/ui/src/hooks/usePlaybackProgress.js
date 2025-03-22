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

  useEffect(() => {
    if (currentPlayback) {
      if (currentPlayback?.item?.id !== trackId) {
        setTrackId(currentPlayback.item?.id);
        setDuration(currentPlayback.item?.duration_ms || 0);
        serverProgressRef.current = currentPlayback.progress_ms || 0;
        setProgressMs(currentPlayback.progress_ms || 0);
        lastUpdateTimeRef.current = Date.now();
      }
      else if (currentPlayback?.progress_ms !== undefined) {
        serverProgressRef.current = currentPlayback.progress_ms;
        setProgressMs(currentPlayback.progress_ms);
        lastUpdateTimeRef.current = Date.now();
      }

      setIsPlaying(currentPlayback.is_playing || false);
      setDuration(currentPlayback.item?.duration_ms || 0);
    }
  }, [currentPlayback, trackId]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) return;

    const FRAME_SKIP = 2;
    const REFRESH_INTERVAL = 15000;
    const STALE_THRESHOLD = 30000;

    const animate = () => {
      frameSkipCounterRef.current = (frameSkipCounterRef.current + 1) % FRAME_SKIP;
      
      if (frameSkipCounterRef.current === 0) {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;

        if (now - lastRefreshTimeRef.current >= REFRESH_INTERVAL) {
          lastRefreshTimeRef.current = now;
          refreshPlaybackState();
        } else if (elapsed > STALE_THRESHOLD) {
          refreshPlaybackState(true);
        }

        const estimated = Math.min(serverProgressRef.current + elapsed, duration);
        setProgressMs(estimated);
      }

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