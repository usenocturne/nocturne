import React, { useEffect, useState, useRef, memo } from "react";

const ButtonMappingOverlay = memo(function ButtonMappingOverlay({
  show,
  activeButton: externalActiveButton,
}) {
  const [preloadedImages, setPreloadedImages] = useState({});
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [internalActiveButton, setInternalActiveButton] = useState(null);
  const preloadImagesCacheRef = useRef({});
  const timerRef = useRef(null);

  useEffect(() => {
    const preloadImages = () => {
      const images = {};
      let hasChanged = false;

      [1, 2, 3, 4].forEach((buttonNum) => {
        const imageUrl = localStorage.getItem(`button${buttonNum}Image`);
        if (imageUrl) {
          if (
            !preloadImagesCacheRef.current[buttonNum] ||
            preloadImagesCacheRef.current[buttonNum] !== imageUrl
          ) {
            const img = new Image();
            img.src = imageUrl;
            preloadImagesCacheRef.current[buttonNum] = imageUrl;
            hasChanged = true;
          }
          images[buttonNum] = imageUrl;
        }
      });

      if (
        hasChanged ||
        Object.keys(images).length !== Object.keys(preloadedImages).length
      ) {
        setPreloadedImages(images);
      }
    };

    preloadImages();

    if (show) {
      timerRef.current = setInterval(preloadImages, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [show, preloadedImages]);

  useEffect(() => {
    if (show) {
      setInternalActiveButton(externalActiveButton);
      setShouldRender(true);

      const fadeInTimer = setTimeout(() => {
        setIsVisible(true);
      }, 10);

      return () => clearTimeout(fadeInTimer);
    } else {
      setIsVisible(false);

      const unmountTimer = setTimeout(() => {
        setShouldRender(false);
        setInternalActiveButton(null);
      }, 300);

      return () => clearTimeout(unmountTimer);
    }
  }, [show, externalActiveButton]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center transition-opacity duration-300 ease-in-out ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/80" />
      <div className="relative w-[800px] pt-4 px-[23px]">
        <div
          className={
            isVisible ? "mapping-overlay-enter" : "mapping-overlay-exit"
          }
        >
          {[1, 2, 3, 4].map((buttonNum, index) => {
            const image = preloadedImages[buttonNum];
            const isActive = String(buttonNum) === String(internalActiveButton);
            let marginClass = "";
            if (index === 1) marginClass = "ml-[40px]";
            if (index === 2) marginClass = "ml-[40px]";
            if (index === 3) marginClass = "ml-[40px]";

            return (
              <div key={buttonNum} className={`relative ${marginClass}`}>
                <div className="flex flex-col items-center w-[160px]">
                  <div
                    className={`w-20 h-1.5 rounded-full mb-4 transition-colors duration-300 ${
                      isActive ? "bg-white" : "bg-white/25"
                    }`}
                    aria-hidden="true"
                  />
                  <div
                    className={`text-[28px] font-[560] mb-4 transition-colors duration-300 ${
                      isActive ? "text-white" : "text-white/60"
                    }`}
                  >
                    {buttonNum}
                  </div>
                  {image && (
                    <div className="aspect-square w-full rounded-lg p-1 transition-all duration-300">
                      <img
                        src={image}
                        alt={`Button ${buttonNum} mapping`}
                        className="w-full h-full object-cover rounded-lg shadow-lg"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default ButtonMappingOverlay;
