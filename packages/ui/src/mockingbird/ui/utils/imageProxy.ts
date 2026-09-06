import {
  getGlobalWebSocket,
  addGlobalWsListener,
} from "../../../hooks/useNocturned";
import { normalizeInlineImageSource } from "../../../utils/imageSource";

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const FETCH_DELAY_MS = 100;
const LOCAL_FILE_FALLBACK = "/images/not-playing.webp";

/** @typedef {import("@schema/spotify").SpotifyImageFetchRequest} SpotifyImageFetchRequest */

const cache = new Map<string, { dataUri: string; accessedAt: number }>();

const pending = new Map<string, Promise<string | null>>();

const queue: Array<{ url: string; resolve: (value: string | null) => void }> =
  [];
let processing = false;

function generateUUID() {
  return crypto.randomUUID();
}

function isLocalUrl(url: string | null | undefined) {
  if (!url) return true;
  return (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/") ||
    url.startsWith("./") ||
    url.startsWith("../")
  );
}

function isSpotifyLocalImageUrl(url: string | null | undefined) {
  return (
    url?.startsWith("spotify:localfileimage:") ||
    url?.startsWith("https://spotify:localfileimage:") ||
    url?.startsWith("http://spotify:localfileimage:")
  );
}

function evictStale() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.accessedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
  while (cache.size > MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

function fetchSingleImage(url: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const ws = getGlobalWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[ImageProxy] WS not open");
      resolve(null);
      return;
    }

    const id = generateUUID();
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const unsubscribe = addGlobalWsListener(id, {
      onMessage: (data) => {
        if (data.id !== id) return;
        if (settled) return;

        const payload = data.result;
        if (
          payload &&
          typeof payload === "object" &&
          "cancelled" in payload &&
          payload.cancelled
        )
          return;

        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();

        if (data.error) {
          console.warn("[ImageProxy] error response for", url, data.error);
          resolve(null);
          return;
        }

        const r = payload && typeof payload === "object" ? payload : data;
        const nested = "result" in r ? r.result : undefined;
        const base64 =
          ("data" in r ? r.data : undefined) ??
          (nested && typeof nested === "object" && "data" in nested
            ? nested.data
            : undefined);
        if (typeof base64 !== "string" || !base64) {
          console.warn(
            "[ImageProxy] no base64 in response for",
            url,
            "keys:",
            Object.keys(data),
          );
          resolve(null);
          return;
        }

        const dataUri = `data:image/jpeg;base64,${base64}`;
        evictStale();
        cache.set(url, { dataUri, accessedAt: Date.now() });
        resolve(dataUri);
      },
    });

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        console.warn("[ImageProxy] timeout for", url);
        resolve(null);
      }
    }, FETCH_TIMEOUT_MS);

    try {
      ws.send(
        JSON.stringify({
          type: "request",
          id,
          method: "spotify.image.fetch",
          params: /** @type {SpotifyImageFetchRequest} */ { url },
        }),
      );
    } catch (err) {
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      console.warn("[ImageProxy] send error", err);
      resolve(null);
    }
  });
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    const { url, resolve } = job;

    const cached = cache.get(url);
    if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
      cached.accessedAt = Date.now();
      resolve(cached.dataUri);
      pending.delete(url);
      continue;
    }

    const result = await fetchSingleImage(url);
    resolve(result);
    pending.delete(url);

    if (queue.length > 0) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }

  processing = false;
}

export function resolveImageUrl(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return Promise.resolve("");
  const normalizedUrl = normalizeInlineImageSource(url);
  if (isSpotifyLocalImageUrl(url)) {
    return Promise.resolve(LOCAL_FILE_FALLBACK);
  }
  if (isLocalUrl(normalizedUrl)) return Promise.resolve(normalizedUrl || "");

  const cached = cache.get(url);
  if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
    cached.accessedAt = Date.now();
    return Promise.resolve(cached.dataUri);
  }

  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const promise = new Promise<string | null>((resolve) => {
    queue.push({ url, resolve });
    processQueue();
  });

  pending.set(url, promise);
  return promise;
}

export function getCachedImageUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (isSpotifyLocalImageUrl(url)) return LOCAL_FILE_FALLBACK;
  const normalizedUrl = normalizeInlineImageSource(url);
  if (normalizedUrl !== url) return normalizedUrl ?? null;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
    cached.accessedAt = Date.now();
    return cached.dataUri;
  }
  return null;
}

export function preloadImage(url: string | null | undefined) {
  resolveImageUrl(url);
}

export function injectArtwork(imageUrls: string[], base64Data: string) {
  if (!base64Data || !imageUrls || imageUrls.length === 0) return;

  const dataUri = `data:image/jpeg;base64,${base64Data}`;
  evictStale();

  for (const url of imageUrls) {
    if (url && !isLocalUrl(url) && !isSpotifyLocalImageUrl(url)) {
      cache.set(url, { dataUri, accessedAt: Date.now() });
    }
  }
}

export function retryImage(url: string | null | undefined) {
  if (!url || isLocalUrl(url) || isSpotifyLocalImageUrl(url)) return;
  cache.delete(url);
  pending.delete(url);
  resolveImageUrl(url);
}

export function clearImageCache() {
  cache.clear();
  pending.clear();
  for (const job of queue.splice(0)) job.resolve(null);
}
