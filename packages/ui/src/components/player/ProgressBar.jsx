import { useState, useEffect, useRef } from "react";
import { useProgressValue } from "../../hooks/usePlaybackProgress";

const SCRUB_TIMEOUT_MS = 3000;

const ProgressBar = ({
  progress,
  isPlaying,
  durationMs,
  onSeek,
  onScrubbingChange,
  updateProgress,
  disabled = false,
  scrubOnWheel = false,
}) => {
  const { progressMs, progressPercentage } = useProgressValue();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubbingProgress, setScrubbingProgress] = useState(null);
  const wasPlayingRef = useRef(false);
  const containerRef = useRef(null);
  const scrubTimeoutRef = useRef(null);
  const hasScrubbedRef = useRef(false);
  const scrubbingProgressRef = useRef(null);
  const durationMsRef = useRef(durationMs);
  const onSeekRef = useRef(onSeek);
  const onScrubbingChangeRef = useRef(onScrubbingChange);
  const updateProgressRef = useRef(updateProgress);

  useEffect(() => {
    durationMsRef.current = durationMs;
    onSeekRef.current = onSeek;
    onScrubbingChangeRef.current = onScrubbingChange;
    updateProgressRef.current = updateProgress;
  }, [durationMs, onSeek, onScrubbingChange, updateProgress]);

  const liveProgress =
    durationMs > 0
      ? Math.min((progressMs / durationMs) * 100, 100)
      : progressPercentage;
  const resolvedProgress = progress === null ? null : liveProgress;
  const effectiveProgress = resolvedProgress ?? 0;
  const isProgressUnknown = resolvedProgress === null;

  const clearScrubTimeout = () => {
    if (scrubTimeoutRef.current) {
      clearTimeout(scrubTimeoutRef.current);
      scrubTimeoutRef.current = null;
    }
  };

  const exitScrubbing = (shouldSeek = false) => {
    clearScrubTimeout();
    setIsScrubbing(false);
    onScrubbingChangeRef.current(false);

    if (shouldSeek && scrubbingProgressRef.current !== null) {
      const seekMs = Math.floor(
        (scrubbingProgressRef.current / 100) * durationMsRef.current,
      );
      onSeekRef.current(seekMs);
      updateProgressRef.current?.(seekMs);
    }

    setScrubbingProgress(null);
    scrubbingProgressRef.current = null;
    hasScrubbedRef.current = false;
  };

  const handleClick = () => {
    if (disabled || isProgressUnknown) return;

    setIsScrubbing(true);
    onScrubbingChange(true);
    wasPlayingRef.current = isPlaying;
    hasScrubbedRef.current = false;
    scrubbingProgressRef.current = null;

    clearScrubTimeout();
    scrubTimeoutRef.current = setTimeout(() => {
      if (!hasScrubbedRef.current) {
        exitScrubbing(false);
      }
    }, SCRUB_TIMEOUT_MS);
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaX;
      const step = 1.5;

      hasScrubbedRef.current = true;

      setScrubbingProgress((prev) => {
        const nextValue =
          (prev ?? effectiveProgress) + (delta > 0 ? step : -step);
        const clampedValue = Math.max(0, Math.min(100, nextValue));
        scrubbingProgressRef.current = clampedValue;

        clearScrubTimeout();
        scrubTimeoutRef.current = setTimeout(() => {
          exitScrubbing(true);
        }, SCRUB_TIMEOUT_MS);

        return clampedValue;
      });
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [isScrubbing, effectiveProgress]);

  useEffect(() => {
    if (!scrubOnWheel || isScrubbing || disabled || isProgressUnknown) return;

    const handleWheelToActivate = (event) => {
      event.preventDefault();
      event.stopPropagation();

      setIsScrubbing(true);
      onScrubbingChangeRef.current(true);
      wasPlayingRef.current = isPlaying;
      hasScrubbedRef.current = true;

      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const step = 1.5;
      const nextValue = effectiveProgress + (delta > 0 ? step : -step);
      const clampedValue = Math.max(0, Math.min(100, nextValue));
      setScrubbingProgress(clampedValue);
      scrubbingProgressRef.current = clampedValue;

      clearScrubTimeout();
      scrubTimeoutRef.current = setTimeout(() => {
        exitScrubbing(true);
      }, SCRUB_TIMEOUT_MS);
    };

    window.addEventListener("wheel", handleWheelToActivate, { passive: false });
    return () => window.removeEventListener("wheel", handleWheelToActivate);
  }, [
    scrubOnWheel,
    isScrubbing,
    disabled,
    isProgressUnknown,
    effectiveProgress,
    isPlaying,
  ]);

  useEffect(() => {
    return () => clearScrubTimeout();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter" && isScrubbing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        exitScrubbing(hasScrubbedRef.current);
        return false;
      } else if (event.key === "Escape" && isScrubbing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        exitScrubbing(false);
        return false;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isScrubbing]);

  const finalProgress = scrubbingProgress ?? effectiveProgress;
  const shouldShowTimestampOutside = finalProgress < 8;

  return (
    <div
      ref={containerRef}
      className={`relative transition-all duration-200 ease-in-out ${
        isScrubbing ? "translate-y-8" : ""
      }`}
    >
      <div
        className={`relative w-full bg-white/20 rounded-full overflow-hidden transition-all duration-300 ${
          isScrubbing ? "h-8" : "h-2 mt-4"
        }`}
        onClick={handleClick}
      >
        <div
          className="absolute inset-0 bg-white flex items-center justify-end transition-transform duration-0 ease-linear"
          style={{
            transform: `translateX(${finalProgress - 100}%)`,
          }}
        />
        {isScrubbing && (
          <div
            className="absolute inset-0 flex items-center"
            style={{
              transform: `translateX(${finalProgress}%)`,
            }}
          >
            <span
              className={`text-lg font-[580] absolute ${
                shouldShowTimestampOutside
                  ? "left-2 text-black/40"
                  : "right-full pr-2 text-black/40"
              }`}
            >
              {formatTime(Math.floor((finalProgress / 100) * durationMs))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default ProgressBar;
