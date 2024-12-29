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

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSelectableItems = () => {
      const trackItems = Array.from(
        containerRef.current.querySelectorAll(
          '.flex.gap-12.items-start[class*="mb-"]'
        )
      );
      setItems(trackItems);
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

    return () => observer.disconnect();
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) return;
      if (!containerRef.current || items.length === 0) return;

      e.preventDefault();
      lastActivityRef.current = Date.now();

      if (selectedIndex === -1 && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        const scaledItem = items.findIndex(
          (item) =>
            item.classList.contains("scale-105") ||
            item.classList.contains("transition-transform")
        );

        const startIndex =
          scaledItem !== -1
            ? scaledItem
            : e.key === "ArrowRight"
            ? 0
            : items.length - 1;

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

          targetItem.classList.add("scale-105");
          scrollItemIntoView(targetItem);
        }
        return;
      }

      let newIndex = selectedIndex;
      const maxIndex = items.length - 1;

      switch (e.key) {
        case "ArrowLeft":
          if (selectedIndex > 0) {
            newIndex = selectedIndex - 1;
          }
          break;

        case "ArrowRight":
          if (selectedIndex < maxIndex) {
            newIndex = selectedIndex + 1;
          }
          break;

        case "Enter":
          if (selectedIndex !== -1 && playTrack) {
            playTrack(tracks[selectedIndex].uri, selectedIndex);
          }
          return;
      }

      if (newIndex !== selectedIndex) {
        items.forEach((item) => {
          item.classList.remove(
            "scale-105",
            "transition-transform",
            "duration-200",
            "ease-out"
          );
        });

        const targetItem = items[newIndex];
        if (targetItem) {
          targetItem.classList.add("scale-105");
          setSelectedIndex(newIndex);
          scrollItemIntoView(targetItem);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
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
