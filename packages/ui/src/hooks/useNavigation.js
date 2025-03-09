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
  inactivityTimeout = 3000,
}) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const inactivityTimeoutRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const hasScrolledToPlayingRef = useRef(false);
  const isActiveRef = useRef(true);
  const itemsRef = useRef(items);

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
            "ease-out"
          );
        }
      });
    }
  }, [activeSection]);

  const scrollItemIntoView = useCallback(
    (item) => {
      if (!item || !containerRef.current) return;

      const container = containerRef.current;
      const itemOffset = item.offsetLeft;

      container.scrollTo({
        left: itemOffset,
        behavior: "smooth",
      });
    },
    [containerRef]
  );

  useEffect(() => {
    if (
      currentlyPlayingId &&
      containerRef.current &&
      !hasScrolledToPlayingRef.current &&
      !isUserScrolling &&
      enableScrollTracking
    ) {
      const currentItemIndex = itemsRef.current.findIndex(
        (item) => item.getAttribute("data-id") === currentlyPlayingId
      );

      if (currentItemIndex !== -1) {
        scrollItemIntoView(itemsRef.current[currentItemIndex]);
        hasScrolledToPlayingRef.current = true;
      }
    }
  }, [currentlyPlayingId, scrollItemIntoView, enableScrollTracking]);

  const handleScroll = useCallback(() => {
    setIsUserScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    if (selectedIndex !== -1 && enableItemSelection) {
      const selectedItem = itemsRef.current[selectedIndex];
      if (selectedItem) {
        selectedItem.style.transition = "transform 0.2s ease-out";
        selectedItem.classList.add("scale-105");
      }
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 150);
  }, [selectedIndex, enableItemSelection]);

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
        !enableWheelNavigation ||
        itemsRef.current.length === 0
      )
        return;

      e.preventDefault();
      e.stopPropagation();

      lastActivityRef.current = Date.now();
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      if (selectedIndex === -1 && enableItemSelection) {
        const scaledItem = itemsRef.current.findIndex(
          (item) =>
            item.classList.contains("scale-105") ||
            item.classList.contains("transition-transform")
        );

        const startIndex =
          scaledItem !== -1
            ? scaledItem
            : e.deltaX > 0
            ? 0
            : itemsRef.current.length - 1;
        setSelectedIndex(startIndex);
        const targetItem = itemsRef.current[startIndex];

        if (targetItem) {
          itemsRef.current.forEach((item) => {
            item.classList.remove(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out"
            );
          });

          targetItem.classList.add(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out"
          );

          onItemFocus(startIndex, targetItem);
          scrollItemIntoView(targetItem);
        }
        return;
      }

      if (selectedIndex === -1 || !enableItemSelection) {
        const container = containerRef.current;
        const scrollAmount = itemWidth + itemGap;
        const direction = Math.sign(e.deltaX);

        container.scrollBy({
          left: scrollAmount * direction,
          behavior: "smooth",
        });
        return;
      }

      let newIndex = selectedIndex;
      const maxIndex = itemsRef.current.length - 1;

      if (e.deltaX > 0) {
        if (selectedIndex < maxIndex) {
          newIndex = selectedIndex + 1;
          const targetItem = itemsRef.current[newIndex];
          if (targetItem) {
            itemsRef.current.forEach((item) => {
              item.classList.remove(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out"
              );
            });
            targetItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out"
            );
            setSelectedIndex(newIndex);
            onItemFocus(newIndex, targetItem);
            scrollItemIntoView(targetItem);
          }
        } else {
          const lastItem = itemsRef.current[maxIndex];
          if (lastItem) {
            lastItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out"
            );
          }
        }
      } else if (e.deltaX < 0) {
        if (selectedIndex > 0) {
          newIndex = selectedIndex - 1;
          const targetItem = itemsRef.current[newIndex];
          if (targetItem) {
            itemsRef.current.forEach((item) => {
              item.classList.remove(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out"
              );
            });
            targetItem.classList.add(
              "scale-105",
              "transition-transform",
              "duration-200",
              "ease-out"
            );
            setSelectedIndex(newIndex);
            onItemFocus(newIndex, targetItem);
            scrollItemIntoView(targetItem);
          }
        }
      }

      if (enableItemSelection) {
        inactivityTimeoutRef.current = setTimeout(() => {
          const scaledItemIndex = itemsRef.current.findIndex((item) =>
            item.classList?.contains("scale-105")
          );

          if (scaledItemIndex !== -1) {
            const scaledItem = itemsRef.current[scaledItemIndex];
            scaledItem.classList.add(
              "transition-transform",
              "duration-200",
              "ease-out"
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
    ]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!isActiveRef.current) return;

      if (enableEscapeKey && e.key === "Escape") {
        onEscape();
        return;
      }

      if (enableKeyboardNavigation && e.key === "Enter") {
        if (selectedIndex !== -1 && itemsRef.current[selectedIndex]) {
          if (inactivityTimeoutRef.current) {
            clearTimeout(inactivityTimeoutRef.current);
          }

          onItemSelect(selectedIndex, itemsRef.current[selectedIndex]);
          return;
        } else if (
          itemsRef.current.length > 0 &&
          enableWheelNavigation &&
          enableItemSelection
        ) {
          const container = containerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const containerLeft = containerRect.left;

            let visibleItemIndex = -1;

            for (let i = 0; i < itemsRef.current.length; i++) {
              const item = itemsRef.current[i];
              const itemRect = item.getBoundingClientRect();

              if (
                itemRect.right > containerLeft &&
                itemRect.left < containerRect.right
              ) {
                visibleItemIndex = i;
                break;
              }
            }

            if (visibleItemIndex !== -1) {
              setSelectedIndex(visibleItemIndex);
              const targetItem = itemsRef.current[visibleItemIndex];

              itemsRef.current.forEach((item) => {
                item.classList.remove(
                  "scale-105",
                  "transition-transform",
                  "duration-200",
                  "ease-out"
                );
              });

              targetItem.classList.add(
                "scale-105",
                "transition-transform",
                "duration-200",
                "ease-out"
              );

              onItemSelect(visibleItemIndex, targetItem);
            }
          }
        }
      }

      if (e.key >= "1" && e.key <= "4" && activeSection === "tutorial") {
        onItemSelect(parseInt(e.key, 10) - 1, null);
      }
    },
    [
      selectedIndex,
      enableEscapeKey,
      enableKeyboardNavigation,
      enableItemSelection,
      enableWheelNavigation,
      activeSection,
      onEscape,
      onItemSelect,
    ]
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
      if (index < 0 || index >= itemsRef.current.length) return;

      setSelectedIndex(index);

      if (enableItemSelection) {
        itemsRef.current.forEach((item) => {
          item.classList.remove(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out"
          );
        });

        const targetItem = itemsRef.current[index];
        targetItem.classList.add(
          "scale-105",
          "transition-transform",
          "duration-200",
          "ease-out"
        );

        scrollItemIntoView(targetItem);
      }
    },
    [enableItemSelection, scrollItemIntoView]
  );

  const scrollToPosition = useCallback(
    (position) => {
      if (!containerRef.current) return;

      containerRef.current.scrollTo({
        left: position,
        behavior: "smooth",
      });
    },
    [containerRef]
  );

  const scrollByAmount = useCallback(
    (amount) => {
      if (!containerRef.current) return;

      containerRef.current.scrollBy({
        left: amount,
        behavior: "smooth",
      });
    },
    [containerRef]
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

    itemsRef.current.forEach((item) => {
      if (item?.classList) {
        item.classList.remove(
          "scale-105",
          "transition-transform",
          "duration-200",
          "ease-out"
        );
      }
    });
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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
