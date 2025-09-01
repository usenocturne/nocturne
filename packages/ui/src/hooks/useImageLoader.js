import { useState, useCallback, useRef, useEffect } from "react";
import { useSpotifyWebSocket } from "./useSpotifyWebSocket";
import { extractColorsFromImageData } from "../utils/colorExtractor";

class ImageLoadQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.failedImages = new Set();
    this.loadingImages = new Set();
    this.retryCount = new Map();
    this.maxRetries = 3;
    this.listeners = new Set();
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach((callback) =>
      callback({
        loadingImages: new Set(this.loadingImages),
        failedImages: new Set(this.failedImages),
      }),
    );
  }

  async loadImage(
    url,
    priority = 0,
    extractColors = false,
    fetchImageFn,
    wsConnected,
  ) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error("No URL provided"));
        return;
      }

      if (this.failedImages.has(url)) {
        reject(new Error(`Image previously failed to load: ${url}`));
        return;
      }

      const existingIndex = this.queue.findIndex((item) => item.url === url);
      if (existingIndex >= 0) {
        const existing = this.queue[existingIndex];
        if (
          priority > existing.priority ||
          (extractColors && !existing.extractColors)
        ) {
          this.queue[existingIndex] = {
            ...existing,
            priority: Math.max(priority, existing.priority),
            extractColors: extractColors || existing.extractColors,
            resolve,
            reject,
          };
        }
        return;
      }

      const queueItem = {
        url,
        resolve,
        reject,
        priority,
        extractColors,
        fetchImageFn,
        wsConnected,
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

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { url, resolve, reject, extractColors, fetchImageFn, wsConnected } =
        this.queue.shift();

      if (!wsConnected) {
        reject(new Error("WebSocket not connected"));
        continue;
      }

      if (this.failedImages.has(url)) {
        reject(new Error(`Image failed to load: ${url}`));
        continue;
      }

      this.loadingImages.add(url);
      this.notifyListeners();

      try {
        const result = await fetchImageFn(url);

        if (result && result.data) {
          let extractedColors = null;
          if (extractColors) {
            try {
              extractedColors = await extractColorsFromImageData(result.data);
            } catch (colorError) {
              console.error(`Error extracting colors for ${url}:`, colorError);
            }
          }

          this.loadingImages.delete(url);
          this.retryCount.delete(url);
          this.notifyListeners();

          resolve({ data: result.data, colors: extractedColors });
        } else {
          throw new Error("No image data received");
        }
      } catch (error) {
        console.error(`Error fetching image ${url}:`, error);

        const retryCount = this.retryCount.get(url) || 0;

        if (retryCount < this.maxRetries) {
          this.retryCount.set(url, retryCount + 1);
          this.queue.unshift({
            url,
            resolve,
            reject,
            extractColors,
            fetchImageFn,
            wsConnected,
          });
        } else {
          this.failedImages.add(url);
          this.loadingImages.delete(url);
          this.notifyListeners();
          reject(error);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.isProcessing = false;
  }

  clearCache() {
    this.failedImages.clear();
    this.loadingImages.clear();
    this.retryCount.clear();
    this.queue = [];
    this.isProcessing = false;
    this.notifyListeners();
  }

  getQueueLength() {
    return this.queue.length;
  }

  isImageLoading(url) {
    return this.loadingImages.has(url);
  }

  hasImageFailed(url) {
    return this.failedImages.has(url);
  }
}

const globalImageQueue = new ImageLoadQueue();

export function useImageLoader() {
  const { fetchImage, wsConnected } = useSpotifyWebSocket();
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
        wsConnected,
      );
    },
    [fetchImage, wsConnected],
  );

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
    return globalImageQueue.hasImageFailed(url);
  }, []);

  const clearCache = useCallback(() => {
    globalImageQueue.clearCache();
  }, []);

  useEffect(() => {
    if (wsConnected && globalImageQueue.getQueueLength() > 0) {
      globalImageQueue.processQueue();
    }
  }, [wsConnected]);

  return {
    loadImage,
    isImageLoading,
    hasImageFailed,
    getImageSize,
    clearCache,
    queueLength: globalImageQueue.getQueueLength(),
    wsConnected,
  };
}
