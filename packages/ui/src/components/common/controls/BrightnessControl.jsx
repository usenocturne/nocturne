import { useEffect, useState } from "react";
import classNames from "classnames";

export default function BrightnessControl({ show }) {
  const [brightness, setBrightness] = useState(100);
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
      const fadeInTimer = setTimeout(() => {
        setIsVisible(true);
      }, 10);
      return () => clearTimeout(fadeInTimer);
    } else {
      setIsVisible(false);
      const unmountTimer = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(unmountTimer);
    }
  }, [show]);

  useEffect(() => {
    const handleWheel = (event) => {
      if (show) {
        event.preventDefault();
        setBrightness((prev) => {
          const newValue = prev + (event.deltaX > 0 ? 2 : -2);
          return Math.max(0, Math.min(100, newValue));
        });
      }
    };

    const handleKeyDown = (event) => {
      if (show && ["1", "2", "3", "4", "Escape", "Enter"].includes(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [show]);

  if (!shouldRender) return null;

  return (
    <div
      className={classNames(
        "fixed right-0 top-[70px] transform transition-opacity duration-300 z-50",
        {
          "opacity-0 volumeOutScale": !isVisible,
          "opacity-100 volumeInScale": isVisible,
        }
      )}
    >
      <div className="w-14 h-44 bg-black/20 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden">
        <div
          className={classNames(
            "bg-white w-full transition-all duration-200 ease-out",
            {
              "rounded-b-[13px]": brightness < 100,
              "rounded-[13px]": brightness === 100,
            }
          )}
          style={{ height: `${brightness ?? 100}%` }}
        >
          <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7"></div>
        </div>
      </div>
    </div>
  );
}
