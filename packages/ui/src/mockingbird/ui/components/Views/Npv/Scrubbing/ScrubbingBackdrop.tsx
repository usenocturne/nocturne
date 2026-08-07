import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./ScrubbingBackdrop.module.scss";
import { SCRUB_SETTLE_TIMEOUT_MS } from "./scrubbingConstants";

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const ScrubbingBackdrop = ({ playbackProgress, onSeek }: UiComponentProps) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.scrubbingUiState;
  const [scrubbingProgress, setScrubbingProgress] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const timeoutRef = useRef(null);
  const scrubbingProgressRef = useRef(null);
  const hasPendingSeekRef = useRef(false);
  const commitQueueRef = useRef(Promise.resolve());
  const onSeekRef = useRef(onSeek);

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  const commitScrub = useCallback(() => {
    if (!hasPendingSeekRef.current) return;

    hasPendingSeekRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const progress = scrubbingProgressRef.current;
    const duration = playbackProgress?.duration;
    const seek = onSeekRef.current;
    if (progress === null || !duration || !seek) {
      uiState.stopScrubbing();
      setScrubbingProgress(null);
      scrubbingProgressRef.current = null;
      return;
    }

    const seekMs = Math.floor(progress * duration);
    const clearCommittedProgress = () => {
      if (scrubbingProgressRef.current === progress) {
        scrubbingProgressRef.current = null;
        setScrubbingProgress((current) =>
          current === progress ? null : current,
        );
      }
    };
    uiState.stopScrubbing();

    if (seekMs >= duration - 1000) {
      clearCommittedProgress();
      const rootStore = window.carThingRootStore;
      rootStore?.npvStore?.npvController?.next?.();
      return;
    }

    const commit = () =>
      Promise.resolve()
        .then(() => seek(seekMs))
        .then((succeeded) => {
          if (succeeded !== false) {
            playbackProgress.updateProgress(seekMs);
          }
          return undefined;
        })
        .finally(clearCommittedProgress);
    commitQueueRef.current = commitQueueRef.current
      .catch(() => undefined)
      .then(commit)
      .catch((error) => {
        console.error("Error committing scrub position:", error);
      });
  }, [playbackProgress?.duration, uiState]);

  const cancelScrub = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    uiState.stopScrubbing();
    setScrubbingProgress(null);
    scrubbingProgressRef.current = null;
    hasPendingSeekRef.current = false;
  }, [uiState]);

  const handleHardwareDial = useCallback(
    (direction) => {
      if (!playbackProgress?.duration) return;
      if (!uiState.isScrubbing) {
        uiState.startScrubbing();
      }
      uiState.resetScrubbingViewTimer();
      hasPendingSeekRef.current = true;
      const fiveSecondsPercent = 5000 / playbackProgress.duration;

      setScrubbingProgress((prev) => {
        const currentPercent =
          prev !== null
            ? prev
            : (playbackProgress?.progressPercentage || 0) / 100;
        const nextValue = Math.max(
          0,
          Math.min(
            1,
            currentPercent +
              (direction === "right"
                ? fiveSecondsPercent
                : -fiveSecondsPercent),
          ),
        );
        scrubbingProgressRef.current = nextValue;
        return nextValue;
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        commitScrub();
      }, SCRUB_SETTLE_TIMEOUT_MS);
    },
    [commitScrub, playbackProgress, uiState],
  );

  const handleTouchMove = useCallback(
    (e) => {
      if (!playbackProgress?.duration) return;
      uiState.resetScrubbingViewTimer();
      const x = e.touches[0].clientX;
      const percent = Math.max(0, Math.min(1, x / 800));
      scrubbingProgressRef.current = percent;
      hasPendingSeekRef.current = true;
      setScrubbingProgress(percent);
    },
    [playbackProgress?.duration, uiState],
  );

  const handleTouchEnd = useCallback(() => {
    commitScrub();
  }, [commitScrub]);

  useEffect(() => {
    if (uiState.isScrubbing) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setTimeout(() => setShouldRender(false), 300);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [uiState.isScrubbing, uiState]);

  useEffect(() => {
    if (!uiState.isScrubbing) return;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaX;
      const step = 1.5;
      hasPendingSeekRef.current = true;
      uiState.resetScrubbingViewTimer();

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        commitScrub();
      }, SCRUB_SETTLE_TIMEOUT_MS);

      setScrubbingProgress((prev) => {
        const currentPercent =
          prev !== null
            ? prev
            : (playbackProgress?.progressPercentage || 0) / 100;
        const nextValue =
          currentPercent + (delta > 0 ? step / 100 : -step / 100);
        const clampedValue = Math.max(0, Math.min(1, nextValue));
        scrubbingProgressRef.current = clampedValue;
        return clampedValue;
      });
    };

    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitScrub();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelScrub();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });

      if (typeof window !== "undefined") {
        window.scrubbingCommit = null;
      }
    };
  }, [
    uiState.isScrubbing,
    playbackProgress?.progressPercentage,
    playbackProgress?.duration,
    handleTouchEnd,
    commitScrub,
    cancelScrub,
    uiState,
  ]);

  useEffect(() => {
    window.scrubbingHardwareDialHandler = handleHardwareDial;
    return () => {
      if (window.scrubbingHardwareDialHandler === handleHardwareDial) {
        window.scrubbingHardwareDialHandler = null;
      }
    };
  }, [handleHardwareDial]);

  useEffect(() => {
    if (typeof window !== "undefined" && uiState.isScrubbing) {
      window.scrubbingCommit = commitScrub;
    }

    return () => {
      if (
        typeof window !== "undefined" &&
        window.scrubbingCommit === commitScrub
      ) {
        window.scrubbingCommit = null;
      }
    };
  }, [commitScrub, uiState.isScrubbing]);

  if (!shouldRender) {
    return null;
  }

  const currentProgress =
    scrubbingProgress !== null
      ? scrubbingProgress
      : (playbackProgress?.progressPercentage || 0) / 100;
  const durationMs = playbackProgress?.duration || 0;
  const currentSeconds = Math.floor((currentProgress * durationMs) / 1000);
  const totalSeconds = Math.floor(durationMs / 1000);
  const currentMs = currentSeconds * 1000;
  const remainingMs = (totalSeconds - currentSeconds) * 1000;

  return (
    <div
      data-testid="scrubbing-backdrop-area"
      className={`${styles.scrubbingBackdrop} ${isVisible ? styles.visible : styles.hidden}`}
      onClick={cancelScrub}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={styles.time}>
        <span className={styles.start}>{formatTime(currentMs)}</span>
        <span className={styles.end}>- {formatTime(remainingMs)}</span>
      </div>
    </div>
  );
};

export default observer(ScrubbingBackdrop);
