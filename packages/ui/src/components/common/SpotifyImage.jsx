import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useImageLoader } from "../../hooks/useImageLoader";

export default function SpotifyImage({
  images,
  preferredSizeIndex = 1,
  alt = "",
  className = "",
  style = {},
  priority = 0,
  fallbackSrc = "/images/not-playing.webp",
  onLoad = null,
  onError = null,
  extractColors = false,
  onColorsExtracted = null,
  useDirectUrl = false,
  ...props
}) {
  const {
    loadImage,
    getImageSize,
    isImageLoading,
    hasImageFailed,
    isSpotifyReady,
  } = useImageLoader();
  const [currentSrc, setCurrentSrc] = useState(fallbackSrc);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const imageUrl = getImageSize(images, preferredSizeIndex);

  const delayMs = useMemo(() => {
    const maxPriority = 100;
    return Math.max(0, maxPriority - priority) * 100;
  }, [priority]);

  const loadImageData = useCallback(async () => {
    if (!imageUrl || hasImageFailed(imageUrl)) {
      setCurrentSrc(fallbackSrc);
      setHasError(true);
      return;
    }

    if (useDirectUrl) {
      setCurrentSrc(imageUrl);
      setIsLoading(false);
      setHasError(false);

      if (extractColors && onColorsExtracted) {
        import("../../utils/colorExtractor").then(
          ({ extractColorsFromImage }) => {
            extractColorsFromImage(imageUrl).then((colors) => {
              if (colors && onColorsExtracted) {
                onColorsExtracted(colors);
              }
            });
          },
        );
      }

      if (onLoad) {
        onLoad();
      }
      return;
    }

    if (!isSpotifyReady) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      const result = await loadImage(imageUrl, priority, extractColors);
      const { data: imageData, colors } = result;

      if (colors && onColorsExtracted) {
        onColorsExtracted(colors);
      }

      if (imageData) {
        let blobUrl;
        if (typeof imageData === "string") {
          if (imageData.startsWith("data:") || imageData.startsWith("blob:")) {
            blobUrl = imageData;
          } else {
            blobUrl = `data:image/jpeg;base64,${imageData}`;
          }
        } else if (
          imageData instanceof ArrayBuffer ||
          imageData instanceof Uint8Array
        ) {
          const blob = new Blob([imageData], { type: "image/jpeg" });
          blobUrl = URL.createObjectURL(blob);
        } else {
          blobUrl = String(imageData);
        }

        setCurrentSrc(blobUrl);

        if (onLoad) {
          onLoad();
        }
      } else {
        throw new Error("No image data received");
      }
    } catch (error) {
      console.error("Failed to load image:", error);
      setCurrentSrc(fallbackSrc);
      setHasError(true);

      if (onError) {
        onError(error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    imageUrl,
    loadImage,
    priority,
    extractColors,
    fallbackSrc,
    hasImageFailed,
    isSpotifyReady,
    onLoad,
    onError,
    onColorsExtracted,
    useDirectUrl,
  ]);

  useEffect(() => {
    if (imageUrl) {
      if (delayMs > 0) {
        const timeoutId = setTimeout(() => {
          loadImageData();
        }, delayMs);

        return () => {
          clearTimeout(timeoutId);
          if (currentSrc && currentSrc.startsWith("blob:")) {
            URL.revokeObjectURL(currentSrc);
          }
        };
      } else {
        loadImageData();
      }
    } else {
      setCurrentSrc(fallbackSrc);
      setHasError(false);
      setIsLoading(false);
    }

    return () => {
      if (currentSrc && currentSrc.startsWith("blob:")) {
        URL.revokeObjectURL(currentSrc);
      }
    };
  }, [imageUrl, loadImageData, fallbackSrc, delayMs]);

  useEffect(() => {
    if (
      isSpotifyReady &&
      imageUrl &&
      currentSrc === fallbackSrc &&
      !isLoading &&
      !hasImageFailed(imageUrl)
    ) {
      loadImageData();
    }
  }, [
    isSpotifyReady,
    imageUrl,
    currentSrc,
    fallbackSrc,
    isLoading,
    hasImageFailed,
    loadImageData,
  ]);

  const handleImageError = useCallback(
    (e) => {
      if (currentSrc !== fallbackSrc) {
        setCurrentSrc(fallbackSrc);
        setHasError(true);

        if (onError) {
          onError(new Error("Image failed to load"));
        }
      }
    },
    [currentSrc, fallbackSrc, onError],
  );

  const handleImageLoad = useCallback(() => {
    if (onLoad && !hasError) {
      onLoad();
    }
  }, [onLoad, hasError]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`${className} ${isLoading ? "opacity-75" : ""}`}
      style={style}
      onLoad={handleImageLoad}
      onError={handleImageError}
      {...props}
    />
  );
}
