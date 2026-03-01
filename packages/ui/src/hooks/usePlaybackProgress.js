import { useState, useEffect, useRef, useCallback } from "react";
import { consumeProgressResetSignal } from "./useSpotifyPlayerState";

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
  const initialRefreshDoneRef = useRef(false);
  const prevShuffleStateRef = useRef(null);
  const prevRepeatStateRef = useRef(null);
  const anchorPositionRef = useRef(0);
  const anchorTimestampRef = useRef(0);
  const actualPlaybackSpeedRef = useRef(1);
  const durationRef = useRef(0);
  const trackIdRef = useRef(null);

  const triggerRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    refreshPlaybackState();
    lastRefreshTimeRef.current = Date.now();
  }, [refreshPlaybackState]);

  useEffect(() => {
    if (!initialRefreshDoneRef.current) {
      initialRefreshDoneRef.current = true;
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
      const currentShuffle = currentPlayback.shuffle_state;
      const currentRepeat = currentPlayback.repeat_state;
      const shuffleChanged =
        prevShuffleStateRef.current !== null &&
        prevShuffleStateRef.current !== currentShuffle;
      const repeatChanged =
        prevRepeatStateRef.current !== null &&
        prevRepeatStateRef.current !== currentRepeat;
      const shuffleOrRepeatJustChanged = shuffleChanged || repeatChanged;

      prevShuffleStateRef.current = currentShuffle;
      prevRepeatStateRef.current = currentRepeat;

      const updatedDuration = currentPlayback.item?.duration_ms;
      if (updatedDuration && updatedDuration > 0) {
        setDuration(updatedDuration);
        durationRef.current = updatedDuration;
      }

      setIsPlaying(currentPlayback.is_playing || false);

      const newPlaybackSpeed = currentPlayback.playback_speed || 1;
      if (newPlaybackSpeed !== actualPlaybackSpeedRef.current) {
        actualPlaybackSpeedRef.current = newPlaybackSpeed;
      }

      if (currentPlayback?.item?.id !== trackIdRef.current) {
        setTrackId(currentPlayback.item?.id);
        trackIdRef.current = currentPlayback.item?.id;

        const spotifyPosition = currentPlayback.progress_ms || 0;
        const spotifyTimestamp = currentPlayback.timestamp || Date.now();

        anchorPositionRef.current = spotifyPosition;
        anchorTimestampRef.current = spotifyTimestamp;

        const now = Date.now();
        const elapsed = currentPlayback.is_playing
          ? Math.max(0, now - spotifyTimestamp) * newPlaybackSpeed
          : 0;
        const currentPosition = Math.min(
          spotifyPosition + elapsed,
          updatedDuration || Infinity,
        );

        serverProgressRef.current = currentPosition;
        setProgressMs(currentPosition);
        lastUpdateTimeRef.current = performance.now();
        lastFrameTimeRef.current = performance.now();
        frameSkipCounterRef.current = 0;
      } else if (
        typeof currentPlayback?.progress_ms === "number" &&
        currentPlayback.timestamp
      ) {
        const spotifyPosition = currentPlayback.progress_ms;
        const spotifyTimestamp = currentPlayback.timestamp;

        if (spotifyTimestamp > anchorTimestampRef.current) {
          anchorPositionRef.current = spotifyPosition;
          anchorTimestampRef.current = spotifyTimestamp;

          const curDuration = durationRef.current;
          const curProgress = serverProgressRef.current;

          const now = Date.now();
          const elapsed = currentPlayback.is_playing
            ? Math.max(0, now - spotifyTimestamp) * newPlaybackSpeed
            : 0;
          const truthPosition = Math.min(
            spotifyPosition + elapsed,
            curDuration || Infinity,
          );

          const wouldMoveBackwards = truthPosition < curProgress;
          const backwardsAmount = curProgress - truthPosition;
          const isSignificantBackwardsJump = backwardsAmount > 2000;
          const isNearEnd = curDuration > 0 && curProgress > curDuration * 0.98;
          const isVerySmallBackwardsJump = backwardsAmount < 500;

          if (
            wouldMoveBackwards &&
            isSignificantBackwardsJump &&
            !shuffleOrRepeatJustChanged
          ) {
            serverProgressRef.current = truthPosition;
            setProgressMs(truthPosition);
            lastUpdateTimeRef.current = performance.now();
          } else if (
            wouldMoveBackwards &&
            isNearEnd &&
            isVerySmallBackwardsJump
          ) {
          } else {
            serverProgressRef.current = truthPosition;
          }
        }
      }
    }
  }, [currentPlayback]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) return;

    const animate = (timestamp) => {
      const frameTime = timestamp - lastFrameTimeRef.current;
      if (frameTime > 50 && document.visibilityState === "visible") {
        frameSkipCounterRef.current++;
        if (frameSkipCounterRef.current > 5) {
          triggerRefresh();
          frameSkipCounterRef.current = 0;
        }
      } else if (document.visibilityState !== "visible") {
        frameSkipCounterRef.current = 0;
      }
      lastFrameTimeRef.current = timestamp;

      const resetSignal = consumeProgressResetSignal();
      if (resetSignal) {
        anchorPositionRef.current = resetSignal.position;
        anchorTimestampRef.current = resetSignal.timestamp;
        serverProgressRef.current = resetSignal.position;
        setProgressMs(resetSignal.position);
      }

      const now = Date.now();
      const currentSpeed = actualPlaybackSpeedRef.current;
      const elapsedSinceAnchor =
        Math.max(0, now - anchorTimestampRef.current) * currentSpeed;
      const truthPosition = Math.min(
        anchorPositionRef.current + elapsedSinceAnchor,
        duration,
      );

      const elapsedSinceLastFrame = timestamp - lastUpdateTimeRef.current;
      lastUpdateTimeRef.current = timestamp;

      const currentDisplayed = serverProgressRef.current;
      const drift = currentDisplayed - truthPosition;

      let frameSpeed = currentSpeed;
      if (Math.abs(drift) > 50) {
        const correctionFactor = Math.max(-0.05, Math.min(0.05, -drift / 1000));
        frameSpeed = currentSpeed + correctionFactor;
      }

      if (Math.abs(drift) > 2000) {
        serverProgressRef.current = truthPosition;
        setProgressMs(truthPosition);
      } else {
        const newPosition = Math.min(
          currentDisplayed + elapsedSinceLastFrame * frameSpeed,
          duration,
        );
        serverProgressRef.current = newPosition;
        setProgressMs(newPosition);
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
  }, [isPlaying, duration, triggerRefresh]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isPlaying) {
        lastFrameTimeRef.current = performance.now();
        frameSkipCounterRef.current = 0;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isPlaying]);

  const updateProgress = useCallback((newProgressMs) => {
    anchorPositionRef.current = newProgressMs;
    anchorTimestampRef.current = Date.now();

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
