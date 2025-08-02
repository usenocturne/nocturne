import React, { useEffect, useState } from "react";
import PowerIcon from "../icons/PowerIcon";
import RefreshIcon from "../icons/RefreshIcon";
import BrightnessMidIcon from "../icons/BrightnessMidIcon";
import BrightnessLowIcon from "../icons/BrightnessLowIcon";
import BrightnessHighIcon from "../icons/BrightnessHighIcon";

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
            <input
              type="range"
              min="1"
              max="220"
              value={221 - brightnessValue}
              disabled={brightnessToggled}
              onChange={(e) => {
                const sliderPos = parseInt(e.target.value);
                const newValue = 221 - sliderPos;
                setBrightnessValue(newValue);

                fetch(`http://localhost:5000/device/brightness/${newValue}`, {
                  method: "POST",
                }).catch((error) => {
                  console.error("Failed to set brightness:", error);
                });
              }}
              className={`w-full h-2 bg-neutral-700 rounded-lg appearance-none slider ${brightnessToggled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              style={{
                background: `linear-gradient(to right, #ffffff 0%, #ffffff ${((220 - brightnessValue) / 219) * 100}%, #404040 ${((220 - brightnessValue) / 219) * 100}%, #404040 100%)`,
                WebkitAppearance: "none",
                outline: "none",
              }}
            />
            <style jsx>{`
              input[type="range"]::-webkit-slider-thumb {
                appearance: none;
                height: 16px;
                width: 16px;
                border-radius: 50%;
                background: rgba(255, 255, 255);
                cursor: pointer;
              }

              input[type="range"]::-moz-range-thumb {
                height: 16px;
                width: 16px;
                border-radius: 50%;
                background: rgba(255, 255, 255);
                cursor: pointer;
              }
            `}</style>
          </div>
          <BrightnessHighIcon className="w-8 h-8 text-white flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

export default PowerMenuOverlay;
