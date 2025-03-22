import { useEffect, useRef } from "react";
import { useSettings } from "../contexts/SettingsContext";

export function useGestureControls({
  contentRef,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  isActive = true,
}) {
  const { settings } = useSettings();
  const touchStartRef = useRef(null);
  const touchStartXRef = useRef(null);

  useEffect(() => {
    const element = contentRef?.current;
    if (!element || !isActive) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
    };

    const handleTouchMove = (e) => {
      if (touchStartRef.current === null || touchStartXRef.current === null)
        return;

      const touchY = e.touches[0].clientY;
      const touchX = e.touches[0].clientX;
      const deltaY = touchStartRef.current - touchY;
      const deltaX = touchStartXRef.current - touchX;

      if (
        Math.abs(deltaY) > Math.abs(deltaX) &&
        Math.abs(deltaY) > 20 &&
        settings.showLyricsGestureEnabled
      ) {
        e.preventDefault();
      }

      if (
        Math.abs(deltaX) > Math.abs(deltaY) &&
        Math.abs(deltaX) > 20 &&
        settings.songChangeGestureEnabled
      ) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e) => {
      if (touchStartRef.current === null || touchStartXRef.current === null)
        return;

      const touchEndY = e.changedTouches[0].clientY;
      const touchEndX = e.changedTouches[0].clientX;

      const deltaY = touchStartRef.current - touchEndY;
      const deltaX = touchStartXRef.current - touchEndX;

      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);

      if (isHorizontalSwipe && settings.songChangeGestureEnabled) {
        if (deltaX > 50 && onSwipeLeft) {
          onSwipeLeft();
        } else if (deltaX < -50 && onSwipeRight) {
          onSwipeRight();
        }
      } else if (!isHorizontalSwipe && settings.showLyricsGestureEnabled) {
        if (deltaY > 50 && onSwipeUp) {
          onSwipeUp();
        } else if (deltaY < -50 && onSwipeDown) {
          onSwipeDown();
        }
      }

      touchStartRef.current = null;
      touchStartXRef.current = null;
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
    };
  }, [
    contentRef?.current,
    isActive,
    settings.showLyricsGestureEnabled,
    settings.songChangeGestureEnabled,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
  ]);
}
