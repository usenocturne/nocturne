import { describe, expect, spyOn, test } from "bun:test";
import {
  createDeferredSpotifyRefresh,
  dispatchSpotifyRequest,
  waitForSpotifySocket,
  withSpotifyImageDeadline,
} from "./spotifyRequestLifecycle";

describe("Spotify request lifetime", () => {
  test("does not poll or send after the connection deadline", async () => {
    const socket = {
      readyState: WebSocket.CONNECTING,
      send() {
        sends++;
      },
    };
    let reads = 0,
      sends = 0;
    const operation = waitForSpotifySocket(
      () => {
        reads++;
        return socket;
      },
      null,
      5,
      1,
    ).then((open) => dispatchSpotifyRequest(open, new Map(), "test", {}));
    await expect(operation).rejects.toThrow("WebSocket connection timeout");
    const readsAtTimeout = reads;
    socket.readyState = WebSocket.OPEN;
    await Bun.sleep(10);
    expect(reads).toBe(readsAtTimeout);
    expect(sends).toBe(0);
  });
  test("stops connection polling after cancellation", async () => {
    const controller = new AbortController();
    let reads = 0;
    const operation = waitForSpotifySocket(
      () => {
        reads++;
        return { readyState: WebSocket.CONNECTING };
      },
      controller.signal,
      100,
      1,
    );
    controller.abort();
    await expect(operation).rejects.toThrow("Request cancelled");
    await Bun.sleep(5);
    expect(reads).toBe(1);
  });
  test("cleans the request map and abort listener after timeout", async () => {
    const pending = new Map();
    const controller = new AbortController();
    const remove = spyOn(controller.signal, "removeEventListener");
    try {
      const operation = dispatchSpotifyRequest(
        { send() {} },
        pending,
        "test",
        {},
        controller.signal,
        5,
      );
      await expect(operation).rejects.toThrow("Request timeout");
      expect(pending.size).toBe(0);
      expect(remove).toHaveBeenCalledTimes(1);
      controller.abort();
      expect(pending.size).toBe(0);
    } finally {
      remove.mockRestore();
    }
  });
  test("cleans resources after a successful reply and ignores a late abort", async () => {
    const pending = new Map();
    const controller = new AbortController();
    let id;
    const remove = spyOn(controller.signal, "removeEventListener");
    try {
      const operation = dispatchSpotifyRequest(
        {
          send(raw) {
            id = JSON.parse(raw).id;
          },
        },
        pending,
        "test",
        {},
        controller.signal,
        20,
      );
      pending.get(id).resolve({ ok: true });
      expect(await operation).toEqual({ ok: true });
      expect(pending.size).toBe(0);
      expect(remove).toHaveBeenCalledTimes(1);
      controller.abort();
      await Bun.sleep(25);
      expect(pending.size).toBe(0);
    } finally {
      remove.mockRestore();
    }
  });
  test("cleans a request when sending throws or its signal is aborted", async () => {
    const pending = new Map();
    await expect(
      dispatchSpotifyRequest(
        {
          send() {
            throw new Error("closed");
          },
        },
        pending,
        "test",
        {},
      ),
    ).rejects.toThrow("closed");
    expect(pending.size).toBe(0);
    const controller = new AbortController();
    const operation = dispatchSpotifyRequest(
      { send() {} },
      pending,
      "test",
      {},
      controller.signal,
    );
    controller.abort();
    await expect(operation).rejects.toThrow("Request cancelled");
    expect(pending.size).toBe(0);
  });
  test("image deadline aborts the underlying pending request", async () => {
    const pending = new Map();
    let aborted = false;
    const operation = withSpotifyImageDeadline(
      (signal) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        return dispatchSpotifyRequest(
          { send() {} },
          pending,
          "spotify.image.fetch",
          {},
          signal,
        );
      },
      null,
      5,
    );
    await expect(operation).rejects.toThrow("Spotify image fetch timed out");
    expect(aborted).toBe(true);
    expect(pending.size).toBe(0);
  });
  test("a completed image request is never aborted by its old deadline", async () => {
    let signal;
    expect(
      await withSpotifyImageDeadline(
        (requestSignal) => {
          signal = requestSignal;
          return Promise.resolve("image");
        },
        null,
        5,
      ),
    ).toBe("image");
    await Bun.sleep(10);
    expect(signal.aborted).toBe(false);
  });
  test("an already cancelled image request never starts", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      withSpotifyImageDeadline(async () => {
        calls++;
        return "image";
      }, controller.signal),
    ).rejects.toThrow("Request cancelled");
    expect(calls).toBe(0);
  });
});

describe("deferred playback refresh disposal", () => {
  test("Back before the refresh delay prevents the read without canceling play", async () => {
    let refreshes = 0,
      plays = 0;
    const refresh = createDeferredSpotifyRefresh(
      async () => {
        refreshes++;
      },
      () => {},
    );
    const generation = refresh.generation;
    const play = Promise.resolve().then(() => {
      plays++;
      refresh.schedule(generation, 5);
      return true;
    });
    expect(await play).toBe(true);
    refresh.dispose();
    await Bun.sleep(10);
    expect(plays).toBe(1);
    expect(refreshes).toBe(0);
  });
  test("a late play acknowledgement cannot schedule into a retired generation", async () => {
    let refreshes = 0;
    const refresh = createDeferredSpotifyRefresh(
      async () => {
        refreshes++;
      },
      () => {},
    );
    const oldGeneration = refresh.generation;
    refresh.dispose();
    refresh.activate();
    refresh.schedule(oldGeneration, 0);
    await Bun.sleep(5);
    expect(refreshes).toBe(0);
    refresh.schedule(refresh.generation, 0);
    await Bun.sleep(5);
    expect(refreshes).toBe(1);
    refresh.dispose();
  });
  test("Back aborts an already-started read and suppresses its cancellation error", async () => {
    let started = false,
      aborted = false;
    const errors = [];
    const refresh = createDeferredSpotifyRefresh(
      (signal) =>
        new Promise((_, reject) => {
          started = true;
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("Request cancelled"));
            },
            { once: true },
          );
        }),
      (error) => errors.push(error),
    );
    refresh.schedule(refresh.generation, 0);
    await Bun.sleep(5);
    expect(started).toBe(true);
    refresh.dispose();
    await Bun.sleep(5);
    expect(aborted).toBe(true);
    expect(errors).toEqual([]);
  });
});
