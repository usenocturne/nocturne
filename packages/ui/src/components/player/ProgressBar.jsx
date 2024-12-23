import React, { useState, useEffect, useRef } from "react";

const ProgressBar = ({ progress, isPlaying, durationMs }) => {
  const [interpolatedProgress, setInterpolatedProgress] = useState(progress);
  const lastUpdateTime = useRef(Date.now());
  const animationFrameRef = useRef(null);

  useEffect(() => {
    setInterpolatedProgress(progress);
    lastUpdateTime.current = Date.now();
  }, [progress]);

  useEffect(() => {
    let startTime = Date.now();

    const animate = () => {
      if (!isPlaying || !durationMs) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const currentTime = Date.now();
      const deltaTime = currentTime - startTime;
      startTime = currentTime;
      const progressIncrement = (deltaTime / durationMs) * 100;

      setInterpolatedProgress((prev) => {
        const maxAllowedProgress = progress + 1;
        return Math.min(prev + progressIncrement, maxAllowedProgress);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, progress, durationMs]);

  return (
    <div className="w-full bg-white/20 h-2 rounded-full mt-4 overflow-hidden">
      <div
        className="bg-white h-2 transition-transform duration-0 ease-linear"
        style={{
          width: "100%",
          transform: `translateX(${interpolatedProgress - 100}%)`,
        }}
      />
    </div>
  );
};

export default ProgressBar;
