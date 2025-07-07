import React, { useLayoutEffect, useRef, useState } from "react";
import { useSettings } from "../../contexts/SettingsContext";

const ScrollingText = ({
  text,
  className = "",
  maxWidth = "100%",
  pauseDuration = 1000,
  pixelsPerSecond = 50,
}) => {
  const { settings } = useSettings();
  const [shouldScroll, setShouldScroll] = useState(false);
  const [style, setStyle] = useState({});
  const textRef = useRef(null);
  const containerRef = useRef(null);
  const animationIdRef = useRef(
    `scroll-${Math.random().toString(36).substr(2, 9)}`
  );
  const styleElRef = useRef(null);

  const cleanupStyleSheet = () => {
    if (styleElRef.current && document.head.contains(styleElRef.current)) {
      document.head.removeChild(styleElRef.current);
      styleElRef.current = null;
    }
  };

  useLayoutEffect(() => {
    const updateScrolling = () => {
      if (!textRef.current || !containerRef.current) return;

      const textWidth = textRef.current.scrollWidth;
      const containerWidth = containerRef.current.offsetWidth;

      const shouldActivateScroll =
        settings.trackNameScrollingEnabled && textWidth > containerWidth;
      setShouldScroll(shouldActivateScroll);

      cleanupStyleSheet();

      if (!shouldActivateScroll) return;

      const styleEl = document.createElement("style");
      const animationName = animationIdRef.current;

      const distance = textWidth;
      const moveDuration = (distance / pixelsPerSecond) * 1000;

      const totalDuration = pauseDuration * 2 + moveDuration * 2;

      const pauseEndPercent = (pauseDuration / totalDuration) * 100;
      const moveRightEndPercent =
        ((pauseDuration + moveDuration) / totalDuration) * 100;
      const secondPauseEndPercent =
        ((pauseDuration * 2 + moveDuration) / totalDuration) * 100;

      styleEl.textContent = `
        @keyframes ${animationName} {
          0%, ${pauseEndPercent}% { 
            transform: translateX(0);
          }
          ${moveRightEndPercent}% { 
            transform: translateX(-${distance - containerWidth}px);
          }
          ${moveRightEndPercent}%, ${secondPauseEndPercent}% { 
            transform: translateX(-${distance - containerWidth}px);
          }
          100% { 
            transform: translateX(0);
          }
        }
      `;

      document.head.appendChild(styleEl);
      styleElRef.current = styleEl;

      setStyle({
        animation: `${animationName} ${totalDuration}ms infinite`,
        animationTimingFunction: "linear",
      });
    };

    updateScrolling();

    window.addEventListener("resize", updateScrolling);

    return () => {
      window.removeEventListener("resize", updateScrolling);
      cleanupStyleSheet();
    };
  }, [
    text,
    settings.trackNameScrollingEnabled,
    pauseDuration,
    pixelsPerSecond,
  ]);

  return (
    <div ref={containerRef} className="overflow-hidden" style={{ maxWidth }}>
      <div
        ref={textRef}
        className={`inline-block whitespace-nowrap ${className}`}
        style={shouldScroll ? style : {}}
      >
        {text}
      </div>
    </div>
  );
};

export default ScrollingText;
