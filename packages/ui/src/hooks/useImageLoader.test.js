import { describe, expect, it } from "bun:test";
import { ImageLoadQueue } from "./useImageLoader";

describe("image loader cancellation", () => {
  it("settles every coalesced listener when a URL is cancelled", async () => {
    const queue = new ImageLoadQueue();
    queue.imageFetchDelayMs = 0;
    queue.updateQueueReadyState(true);
    const fetchImage = async (_url, signal) => {
      if (signal?.aborted) throw new Error("Request cancelled");
      return { data: "image-data" };
    };

    const first = queue.loadImage(
      "https://i.scdn.co/image/cover",
      1,
      false,
      fetchImage,
      true,
    );
    const second = queue.loadImage(
      "https://i.scdn.co/image/cover",
      1,
      true,
      fetchImage,
      true,
    );

    queue.cancelRequest("https://i.scdn.co/image/cover");
    const results = await Promise.allSettled([first, second]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(results.map((result) => result.reason.message)).toEqual([
      "Request cancelled",
      "Request cancelled",
    ]);
  });

  it("detaches one listener without aborting shared consumers", async () => {
    const queue = new ImageLoadQueue();
    queue.imageFetchDelayMs = 0;
    queue.updateQueueReadyState(true);
    const fetchImage = async () => ({ data: "image-data" });

    const visibleImage = queue.loadImage(
      "https://i.scdn.co/image/shared",
      1,
      false,
      fetchImage,
      true,
    );
    const gradient = queue.loadImage(
      "https://i.scdn.co/image/shared",
      1,
      false,
      fetchImage,
      true,
    );

    visibleImage.cancel();
    const results = await Promise.allSettled([visibleImage, gradient]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
  });

  it("does not let a cancelled worker erase an immediate same-URL reload", async () => {
    const queue = new ImageLoadQueue();
    queue.imageFetchDelayMs = 0;
    queue.updateQueueReadyState(true);
    let calls = 0;
    const fetchImage = (_url, signal) => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ data: "replacement-image" });
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("Request cancelled")),
          { once: true },
        );
      });
    };
    const url = "https://i.scdn.co/image/reloaded";

    const oldRequest = queue.loadImage(url, 1, false, fetchImage, true);
    while (calls === 0) await Bun.sleep(1);
    queue.cancelRequest(url);
    const replacement = queue.loadImage(url, 1, false, fetchImage, true);
    const coalescedReplacement = queue.loadImage(
      url,
      1,
      false,
      fetchImage,
      true,
    );

    const results = await Promise.race([
      Promise.allSettled([oldRequest, replacement, coalescedReplacement]),
      Bun.sleep(250).then(() => {
        throw new Error("same-URL replacements did not settle");
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("keeps replacement listeners added during extended retry backoff", async () => {
    const queue = new ImageLoadQueue();
    queue.imageFetchDelayMs = 0;
    queue.maxRetries = 0;
    queue.maxExtendedRetries = 1;
    queue.updateQueueReadyState(true);
    let calls = 0;
    const fetchImage = async () => {
      calls += 1;
      if (calls === 1) throw new Error("Temporary image failure");
      return { data: "retried-image" };
    };
    const url = "https://i.scdn.co/image/retry-reload";

    const visibleImage = queue.loadImage(url, 1, false, fetchImage, true);
    const gradient = queue.loadImage(url, 1, false, fetchImage, true);
    while (calls === 0) await Bun.sleep(1);
    await Bun.sleep(1);
    visibleImage.cancel();
    const replacement = queue.loadImage(url, 1, false, fetchImage, true);

    const results = await Promise.race([
      Promise.allSettled([visibleImage, gradient, replacement]),
      Bun.sleep(1000).then(() => {
        throw new Error("extended retry listeners did not settle");
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
  });
});
