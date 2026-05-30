import { useState, useEffect, useCallback, useRef } from "react";
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
  skipFetchWhenNowPlaying = false,
  isReceivingNowPlayingUpdates = false,
  disableSpotifyFetch = false,
  ...props
}) {
  const {
    loadImage,
    getImageSize,
    cancelRequest,
    addUrlListener,
    hasImageFailed,
    isSpotifyReady,
  } = useImageLoader({ subscribe: false });
  const [currentSrc, setCurrentSrc] = useState(fallbackSrc);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [, forceUpdate] = useState({});
  const isMountedRef = useRef(true);
  const currentImageUrlRef = useRef(null);
  const blobUrlRef = useRef(null);
  const failedImageUrlRef = useRef(null);

  const imageUrl = getImageSize(images, preferredSizeIndex);

  useEffect(() => {
    if (!imageUrl) {
      return undefined;
    }

    return addUrlListener(imageUrl, () => {
      if (isMountedRef.current) {
        forceUpdate({});
      }
    });
  }, [imageUrl, addUrlListener]);

  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current && blobUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const loadImageData = useCallback(async () => {
    if (!isMountedRef.current) return;

    if (failedImageUrlRef.current && failedImageUrlRef.current === imageUrl) {
      setCurrentSrc(fallbackSrc);
      setHasError(true);
      setIsLoading(false);
      return;
    }

    if (!imageUrl || hasImageFailed(imageUrl)) {
      setCurrentSrc(fallbackSrc);
      setHasError(true);
      setIsLoading(false);
      return;
    }

    if (imageUrl === fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    const isLocalUrl =
      imageUrl.startsWith("/") ||
      imageUrl.startsWith("./") ||
      imageUrl.startsWith("../") ||
      imageUrl.startsWith("blob:") ||
      imageUrl.startsWith("data:") ||
      (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"));

    if (useDirectUrl || isLocalUrl) {
      if (!imageUrl.startsWith("blob:")) {
        cleanupBlobUrl();
      }
      setCurrentSrc(imageUrl);
      setIsLoading(false);
      setHasError(false);

      if (extractColors && onColorsExtracted) {
        import("../../utils/colorExtractor").then(
          ({ extractColorsFromImage }) => {
            extractColorsFromImage(imageUrl).then((colors) => {
              if (colors && onColorsExtracted && isMountedRef.current) {
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

    if (
      disableSpotifyFetch ||
      (skipFetchWhenNowPlaying && isReceivingNowPlayingUpdates)
    ) {
      cancelRequest(imageUrl);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      const result = await loadImage(imageUrl, priority, extractColors);
      if (!isMountedRef.current) return;

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

        if (!isMountedRef.current) {
          if (blobUrl.startsWith("blob:")) {
            URL.revokeObjectURL(blobUrl);
          }
          return;
        }

        cleanupBlobUrl();
        blobUrlRef.current = blobUrl;
        setCurrentSrc(blobUrl);

        if (onLoad) {
          onLoad();
        }
      } else {
        throw new Error("No image data received");
      }
    } catch (error) {
      if (!isMountedRef.current) return;

      if (error.message === "Request cancelled") {
        return;
      }

      console.error("Failed to load image:", error);
      if (imageUrl) {
        failedImageUrlRef.current = imageUrl;
      }
      setCurrentSrc(fallbackSrc);
      setHasError(true);

      if (onError) {
        onError(error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    imageUrl,
    loadImage,
    priority,
    extractColors,
    fallbackSrc,
    hasImageFailed,
    onLoad,
    onError,
    onColorsExtracted,
    useDirectUrl,
    cleanupBlobUrl,
    skipFetchWhenNowPlaying,
    isReceivingNowPlayingUpdates,
    disableSpotifyFetch,
    cancelRequest,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (currentImageUrlRef.current) {
        cancelRequest(currentImageUrlRef.current);
      }
      cleanupBlobUrl();
    };
  }, [cancelRequest, cleanupBlobUrl]);

  useEffect(() => {
    if (currentImageUrlRef.current && currentImageUrlRef.current !== imageUrl) {
      cancelRequest(currentImageUrlRef.current);
    }
    currentImageUrlRef.current = imageUrl;

    if (imageUrl) {
      loadImageData();
    } else {
      cleanupBlobUrl();
      setCurrentSrc(fallbackSrc);
      setHasError(false);
      setIsLoading(false);
    }
  }, [imageUrl, loadImageData, fallbackSrc, cancelRequest, cleanupBlobUrl]);

  useEffect(() => {
    if (failedImageUrlRef.current && failedImageUrlRef.current !== imageUrl) {
      failedImageUrlRef.current = null;
    }
  }, [imageUrl]);

  useEffect(() => {
    if (
      isSpotifyReady &&
      imageUrl &&
      currentSrc === fallbackSrc &&
      !isLoading &&
      !hasImageFailed(imageUrl) &&
      !(skipFetchWhenNowPlaying && isReceivingNowPlayingUpdates)
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
    skipFetchWhenNowPlaying,
    isReceivingNowPlayingUpdates,
  ]);

  const handleImageError = useCallback(() => {
    if (!isMountedRef.current) return;
    if (imageUrl) {
      failedImageUrlRef.current = imageUrl;
    }
    if (currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setHasError(true);

      if (onError) {
        onError(new Error("Image failed to load"));
      }
    }
  }, [currentSrc, fallbackSrc, onError, imageUrl]);

  const handleImageLoad = useCallback(() => {
    if (!isMountedRef.current) return;
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
