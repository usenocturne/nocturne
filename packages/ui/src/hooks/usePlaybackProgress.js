import { useState, useEffect, useRef, useCallback } from "react";

export const usePlaybackProgress = (currentPlayback, refreshPlaybackState) => {
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trackId, setTrackId] = useState(null);

  const lastUpdateTimeRef = useRef(Date.now());
  const animationFrameRef = useRef(null);
  const serverProgressRef = useRef(0);
  const frameSkipCounterRef = useRef(0);
  const refreshTimeoutRef = useRef(null);
  const lastRefreshTimeRef = useRef(0);
  const driftHistoryRef = useRef([]);
  const maxDriftHistory = 10;

  const scheduleNextRefresh = useCallback(() => {
    const REFRESH_INTERVAL = 15000;

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
      console.log('🔄 Periodic refresh triggered (every 15s)');
      refreshPlaybackState();
      lastRefreshTimeRef.current = Date.now();
      scheduleNextRefresh();
    }, REFRESH_INTERVAL);
  }, [refreshPlaybackState]);

  const triggerRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshPlaybackState();
    lastRefreshTimeRef.current = Date.now();
    scheduleNextRefresh();
  }, [refreshPlaybackState, scheduleNextRefresh]);

  useEffect(() => {
    const now = Date.now();
    if (
      !refreshTimeoutRef.current ||
      now - lastRefreshTimeRef.current > 10000
    ) {
      triggerRefresh();
    }

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [triggerRefresh]);

  useEffect(() => {
    if (currentPlayback) {
      if (currentPlayback?.item?.id !== trackId) {
        setTrackId(currentPlayback.item?.id);
        setDuration(currentPlayback.item?.duration_ms || 0);
        serverProgressRef.current = currentPlayback.progress_ms || 0;
        setProgressMs(currentPlayback.progress_ms || 0);
        lastUpdateTimeRef.current = Date.now();
        driftHistoryRef.current = [];
      } else if (typeof currentPlayback?.progress_ms === "number") {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;
        const estimatedProgress = serverProgressRef.current + elapsed;
        const actualProgress = currentPlayback.progress_ms;
        const drift = estimatedProgress - actualProgress;

        if (elapsed > 1000 && Math.abs(drift) < 10000) {
          driftHistoryRef.current.push(drift);
          if (driftHistoryRef.current.length > maxDriftHistory) {
            driftHistoryRef.current.shift();
          }
        }

        serverProgressRef.current = currentPlayback.progress_ms;
        setProgressMs(currentPlayback.progress_ms);
        lastUpdateTimeRef.current = now;
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

      let driftCorrectionFactor = 0.98;
      if (driftHistoryRef.current.length >= 3) {
        const averageDrift =
          driftHistoryRef.current.reduce((sum, drift) => sum + drift, 0) /
          driftHistoryRef.current.length;
        if (averageDrift > 100) {
          driftCorrectionFactor = 0.96;
        } else if (averageDrift > 50) {
          driftCorrectionFactor = 0.97;
        } else if (averageDrift < -50) {
          driftCorrectionFactor = 1.01;
        } else {
          driftCorrectionFactor = 0.98;
        }
      }

      const correctedElapsed = elapsed * driftCorrectionFactor;
      const estimated = Math.min(
        serverProgressRef.current + correctedElapsed,
        duration,
      );

      if (estimated > duration * 0.98) {
        const remaining = duration - serverProgressRef.current;
        const safeProgression = remaining * 0.1;
        const safeEstimated = Math.min(
          serverProgressRef.current + safeProgression,
          duration,
        );
        setProgressMs(safeEstimated);
      } else {
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
