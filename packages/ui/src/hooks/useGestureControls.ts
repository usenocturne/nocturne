import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useSettings } from "../contexts/SettingsContext";
type SwipeHandler = () => void | Promise<void>;

interface GestureControlsOptions {
  contentRef: RefObject<HTMLElement | null>;
  onSwipeLeft?: SwipeHandler;
  onSwipeRight?: SwipeHandler;
  onSwipeUp?: SwipeHandler;
  onSwipeDown?: SwipeHandler;
  swipeUpEnabled?: boolean;
  swipeDownEnabled?: boolean;
  isActive?: boolean;
}

export function useGestureControls({
  contentRef,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  swipeUpEnabled,
  swipeDownEnabled,
  isActive = true,
}: GestureControlsOptions) {
  const { settings } = useSettings();
  const canSwipeUp = swipeUpEnabled ?? !!settings.showLyricsGestureEnabled;
  const canSwipeDown = swipeDownEnabled ?? !!settings.showLyricsGestureEnabled;
  const touchStartRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchTargetRef = useRef<EventTarget | null>(null);

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

  const isWithinScrollableContainer = (target: EventTarget | null) => {
    let current = target instanceof HTMLElement ? target : null;
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

    const handleTouchStart = (e: TouchEvent) => {
      touchStartRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
      touchTargetRef.current = e.target;
    };

    const handleTouchMove = (e: TouchEvent) => {
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
          (deltaY > 0 ? canSwipeUp : canSwipeDown) &&
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

    const handleTouchEnd = (e: TouchEvent) => {
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
      } else if (!isHorizontalSwipe && !scrollableContainer) {
        if (deltaY > 50 && canSwipeUp && onSwipeUpRef.current) {
          onSwipeUpRef.current();
        } else if (deltaY < -50 && canSwipeDown && onSwipeDownRef.current) {
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
    canSwipeUp,
    canSwipeDown,
    settings.songChangeGestureEnabled,
  ]);
}
