import { useEffect, useState } from "react";

export default function ButtonMappingOverlay({ show, onClose, activeButton }) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
      setIsVisible(true);

      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [show]);

  useEffect(() => {
    if (!isVisible && shouldRender) {
      const timer = setTimeout(() => {
        setShouldRender(false);
        onClose();
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [isVisible, shouldRender, onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center bg-black/80 ${
        isVisible ? "overlay-fadeIn" : "overlay-fadeOut"
      }`}
    >
      <div className="grid grid-cols-4 gap-4 w-full max-w-7xl px-8 pt-8">
        {[1, 2, 3, 4].map((buttonNum) => {
          const image = localStorage.getItem(`button${buttonNum}Image`);
          if (!image) return <div key={buttonNum} className="aspect-square" />;

          const isActive = String(buttonNum) === activeButton;

          return (
            <div key={buttonNum} className="relative aspect-square">
              <div
                className={`h-full w-full rounded-lg p-2 ${
                  isActive ? "ring-4 ring-white ring-opacity-80" : ""
                }`}
              >
                <img
                  src={image}
                  alt={`Button ${buttonNum} mapping`}
                  className="w-full h-full object-cover rounded-lg shadow-lg"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
