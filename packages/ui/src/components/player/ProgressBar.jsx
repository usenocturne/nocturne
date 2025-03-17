import React, { useState, useEffect, useRef } from "react";
import { usePlaybackProgressConsumer } from "../../hooks/usePlaybackProgress";

const ProgressBar = ({
  progress: externalProgress,
  isPlaying: externalIsPlaying,
  durationMs: externalDurationMs,
  onSeek,
  onPlayPause,
  onScrubbingChange,
}) => {
  const progressContext = usePlaybackProgressConsumer();

  const progress = externalProgress ?? progressContext.progressPercentage;
  const isPlaying = externalIsPlaying ?? progressContext.isPlaying;
  const durationMs = externalDurationMs ?? progressContext.duration;

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubbingProgress, setScrubbingProgress] = useState(null);
  const wasPlayingRef = useRef(false);
  const containerRef = useRef(null);

  const handleClick = () => {
    setIsScrubbing(true);
    onScrubbingChange(true);
    wasPlayingRef.current = isPlaying;
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaX;
      const step = 0.5;

      setScrubbingProgress((prev) => {
        const nextValue =
          (prev ?? progress) + (delta > 0 ? step : -step);
        return Math.max(0, Math.min(100, nextValue));
      });
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [isScrubbing, progress]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter" && isScrubbing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        setIsScrubbing(false);
        onScrubbingChange(false);

        if (scrubbingProgress !== null) {
          const seekMs = Math.floor((scrubbingProgress / 100) * durationMs);
          onSeek(seekMs);
          if (progressContext.updateProgress) {
            progressContext.updateProgress(seekMs);
          }
        }

        setScrubbingProgress(null);
        return false;
      } else if (event.key === "Escape" && isScrubbing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setIsScrubbing(false);
        onScrubbingChange(false);
        setScrubbingProgress(null);
        return false;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    isScrubbing,
    scrubbingProgress,
    durationMs,
    onSeek,
    onPlayPause,
    onScrubbingChange,
    progressContext,
  ]);

  const finalProgress = scrubbingProgress ?? progress;
  const shouldShowTimestampOutside = finalProgress < 8;

  return (
    <div
      ref={containerRef}
      className={`relative transition-all duration-200 ease-in-out ${isScrubbing ? "translate-y-8" : ""
        }`}
    >
      <div
        className={`relative w-full bg-white/20 rounded-full overflow-hidden cursor-pointer transition-all duration-300 ${isScrubbing ? "h-8" : "h-2 mt-4"
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
              className={`text-lg font-[580] absolute ${shouldShowTimestampOutside
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
