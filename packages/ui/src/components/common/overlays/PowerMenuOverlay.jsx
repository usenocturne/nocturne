import React, { useEffect, useState } from "react";
import PowerIcon from "../icons/PowerIcon";
import RefreshIcon from "../icons/RefreshIcon";

function PowerMenuOverlay({ show, onShutdown, onReboot, onClose }) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
      const t = setTimeout(() => setIsVisible(true), 10);
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
        className="relative bg-neutral-900/90 rounded-2xl px-8 py-6 flex space-x-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onShutdown}
          className="w-24 h-24 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-700 transition-colors"
        >
          <PowerIcon className="w-10 h-10 text-white" />
        </button>
        <button
          onClick={onReboot}
          className="w-24 h-24 rounded-full bg-neutral-700 flex items-center justify-center hover:bg-neutral-600 transition-colors"
        >
          <RefreshIcon className="w-10 h-10 text-white" />
        </button>
      </div>
    </div>
  );
}

export default PowerMenuOverlay;
