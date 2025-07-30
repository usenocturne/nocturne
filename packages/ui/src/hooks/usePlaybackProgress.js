import { useState, useEffect, useRef, useCallback } from "react";

const sharedState = {
  refreshTimeoutId: null,
  lastRefreshTime: 0,
};

export const usePlaybackProgress = (
  currentPlayback,
  refreshPlaybackState,
  accessToken,
) => {
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trackId, setTrackId] = useState(null);

  const lastUpdateTimeRef = useRef(Date.now());
  const animationFrameRef = useRef(null);
  const serverProgressRef = useRef(0);
  const frameSkipCounterRef = useRef(0);

  const scheduleNextRefresh = useCallback(() => {
    const REFRESH_INTERVAL = 15000;

    if (sharedState.refreshTimeoutId) {
      clearTimeout(sharedState.refreshTimeoutId);
    }

    sharedState.refreshTimeoutId = setTimeout(() => {
      refreshPlaybackState();
      sharedState.lastRefreshTime = Date.now();
      scheduleNextRefresh();
    }, REFRESH_INTERVAL);
  }, [refreshPlaybackState]);

  const triggerRefresh = useCallback(() => {
    if (sharedState.refreshTimeoutId) {
      clearTimeout(sharedState.refreshTimeoutId);
    }

    refreshPlaybackState();
    sharedState.lastRefreshTime = Date.now();
    scheduleNextRefresh();
  }, [refreshPlaybackState, scheduleNextRefresh]);

  useEffect(() => {
    if (accessToken) {
      const now = Date.now();
      if (
        !sharedState.refreshTimeoutId ||
        now - sharedState.lastRefreshTime > 10000
      ) {
        triggerRefresh();
      }
    }

    return () => {};
  }, [accessToken, triggerRefresh]);

  useEffect(() => {
    if (currentPlayback) {
      if (currentPlayback?.item?.id !== trackId) {
        setTrackId(currentPlayback.item?.id);
        setDuration(currentPlayback.item?.duration_ms || 0);
        serverProgressRef.current = currentPlayback.progress_ms || 0;
        setProgressMs(currentPlayback.progress_ms || 0);
        lastUpdateTimeRef.current = Date.now();
      } else if (typeof currentPlayback?.progress_ms === "number") {
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

    const animate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdateTimeRef.current;
      const estimated = Math.min(serverProgressRef.current + elapsed, duration);
      setProgressMs(estimated);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, duration]);

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
    updateProgress,
    triggerRefresh,
  };
};
