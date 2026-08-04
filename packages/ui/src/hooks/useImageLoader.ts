import { useState, useCallback, useEffect } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { extractColorsFromImageData } from "../utils/colorExtractor";
import type { SpotifyImage } from "../types";

type ImageData = string | ArrayBuffer | Uint8Array;
type ImageColors = string[] | null;
type ImageResult = { data: ImageData | null; colors: ImageColors };
type ImageFetchResult = { data?: ImageData | null };
type ImageFetchFn = (
  url: string,
  signal?: AbortSignal,
) => Promise<ImageFetchResult | null | undefined>;
type QueueState = {
  loadingImages: Set<string>;
  failedImages: Set<string>;
};
type QueueListener = (state: QueueState) => void;
type ImageRequestListener = {
  resolve: (value: ImageResult | PromiseLike<ImageResult>) => void;
  reject: (reason?: unknown) => void;
  extractColors: boolean;
  abortController: AbortController;
};
type CacheEntry = {
  data: ImageData | null;
  colors: ImageColors;
  timestamp: number;
  colorPromise: Promise<ImageColors> | null;
};
type FailureEntry = {
  error: unknown;
  timestamp: number;
  extractColors?: boolean;
  fetchImageFn?: ImageFetchFn;
};
type QueueItem = {
  url: string;
  priority: number;
  extractColors: boolean;
  fetchImageFn: ImageFetchFn;
  isSpotifyReady: boolean;
  listeners: ImageRequestListener[];
};
type ActiveRequest = {
  listeners: ImageRequestListener[];
  extractColors: boolean;
  fetchImageFn: ImageFetchFn;
  abortController: AbortController;
};

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

const normalizeErrorMessage = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return (error.message || "").toLowerCase();
  if (typeof error === "object" && "message" in error) {
    return String(error.message || "").toLowerCase();
  }
  return String(error).toLowerCase();
};

const isPermanentError = (error: unknown): boolean => {
  const message = normalizeErrorMessage(error);
  if (!message) return false;
  return PERMANENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

class ImageLoadQueue {
  queue: QueueItem[] = [];
  isProcessing = false;
  isSpotifyReady = false;
  failedImages = new Map<string, FailureEntry>();
  failureTtlMs = 5 * 60 * 1000;
  loadingImages = new Set<string>();
  activeRequests = new Map<string, ActiveRequest>();
  retryCount = new Map<string, number>();
  maxRetries = 3;
  maxExtendedRetries = 10;
  retryDelay = 0;
  listeners = new Set<QueueListener>();
  urlListeners = new Map<string, Set<QueueListener>>();
  cache = new Map<string, CacheEntry>();
  cacheTtlMs = 5 * 60 * 1000;
  imageFetchDelayMs = 150;
  maxConcurrent = 2;
  interLaunchDelayMs = 60;
  activeWorkers = 0;

  addListener(callback: QueueListener): () => boolean {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  addUrlListener(
    url: string | null | undefined,
    callback: QueueListener,
  ): () => void {
    if (!url) {
      return () => {};
    }

    if (!this.urlListeners.has(url)) {
      this.urlListeners.set(url, new Set());
    }

    const listeners = this.urlListeners.get(url);
    listeners.add(callback);

    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.urlListeners.delete(url);
      }
    };
  }

  notifyListeners(url: string | null = null): void {
    const failedImages = new Set(this.getActiveFailedImages());
    const loadingImages = new Set(this.loadingImages);
    const state = { loadingImages, failedImages };

    this.listeners.forEach((callback) => callback(state));

    if (url === null) {
      this.urlListeners.forEach((callbacks) => {
        callbacks.forEach((callback) => callback(state));
      });
      return;
    }

    const urlCallbacks = this.urlListeners.get(url);
    if (urlCallbacks) {
      urlCallbacks.forEach((callback) => callback(state));
    }
  }

  getActiveFailedImages(): string[] {
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

  markImageFailed(url: string, error: unknown): void {
    this.failedImages.set(url, {
      error,
      timestamp: Date.now(),
    });
  }

  getFailure(url: string): FailureEntry | null {
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

  getCachedEntry(url: string): CacheEntry | null {
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

  setCache(
    url: string,
    data: ImageData | null,
    colors: ImageColors | undefined = undefined,
  ): void {
    const existing = this.cache.get(url);

    const entry = {
      data: data ?? existing?.data ?? null,
      colors: colors !== undefined ? colors : (existing?.colors ?? null),
      timestamp: Date.now(),
      colorPromise: null,
    };

    this.cache.set(url, entry);
  }

  handleCacheHit(
    url: string,
    entry: CacheEntry,
    listener: ImageRequestListener,
    requireColors: boolean,
  ): boolean {
    if (!requireColors) {
      listener.resolve({ data: entry.data, colors: entry.colors ?? null });
      return true;
    }

    if (entry.colors) {
      listener.resolve({ data: entry.data, colors: entry.colors });
      return true;
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
        listener.resolve({ data: entry.data, colors: colors ?? null });
      })
      .catch(() => {
        listener.resolve({ data: entry.data, colors: null });
      });

    return false;
  }

  async loadImage(
    url: string,
    priority = 0,
    extractColors = false,
    fetchImageFn: ImageFetchFn,
    isSpotifyReady: boolean,
  ) {
    return new Promise<ImageResult>((resolve, reject) => {
      if (!url) {
        reject(new Error("No URL provided"));
        return;
      }

      this.isSpotifyReady = isSpotifyReady;

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

      this.processQueue();
    });
  }

  cancelRequest(url: string): void {
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
      this.notifyListeners(url);
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
      this.notifyListeners(url);
    }
  }

  async processQueue(): Promise<void> {
    if (
      this.activeWorkers >= this.maxConcurrent ||
      !this.isSpotifyReady ||
      this.queue.length === 0
    ) {
      return;
    }

    const queueItem = this.queue.shift();
    if (!queueItem) {
      return;
    }

    this.activeWorkers++;
    this.isProcessing = true;

    if (this.queue.length > 0 && this.activeWorkers < this.maxConcurrent) {
      setTimeout(() => this.processQueue(), this.interLaunchDelayMs);
    }

    try {
      await this._processItem(queueItem);
    } finally {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.isProcessing = this.activeWorkers > 0;
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  async _processItem(queueItem: QueueItem): Promise<void> {
    const { url, extractColors, fetchImageFn, isSpotifyReady, listeners } =
      queueItem;

    if (!isSpotifyReady || !this.isSpotifyReady) {
      this.queue.unshift({
        ...queueItem,
        isSpotifyReady: this.isSpotifyReady,
      });
      return;
    }

    const failure = this.getFailure(url);
    if (failure) {
      const failureMessage =
        failure?.error instanceof Error
          ? failure.error.message
          : failure?.error || `Image failed to load: ${url}`;
      listeners.forEach(({ reject }) => reject(new Error(failureMessage)));
      return;
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
    this.notifyListeners(url);

    await new Promise<void>((resolve) =>
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

        this.notifyListeners(url);

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
      if (error instanceof Error && error.message === "Request cancelled") {
        this.loadingImages.delete(url);
        this.activeRequests.delete(url);
        this.notifyListeners(url);
        return;
      }

      console.error(`Error fetching image ${url}:`, error);

      const retryCount = this.retryCount.get(url) || 0;
      const activeRequest = this.activeRequests.get(url);
      const requestListeners = activeRequest?.listeners || listeners;

      if (retryCount < this.maxRetries) {
        this.retryCount.set(url, retryCount + 1);
        this.loadingImages.delete(url);
        this.activeRequests.delete(url);
        this.notifyListeners(url);
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
        this.notifyListeners(url);

        await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));

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
      } else {
        if (isPermanentError(error)) {
          this.markImageFailed(url, error);
        }
        this.retryCount.delete(url);
        this.loadingImages.delete(url);
        this.activeRequests.delete(url);
        this.notifyListeners(url);
        requestListeners.forEach(({ reject }) => reject(error));
      }
    }
  }

  updateQueueReadyState(isSpotifyReady: boolean): void {
    this.isSpotifyReady = isSpotifyReady;

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

    if (isSpotifyReady && this.queue.length > 0) {
      this.processQueue();
    }

    this.notifyListeners(null);
  }

  clearCache(): void {
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
    this.isProcessing = this.activeWorkers > 0;
    this.activeRequests.clear();
    this.cache.clear();
    this.notifyListeners(null);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isImageLoading(url: string): boolean {
    return this.loadingImages.has(url);
  }

  hasImageFailed(url: string): boolean {
    return Boolean(this.getFailure(url));
  }
}

const globalImageQueue = new ImageLoadQueue();

export function getImageLoaderState() {
  return {
    activeWorkers: globalImageQueue.activeWorkers ?? 0,
    queueLength: globalImageQueue.queue?.length ?? 0,
    cacheSize: globalImageQueue.cache?.size ?? 0,
  };
}

export function useImageLoader(options: { subscribe?: boolean } = {}) {
  const { subscribe = true } = options;
  const { fetchImage, isSpotifyReady } = useSpotifyWebSocket();
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (!subscribe) {
      return undefined;
    }

    const unsubscribe = globalImageQueue.addListener(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, [subscribe]);

  const loadImage = useCallback(
    (url: string, priority = 0, extractColors = false) => {
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

  const cancelRequest = useCallback((url: string) => {
    globalImageQueue.cancelRequest(url);
  }, []);

  const getImageSize = useCallback(
    (images: SpotifyImage[] | null | undefined, preferredIndex = 1) => {
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
    },
    [],
  );

  const isImageLoading = useCallback((url: string) => {
    return globalImageQueue.isImageLoading(url);
  }, []);

  const hasImageFailed = useCallback((url: string) => {
    return Boolean(globalImageQueue.getFailure(url));
  }, []);

  const clearCache = useCallback(() => {
    globalImageQueue.clearCache();
  }, []);

  const addUrlListener = useCallback(
    (url: string | null | undefined, callback: QueueListener) => {
      return globalImageQueue.addUrlListener(url, callback);
    },
    [],
  );

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
    addUrlListener,
    queueLength: globalImageQueue.getQueueLength(),
    isSpotifyReady,
  };
}
