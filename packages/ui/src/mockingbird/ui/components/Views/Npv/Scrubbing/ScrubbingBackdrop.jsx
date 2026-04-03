import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { useState, useCallback, useEffect, useRef } from 'react';
import styles from './ScrubbingBackdrop.module.scss';

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const ScrubbingBackdrop = ({ playbackProgress, onSeek }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.scrubbingUiState;
  const [scrubbingProgress, setScrubbingProgress] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const timeoutRef = useRef(null);

  const handleTouchMove = useCallback((e) => {
    if (!playbackProgress?.duration) return;
    window.scrubbingTimeoutShouldSeek = false;
    uiState.resetScrubbingViewTimer();
    const x = e.touches[0].clientX;
    const percent = Math.max(0, Math.min(1, x / 800));
    setScrubbingProgress(percent);
  }, [playbackProgress?.duration, uiState]);

  const handleTouchEnd = useCallback(() => {
    if (scrubbingProgress !== null && playbackProgress?.duration && onSeek) {
      const seekMs = Math.floor(scrubbingProgress * playbackProgress.duration);
      if (seekMs >= playbackProgress.duration - 1000) {
        
        const rootStore = window.carThingRootStore;
        rootStore?.npvStore?.npvController?.next?.();
      } else {
        onSeek(seekMs);
      }
    }
    uiState.stopScrubbing();
    setScrubbingProgress(null);
  }, [scrubbingProgress, playbackProgress?.duration, onSeek, uiState]);

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

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        if (scrubbingProgress !== null && playbackProgress?.duration && onSeek) {
          const seekMs = Math.floor(scrubbingProgress * playbackProgress.duration);
          if (seekMs >= playbackProgress.duration - 1000) {
            const rootStore = window.carThingRootStore;
            rootStore?.npvStore?.npvController?.next?.();
          } else {
            onSeek(seekMs);
          }
        }
        uiState.stopScrubbing();
        setScrubbingProgress(null);
      }, 3000);

      setScrubbingProgress((prev) => {
        const currentPercent = prev !== null ? prev : (playbackProgress?.progressPercentage || 0) / 100;
        const nextValue = currentPercent + (delta > 0 ? step / 100 : -step / 100);
        return Math.max(0, Math.min(1, nextValue));
      });
    };

    const handleHardwareDial = (direction) => {
      if (!playbackProgress?.duration) return;
      window.scrubbingTimeoutShouldSeek = true;
      window.scrubbingOnSeek = onSeek;
      window.scrubbingPlaybackProgress = playbackProgress;
      uiState.resetScrubbingViewTimer();
      const fiveSecondsPercent = 5000 / playbackProgress.duration;

      setScrubbingProgress((prev) => {
        const currentPercent = prev !== null ? prev : (playbackProgress?.progressPercentage || 0) / 100;
        const nextValue = Math.max(0, Math.min(1, currentPercent + (direction === 'right' ? fiveSecondsPercent : -fiveSecondsPercent)));
        window.scrubbingProgressValue = nextValue;
        return nextValue;
      });
    };

    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        handleTouchEnd();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        uiState.stopScrubbing();
        setScrubbingProgress(null);
      }
    };

    if (typeof window !== 'undefined') {
      window.scrubbingHardwareDialHandler = handleHardwareDial;
    }

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });

      if (typeof window !== 'undefined') {
        window.scrubbingHardwareDialHandler = null;
      }
    };
  }, [uiState.isScrubbing, playbackProgress?.progressPercentage, playbackProgress?.duration, handleTouchEnd, uiState]);

  if (!shouldRender) {
    return null;
  }

  const currentProgress = scrubbingProgress !== null ? scrubbingProgress : (playbackProgress?.progressPercentage || 0) / 100;
  const durationMs = playbackProgress?.duration || 0;
  const currentSeconds = Math.floor((currentProgress * durationMs) / 1000);
  const totalSeconds = Math.floor(durationMs / 1000);
  const currentMs = currentSeconds * 1000;
  const remainingMs = (totalSeconds - currentSeconds) * 1000;

  return (
    <div
      data-testid="scrubbing-backdrop-area"
      className={`${styles.scrubbingBackdrop} ${isVisible ? styles.visible : styles.hidden}`}
      onClick={() => uiState.stopScrubbing()}
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
