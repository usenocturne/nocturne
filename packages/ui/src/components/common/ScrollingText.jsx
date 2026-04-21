import { useLayoutEffect, useRef, useState } from "react";
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
  const animationRef = useRef(null);

  useLayoutEffect(() => {
    const stopAnimation = () => {
      if (animationRef.current) {
        animationRef.current.cancel();
        animationRef.current = null;
      }
    };

    const updateScrolling = () => {
      if (!textRef.current || !containerRef.current) return;

      stopAnimation();

      const textWidth = textRef.current.scrollWidth;
      const containerWidth = containerRef.current.offsetWidth;

      const shouldActivateScroll =
        settings.trackNameScrollingEnabled && textWidth > containerWidth;
      setShouldScroll(shouldActivateScroll);

      if (!shouldActivateScroll) {
        setStyle({});
        return;
      }

      const distance = textWidth;
      const overflow = textWidth - containerWidth;
      const moveDuration = (distance / pixelsPerSecond) * 1000;

      const totalDuration = pauseDuration * 2 + moveDuration * 2;

      const pauseEndOffset = pauseDuration / totalDuration;
      const forwardEndOffset = (pauseDuration + moveDuration) / totalDuration;
      const secondPauseEndOffset =
        (pauseDuration * 2 + moveDuration) / totalDuration;

      setStyle({
        willChange: "transform",
      });

      animationRef.current = textRef.current.animate(
        [
          { transform: "translateX(0)", offset: 0 },
          { transform: "translateX(0)", offset: pauseEndOffset },
          { transform: `translateX(-${overflow}px)`, offset: forwardEndOffset },
          {
            transform: `translateX(-${overflow}px)`,
            offset: secondPauseEndOffset,
          },
          { transform: "translateX(0)", offset: 1 },
        ],
        {
          duration: totalDuration,
          easing: "linear",
          iterations: Infinity,
        },
      );
    };

    updateScrolling();

    window.addEventListener("resize", updateScrolling);

    return () => {
      window.removeEventListener("resize", updateScrolling);
      stopAnimation();
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
