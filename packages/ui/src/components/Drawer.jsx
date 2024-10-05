import React, { useState, useEffect, useCallback, useRef } from "react";

const Drawer = ({ isOpen, onClose, children }) => {
  const [isRendered, setIsRendered] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [dragPosition, setDragPosition] = useState(0);
  const dragStartY = useRef(0);
  const drawerRef = useRef(null);

  const handleClose = useCallback(() => {
    setIsAnimating(true);
    setDragPosition(0);
    setTimeout(() => {
      setIsRendered(false);
      setIsAnimating(false);
      onClose();
    }, 300);
  }, [onClose]);

  useEffect(() => {
    if (isOpen && !isRendered) {
      setIsRendered(true);
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    } else if (!isOpen && isRendered) {
      handleClose();
    }
  }, [isOpen, isRendered, handleClose]);

  useEffect(() => {
    if (isRendered) {
      document.body.style.overscrollBehavior = "none";
    } else {
      document.body.style.overscrollBehavior = "auto";
    }

    return () => {
      document.body.style.overscrollBehavior = "auto";
    };
  }, [isRendered]);

  const handleTouchStart = (e) => {
    dragStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    const currentY = e.touches[0].clientY;
    const diff = currentY - dragStartY.current;
    if (diff > 0) {
      e.preventDefault();
      setDragPosition(diff);
    } else if (
      drawerRef.current &&
      drawerRef.current.scrollTop === 0 &&
      diff < 0
    ) {
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (dragPosition > 100) {
      handleClose();
    } else {
      setDragPosition(0);
    }
  };

  const handleMouseDown = (e) => {
    dragStartY.current = e.clientY;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e) => {
    const currentY = e.clientY;
    const diff = currentY - dragStartY.current;
    if (diff > 0) {
      setDragPosition(diff);
    }
  };

  const handleMouseUp = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    if (dragPosition > 100) {
      handleClose();
    } else {
      setDragPosition(0);
    }
  };

  if (!isRendered && !isAnimating) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 ${
          isRendered && !isAnimating ? "bg-opacity-50" : "bg-opacity-0"
        }`}
        style={{ zIndex: 40 }}
        onClick={handleClose}
      />

      <div
        className="fixed inset-0"
        style={{ zIndex: 45, pointerEvents: isRendered ? "auto" : "none" }}
      />

      <div
        ref={drawerRef}
        className={`fixed left-0 right-0 bottom-0 bg-black bg-opacity-40 backdrop-blur-2xl rounded-t-[17px] transition-transform duration-300 ease-out`}
        style={{
          zIndex: 50,
          maxHeight: "90vh",
          overflowY: "auto",
          transform: `translateY(${
            isRendered && !isAnimating ? dragPosition : 100
          }%)`,
          overscrollBehavior: "contain",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="w-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <div className="mx-auto w-12 h-1.5 bg-zinc-300 rounded-full mt-3" />
        </div>
        <div className="pb-4 flex-1">{children}</div>
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
