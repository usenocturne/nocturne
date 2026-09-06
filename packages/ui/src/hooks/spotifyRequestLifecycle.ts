export interface PendingSpotifyRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function waitForSpotifySocket<T extends { readyState: number }>(
  getSocket: () => T | null,
  signal: AbortSignal | null = null,
  timeoutMs = 10_000,
  pollMs = 100,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { socket: T } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      signal?.removeEventListener("abort", abort);
      if ("error" in result) reject(result.error);
      else resolve(result.socket);
    };
    const abort = () => finish({ error: new Error("Request cancelled") });
    const timeout = setTimeout(
      () => finish({ error: new Error("WebSocket connection timeout") }),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    const check = () => {
      if (settled) return;
      const socket = getSocket();
      if (!socket)
        finish({ error: new Error("WebSocket disconnected while waiting") });
      else if (socket.readyState === WebSocket.OPEN) finish({ socket });
      else if (
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      )
        finish({ error: new Error("WebSocket closed while waiting") });
      else pollTimer = setTimeout(check, pollMs);
    };
    check();
  });
}

export function dispatchSpotifyRequest(
  socket: Pick<WebSocket, "send">,
  pending: Map<string, PendingSpotifyRequest>,
  method: string,
  params: object,
  signal: AbortSignal | null = null,
  timeoutMs = 30_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }
    const id = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      pending.delete(id);
      signal?.removeEventListener("abort", abort);
    };
    const entry: PendingSpotifyRequest = {
      resolve(value) {
        if (!settled) {
          cleanup();
          resolve(value);
        }
      },
      reject(error) {
        if (!settled) {
          cleanup();
          reject(error);
        }
      },
    };
    const abort = () => entry.reject(new Error("Request cancelled"));
    const timeout = setTimeout(
      () => entry.reject(new Error("Request timeout")),
      timeoutMs,
    );
    pending.set(id, entry);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      socket.send(JSON.stringify({ type: "request", id, method, params }));
    } catch (error) {
      entry.reject(error);
    }
  });
}

export async function withSpotifyImageDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | null = null,
  timeoutMs = 30_000,
): Promise<T> {
  if (signal?.aborted) throw new Error("Request cancelled");
  const controller = new AbortController();
  const requestSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = request(requestSignal);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Spotify image fetch timed out"));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([result, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createDeferredSpotifyRefresh(
  refresh: (signal: AbortSignal) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  return {
    get generation() {
      return generation;
    },
    activate() {
      if (!active) {
        active = true;
        generation++;
      }
    },
    dispose() {
      active = false;
      generation++;
      cancel();
    },
    schedule(requestGeneration: number, delayMs = 100) {
      if (!active || requestGeneration !== generation) return;
      cancel();
      timer = setTimeout(async () => {
        timer = null;
        if (!active || requestGeneration !== generation) return;
        const requestController = new AbortController();
        controller = requestController;
        try {
          await refresh(requestController.signal);
        } catch (error) {
          if (
            !requestController.signal.aborted &&
            active &&
            requestGeneration === generation
          )
            onError(error);
        } finally {
          if (controller === requestController) controller = null;
        }
      }, delayMs);
    },
  };
}
