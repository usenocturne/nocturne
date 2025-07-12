import { useState, useEffect, useRef, useCallback } from "react";

export function useNavigation({
  containerRef,
  activeSection,
  enableScrollTracking = true,
  enableWheelNavigation = true,
  enableKeyboardNavigation = true,
  enableItemSelection = true,
  enableEscapeKey = false,
  itemWidth = 290,
  itemGap = 40,
  items = [],
  currentlyPlayingId = null,
  onEscape = () => {},
  onItemSelect = () => {},
  onItemFocus = () => {},
  onEnterKey = null,
  inactivityTimeout = 3000,
  vertical = false,
}) {
  const [selectedIndex, _setSelectedIndex] = useState(-1);
  const selectedIndexRef = useRef(selectedIndex);

  const setSelectedIndex = (index) => {
    selectedIndexRef.current = index;
    _setSelectedIndex(index);
  };
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const inactivityTimeoutRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const hasScrolledToPlayingRef = useRef(false);
  const isActiveRef = useRef(true);
  const itemsRef = useRef(items);
  const wheelDeltaAccumulator = useRef(0);
  const lastWheelTime = useRef(0);
  const wheelAnimationFrame = useRef(null);
  const isWheelScrolling = useRef(false);
  const wheelThrottleRef = useRef(null);
  const isRapidScrollingRef = useRef(false);
  const wheelDebounceRef = useRef(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    hasScrolledToPlayingRef.current = false;
    setSelectedIndex(-1);
    if (itemsRef.current.length > 0) {
      itemsRef.current.forEach((item) => {
        if (item?.classList) {
          item.classList.remove(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out",
          );
        }
      });
    }
  }, [activeSection]);

  const previousPlayingIdRef = useRef(null);
  useEffect(() => {
    if (
      currentlyPlayingId &&
      currentlyPlayingId !== previousPlayingIdRef.current
    ) {
      previousPlayingIdRef.current = currentlyPlayingId;
      hasScrolledToPlayingRef.current = false;
    }
  }, [currentlyPlayingId]);

  const scrollItemIntoView = useCallback(
    (item) => {
      if (!item || !containerRef.current) return;

      const container = containerRef.current;

      if (vertical) {
        const itemOffset = item.offsetTop;
        container.scrollTo({
          top: itemOffset - container.offsetHeight / 3,
          behavior: "smooth",
        });
      } else {
        const itemOffset = item.offsetLeft;
        container.scrollTo({
          left: itemOffset,
          behavior: "smooth",
        });
      }
    },
    [containerRef, vertical],
  );

  useEffect(() => {
    if (
      currentlyPlayingId &&
      containerRef.current &&
      !hasScrolledToPlayingRef.current &&
      !isUserScrolling &&
      enableScrollTracking
    ) {
      const firstItem = itemsRef.current[0];

      if (
        firstItem &&
        firstItem.getAttribute("data-id") === currentlyPlayingId
      ) {
        containerRef.current.scrollTo({
          left: 0,
          top: 0,
          behavior: "smooth",
        });
        hasScrolledToPlayingRef.current = true;
      }
    }
  }, [currentlyPlayingId, containerRef, enableScrollTracking, isUserScrolling]);

  const getTrackItems = useCallback(() => {
    if (!containerRef.current) return [];

    return Array.from(
      containerRef.current.querySelectorAll("[data-track-index]"),
    ).sort((a, b) => {
      const indexA = parseInt(a.getAttribute("data-track-index"), 10);
      const indexB = parseInt(b.getAttribute("data-track-index"), 10);
      return indexA - indexB;
    });
  }, [containerRef]);

  const handleScroll = useCallback(() => {
    setIsUserScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    if (selectedIndexRef.current !== -1 && enableItemSelection) {
      const items = vertical ? getTrackItems() : itemsRef.current;
      const selectedItem = items[selectedIndexRef.current];

      if (selectedItem) {
        selectedItem.classList.add(
          "scale-105",
          "transition-transform",
          "duration-200",
          "ease-out",
        );
      }
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 150);
  }, [selectedIndex, enableItemSelection, vertical, getTrackItems]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enableScrollTracking) return;

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [containerRef, handleScroll, enableScrollTracking]);

  const handleWheel = useCallback(
    (e) => {
      if (
        !isActiveRef.current ||
        !containerRef.current ||
        !enableWheelNavigation
      )
        return;

      const items = vertical ? getTrackItems() : itemsRef.current;
      if (items.length === 0) return;

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

      if (wheelDebounceRef.current) {
        clearTimeout(wheelDebounceRef.current);
      }

      wheelDebounceRef.current = setTimeout(() => {
        isRapidScrollingRef.current = false;
      }, 100);

      wheelThrottleRef.current = now;

      lastActivityRef.current = now;

      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      if (!enableItemSelection) {
        const container = containerRef.current;
        const scrollAmount = vertical ? 100 : itemWidth + itemGap;
        const direction = Math.sign(e.deltaX);

        if (vertical) {
          container.scrollBy({
            top: scrollAmount * direction,
            behavior: "smooth",
          });
        } else {
          container.scrollBy({
            left: scrollAmount * direction,
            behavior: "smooth",
          });
        }
        return;
      }

      if (selectedIndexRef.current === -1) {
        const scaledItem = items.findIndex(
          (item) =>
            item.classList.contains("scale-105") ||
            item.classList.contains("transition-transform"),
        );

        const delta = e.deltaX;
        const startIndex =
          scaledItem !== -1 ? scaledItem : delta > 0 ? 0 : items.length - 1;

        setSelectedIndex(startIndex);
        const targetItem = items[startIndex];

        if (targetItem) {
          items.forEach((item) => {
            item.classList.remove(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out",
            );
          });

          targetItem.classList.add(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out",
          );

          onItemFocus(startIndex, targetItem);
          scrollItemIntoView(targetItem);
        }
        return;
      }

      const deltaThreshold = 10;
      if (Math.abs(e.deltaX) < deltaThreshold) {
        return;
      }

      let newIndex = selectedIndexRef.current;
      const maxIndex = items.length - 1;

      if (e.deltaX > 0) {
        if (selectedIndexRef.current < maxIndex) {
          newIndex = selectedIndexRef.current + 1;
        }
      } else if (e.deltaX < 0) {
        if (selectedIndexRef.current > 0) {
          newIndex = selectedIndexRef.current - 1;
        }
      }

      if (newIndex !== selectedIndexRef.current) {
        const targetItem = items[newIndex];
        if (targetItem) {
          requestAnimationFrame(() => {
            items.forEach((item) => {
              item.classList.remove(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out",
              );
            });

            targetItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out",
            );
          });

          setSelectedIndex(newIndex);
          onItemFocus(newIndex, targetItem);
          scrollItemIntoView(targetItem);
        }
      } else if (selectedIndexRef.current === maxIndex && e.deltaX > 0) {
        const lastItem = items[maxIndex];
        if (lastItem) {
          requestAnimationFrame(() => {
            lastItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out",
            );
          });
        }
      }

      if (enableItemSelection) {
        inactivityTimeoutRef.current = setTimeout(() => {
          const scaledItemIndex = items.findIndex((item) =>
            item.classList?.contains("scale-105"),
          );

          if (scaledItemIndex !== -1) {
            const scaledItem = items[scaledItemIndex];
            scaledItem.classList.add(
              "transition-transform",
              "duration-200",
              "ease-out",
            );
            scaledItem.classList.remove("scale-105");
          }

          setSelectedIndex(-1);
        }, inactivityTimeout);
      }
    },
    [
      selectedIndex,
      enableWheelNavigation,
      enableItemSelection,
      inactivityTimeout,
      itemWidth,
      itemGap,
      scrollItemIntoView,
      onItemFocus,
      vertical,
      getTrackItems,
    ],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!isActiveRef.current) return;

      if (enableEscapeKey && e.key === "Escape") {
        onEscape();
        return;
      }

      if (activeSection === "nowPlaying" && e.key === "Enter" && onEnterKey) {
        onEnterKey();
        return;
      }

      if (enableKeyboardNavigation && e.key === "Enter") {
        const items = vertical ? getTrackItems() : itemsRef.current;

        if (
          selectedIndexRef.current !== -1 &&
          items[selectedIndexRef.current]
        ) {
          if (inactivityTimeoutRef.current) {
            clearTimeout(inactivityTimeoutRef.current);
          }

          onItemSelect(
            selectedIndexRef.current,
            items[selectedIndexRef.current],
          );
          return;
        } else if (
          items.length > 0 &&
          enableWheelNavigation &&
          enableItemSelection
        ) {
          const container = containerRef.current;
          if (container) {
            let visibleItemIndex = -1;

            if (vertical) {
              const containerRect = container.getBoundingClientRect();
              const containerTop = containerRect.top;

              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemRect = item.getBoundingClientRect();

                if (
                  itemRect.bottom > containerTop &&
                  itemRect.top < containerRect.bottom
                ) {
                  visibleItemIndex = i;
                  break;
                }
              }
            } else {
              const containerRect = container.getBoundingClientRect();
              const containerLeft = containerRect.left;

              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemRect = item.getBoundingClientRect();

                if (
                  itemRect.right > containerLeft &&
                  itemRect.left < containerRect.right
                ) {
                  visibleItemIndex = i;
                  break;
                }
              }
            }

            if (visibleItemIndex !== -1) {
              setSelectedIndex(visibleItemIndex);
              const targetItem = items[visibleItemIndex];

              items.forEach((item) => {
                item.classList.remove(
                  "scale-105",
                  "transition-transform",
                  "duration-200",
                  "ease-out",
                );
              });

              targetItem.classList.add(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out",
              );

              onItemSelect(visibleItemIndex, targetItem);
            }
          }
        }
      }

      if (e.key >= "1" && e.key <= "4" && activeSection === "tutorial") {
        onItemSelect(parseInt(e.key, 10) - 1, null);
      }

      if (enableKeyboardNavigation) {
        const items = vertical ? getTrackItems() : itemsRef.current;
        if (items.length === 0) return;

        let newIndex = selectedIndexRef.current;
        const maxIndex = items.length - 1;

        if (
          (vertical && e.key === "ArrowDown") ||
          (!vertical && e.key === "ArrowRight")
        ) {
          if (selectedIndexRef.current === -1) {
            newIndex = 0;
          } else if (selectedIndexRef.current < maxIndex) {
            newIndex = selectedIndexRef.current + 1;
          }
        } else if (
          (vertical && e.key === "ArrowUp") ||
          (!vertical && e.key === "ArrowLeft")
        ) {
          if (selectedIndexRef.current === -1) {
            newIndex = 0;
          } else if (selectedIndexRef.current > 0) {
            newIndex = selectedIndexRef.current - 1;
          }
        }

        if (newIndex !== selectedIndexRef.current) {
          setSelectedIndex(newIndex);

          const targetItem = items[newIndex];
          if (targetItem) {
            items.forEach((item) => {
              item.classList.remove(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out",
              );
            });

            targetItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out",
            );

            onItemFocus(newIndex, targetItem);
            scrollItemIntoView(targetItem);

            if (inactivityTimeoutRef.current) {
              clearTimeout(inactivityTimeoutRef.current);
            }

            if (enableItemSelection) {
              inactivityTimeoutRef.current = setTimeout(() => {
                targetItem.classList.remove("scale-105");
                setSelectedIndex(-1);
              }, inactivityTimeout);
            }
          }
        }
      }
    },
    [
      selectedIndex,
      enableEscapeKey,
      enableKeyboardNavigation,
      enableItemSelection,
      enableWheelNavigation,
      vertical,
      activeSection,
      onEscape,
      onEnterKey,
      onItemSelect,
      onItemFocus,
      scrollItemIntoView,
      inactivityTimeout,
      getTrackItems,
    ],
  );

  useEffect(() => {
    if (enableWheelNavigation) {
      document.addEventListener("wheel", handleWheel, { passive: false });
    }

    if (enableKeyboardNavigation || enableEscapeKey) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      if (enableWheelNavigation) {
        document.removeEventListener("wheel", handleWheel);
      }

      if (enableKeyboardNavigation || enableEscapeKey) {
        window.removeEventListener("keydown", handleKeyDown);
      }

      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      if (wheelAnimationFrame.current) {
        cancelAnimationFrame(wheelAnimationFrame.current);
      }
    };
  }, [
    handleWheel,
    handleKeyDown,
    enableWheelNavigation,
    enableKeyboardNavigation,
    enableEscapeKey,
  ]);

  const selectItem = useCallback(
    (index) => {
      const items = vertical ? getTrackItems() : itemsRef.current;
      if (index < 0 || index >= items.length) return;

      setSelectedIndex(index);

      if (enableItemSelection) {
        items.forEach((item) => {
          item.classList.remove(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out",
          );
        });

        const targetItem = items[index];
        targetItem.classList.add(
          "scale-105",
          "transition-transform",
          "duration-200",
          "ease-out",
        );

        scrollItemIntoView(targetItem);
      }
    },
    [enableItemSelection, scrollItemIntoView, vertical, getTrackItems],
  );

  const scrollToPosition = useCallback(
    (position) => {
      if (!containerRef.current) return;

      if (vertical) {
        containerRef.current.scrollTo({
          top: position,
          behavior: "smooth",
        });
      } else {
        containerRef.current.scrollTo({
          left: position,
          behavior: "smooth",
        });
      }
    },
    [containerRef, vertical],
  );

  const scrollByAmount = useCallback(
    (amount) => {
      if (!containerRef.current) return;

      if (vertical) {
        containerRef.current.scrollBy({
          top: amount,
          behavior: "smooth",
        });
      } else {
        containerRef.current.scrollBy({
          left: amount,
          behavior: "smooth",
        });
      }
    },
    [containerRef, vertical],
  );

  const cleanup = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (wheelAnimationFrame.current) {
      cancelAnimationFrame(wheelAnimationFrame.current);
      wheelAnimationFrame.current = null;
    }

    wheelDeltaAccumulator.current = 0;
    isWheelScrolling.current = false;

    const items = vertical ? getTrackItems() : itemsRef.current;
    items.forEach((item) => {
      if (item?.classList) {
        item.classList.remove(
          "scale-105",
          "transition-transform",
          "duration-200",
          "duration-150",
          "ease-out",
        );
      }
    });
  }, [vertical, getTrackItems]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  return {
    selectedIndex,
    isUserScrolling,
    selectItem,
    scrollItemIntoView,
    scrollToPosition,
    scrollByAmount,
    cleanup,
    hasScrolledToCurrentItem: hasScrolledToPlayingRef.current,
  };
}
