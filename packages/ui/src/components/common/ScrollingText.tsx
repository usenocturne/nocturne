import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useSettings } from "../../contexts/SettingsContext";

interface ScrollingTextProps {
  text: ReactNode;
  className?: string;
  maxWidth?: CSSProperties["maxWidth"];
  pauseDuration?: number;
  pixelsPerSecond?: number;
  multilineWhenDisabled?: boolean;
  multilineMaxHeight?: number | null;
  multilineMinFontSize?: number;
  multilineLineHeightRatio?: number;
}

const ScrollingText = ({
  text,
  className = "",
  maxWidth = "100%",
  pauseDuration = 1000,
  pixelsPerSecond = 50,
  multilineWhenDisabled = false,
  multilineMaxHeight = null,
  multilineMinFontSize = 28,
  multilineLineHeightRatio = 1.15,
}: ScrollingTextProps) => {
  const { settings } = useSettings();
  const [shouldScroll, setShouldScroll] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const textRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const isMultiline =
    multilineWhenDisabled && !settings.trackNameScrollingEnabled;

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
      textRef.current.style.fontSize = "";
      textRef.current.style.lineHeight = "";
      textRef.current.style.maxHeight = "";
      textRef.current.style.overflow = "";

      if (!settings.trackNameScrollingEnabled) {
        setShouldScroll(false);
        if (!multilineWhenDisabled) {
          setStyle({});
          return;
        }

        const baseStyle: CSSProperties = {
          display: "block",
          overflow: "visible",
          overflowWrap: "break-word",
          wordBreak: "break-word",
        };

        if (!multilineMaxHeight) {
          setStyle(baseStyle);
          return;
        }

        const computedStyle = getComputedStyle(textRef.current);
        const baseFontSize = parseFloat(computedStyle.fontSize) || 40;
        const minFontSize = Math.min(multilineMinFontSize, baseFontSize);
        const lineHeightFor = (fontSize: number) =>
          Math.ceil(fontSize * multilineLineHeightRatio);
        let fontSize = baseFontSize;

        textRef.current.style.fontSize = `${fontSize}px`;
        textRef.current.style.lineHeight = `${lineHeightFor(fontSize)}px`;
        textRef.current.style.maxHeight = `${multilineMaxHeight}px`;
        textRef.current.style.overflow = "visible";

        while (
          fontSize > minFontSize &&
          textRef.current.scrollHeight > multilineMaxHeight
        ) {
          fontSize = Math.max(minFontSize, fontSize - 2);
          textRef.current.style.fontSize = `${fontSize}px`;
          textRef.current.style.lineHeight = `${lineHeightFor(fontSize)}px`;
        }

        setStyle({
          ...baseStyle,
          fontSize: `${fontSize}px`,
          lineHeight: `${lineHeightFor(fontSize)}px`,
          ...(textRef.current.scrollHeight <= multilineMaxHeight
            ? { maxHeight: `${multilineMaxHeight}px` }
            : {}),
        });
        return;
      }

      const textWidth = textRef.current.scrollWidth;
      const containerWidth = containerRef.current.offsetWidth;

      const shouldActivateScroll = textWidth > containerWidth;
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
    multilineWhenDisabled,
    multilineMaxHeight,
    multilineMinFontSize,
    multilineLineHeightRatio,
    pauseDuration,
    pixelsPerSecond,
  ]);

  const multilineStyle: CSSProperties = isMultiline
    ? {
        overflow: "visible",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        ...style,
      }
    : {};

  return (
    <div
      ref={containerRef}
      className={isMultiline ? "overflow-visible" : "overflow-hidden"}
      style={{ maxWidth }}
    >
      <div
        ref={textRef}
        className={`${isMultiline ? "block whitespace-normal" : "inline-block whitespace-nowrap"} ${className}`}
        style={shouldScroll ? style : multilineStyle}
      >
        {text}
      </div>
    </div>
  );
};

export default ScrollingText;
