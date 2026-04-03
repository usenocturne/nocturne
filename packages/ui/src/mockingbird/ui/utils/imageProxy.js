import { getGlobalWebSocket, addGlobalWsListener } from '../../../hooks/useNocturned';

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; 
const FETCH_TIMEOUT_MS = 15000;
const FETCH_DELAY_MS = 100;

const cache = new Map();

const pending = new Map();

const queue = [];
let processing = false;

function generateUUID() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isLocalUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../')
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
    let oldestKey = null;
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

function fetchSingleImage(url) {
  return new Promise((resolve) => {
    const ws = getGlobalWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[ImageProxy] WS not open');
      resolve(null);
      return;
    }

    const id = generateUUID();
    let settled = false;
    let timeoutId;

    const unsubscribe = addGlobalWsListener(id, {
      onMessage: (data) => {
        if (data.id !== id) return;
        if (settled) return;

        if (data.result?.cancelled) return;

        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();

        if (data.error) {
          console.warn('[ImageProxy] error response for', url, data.error);
          resolve(null);
          return;
        }

        const r = data.result || data;
        const base64 = r?.data ?? (r?.result?.data);
        if (!base64) {
          console.warn('[ImageProxy] no base64 in response for', url, 'keys:', Object.keys(data));
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
        console.warn('[ImageProxy] timeout for', url);
        resolve(null);
      }
    }, FETCH_TIMEOUT_MS);

    try {
      ws.send(JSON.stringify({
        type: 'request',
        id,
        method: 'spotify.image.fetch',
        params: { url },
      }));
    } catch (err) {
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      console.warn('[ImageProxy] send error', err);
      resolve(null);
    }
  });
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const { url, resolve } = queue.shift();

    const cached = cache.get(url);
    if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
      cached.accessedAt = Date.now();
      resolve(cached.dataUri);
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

export function resolveImageUrl(url) {
  if (isLocalUrl(url)) return Promise.resolve(url || '');

  const cached = cache.get(url);
  if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
    cached.accessedAt = Date.now();
    return Promise.resolve(cached.dataUri);
  }

  if (pending.has(url)) {
    return pending.get(url);
  }

  const promise = new Promise((resolve) => {
    queue.push({ url, resolve });
    processQueue();
  });

  pending.set(url, promise);
  return promise;
}

export function getCachedImageUrl(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.accessedAt < CACHE_TTL_MS) {
    cached.accessedAt = Date.now();
    return cached.dataUri;
  }
  return null;
}

export function preloadImage(url) {
  resolveImageUrl(url);
}

export function injectArtwork(imageUrls, base64Data) {
  if (!base64Data || !imageUrls || imageUrls.length === 0) return;

  const dataUri = `data:image/jpeg;base64,${base64Data}`;
  evictStale();

  for (const url of imageUrls) {
    if (url && !isLocalUrl(url)) {
      cache.set(url, { dataUri, accessedAt: Date.now() });
    }
  }
}

export function retryImage(url) {
  if (!url || isLocalUrl(url)) return;
  cache.delete(url);
  pending.delete(url);
  resolveImageUrl(url);
}

export function clearImageCache() {
  cache.clear();
  pending.clear();
  queue.length = 0;
}
