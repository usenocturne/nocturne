import { useState, useEffect, useRef, useCallback } from "react";
import { consumeProgressResetSignal } from "./useSpotifyPlayerState";
import type { PlaybackProgress, SpotifyPlayback } from "../types";

type ProgressSnapshot = PlaybackProgress;
type ProgressSubscriber = (snapshot: ProgressSnapshot) => void;
type ProgressResetSignal = {
  position?: number;
  progressMs?: number;
  timestamp?: number;
  at?: number;
};

let _progressMs = 0;
let _isPlaying = false;
let _duration = 0;
let _trackId: string | null = null;
let _progressPercentage = 0;
let _rafHandle: number | null = null;
const _subscribers = new Set<ProgressSubscriber>();

let _anchorMs = 0;
let _anchorTimestamp = 0;

let _serverProgressMs = 0;
let _lastUpdateTime = performance.now();
let _playbackSpeed = 1;
let _shuffleOrRepeatJustChanged = false;

const updateProgressPercentage = () => {
  _progressPercentage = _duration > 0 ? (_progressMs / _duration) * 100 : 0;
};

const notifySubscribers = () => {
  const snapshot = getProgressSnapshot();
  _subscribers.forEach((listener) => listener(snapshot));
  return snapshot;
};

const publishProgress = () => {
  updateProgressPercentage();
  return notifySubscribers();
};

const stopAnimationLoop = () => {
  if (_rafHandle) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }
};

const animate = (timestamp: number) => {
  if (!_isPlaying || _duration <= 0) {
    _rafHandle = null;
    return;
  }

  const resetSignal = consumeProgressResetSignal();
  if (resetSignal) {
    const position = resetSignal.position ?? resetSignal.progressMs ?? 0;
    const timestamp = resetSignal.timestamp ?? resetSignal.at ?? Date.now();
    _anchorMs = position;
    _anchorTimestamp = timestamp;
    _serverProgressMs = position;
    _progressMs = position;
  }

  const now = Date.now();
  const elapsedSinceAnchor =
    Math.max(0, now - _anchorTimestamp) * _playbackSpeed;
  const truthPosition = Math.min(_anchorMs + elapsedSinceAnchor, _duration);

  const elapsedSinceLastFrame = timestamp - _lastUpdateTime;
  _lastUpdateTime = timestamp;

  const currentDisplayed = _serverProgressMs;
  const drift = currentDisplayed - truthPosition;

  let frameSpeed = _playbackSpeed;
  if (Math.abs(drift) > 50) {
    const correctionFactor = Math.max(-0.05, Math.min(0.05, -drift / 1000));
    frameSpeed = _playbackSpeed + correctionFactor;
  }

  if (Math.abs(drift) > 2000) {
    _serverProgressMs = truthPosition;
    _progressMs = truthPosition;
  } else {
    const newPosition = Math.min(
      currentDisplayed + elapsedSinceLastFrame * frameSpeed,
      _duration,
    );
    _serverProgressMs = newPosition;
    _progressMs = newPosition;
  }

  publishProgress();
  _rafHandle = requestAnimationFrame(animate);
};

const ensureAnimationLoop = () => {
  if (_rafHandle || !_isPlaying || _duration <= 0) return;
  _rafHandle = requestAnimationFrame(animate);
};

export function subscribeProgress(listener: ProgressSubscriber) {
  _subscribers.add(listener);
  return () => _subscribers.delete(listener);
}

export function getProgressSnapshot(): ProgressSnapshot {
  return {
    progressMs: _progressMs,
    isPlaying: _isPlaying,
    duration: _duration,
    durationMs: _duration,
    trackId: _trackId,
    progressPercentage: _progressPercentage,
  };
}

export function usePlaybackProgress(
  currentPlayback: SpotifyPlayback | null,
  refreshPlaybackState: () => void | Promise<void>,
): PlaybackProgress {
  const [snapshot, setSnapshot] = useState(getProgressSnapshot);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshTimeRef = useRef(0);
  const initialRefreshDoneRef = useRef(false);
  const prevShuffleStateRef = useRef<unknown>(null);
  const prevRepeatStateRef = useRef<unknown>(null);
  const trackIdRef = useRef<string | null>(null);
  const wasAnimatingRef = useRef(false);
  const REFRESH_INTERVAL_MS = 15000;

  const scheduleNextRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshPlaybackState();
      lastRefreshTimeRef.current = Date.now();
      scheduleNextRefresh();
    }, REFRESH_INTERVAL_MS);
  }, [refreshPlaybackState]);

  const triggerRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    refreshPlaybackState();
    lastRefreshTimeRef.current = Date.now();
    scheduleNextRefresh();
  }, [refreshPlaybackState, scheduleNextRefresh]);

  useEffect(() => {
    if (!initialRefreshDoneRef.current) {
      initialRefreshDoneRef.current = true;
      triggerRefresh();
    } else if (!refreshTimeoutRef.current) {
      scheduleNextRefresh();
    }

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [triggerRefresh, scheduleNextRefresh]);

  useEffect(() => {
    const id = setInterval(() => {
      if (_isPlaying) {
        setSnapshot(getProgressSnapshot());
      }
    }, 100);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!currentPlayback) return;

    const currentShuffle = currentPlayback.shuffle_state;
    const currentRepeat = currentPlayback.repeat_state;
    const shuffleChanged =
      prevShuffleStateRef.current !== null &&
      prevShuffleStateRef.current !== currentShuffle;
    const repeatChanged =
      prevRepeatStateRef.current !== null &&
      prevRepeatStateRef.current !== currentRepeat;
    const shuffleOrRepeatJustChanged = shuffleChanged || repeatChanged;

    _shuffleOrRepeatJustChanged = shuffleOrRepeatJustChanged;
    prevShuffleStateRef.current = currentShuffle;
    prevRepeatStateRef.current = currentRepeat;

    const updatedDuration = currentPlayback.item?.duration_ms;
    if (updatedDuration && updatedDuration > 0) {
      _duration = updatedDuration;
    }

    _isPlaying = currentPlayback.is_playing || false;

    const newPlaybackSpeed = currentPlayback.playback_speed || 1;
    if (newPlaybackSpeed !== _playbackSpeed) {
      _playbackSpeed = newPlaybackSpeed;
    }

    if (currentPlayback?.item?.id !== trackIdRef.current) {
      _trackId = currentPlayback.item?.id;
      trackIdRef.current = currentPlayback.item?.id;

      const spotifyPosition = currentPlayback.progress_ms || 0;
      const spotifyTimestamp = currentPlayback.timestamp || Date.now();

      _anchorMs = spotifyPosition;
      _anchorTimestamp = spotifyTimestamp;

      const now = Date.now();
      const elapsed = currentPlayback.is_playing
        ? Math.max(0, now - spotifyTimestamp) * newPlaybackSpeed
        : 0;
      const currentPosition = Math.min(
        spotifyPosition + elapsed,
        updatedDuration || Infinity,
      );

      _serverProgressMs = currentPosition;
      _progressMs = currentPosition;
      _lastUpdateTime = performance.now();
    } else if (
      typeof currentPlayback?.progress_ms === "number" &&
      currentPlayback.timestamp
    ) {
      const spotifyPosition = currentPlayback.progress_ms;
      const spotifyTimestamp = currentPlayback.timestamp;

      if (spotifyTimestamp > _anchorTimestamp) {
        _anchorMs = spotifyPosition;
        _anchorTimestamp = spotifyTimestamp;

        const curDuration = _duration;
        const curProgress = _serverProgressMs;

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
          !_shuffleOrRepeatJustChanged
        ) {
          _serverProgressMs = truthPosition;
          _progressMs = truthPosition;
          _lastUpdateTime = performance.now();
        } else if (
          wouldMoveBackwards &&
          isNearEnd &&
          isVerySmallBackwardsJump
        ) {
        } else {
          _serverProgressMs = truthPosition;
        }
      }
    }

    const shouldAnimate = _isPlaying && _duration > 0;
    if (shouldAnimate && !wasAnimatingRef.current) {
      _lastUpdateTime = performance.now();
    }

    wasAnimatingRef.current = shouldAnimate;

    if (shouldAnimate) {
      ensureAnimationLoop();
    } else {
      stopAnimationLoop();
    }

    setSnapshot(publishProgress());
  }, [currentPlayback]);

  const updateProgress = useCallback((newProgressMs: number) => {
    _anchorMs = newProgressMs;
    _anchorTimestamp = Date.now();

    _serverProgressMs = newProgressMs;
    _progressMs = newProgressMs;
    _lastUpdateTime = performance.now();

    setSnapshot(publishProgress());
  }, []);

  return {
    progressMs: snapshot.progressMs,
    isPlaying: snapshot.isPlaying,
    duration: snapshot.duration,
    trackId: snapshot.trackId,
    progressPercentage: snapshot.progressPercentage,
    updateProgress,
    triggerRefresh,
  };
}

export function useProgressValue() {
  const [progress, setProgress] = useState(getProgressSnapshot);

  useEffect(() => {
    return subscribeProgress(setProgress);
  }, []);

  return progress;
}
