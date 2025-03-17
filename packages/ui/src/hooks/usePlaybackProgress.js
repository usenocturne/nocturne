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
  const frameStartRef = useRef(0);

  const animationCountRef = useRef(0);
  const lowFrequencyThreshold = 60;

  useEffect(() => {
    if (currentPlayback?.item?.id !== trackId) {
      setTrackId(currentPlayback?.item?.id);
      setDuration(currentPlayback?.item?.duration_ms || 0);
      serverProgressRef.current = currentPlayback?.progress_ms || 0;
      setProgressMs(currentPlayback?.progress_ms || 0);
      lastUpdateTimeRef.current = Date.now();
      animationCountRef.current = 0;
    }
  }, [currentPlayback?.item?.id, trackId]);

  useEffect(() => {
    if (currentPlayback?.progress_ms !== undefined) {
      serverProgressRef.current = currentPlayback.progress_ms;
      setProgressMs(currentPlayback.progress_ms);
      lastUpdateTimeRef.current = Date.now();
      animationCountRef.current = 0;
    }

    setIsPlaying(currentPlayback?.is_playing || false);
    setDuration(currentPlayback?.item?.duration_ms || 0);
  }, [currentPlayback]);

  const getAnimationFrameDelay = useCallback(() => {
    if (animationCountRef.current < lowFrequencyThreshold) {
      return 0;
    } else {
      return 3;
    }
  }, []);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) {
      return;
    }

    let frameSkipCounter = 0;

    const animate = (timestamp) => {
      if (!frameStartRef.current) {
        frameStartRef.current = timestamp;
      }

      const frameDelay = getAnimationFrameDelay();
      if (frameDelay > 0) {
        frameSkipCounter = (frameSkipCounter + 1) % frameDelay;
        if (frameSkipCounter !== 0) {
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        }
      }

      const now = Date.now();
      const elapsed = now - lastUpdateTimeRef.current;

      if (elapsed > 30000) {
        refreshPlaybackState();
      }

      setProgressMs((prev) => {
        const estimated = Math.min(serverProgressRef.current + elapsed, duration);
        return estimated;
      });

      animationCountRef.current += 1;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    frameStartRef.current = 0;
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, duration, getAnimationFrameDelay, refreshPlaybackState]);

  const updateProgress = useCallback((newProgressMs) => {
    serverProgressRef.current = newProgressMs;
    setProgressMs(newProgressMs);
    lastUpdateTimeRef.current = Date.now();
    animationCountRef.current = 0;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying) {
        refreshPlaybackState();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [isPlaying, refreshPlaybackState]);

  return {
    progressMs,
    isPlaying,
    duration,
    trackId,
    progressPercentage: duration > 0 ? (progressMs / duration) * 100 : 0,
    updateProgress
  };
}; 