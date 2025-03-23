import React, { useEffect, useRef, useCallback } from "react";

const Drawer = ({ isOpen, onClose, children }) => {
  const drawerRef = useRef(null);
  const backdropRef = useRef(null);

  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDraggingRef = useRef(false);

  const initialRenderRef = useRef(true);

  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      if (isOpen && drawerRef.current) {
        drawerRef.current.style.transform = "translateY(0)";
      }
      return;
    }

    const drawer = drawerRef.current;
    const backdrop = backdropRef.current;

    if (!drawer || !backdrop) return;

    if (isOpen) {
      drawer.style.transition = "none";
      drawer.style.transform = "translateY(100%)";
      backdrop.style.transition = "none";
      backdrop.style.opacity = "0";

      drawer.offsetHeight;

      requestAnimationFrame(() => {
        drawer.style.transition =
          "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
        drawer.style.transform = "translateY(0)";
        backdrop.style.transition =
          "opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)";
        backdrop.style.opacity = "0.5";
      });
    } else {
      drawer.style.transition = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
      drawer.style.transform = "translateY(100%)";
      backdrop.style.transition = "opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)";
      backdrop.style.opacity = "0";
    }
  }, [isOpen]);

  const handleTouchStart = useCallback((e) => {
    startYRef.current = e.touches[0].clientY;
    isDraggingRef.current = true;

    const drawer = drawerRef.current;
    if (drawer) {
      drawer.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isDraggingRef.current) return;

    const touchY = e.touches[0].clientY;
    const diff = touchY - startYRef.current;

    if (diff > 0) {
      e.preventDefault();
      currentYRef.current = diff;

      const drawer = drawerRef.current;
      if (drawer) {
        drawer.style.transform = `translateY(${diff}px)`;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    isDraggingRef.current = false;

    const drawer = drawerRef.current;
    if (!drawer) return;

    drawer.style.transition = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";

    if (currentYRef.current > 100) {
      drawer.style.transform = "translateY(100%)";

      setTimeout(() => {
        onClose();
      }, 300);
    } else {
      drawer.style.transform = "translateY(0)";
      currentYRef.current = 0;
    }
  }, [onClose]);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;

    drawer.addEventListener("touchstart", handleTouchStart, { passive: false });
    drawer.addEventListener("touchmove", handleTouchMove, { passive: false });
    drawer.addEventListener("touchend", handleTouchEnd);

    return () => {
      drawer.removeEventListener("touchstart", handleTouchStart);
      drawer.removeEventListener("touchmove", handleTouchMove);
      drawer.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <>
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black z-40"
        style={{
          opacity: 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={onClose}
      />

      <div
        ref={drawerRef}
        className="fixed left-0 right-0 bottom-0 bg-[#161616] rounded-t-[17px] z-50"
        style={{
          maxHeight: "90vh",
          overflowY: "auto",
          transform: "translateY(100%)",
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        <div className="py-3 flex justify-center cursor-grab">
          <div className="w-12 h-1.5 bg-zinc-300 rounded-full" />
        </div>

        <div className="pb-4">{children}</div>
      </div>
    </>
  );
};

export const DrawerTrigger = ({ children, onClick }) => {
  return React.cloneElement(children, { onClick });
};

export const DrawerContent = ({ children }) => {
  return <>{children}</>;
};

export default Drawer;
