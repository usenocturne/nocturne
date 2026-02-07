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
  const touchTargetRef = useRef(null);

  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeDownRef = useRef(onSwipeDown);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
    onSwipeUpRef.current = onSwipeUp;
    onSwipeDownRef.current = onSwipeDown;
  });

  const isWithinScrollableContainer = (target) => {
    let current = target;
    while (current && current !== contentRef?.current) {
      const computedStyle = window.getComputedStyle(current);
      const isScrollable =
        (computedStyle.overflowY === "auto" ||
          computedStyle.overflowY === "scroll" ||
          computedStyle.overflow === "auto" ||
          computedStyle.overflow === "scroll") &&
        current.scrollHeight > current.clientHeight;

      if (isScrollable) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  useEffect(() => {
    const element = contentRef?.current;
    if (!element || !isActive) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
      touchTargetRef.current = e.target;
    };

    const handleTouchMove = (e) => {
      if (touchStartRef.current === null || touchStartXRef.current === null)
        return;

      const touchY = e.touches[0].clientY;
      const touchX = e.touches[0].clientX;
      const deltaY = touchStartRef.current - touchY;
      const deltaX = touchStartXRef.current - touchX;

      const scrollableContainer = touchTargetRef.current
        ? isWithinScrollableContainer(touchTargetRef.current)
        : null;

      if (e.cancelable) {
        if (
          Math.abs(deltaY) > Math.abs(deltaX) &&
          Math.abs(deltaY) > 20 &&
          settings.showLyricsGestureEnabled &&
          !scrollableContainer
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

      const scrollableContainer = touchTargetRef.current
        ? isWithinScrollableContainer(touchTargetRef.current)
        : null;

      if (isHorizontalSwipe && settings.songChangeGestureEnabled) {
        if (deltaX > 50 && onSwipeLeftRef.current) {
          onSwipeLeftRef.current();
        } else if (deltaX < -50 && onSwipeRightRef.current) {
          onSwipeRightRef.current();
        }
      } else if (
        !isHorizontalSwipe &&
        settings.showLyricsGestureEnabled &&
        !scrollableContainer
      ) {
        if (deltaY > 50 && onSwipeUpRef.current) {
          onSwipeUpRef.current();
        } else if (deltaY < -50 && onSwipeDownRef.current) {
          onSwipeDownRef.current();
        }
      }

      touchStartRef.current = null;
      touchStartXRef.current = null;
      touchTargetRef.current = null;
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
    contentRef,
    isActive,
    settings.showLyricsGestureEnabled,
    settings.songChangeGestureEnabled,
  ]);
}
