import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

export default function HorizontalScroll({
  children,
  containerRef,
  accessToken,
  currentlyPlayingId,
  activeSection,
}) {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [items, setItems] = useState([]);
  const lastActivityRef = useRef(Date.now());
  const inactivityTimeoutRef = useRef(null);
  const hasScrolledToPlayingRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new MutationObserver(() => {
      const scrollableItems = Array.from(containerRef.current.children);
      setItems(scrollableItems);
    });

    observer.observe(containerRef.current, {
      childList: true,
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      isUserScrollingRef.current = true;

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      if (selectedIndex !== -1) {
        const selectedItem = items[selectedIndex];
        if (selectedItem) {
          selectedItem.style.transition = "transform 0.2s ease-out";
          selectedItem.classList.add("scale-105");
        }
      }

      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 150);
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [selectedIndex, items]);

  useEffect(() => {
    if (containerRef.current) {
      const scrollableItems = Array.from(containerRef.current.children);
      setItems(scrollableItems);
      hasScrolledToPlayingRef.current = false;
    }
  }, [activeSection]);

  const scrollItemIntoView = (item) => {
    if (!item || !containerRef.current) return;

    const container = containerRef.current;
    const itemOffset = item.offsetLeft;

    container.scrollTo({
      left: itemOffset,
      behavior: "smooth",
    });
  };

  const handleWheel = (e) => {
    if (!isActiveRef.current || !containerRef.current || items.length === 0 || activeSection === "settings") return;
    
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
      
      if (e.key === "Enter" && selectedIndex !== -1) {
        const link = items[selectedIndex]?.querySelector("a");
        if (link?.getAttribute("href")) {
          const href = link.getAttribute("href");
          router.push(
            `${href}${
              href.includes("?") ? "&" : "?"
            }accessToken=${accessToken}`
          );
        }
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
  }, [selectedIndex, items, router, accessToken, activeSection]);

  useEffect(() => {
    if (
      currentlyPlayingId &&
      containerRef.current &&
      !hasScrolledToPlayingRef.current &&
      !isUserScrollingRef.current
    ) {
      const currentItemIndex = items.findIndex(
        (item) => item.getAttribute("data-id") === currentlyPlayingId
      );

      if (currentItemIndex !== -1) {
        scrollItemIntoView(items[currentItemIndex]);
        hasScrolledToPlayingRef.current = true;
      }
    }
  }, [currentlyPlayingId, items]);

  useEffect(() => {
    hasScrolledToPlayingRef.current = false;
    setSelectedIndex(-1);
    items.forEach((item) => {
      item.classList.remove(
        "scale-105",
        "transition-transform",
        "duration-200",
        "ease-out"
      );
    });
  }, [activeSection]);

  useEffect(() => {
    if (selectedIndex !== -1) {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      inactivityTimeoutRef.current = setTimeout(() => {
        const currentItem = items[selectedIndex];
        if (currentItem) {
          currentItem.classList.add(
            "transition-transform",
            "duration-200",
            "ease-out"
          );
          currentItem.classList.remove("scale-105");
        }
        setSelectedIndex(-1);
      }, 3000);

      return () => {
        if (inactivityTimeoutRef.current) {
          clearTimeout(inactivityTimeoutRef.current);
        }
      };
    }
  }, [selectedIndex, items]);

  useEffect(() => {
    return () => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      items.forEach((item) => {
        item.classList.remove(
          "scale-105",
          "transition-transform",
          "duration-200",
          "ease-out"
        );
      });
    };
  }, [items]);

  return <div className="relative">{children}</div>;
}