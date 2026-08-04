import React, { useEffect, useState, useRef, memo } from "react";
import { useSpotifyWebSocket } from "../../../hooks/useSpotifyWebSocket";
import {
  getActivePresetDeviceId,
  getButtonMappingValue,
} from "../../../utils/presetStorage";
type ImageCache = Record<string, string>;
type ImageTypes = Record<string, string | null>;

interface ButtonMappingOverlayProps {
  show: boolean;
  activeButton?: string | number | null;
}

const ButtonMappingOverlay = memo(function ButtonMappingOverlay({
  show,
  activeButton: externalActiveButton,
}: ButtonMappingOverlayProps) {
  const [preloadedImages, setPreloadedImages] = useState<ImageCache>({});
  const [imageTypes, setImageTypes] = useState<ImageTypes>({});
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [internalActiveButton, setInternalActiveButton] = useState<
    string | number | null | undefined
  >(null);
  const preloadImagesCacheRef = useRef<ImageCache>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const abortControllersRef = useRef(new Map<string, AbortController>());

  const { fetchImage, isSpotifyReady } = useSpotifyWebSocket();

  useEffect(() => {
    const preloadImages = async () => {
      const images: ImageCache = {};
      const types: ImageTypes = {};
      let hasChanged = false;
      const deviceId = getActivePresetDeviceId();

      const promises = [1, 2, 3, 4].map(async (buttonNum) => {
        const imageUrl = getButtonMappingValue(buttonNum, "Image", deviceId);
        const contentType = getButtonMappingValue(buttonNum, "Type", deviceId);
        const cacheKey = `${deviceId}:${buttonNum}`;

        if (imageUrl) {
          const isLocalImage =
            imageUrl.startsWith("/images/") || imageUrl.startsWith("images/");

          if (
            !preloadImagesCacheRef.current[cacheKey] ||
            preloadImagesCacheRef.current[cacheKey] !== imageUrl
          ) {
            if (isLocalImage) {
              const img = new Image();
              img.src = imageUrl;
              preloadImagesCacheRef.current[cacheKey] = imageUrl;
              preloadImagesCacheRef.current[`${cacheKey}:data`] = imageUrl;
              hasChanged = true;
              images[buttonNum] = imageUrl;
              types[buttonNum] = contentType;
            } else {
              if (!isSpotifyReady) {
                return;
              }
              try {
                const abortController = new AbortController();
                abortControllersRef.current.set(imageUrl, abortController);

                const result = await fetchImage(
                  imageUrl,
                  abortController.signal,
                );

                abortControllersRef.current.delete(imageUrl);

                if (result && result.data) {
                  let blobUrl: string;
                  const imageData = result.data;

                  if (typeof imageData === "string") {
                    if (
                      imageData.startsWith("data:") ||
                      imageData.startsWith("blob:")
                    ) {
                      blobUrl = imageData;
                    } else {
                      blobUrl = `data:image/jpeg;base64,${imageData}`;
                    }
                  } else if (imageData instanceof ArrayBuffer) {
                    const blob = new Blob([imageData], { type: "image/jpeg" });
                    blobUrl = URL.createObjectURL(blob);
                    blobUrlsRef.current.push(blobUrl);
                  } else if (imageData instanceof Uint8Array) {
                    const bytes = imageData.buffer.slice(
                      imageData.byteOffset,
                      imageData.byteOffset + imageData.byteLength,
                    ) as ArrayBuffer;
                    const blob = new Blob([bytes], { type: "image/jpeg" });
                    blobUrl = URL.createObjectURL(blob);
                    blobUrlsRef.current.push(blobUrl);
                  } else {
                    blobUrl = String(imageData);
                  }

                  const img = new Image();
                  img.src = blobUrl;

                  preloadImagesCacheRef.current[cacheKey] = imageUrl;
                  preloadImagesCacheRef.current[`${cacheKey}:data`] = blobUrl;
                  hasChanged = true;
                  images[buttonNum] = blobUrl;
                  types[buttonNum] = contentType;
                }
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message === "Request cancelled"
                ) {
                  return;
                }
                console.error(
                  `Failed to fetch image for button ${buttonNum}:`,
                  error,
                );
              }
            }
          } else {
            const cachedData =
              preloadImagesCacheRef.current[`${cacheKey}:data`];
            if (cachedData) {
              images[buttonNum] = cachedData;
              types[buttonNum] = contentType;
            }
          }
        }
      });

      await Promise.all(promises);

      const typeKeys = new Set([
        ...Object.keys(types),
        ...Object.keys(imageTypes),
      ]);
      const typesChanged = Array.from(typeKeys).some(
        (key) => types[key] !== imageTypes[key],
      );

      if (
        hasChanged ||
        Object.keys(images).length !== Object.keys(preloadedImages).length ||
        typesChanged
      ) {
        setPreloadedImages(images);
        setImageTypes(types);
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
  }, [show, preloadedImages, imageTypes, fetchImage, isSpotifyReady]);

  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      abortControllersRef.current.clear();

      blobUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrlsRef.current = [];
    };
  }, []);

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
            const contentType = imageTypes[buttonNum];
            const isArtist = contentType === "artist";
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
                    <div className="aspect-square w-full p-1 transition-all duration-300">
                      <img
                        src={image}
                        alt={`Button ${buttonNum} mapping`}
                        className={`w-full h-full object-cover shadow-lg max-w-[152px] max-h-[152px] ${
                          isArtist ? "rounded-full" : "rounded-lg"
                        }`}
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
