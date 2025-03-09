import { useState, useEffect, useRef } from "react";
import { useNavigation } from "../../../hooks/useNavigation";

export default function HorizontalScroll({
  children,
  containerRef,
  accessToken,
  currentlyPlayingId,
  activeSection,
  onItemSelect,
}) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new MutationObserver(() => {
      const scrollableItems = Array.from(containerRef.current.children);
      setItems(scrollableItems);
    });

    observer.observe(containerRef.current, {
      childList: true,
    });

    const scrollableItems = Array.from(containerRef.current.children);
    setItems(scrollableItems);

    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  const handleItemFocus = (index, item) => {};

  const handleItemSelect = (index, item) => {
    if (onItemSelect) {
      onItemSelect(index, item);
      return;
    }

    const link = item?.querySelector("a");
    if (link?.getAttribute("href")) {
      window.location.href = link.getAttribute("href");
    }
  };

  const { selectedIndex } = useNavigation({
    containerRef,
    activeSection,
    enableScrollTracking: true,
    enableWheelNavigation: true,
    enableKeyboardNavigation: true,
    enableItemSelection: true,
    items,
    currentlyPlayingId,
    onItemFocus: handleItemFocus,
    onItemSelect: handleItemSelect,
    inactivityTimeout: 3000,
  });

  return <div className="relative">{children}</div>;
}
