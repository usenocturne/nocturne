import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import PowerIcon from "../icons/PowerIcon";
import RefreshIcon from "../icons/RefreshIcon";
import BrightnessMidIcon from "../icons/BrightnessMidIcon";
import BrightnessLowIcon from "../icons/BrightnessLowIcon";
import BrightnessHighIcon from "../icons/BrightnessHighIcon";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPositionValue(clientX, trackRect, min, max) {
  const ratio = clamp((clientX - trackRect.left) / trackRect.width, 0, 1);
  const rawValue = min + ratio * (max - min);
  return Math.round(rawValue);
}

function RangeSlider({
  min = 0,
  max = 100,
  value = 0,
  disabled = false,
  onChange,
  className = "",
  trackStyle = {},
  thumbClassName = "",
}) {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const percentage = useMemo(() => {
    if (max === min) return 0;
    return ((clamp(value, min, max) - min) / (max - min)) * 100;
  }, [value, min, max]);

  const startDraggingAt = useCallback(
    (clientX) => {
      if (disabled) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const newValue = getPositionValue(clientX, rect, min, max);
      onChange?.(newValue);
      setIsDragging(true);
    },
    [disabled, min, max, onChange]
  );

  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      startDraggingAt(e.clientX);
    },
    [startDraggingAt]
  );

  const handleTouchStart = useCallback(
    (e) => {
      if (e.touches && e.touches[0]) {
        startDraggingAt(e.touches[0].clientX);
      }
    },
    [startDraggingAt]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const newValue = getPositionValue(e.clientX, rect, min, max);
      onChange?.(newValue);
    };

    const handleTouchMove = (e) => {
      if (!e.touches || !e.touches[0]) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const newValue = getPositionValue(e.touches[0].clientX, rect, min, max);
      onChange?.(newValue);
    };

    const stopDragging = () => setIsDragging(false);

    document.addEventListener("mousemove", handleMouseMove, { passive: false });
    document.addEventListener("mouseup", stopDragging);
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", stopDragging);
    document.addEventListener("touchcancel", stopDragging);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopDragging);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", stopDragging);
      document.removeEventListener("touchcancel", stopDragging);
    };
  }, [isDragging, min, max, onChange]);

  return (
    <div
      ref={trackRef}
      className={`relative h-2 rounded-lg bg-neutral-700 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      style={trackStyle}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-lg bg-white"
        style={{ width: `${percentage}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full bg-white ${disabled ? "pointer-events-none" : ""} ${thumbClassName}`}
        style={{ left: `calc(${percentage}% + 0px)` }}
      />
    </div>
  );
}

function PowerMenuOverlay({
  show,
  onShutdown,
  onReboot,
  onClose,
  onBrightnessToggle,
}) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [brightnessToggled, setBrightnessToggled] = useState(false);
  const [brightnessValue, setBrightnessValue] = useState(180);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
      const t = setTimeout(() => setIsVisible(true), 10);

      fetch("http://localhost:5000/device/brightness")
        .then((response) => response.json())
        .then((data) => {
          setBrightnessToggled(data.auto);
          setBrightnessValue(data.brightness);
        })
        .catch((error) => {
          console.error("Failed to fetch brightness state:", error);
        });

      return () => clearTimeout(t);
    } else {
      setIsVisible(false);
      const t = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(t);
    }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [show, onClose]);

  useEffect(() => {
    if (show) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    } else {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, [show]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ease-in-out ${isVisible ? "opacity-100" : "opacity-0"}`}
      onClick={() => onClose?.()}
    >
      <div className="absolute inset-0 bg-black/80" />
      <div
        className="relative bg-neutral-900/90 rounded-2xl px-8 py-6 flex flex-col items-center space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex space-x-8">
          <button
            onClick={onShutdown}
            className="w-24 h-24 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-700 transition-colors focus:outline-none"
          >
            <PowerIcon className="w-10 h-10 text-white" />
          </button>
          <button
            onClick={onReboot}
            className="w-24 h-24 rounded-full bg-neutral-700 flex items-center justify-center hover:bg-neutral-600 transition-colors focus:outline-none"
          >
            <RefreshIcon className="w-10 h-10 text-white" />
          </button>
          <button
            onClick={() => {
              const newToggleState = !brightnessToggled;
              setBrightnessToggled(newToggleState);
              onBrightnessToggle?.(newToggleState);

              fetch("http://localhost:5000/device/brightness/auto", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ enabled: newToggleState }),
              }).catch((error) => {
                console.error("Failed to toggle auto brightness:", error);
              });
            }}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-0 ${
              brightnessToggled
                ? "bg-white hover:bg-gray-100"
                : "bg-neutral-700 hover:bg-neutral-600"
            }`}
          >
            <BrightnessMidIcon
              className={`w-10 h-10 ${brightnessToggled ? "text-black" : "text-white"}`}
            />
          </button>
        </div>

        <div className="flex items-center space-x-4 w-full max-w-sm">
          <BrightnessLowIcon className="w-8 h-8 text-white flex-shrink-0" />
          <div className="flex-1 relative">
            <RangeSlider
              min={1}
              max={220}
              value={221 - brightnessValue}
              disabled={brightnessToggled}
              onChange={(sliderPos) => {
                const newValue = 221 - sliderPos;
                setBrightnessValue(newValue);
                fetch(`http://localhost:5000/device/brightness/${newValue}`, {
                  method: "POST",
                }).catch((error) => {
                  console.error("Failed to set brightness:", error);
                });
              }}
            />
          </div>
          <BrightnessHighIcon className="w-8 h-8 text-white flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

export default PowerMenuOverlay;
