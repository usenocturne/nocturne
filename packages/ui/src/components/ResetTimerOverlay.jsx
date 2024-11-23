import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

const ResetTimerOverlay = ({ duration, startTime, onCancel }) => {
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);
    }, 16);

    return () => clearInterval(interval);
  }, [duration, startTime]);

  const secondsLeft = Math.ceil(
    (duration - (progress / 100) * duration) / 1000
  );

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onCancel?.();
    }, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isVisible && !isExiting ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 transition-all duration-300 ${
          isVisible && !isExiting
            ? "-translate-y-1/2 opacity-100"
            : isExiting
            ? "translate-y-[10%] opacity-0"
            : "translate-y-[10%] opacity-0"
        }`}
      >
        <div className="relative bg-black/90 p-8 rounded-3xl shadow-2xl min-w-[400px] border border-white/10">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
          <div className="flex flex-col items-center space-y-8">
            <div>
              <h2 className="text-white text-2xl text-center">
                Reset Application
              </h2>
              <p className="text-white/50 text-lg text-center mt-2">
                Hold the buttons for {secondsLeft} seconds to reset
              </p>
            </div>
            <div className="w-full h-4 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-75 ease-linear rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetTimerOverlay;
