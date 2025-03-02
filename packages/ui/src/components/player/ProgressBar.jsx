import React, { useState, useEffect, useRef } from "react";

const ProgressBar = ({
  progress,
  isPlaying,
  durationMs,
  onSeek,
  onPlayPause,
  onScrubbingChange,
  accessToken,
  onProgressUpdate,
}) => {
  const [displayProgress, setDisplayProgress] = useState(progress);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubbingProgress, setScrubbingProgress] = useState(null);
  const animationFrameRef = useRef(null);
  const wasPlayingRef = useRef(false);
  const containerRef = useRef(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    if (onProgressUpdate) {
      onProgressUpdate(scrubbingProgress ?? displayProgress);
    }
  }, [displayProgress, scrubbingProgress, onProgressUpdate]);

  useEffect(() => {
    const fetchCurrentPosition = async () => {
      if (!accessToken || !durationMs) return;

      try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.status === 204) {
          return;
        }

        if (response.ok) {
          const data = await response.json();
          if (data && data.progress_ms) {
            const accurateProgress = (data.progress_ms / durationMs) * 100;
            setDisplayProgress(accurateProgress);
          }
        }
      } catch (error) {
        console.error("Error fetching current playback:", error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchCurrentPosition();
      }
    };

    if (!isMountedRef.current) {
      fetchCurrentPosition();
      isMountedRef.current = true;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accessToken, durationMs]);

  useEffect(() => {
    if (!isScrubbing && progress !== null) {
      setDisplayProgress(progress);
    }
  }, [progress, isScrubbing]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (isPlaying && !isScrubbing && durationMs > 0) {
      let lastTimestamp = performance.now();

      const animate = (timestamp) => {
        if (!isPlaying || !durationMs || isScrubbing) {
          return;
        }

        const deltaTime = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        const progressIncrement = (deltaTime / durationMs) * 100;

        setDisplayProgress((prevProgress) => {
          return Math.min(prevProgress + progressIncrement, 100);
        });

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isScrubbing, durationMs]);

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
          (prev ?? displayProgress) + (delta > 0 ? step : -step);
        return Math.max(0, Math.min(100, nextValue));
      });
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [isScrubbing, displayProgress]);

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
          setDisplayProgress(scrubbingProgress);
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
        setDisplayProgress(progress);
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
    progress,
  ]);

  const finalProgress = scrubbingProgress ?? displayProgress;
  const shouldShowTimestampOutside = finalProgress < 8;

  return (
    <div
      ref={containerRef}
      className={`relative transition-all duration-200 ease-in-out ${
        isScrubbing ? "translate-y-8" : ""
      }`}
    >
      <div
        className={`relative w-full bg-white/20 rounded-full overflow-hidden cursor-pointer transition-all duration-300 ${
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
