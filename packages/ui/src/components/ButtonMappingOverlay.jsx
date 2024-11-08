import { useEffect, useState } from "react";

export default function ButtonMappingOverlay({ show, onClose, activeButton }) {
  const [preloadedImages, setPreloadedImages] = useState({});
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const preloadImages = () => {
      const images = {};
      [1, 2, 3, 4].forEach((buttonNum) => {
        const imageUrl = localStorage.getItem(`button${buttonNum}Image`);
        if (imageUrl) {
          const img = new Image();
          img.src = imageUrl;
          images[buttonNum] = imageUrl;
        }
      });
      setPreloadedImages(images);
    };

    preloadImages();
    const intervalId = setInterval(preloadImages, 1000);
    return () => clearInterval(intervalId);
  }, []);

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

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center transition-all duration-300 ease-in-out ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/80" />
      <div
        className={`relative grid grid-cols-4 gap-4 w-full max-w-7xl px-8 pt-8 transition-all duration-300 delay-[50ms] ${
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
        }`}
      >
        {[1, 2, 3, 4].map((buttonNum) => {
          const image = preloadedImages[buttonNum];
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
