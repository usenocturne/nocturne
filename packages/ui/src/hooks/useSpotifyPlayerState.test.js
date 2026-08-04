import { describe, expect, it } from "bun:test";
import {
  createMediaGenerationCorrelator,
  fetchPlaybackStateAfterAppReady,
  getPushedArtworkTargetUri,
  isCanonicalSpotifyItem,
  isPendingSpotifyTrackChange,
  mediaGenerationsCorrelate,
  normalizeMediaGeneration,
  shouldIgnoreInactiveForeignMedia,
} from "./useSpotifyPlayerState";

describe("player state startup recovery", () => {
  it("retries empty cold-start responses until playback is available", async () => {
    const responses = [{}, {}, { item: { name: "Ready" } }];
    const delays = [];

    const playback = await fetchPlaybackStateAfterAppReady(
      async () => responses.shift(),
      {
        signal: new AbortController().signal,
        wait: async (delayMs) => {
          delays.push(delayMs);
          return true;
        },
        retryDelays: [0, 500, 1000, 2000, 4000],
      },
    );

    expect(playback).toEqual({ item: { name: "Ready" } });
    expect(delays).toEqual([0, 500, 1000]);
  });

  it("stops retrying after the first populated response", async () => {
    let attempts = 0;

    const playback = await fetchPlaybackStateAfterAppReady(
      async () => {
        attempts += 1;
        return { item: { name: "Ready" } };
      },
      {
        signal: new AbortController().signal,
        wait: async () => true,
        retryDelays: [0, 500, 1000],
      },
    );

    expect(playback).toEqual({ item: { name: "Ready" } });
    expect(attempts).toBe(1);
  });

  it("does not fetch after startup recovery is cancelled", async () => {
    let attempts = 0;
    const controller = new AbortController();
    controller.abort();

    const playback = await fetchPlaybackStateAfterAppReady(
      async () => {
        attempts += 1;
        return { item: { name: "Too late" } };
      },
      {
        signal: controller.signal,
        wait: async () => true,
        retryDelays: [0],
      },
    );

    expect(playback).toBeNull();
    expect(attempts).toBe(0);
  });

  it("ignores a response when a newer dealer event wins", async () => {
    let dealerWon = false;

    const playback = await fetchPlaybackStateAfterAppReady(
      async () => {
        dealerWon = true;
        return { item: { name: "Stale" } };
      },
      {
        signal: new AbortController().signal,
        wait: async () => true,
        retryDelays: [0],
        shouldStop: () => dealerWon,
      },
    );

    expect(playback).toBeNull();
  });

  it("exhausts empty responses without inventing a playback state", async () => {
    let attempts = 0;

    const playback = await fetchPlaybackStateAfterAppReady(
      async () => {
        attempts += 1;
        return {};
      },
      {
        signal: new AbortController().signal,
        wait: async () => true,
        retryDelays: [0, 500, 1000],
      },
    );

    expect(playback).toBeNull();
    expect(attempts).toBe(3);
  });

  it("aborts a stalled request and continues to the next attempt", async () => {
    let attempts = 0;

    const playback = await fetchPlaybackStateAfterAppReady(
      async (signal) => {
        attempts += 1;
        if (attempts === 1) {
          return await new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("Request cancelled")),
              { once: true },
            );
          });
        }
        return { item: { name: "Recovered" } };
      },
      {
        signal: new AbortController().signal,
        wait: async () => true,
        retryDelays: [0, 0],
        requestTimeoutMs: 1,
      },
    );

    expect(playback).toEqual({ item: { name: "Recovered" } });
    expect(attempts).toBe(2);
  });
});

describe("pushed artwork targeting", () => {
  it("never targets a canonical Spotify item", () => {
    const item = { uri: "spotify:track:old" };

    expect(isCanonicalSpotifyItem(item)).toBe(true);
    expect(getPushedArtworkTargetUri(item)).toBeNull();
  });

  it("parks transition artwork under the pending Spotify identity", () => {
    const item = { uri: "spotify:track:old", name: "Old Track" };

    expect(getPushedArtworkTargetUri(item, "Next Track")).toBe(
      "spotify:pending:Next Track",
    );
    expect(isPendingSpotifyTrackChange(item, "Next Track")).toBe(true);
    expect(isPendingSpotifyTrackChange(item, " old track ")).toBe(false);
  });

  it("parks cold-start artwork before a canonical item exists", () => {
    expect(getPushedArtworkTargetUri(undefined, "First Track")).toBe(
      "spotify:pending:First Track",
    );
  });

  it("allows pending, phone media, and local files to own pushed artwork", () => {
    const pending = {
      uri: "spotify:pending:Next Track",
      is_spotify_pending: true,
    };
    const phoneMedia = {
      uri: "local:media:Next Track",
      is_phone_media: true,
    };
    const localFile = {
      uri: "spotify:local:Artist:Album:Track",
      is_local: true,
    };

    expect(isCanonicalSpotifyItem(pending)).toBe(false);
    expect(getPushedArtworkTargetUri(pending)).toBe(pending.uri);
    expect(isCanonicalSpotifyItem(phoneMedia)).toBe(false);
    expect(getPushedArtworkTargetUri(phoneMedia)).toBe(phoneMedia.uri);
    expect(isCanonicalSpotifyItem(localFile)).toBe(false);
    expect(getPushedArtworkTargetUri(localFile)).toBe(localFile.uri);
  });
});

describe("pushed artwork generation correlation", () => {
  it("accepts matching tagged events", () => {
    const metadataGeneration = normalizeMediaGeneration({
      media_generation: 12,
    });
    const artworkGeneration = normalizeMediaGeneration({
      mediaGeneration: 12,
    });

    expect(
      mediaGenerationsCorrelate(metadataGeneration, artworkGeneration),
    ).toBe(true);
  });

  it("rejects stale and partially tagged artwork", () => {
    expect(mediaGenerationsCorrelate(12, 11)).toBe(false);
    expect(mediaGenerationsCorrelate(12, null)).toBe(false);
    expect(mediaGenerationsCorrelate(null, 12)).toBe(false);
  });

  it("keeps untagged legacy media events compatible", () => {
    expect(mediaGenerationsCorrelate(null, null)).toBe(true);
    expect(normalizeMediaGeneration({ media_generation: null })).toBeNull();
    expect(normalizeMediaGeneration({ mediaGeneration: -1 })).toBeNull();
  });

  it("rejects tagged artwork until its metadata arrives", () => {
    const correlator = createMediaGenerationCorrelator();

    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(false);
    correlator.recordMetadata({ mediaGeneration: 21 });
    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(true);
  });

  it("invalidates older artwork synchronously on the next metadata event", () => {
    const correlator = createMediaGenerationCorrelator();
    correlator.recordMetadata({ mediaGeneration: 21 });
    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(true);

    correlator.recordMetadata({ mediaGeneration: 22 });
    expect(correlator.current()).toBe(22);
    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(false);
    expect(correlator.acceptsArtwork({ mediaGeneration: 22 })).toBe(true);
  });

  it("switches back to legacy pairing only after untagged metadata", () => {
    const correlator = createMediaGenerationCorrelator();
    correlator.recordMetadata({ mediaGeneration: 21 });
    expect(correlator.acceptsArtwork({})).toBe(false);

    correlator.recordMetadata({});
    expect(correlator.current()).toBeNull();
    expect(correlator.acceptsArtwork({})).toBe(true);
    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(false);
  });
});

describe("inactive phone media precedence", () => {
  const playingSpotify = {
    is_playing: true,
    item: { uri: "spotify:track:current" },
  };

  it("does not let dormant foreign sessions replace playing Spotify", () => {
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, "YouTube", "stopped"),
    ).toBe(true);
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, "YouTube", "paused"),
    ).toBe(true);
  });

  it("still accepts actively playing or loading foreign media", () => {
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, "YouTube", "playing"),
    ).toBe(false);
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, "YouTube", "loading"),
    ).toBe(false);
  });

  it("does not suppress legacy, Spotify, or existing phone-media state", () => {
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, null, "stopped"),
    ).toBe(false);
    expect(
      shouldIgnoreInactiveForeignMedia(playingSpotify, "Spotify", "paused"),
    ).toBe(false);
    expect(
      shouldIgnoreInactiveForeignMedia(
        {
          is_playing: true,
          item: {
            uri: "local:media:current",
            is_phone_media: true,
          },
        },
        "YouTube",
        "paused",
      ),
    ).toBe(false);
  });
});
