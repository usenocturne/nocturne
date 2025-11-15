import { useState, useEffect, useRef, useCallback } from "react";

export const usePlaybackProgress = (currentPlayback, refreshPlaybackState) => {
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trackId, setTrackId] = useState(null);

  const lastUpdateTimeRef = useRef(performance.now());
  const animationFrameRef = useRef(null);
  const serverProgressRef = useRef(0);
  const frameSkipCounterRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const refreshTimeoutRef = useRef(null);
  const lastRefreshTimeRef = useRef(0);
  const driftHistoryRef = useRef([]);
  const maxDriftHistory = 30;
  const initialRefreshDoneRef = useRef(false);
  const estimatedLatencyRef = useRef(0);
  const latencyHistoryRef = useRef([]);
  const maxLatencyHistory = 10;

  const scheduleNextRefresh = useCallback(() => {
    const REFRESH_INTERVAL = 8000;

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
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
      !initialRefreshDoneRef.current &&
      (!refreshTimeoutRef.current || now - lastRefreshTimeRef.current > 10000)
    ) {
      initialRefreshDoneRef.current = true;
      triggerRefresh();
    } else if (isPlaying && !refreshTimeoutRef.current) {
      scheduleNextRefresh();
    }

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [triggerRefresh, scheduleNextRefresh, isPlaying]);

  useEffect(() => {
    if (currentPlayback) {
      if (currentPlayback?.item?.id !== trackId) {
        setTrackId(currentPlayback.item?.id);
        setDuration(currentPlayback.item?.duration_ms || 0);
        serverProgressRef.current = currentPlayback.progress_ms || 0;
        setProgressMs(currentPlayback.progress_ms || 0);
        lastUpdateTimeRef.current = performance.now();
        lastFrameTimeRef.current = performance.now();
        frameSkipCounterRef.current = 0;
        driftHistoryRef.current = [];
        latencyHistoryRef.current = [];
        estimatedLatencyRef.current = 0;

        if (!refreshTimeoutRef.current && currentPlayback.is_playing) {
          scheduleNextRefresh();
        }
      } else if (typeof currentPlayback?.progress_ms === "number") {
        const now = performance.now();
        const elapsed = now - lastUpdateTimeRef.current;
        const estimatedProgress = serverProgressRef.current + elapsed;
        const actualProgress = currentPlayback.progress_ms;

        if (isPlaying && elapsed > 500) {
          const impliedLatency = Math.max(0, estimatedProgress - actualProgress);
          if (impliedLatency < 1000) {
            latencyHistoryRef.current.push(impliedLatency);
            if (latencyHistoryRef.current.length > maxLatencyHistory) {
              latencyHistoryRef.current.shift();
            }
            if (latencyHistoryRef.current.length > 0) {
              estimatedLatencyRef.current =
                latencyHistoryRef.current.reduce((sum, l) => sum + l, 0) /
                latencyHistoryRef.current.length;
            }
          }
        }

        const compensatedProgress = actualProgress + Math.min(estimatedLatencyRef.current * 0.3, 200);
        const drift = estimatedProgress - compensatedProgress;

        if (elapsed > 1000 && Math.abs(drift) < 5000) {
          driftHistoryRef.current.push(drift);
          if (driftHistoryRef.current.length > maxDriftHistory) {
            driftHistoryRef.current.shift();
          }
        }

        const wouldMoveBackwards = compensatedProgress < progressMs;
        const backwardsAmount = progressMs - compensatedProgress;
        const isNearEnd = duration > 0 && progressMs > duration * 0.98;
        const isVerySmallBackwardsJump = backwardsAmount < 500;

        if (wouldMoveBackwards && isNearEnd && isVerySmallBackwardsJump) {
          return;
        }

        serverProgressRef.current = compensatedProgress;
        setProgressMs(compensatedProgress);
        lastUpdateTimeRef.current = now;
      }

      setIsPlaying(currentPlayback.is_playing || false);
      setDuration(currentPlayback.item?.duration_ms || 0);
    }
  }, [currentPlayback, trackId, scheduleNextRefresh]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) return;

    const animate = (timestamp) => {
      const elapsed = timestamp - lastUpdateTimeRef.current;

      const frameTime = timestamp - lastFrameTimeRef.current;
      if (frameTime > 50) {
        frameSkipCounterRef.current++;
        if (frameSkipCounterRef.current > 5) {
          triggerRefresh();
          frameSkipCounterRef.current = 0;
        }
      }
      lastFrameTimeRef.current = timestamp;

      let driftCorrectionFactor = 0.99;
      if (driftHistoryRef.current.length >= 1) {
        const averageDrift =
          driftHistoryRef.current.reduce((sum, drift) => sum + drift, 0) /
          driftHistoryRef.current.length;

        const driftInfluence = Math.max(-0.04, Math.min(0.04, averageDrift / 3000));
        driftCorrectionFactor = 0.99 + driftInfluence;

        if (Math.abs(averageDrift) < 30) {
          driftCorrectionFactor = 0.99;
        }
      }

      const correctedElapsed = elapsed * driftCorrectionFactor;
      const estimated = Math.min(
        serverProgressRef.current + correctedElapsed,
        duration,
      );

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

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isPlaying) {
        lastUpdateTimeRef.current = performance.now();
        lastFrameTimeRef.current = performance.now();
        frameSkipCounterRef.current = 0;
        triggerRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isPlaying, triggerRefresh]);

  const updateProgress = useCallback((newProgressMs) => {
    serverProgressRef.current = newProgressMs;
    setProgressMs(newProgressMs);
    lastUpdateTimeRef.current = performance.now();
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
