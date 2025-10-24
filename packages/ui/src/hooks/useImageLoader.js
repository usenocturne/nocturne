import { useState, useCallback, useEffect } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { extractColorsFromImageData } from "../utils/colorExtractor";

const PERMANENT_ERROR_PATTERNS = [
  "not found",
  "invalid",
  "malformed",
  "unsupported",
  "forbidden",
  "unauthorized",
  "permission",
  "denied",
];

const normalizeErrorMessage = (error) => {
  if (!error) return "";
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return (error.message || "").toLowerCase();
  if (typeof error === "object" && "message" in error) {
    return String(error.message || "").toLowerCase();
  }
  return String(error).toLowerCase();
};

const isPermanentError = (error) => {
  const message = normalizeErrorMessage(error);
  if (!message) return false;
  return PERMANENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

class ImageLoadQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.failedImages = new Map();
    this.failureTtlMs = 5 * 60 * 1000;
    this.loadingImages = new Set();
    this.activeRequests = new Map();
    this.retryCount = new Map();
    this.maxRetries = 3;
    this.maxExtendedRetries = 10;
    this.retryDelay = 0;
    this.listeners = new Set();
    this.cache = new Map();
    this.cacheTtlMs = 5 * 60 * 1000;
    this.imageFetchDelayMs = 150;
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    const failedImages = new Set(this.getActiveFailedImages());
    const loadingImages = new Set(this.loadingImages);
    this.listeners.forEach((callback) =>
      callback({ loadingImages, failedImages }),
    );
  }

  getActiveFailedImages() {
    const now = Date.now();
    const active = [];

    for (const [url, meta] of this.failedImages.entries()) {
      if (!meta || typeof meta.timestamp !== "number") {
        this.failedImages.delete(url);
        continue;
      }

      if (now - meta.timestamp <= this.failureTtlMs) {
        active.push(url);
      } else {
        this.failedImages.delete(url);
      }
    }

    return active;
  }

  markImageFailed(url, error) {
    this.failedImages.set(url, {
      error,
      timestamp: Date.now(),
    });
  }

  getFailure(url) {
    const meta = this.failedImages.get(url);
    if (!meta) return null;

    const now = Date.now();
    if (
      typeof meta.timestamp !== "number" ||
      now - meta.timestamp > this.failureTtlMs
    ) {
      this.failedImages.delete(url);
      return null;
    }

    return meta;
  }

  getCachedEntry(url) {
    const entry = this.cache.get(url);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(url);
      return null;
    }

    entry.timestamp = now;
    return entry;
  }

  setCache(url, data, colors = undefined) {
    const existing = this.cache.get(url);

    const entry = {
      data: data ?? existing?.data ?? null,
      colors: colors !== undefined ? colors : (existing?.colors ?? null),
      timestamp: Date.now(),
      colorPromise: null,
    };

    this.cache.set(url, entry);
  }

  handleCacheHit(url, entry, listener, requireColors) {
    const deliver = (colors) => {
      listener.resolve({ data: entry.data, colors: colors ?? null });
    };

    if (!requireColors) {
      deliver(entry.colors ?? null);
      return;
    }

    if (entry.colors) {
      deliver(entry.colors);
      return;
    }

    if (!entry.colorPromise) {
      entry.colorPromise = extractColorsFromImageData(entry.data)
        .then((colors) => {
          entry.colors = colors;
          entry.colorPromise = null;
          entry.timestamp = Date.now();
          return colors;
        })
        .catch((err) => {
          console.error(
            `Error extracting colors from cached image ${url}:`,
            err,
          );
          entry.colorPromise = null;
          return null;
        });
    }

    entry.colorPromise
      .then((colors) => {
        deliver(colors);
      })
      .catch(() => {
        deliver(null);
      });
  }

  async loadImage(
    url,
    priority = 0,
    extractColors = false,
    fetchImageFn,
    isSpotifyReady,
  ) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error("No URL provided"));
        return;
      }

      const abortController = new AbortController();
      const listener = {
        resolve,
        reject,
        extractColors: Boolean(extractColors),
        abortController,
      };

      const cachedEntry = this.getCachedEntry(url);
      if (cachedEntry) {
        this.handleCacheHit(url, cachedEntry, listener, Boolean(extractColors));
        return;
      }

      const failure = this.getFailure(url);
      if (failure) {
        const failureMessage =
          failure?.error instanceof Error
            ? failure.error.message
            : failure?.error || `Image previously failed to load: ${url}`;
        reject(new Error(failureMessage));
        return;
      }

      if (this.activeRequests.has(url)) {
        const active = this.activeRequests.get(url);
        active.listeners.push(listener);
        if (extractColors && !active.extractColors) {
          active.extractColors = true;
        }
        return;
      }

      const existingIndex = this.queue.findIndex((item) => item.url === url);
      if (existingIndex >= 0) {
        const existing = this.queue[existingIndex];
        existing.listeners.push(listener);
        existing.priority = Math.max(priority, existing.priority);
        if (extractColors && !existing.extractColors) {
          existing.extractColors = true;
        }
        existing.fetchImageFn = fetchImageFn;
        existing.isSpotifyReady = isSpotifyReady;
        return;
      }

      const queueItem = {
        url,
        priority,
        extractColors: Boolean(extractColors),
        fetchImageFn,
        isSpotifyReady,
        listeners: [listener],
      };
      const insertIndex = this.queue.findIndex(
        (item) => item.priority < priority,
      );
      if (insertIndex >= 0) {
        this.queue.splice(insertIndex, 0, queueItem);
      } else {
        this.queue.push(queueItem);
      }

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  cancelRequest(url) {
    const activeRequest = this.activeRequests.get(url);
    if (activeRequest) {
      if (activeRequest.abortController) {
        activeRequest.abortController.abort();
      }
      activeRequest.listeners.forEach(({ abortController }) => {
        if (abortController) {
          abortController.abort();
        }
      });
      this.activeRequests.delete(url);
      this.loadingImages.delete(url);
      this.notifyListeners();
    }

    const queueIndex = this.queue.findIndex((item) => item.url === url);
    if (queueIndex >= 0) {
      const queueItem = this.queue[queueIndex];
      queueItem.listeners.forEach(({ abortController }) => {
        if (abortController) {
          abortController.abort();
        }
      });
      this.queue.splice(queueIndex, 1);
    }
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const queueItem = this.queue.shift();
      if (!queueItem) break;

      const { url, extractColors, fetchImageFn, isSpotifyReady, listeners } =
        queueItem;

      if (!isSpotifyReady) {
        this.queue.unshift(queueItem);
        this.isProcessing = false;
        await new Promise((r) => setTimeout(r, 150));
        return;
      }

      const failure = this.getFailure(url);
      if (failure) {
        const failureMessage =
          failure?.error instanceof Error
            ? failure.error.message
            : failure?.error || `Image failed to load: ${url}`;
        listeners.forEach(({ reject }) => reject(new Error(failureMessage)));
        continue;
      }

      const abortController = new AbortController();

      this.loadingImages.add(url);
      this.activeRequests.set(url, {
        listeners: [...listeners],
        extractColors:
          listeners.some((listener) => listener.extractColors) ||
          Boolean(extractColors),
        fetchImageFn,
        abortController,
      });
      this.notifyListeners();

      await new Promise((resolve) =>
        setTimeout(resolve, this.imageFetchDelayMs),
      );

      try {
        const result = await fetchImageFn(url, abortController.signal);
        const activeRequest = this.activeRequests.get(url);
        const requestListeners = activeRequest?.listeners || listeners;
        const shouldExtractColors =
          activeRequest?.extractColors || Boolean(extractColors);

        if (result && result.data) {
          let extractedColors = null;
          if (shouldExtractColors) {
            try {
              extractedColors = await extractColorsFromImageData(result.data);
            } catch (colorError) {
              console.error(`Error extracting colors for ${url}:`, colorError);
            }
          }

          this.loadingImages.delete(url);
          this.retryCount.delete(url);
          this.activeRequests.delete(url);
          this.failedImages.delete(url);
          const colorsForCache = shouldExtractColors
            ? (extractedColors ?? null)
            : undefined;
          this.setCache(url, result.data, colorsForCache);
          const cachedResult = this.getCachedEntry(url) || {
            data: result.data,
            colors: extractedColors ?? null,
          };

          this.notifyListeners();

          requestListeners.forEach(({ resolve }) =>
            resolve({
              data: cachedResult.data,
              colors: cachedResult.colors ?? extractedColors ?? null,
            }),
          );
        } else {
          throw new Error("No image data received");
        }
      } catch (error) {
        if (error.message === "Request cancelled") {
          this.loadingImages.delete(url);
          this.activeRequests.delete(url);
          this.notifyListeners();
          continue;
        }

        console.error(`Error fetching image ${url}:`, error);

        const retryCount = this.retryCount.get(url) || 0;
        const activeRequest = this.activeRequests.get(url);
        const requestListeners = activeRequest?.listeners || listeners;

        if (retryCount < this.maxRetries) {
          this.retryCount.set(url, retryCount + 1);
          this.loadingImages.delete(url);
          this.activeRequests.delete(url);
          this.notifyListeners();
          this.queue.unshift({
            url,
            priority: 100,
            extractColors:
              requestListeners.some((listener) => listener.extractColors) ||
              Boolean(extractColors),
            fetchImageFn,
            isSpotifyReady,
            listeners: requestListeners,
          });
        } else if (retryCount < this.maxRetries + this.maxExtendedRetries) {
          const extendedAttempt = retryCount - this.maxRetries + 1;
          const retryDelay = Math.min(
            2000,
            150 * 2 ** Math.min(extendedAttempt, 4),
          );

          this.retryCount.set(url, retryCount + 1);
          this.loadingImages.delete(url);
          this.activeRequests.delete(url);
          this.notifyListeners();

          await new Promise((resolve) => setTimeout(resolve, retryDelay));

          this.queue.unshift({
            url,
            priority: 90,
            extractColors:
              requestListeners.some((listener) => listener.extractColors) ||
              Boolean(extractColors),
            fetchImageFn,
            isSpotifyReady,
            listeners: requestListeners,
          });

          continue;
        } else {
          if (isPermanentError(error)) {
            this.markImageFailed(url, error);
          }
          this.retryCount.delete(url);
          this.loadingImages.delete(url);
          this.activeRequests.delete(url);
          this.notifyListeners();
          requestListeners.forEach(({ reject }) => reject(error));
        }
      }
    }

    this.isProcessing = false;
  }

  updateQueueReadyState(isSpotifyReady) {
    this.queue.forEach((item) => {
      item.isSpotifyReady = isSpotifyReady;
    });

    if (isSpotifyReady && this.failedImages.size > 0) {
      const failedUrls = Array.from(this.failedImages.keys());
      failedUrls.forEach((url) => {
        const meta = this.failedImages.get(url);
        if (meta) {
          this.failedImages.delete(url);
          this.retryCount.delete(url);
          this.queue.unshift({
            url,
            priority: 100,
            extractColors: meta.extractColors || false,
            fetchImageFn: meta.fetchImageFn,
            isSpotifyReady: true,
            listeners: [],
          });
        }
      });
    }

    if (isSpotifyReady && this.queue.length > 0 && !this.isProcessing) {
      this.processQueue();
    }
  }

  clearCache() {
    this.activeRequests.forEach((request) => {
      if (request.abortController) {
        request.abortController.abort();
      }
      request.listeners.forEach(({ abortController }) => {
        if (abortController) {
          abortController.abort();
        }
      });
    });

    this.queue.forEach((item) => {
      item.listeners.forEach(({ abortController }) => {
        if (abortController) {
          abortController.abort();
        }
      });
    });

    this.failedImages.clear();
    this.loadingImages.clear();
    this.retryCount.clear();
    this.queue = [];
    this.isProcessing = false;
    this.activeRequests.clear();
    this.cache.clear();
    this.notifyListeners();
  }

  getQueueLength() {
    return this.queue.length;
  }

  isImageLoading(url) {
    return this.loadingImages.has(url);
  }

  hasImageFailed(url) {
    return Boolean(this.getFailure(url));
  }
}

const globalImageQueue = new ImageLoadQueue();

export function useImageLoader() {
  const { fetchImage, isSpotifyReady } = useSpotifyWebSocket();
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const unsubscribe = globalImageQueue.addListener(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, []);

  const loadImage = useCallback(
    (url, priority = 0, extractColors = false) => {
      return globalImageQueue.loadImage(
        url,
        priority,
        extractColors,
        fetchImage,
        isSpotifyReady,
      );
    },
    [fetchImage, isSpotifyReady],
  );

  const cancelRequest = useCallback((url) => {
    globalImageQueue.cancelRequest(url);
  }, []);

  const getImageSize = useCallback((images, preferredIndex = 1) => {
    if (!images || !Array.isArray(images) || images.length === 0) {
      return null;
    }

    if (images[preferredIndex]?.url) {
      return images[preferredIndex].url;
    }

    for (const image of images) {
      if (image?.url) {
        return image.url;
      }
    }

    return null;
  }, []);

  const isImageLoading = useCallback((url) => {
    return globalImageQueue.isImageLoading(url);
  }, []);

  const hasImageFailed = useCallback((url) => {
    return Boolean(globalImageQueue.getFailure(url));
  }, []);

  const clearCache = useCallback(() => {
    globalImageQueue.clearCache();
  }, []);

  useEffect(() => {
    globalImageQueue.updateQueueReadyState(isSpotifyReady);
  }, [isSpotifyReady]);

  return {
    loadImage,
    isImageLoading,
    hasImageFailed,
    getImageSize,
    clearCache,
    cancelRequest,
    queueLength: globalImageQueue.getQueueLength(),
    isSpotifyReady,
  };
}
