import { useEffect, useRef, useState } from "react";

export const TRANSITION_DURATION_MS = 500;
export const EASING_FUNCTION = "cubic-bezier(0.16, 1, 0.3, 1)";

let dragging = false;

export const setDragging = (value) => {
  dragging = value;
};

export function useSwiperNavigation({
  swiperRef,
  itemCount,
  activeSection,
  playingItemIndex = -1,
  onItemSelect = () => {},
  onItemFocus = () => {},
  inactivityTimeout = 3000,
  enabled = true,
}) {
  const [selectedIndex, _setSelectedIndex] = useState(-1);
  const selectedIndexRef = useRef(-1);
  const onItemSelectRef = useRef(onItemSelect);
  const onItemFocusRef = useRef(onItemFocus);
  const enabledRef = useRef(enabled);
  const itemCountRef = useRef(itemCount);
  const inactivityTimeoutRef = useRef(null);
  const wheelThrottleRef = useRef(null);
  const wheelDebounceRef = useRef(null);
  const isRapidScrollingRef = useRef(false);
  const previousPlayingItemIndexRef = useRef(-1);

  const setSelectedIndex = (index) => {
    selectedIndexRef.current = index;
    _setSelectedIndex(index);
  };

  const clearInactivityTimeout = () => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  };

  const clearWheelDebounce = () => {
    if (wheelDebounceRef.current) {
      clearTimeout(wheelDebounceRef.current);
      wheelDebounceRef.current = null;
    }
  };

  const resetInactivityTimeout = () => {
    clearInactivityTimeout();
    if (!enabledRef.current) return;
    inactivityTimeoutRef.current = setTimeout(() => {
      setSelectedIndex(-1);
    }, inactivityTimeout);
  };

  const clampIndex = (index) => {
    if (itemCountRef.current <= 0) return -1;
    return Math.max(0, Math.min(index, itemCountRef.current - 1));
  };

  const slideToIndex = (index, duration = TRANSITION_DURATION_MS) => {
    if (!enabledRef.current || dragging) return;
    if (
      !swiperRef?.current ||
      typeof swiperRef.current.slideTo !== "function"
    ) {
      return;
    }
    const boundedIndex = clampIndex(index);
    if (boundedIndex === -1) return;
    swiperRef.current.slideTo(boundedIndex, duration);
    if (swiperRef.current.wrapperEl?.style) {
      swiperRef.current.wrapperEl.style.transitionTimingFunction =
        EASING_FUNCTION;
    }
  };

  useEffect(() => {
    onItemSelectRef.current = onItemSelect;
  }, [onItemSelect]);

  useEffect(() => {
    onItemFocusRef.current = onItemFocus;
  }, [onItemFocus]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    itemCountRef.current = itemCount;
    if (selectedIndexRef.current >= itemCount) {
      setSelectedIndex(itemCount > 0 ? itemCount - 1 : -1);
    }
  }, [itemCount]);

  useEffect(() => {
    setSelectedIndex(-1);
    clearInactivityTimeout();
    clearWheelDebounce();
    wheelThrottleRef.current = null;
    isRapidScrollingRef.current = false;
    previousPlayingItemIndexRef.current = -1;
  }, [activeSection]);

  useEffect(() => {
    if (
      playingItemIndex >= 0 &&
      playingItemIndex !== previousPlayingItemIndexRef.current
    ) {
      previousPlayingItemIndexRef.current = playingItemIndex;
      slideToIndex(playingItemIndex, 0);
    }
  }, [playingItemIndex]);

  useEffect(() => {
    const handleWheel = (e) => {
      if (!enabledRef.current || itemCountRef.current <= 0) return;

      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();

      if (wheelThrottleRef.current && now - wheelThrottleRef.current < 60) {
        isRapidScrollingRef.current = true;
        if (now - wheelThrottleRef.current < 15) {
          return;
        }
      } else if (
        wheelThrottleRef.current &&
        now - wheelThrottleRef.current > 100
      ) {
        isRapidScrollingRef.current = false;
      }

      clearWheelDebounce();
      wheelDebounceRef.current = setTimeout(() => {
        isRapidScrollingRef.current = false;
      }, 100);

      wheelThrottleRef.current = now;

      if (Math.abs(e.deltaX) < 10) {
        return;
      }

      let newIndex = selectedIndexRef.current;

      if (selectedIndexRef.current === -1) {
        newIndex = e.deltaX > 0 ? 0 : itemCountRef.current - 1;
      } else if (e.deltaX > 0) {
        newIndex = clampIndex(selectedIndexRef.current + 1);
      } else if (e.deltaX < 0) {
        newIndex = clampIndex(selectedIndexRef.current - 1);
      }

      if (newIndex === -1 || newIndex === selectedIndexRef.current) {
        resetInactivityTimeout();
        return;
      }

      setSelectedIndex(newIndex);
      onItemFocusRef.current?.(newIndex);
      slideToIndex(newIndex);
      resetInactivityTimeout();
    };

    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("wheel", handleWheel);
    };
  }, [swiperRef, inactivityTimeout]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!enabledRef.current || itemCountRef.current <= 0) return;

      if (e.key === "Enter") {
        if (selectedIndexRef.current >= 0) {
          clearInactivityTimeout();
          onItemSelectRef.current?.(selectedIndexRef.current);
        }
        return;
      }

      let newIndex = selectedIndexRef.current;

      if (e.key === "ArrowRight") {
        newIndex =
          selectedIndexRef.current === -1
            ? 0
            : clampIndex(selectedIndexRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        newIndex =
          selectedIndexRef.current === -1
            ? 0
            : clampIndex(selectedIndexRef.current - 1);
      } else {
        return;
      }

      if (newIndex === -1 || newIndex === selectedIndexRef.current) {
        resetInactivityTimeout();
        return;
      }

      setSelectedIndex(newIndex);
      onItemFocusRef.current?.(newIndex);
      slideToIndex(newIndex);
      resetInactivityTimeout();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [swiperRef, inactivityTimeout]);

  useEffect(() => {
    return () => {
      clearInactivityTimeout();
      clearWheelDebounce();
    };
  }, []);

  return {
    selectedIndex,
    setSelectedIndex,
  };
}
