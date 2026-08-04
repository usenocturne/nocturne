import { describe, expect, it } from "bun:test";
import {
  getInitialCollectionLimit,
  getSpotifyProfileIdentity,
  hasSpotifyCollectionEnvelope,
  prepareInitialDataLoadGeneration,
  retryInitialDataLoadAfterAppReady,
  shouldAttemptMockingbirdPrefetch,
  shouldCommitSpotifyLoadState,
  shouldEnrichPlaylistTrackCount,
} from "./useSpotifyData";

describe("Spotify initial data validation", () => {
  it("accepts native and connector profile identities", () => {
    expect(getSpotifyProfileIdentity({ id: "native-user" })).toBe(
      "native-user",
    );
    expect(
      getSpotifyProfileIdentity({
        profile: { uri: "spotify:user:connector-user" },
      }),
    ).toBe("connector-user");
    expect(
      getSpotifyProfileIdentity({
        data: { me: { profile: { username: "web-user" } } },
      }),
    ).toBe("web-user");
  });

  it("distinguishes valid empty collections from cold empty objects", () => {
    expect(hasSpotifyCollectionEnvelope({ items: [] }, "items")).toBe(true);
    expect(hasSpotifyCollectionEnvelope({ albums: [] }, "albums")).toBe(true);
    expect(hasSpotifyCollectionEnvelope({}, "items")).toBe(false);
    expect(hasSpotifyCollectionEnvelope(null, "items")).toBe(false);
  });

  it("prefetches enough inventory for Mockingbird More shelves", () => {
    expect(getInitialCollectionLimit("playlists", true)).toBe(50);
    expect(getInitialCollectionLimit("artists", true)).toBe(20);
    expect(getInitialCollectionLimit("shows", true)).toBe(20);
    expect(getInitialCollectionLimit("playlists", false)).toBe(5);
  });

  it("limits playlist count enrichment during large Mockingbird prefetches", () => {
    expect(shouldEnrichPlaylistTrackCount(4, false, true)).toBe(true);
    expect(shouldEnrichPlaylistTrackCount(5, false, true)).toBe(false);
    expect(shouldEnrichPlaylistTrackCount(20, true, true)).toBe(true);
    expect(shouldEnrichPlaylistTrackCount(20, false, false)).toBe(true);
  });

  it("keeps Mockingbird prefetch pending until loading is ready and idle", () => {
    expect(shouldAttemptMockingbirdPrefetch(false, true, false, false)).toBe(
      false,
    );
    expect(shouldAttemptMockingbirdPrefetch(false, true, true, true)).toBe(
      false,
    );
    expect(shouldAttemptMockingbirdPrefetch(false, true, true, false)).toBe(
      true,
    );
    expect(shouldAttemptMockingbirdPrefetch(true, true, true, false)).toBe(
      false,
    );
  });

  it("allows only the active generation to commit request state", () => {
    const staleController = new AbortController();
    const currentController = new AbortController();

    expect(shouldCommitSpotifyLoadState(null, currentController.signal)).toBe(
      true,
    );
    expect(
      shouldCommitSpotifyLoadState(
        currentController.signal,
        currentController.signal,
      ),
    ).toBe(true);
    expect(
      shouldCommitSpotifyLoadState(
        staleController.signal,
        currentController.signal,
      ),
    ).toBe(false);
    staleController.abort();
    expect(
      shouldCommitSpotifyLoadState(
        staleController.signal,
        staleController.signal,
      ),
    ).toBe(false);
  });

  it("cancels an old generation before starting its successor", () => {
    const oldController = new AbortController();
    let inProgress = true;

    const shouldStart = prepareInitialDataLoadGeneration(1, 2, () => {
      oldController.abort();
      inProgress = false;
    });

    expect(shouldStart).toBe(true);
    expect(oldController.signal.aborted).toBe(true);
    expect(inProgress).toBe(false);
    expect(prepareInitialDataLoadGeneration(2, 2, () => {})).toBe(false);
  });
});

describe("Spotify initial data recovery", () => {
  it("retries a cold app.ready generation until the warmup succeeds", async () => {
    const outcomes = [false, false, true];
    const delays = [];
    let attempts = 0;

    const loaded = await retryInitialDataLoadAfterAppReady(
      async () => {
        attempts += 1;
        return outcomes.shift();
      },
      {
        signal: new AbortController().signal,
        retryDelays: [0, 500, 1000, 2000],
        wait: async (delayMs) => {
          delays.push(delayMs);
          return true;
        },
      },
    );

    expect(loaded).toBe(true);
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("does not report completion when every request attempt fails", async () => {
    let attempts = 0;

    const loaded = await retryInitialDataLoadAfterAppReady(
      async () => {
        attempts += 1;
        return false;
      },
      {
        signal: new AbortController().signal,
        retryDelays: [0, 500, 1000],
        wait: async () => true,
      },
    );

    expect(loaded).toBe(false);
    expect(attempts).toBe(3);
  });

  it("stops a stale generation before another request is sent", async () => {
    const controller = new AbortController();
    let attempts = 0;

    const loaded = await retryInitialDataLoadAfterAppReady(
      async () => {
        attempts += 1;
        return false;
      },
      {
        signal: controller.signal,
        retryDelays: [0, 500, 1000],
        wait: async () => {
          controller.abort();
          return false;
        },
      },
    );

    expect(loaded).toBe(false);
    expect(attempts).toBe(1);
  });

  it("recovers from an unexpected warmup exception", async () => {
    let attempts = 0;

    const loaded = await retryInitialDataLoadAfterAppReady(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("No active app session");
        return true;
      },
      {
        signal: new AbortController().signal,
        retryDelays: [0, 0],
        onError: () => {},
      },
    );

    expect(loaded).toBe(true);
    expect(attempts).toBe(2);
  });
});
