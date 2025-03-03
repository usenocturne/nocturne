import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";

const TrackListNavigation = ({
  tracks,
  containerRef,
  accessToken,
  currentlyPlayingTrackUri,
  playTrack,
}) => {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [items, setItems] = useState([]);
  const lastActivityRef = useRef(Date.now());
  const inactivityTimeoutRef = useRef(null);
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSelectableItems = () => {
      const trackItems = Array.from(
        containerRef.current.querySelectorAll(
          '.flex.gap-12.items-start[class*="mb-"]'
        )
      );
      setItems(trackItems);
      containerRef.current.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    };

    updateSelectableItems();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.type === "childList")) {
        updateSelectableItems();
      }
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
    });

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        isActiveRef.current = entries[0]?.isIntersecting ?? false;
      },
      { threshold: 0.1 }
    );

    intersectionObserver.observe(containerRef.current);

    return () => {
      observer.disconnect();
      intersectionObserver.disconnect();
    };
  }, []);

  const scrollItemIntoView = (item) => {
    if (!item || !containerRef.current) return;
    item.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  };

  useEffect(() => {
    if (selectedIndex === -1) return;

    const checkInactivity = () => {
      const currentTime = Date.now();
      const inactiveTime = currentTime - lastActivityRef.current;

      if (inactiveTime >= 3000) {
        items.forEach((item) => {
          if (item.classList.contains("scale-105")) {
            item.classList.add(
              "transition-transform",
              "duration-200",
              "ease-out"
            );
            item.classList.remove("scale-105");
          }
        });
        setSelectedIndex(-1);
        if (inactivityTimeoutRef.current) {
          clearTimeout(inactivityTimeoutRef.current);
          inactivityTimeoutRef.current = null;
        }
      }
    };

    const intervalId = setInterval(checkInactivity, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [selectedIndex, items]);

  const handleWheel = (e) => {
    if (!isActiveRef.current || !containerRef.current || items.length === 0) return;
    
    e.preventDefault();
    e.stopPropagation();

    lastActivityRef.current = Date.now();
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    if (selectedIndex === -1) {
      const scaledItem = items.findIndex(
        (item) =>
          item.classList.contains("scale-105") ||
          item.classList.contains("transition-transform")
      );

      const startIndex = scaledItem !== -1 ? scaledItem : 
                        e.deltaX > 0 ? 0 : items.length - 1;
      setSelectedIndex(startIndex);
      const targetItem = items[startIndex];

      if (targetItem) {
        items.forEach((item) => {
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
        scrollItemIntoView(targetItem);
      }
      return;
    }

    let newIndex = selectedIndex;
    const maxIndex = items.length - 1;

    if (e.deltaX > 0) {
      if (selectedIndex < maxIndex) {
        newIndex = selectedIndex + 1;
        const targetItem = items[newIndex];
        if (targetItem) {
          items.forEach((item) => {
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
          scrollItemIntoView(targetItem);
        }
      } else {
        const lastItem = items[maxIndex];
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
        const targetItem = items[newIndex];
        if (targetItem) {
          items.forEach((item) => {
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
          scrollItemIntoView(targetItem);
        }
      }
    }

    inactivityTimeoutRef.current = setTimeout(() => {
      const scaledItemIndex = items.findIndex((item) =>
        item.classList.contains("scale-105")
      );

      if (scaledItemIndex !== -1) {
        const scaledItem = items[scaledItemIndex];
        scaledItem.classList.add(
          "transition-transform",
          "duration-200",
          "ease-out"
        );
        scaledItem.classList.remove("scale-105");
      }

      setSelectedIndex(-1);
    }, 3000);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isActiveRef.current) return;
      
      if (e.key === "Enter" && selectedIndex !== -1 && playTrack) {
        playTrack(tracks[selectedIndex].uri, selectedIndex);
      }
    };

    document.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    
    return () => {
      document.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
    };
  }, [selectedIndex, items, tracks, playTrack]);

  useEffect(() => {
    return () => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      items.forEach((item) => {
        if (item.classList.contains("scale-105")) {
          item.classList.remove("scale-105");
        }
      });
    };
  }, [items]);

  return null;
};

export default TrackListNavigation;