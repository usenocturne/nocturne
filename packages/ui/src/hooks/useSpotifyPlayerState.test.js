import { describe, expect, it } from "bun:test";
import {
  acceptsPhoneMediaArtworkEvent,
  attachPushedArtwork,
  canUsePhonePushedArtwork,
  createMediaGenerationCorrelator,
  fetchPlaybackStateAfterAppReady,
  getPendingSpotifyArtworkKeys,
  getPushedArtworkTargetUri,
  getPhoneMediaTrackId,
  getDealerArtists,
  isCanonicalSpotifyItem,
  isPendingSpotifyTrackChange,
  isResolvedSpotifyItem,
  isSpotifyLocalItem,
  mediaGenerationsCorrelate,
  normalizeImageUrl,
  normalizeMediaGeneration,
  normalizePhoneMediaTiming,
  normalizeSpotifyDeviceType,
  reconcilePlaybackDevice,
  reconcilePlaybackItem,
  reconcilePolledPlaybackTiming,
  replaceDiscardedPendingArtwork,
  shouldClearDisplayedMediaForEmptyUpdate,
  shouldIgnoreInactiveForeignMedia,
  shouldIgnoreSpotifyPhoneMediaUpdate,
  shouldPreserveDealerBlobArtwork,
  shouldPreservePushedArtwork,
} from "./useSpotifyPlayerState";

describe("Spotify phone media source precedence", () => {
  const canonicalPcPlayback = {
    is_playing: true,
    progress_ms: 42_000,
    timestamp: 100_000,
    device: { id: "pc", type: "Computer" },
    item: {
      uri: "spotify:track:casual",
      name: "Casual",
      artists: [{ name: "Chappell Roan" }],
    },
  };

  it("ignores connected-phone Spotify mirrors while a PC owns playback", () => {
    expect(normalizeSpotifyDeviceType(" computer ")).toBe("COMPUTER");
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(canonicalPcPlayback, "Spotify"),
    ).toBe(true);
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(
        {
          ...canonicalPcPlayback,
          item: { uri: "spotify:local:Artist:Album:Track:180" },
        },
        "Spotify",
      ),
    ).toBe(true);
  });

  it("keeps smartphone and unresolved cold-start metadata eligible", () => {
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(
        {
          ...canonicalPcPlayback,
          device: { id: "phone", type: "Smartphone" },
        },
        "Spotify",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(
        {
          ...canonicalPcPlayback,
          device: { id: "unknown", type: "UNKNOWN" },
        },
        "Spotify",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(
        {
          ...canonicalPcPlayback,
          device: null,
          item: { uri: "spotify:pending:Casual", is_spotify_pending: true },
        },
        "Spotify",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreSpotifyPhoneMediaUpdate(canonicalPcPlayback, "YouTube"),
    ).toBe(false);
  });

  it("preserves known PC ownership across a sparse same-track poll", () => {
    const sparsePoll = {
      ...canonicalPcPlayback,
      device: null,
    };
    const reconciled = reconcilePlaybackDevice(sparsePoll, canonicalPcPlayback);

    expect(reconciled.device).toEqual(canonicalPcPlayback.device);
    expect(shouldIgnoreSpotifyPhoneMediaUpdate(reconciled, "Spotify")).toBe(
      true,
    );

    const transferred = {
      ...sparsePoll,
      device: { id: "phone", type: "SMARTPHONE" },
    };
    expect(
      reconcilePlaybackDevice(transferred, canonicalPcPlayback).device,
    ).toEqual(transferred.device);
  });

  it("rejects tagged and legacy artwork paired with an ignored PC update", () => {
    const tagged = createMediaGenerationCorrelator();
    tagged.recordMetadata({ mediaGeneration: 41 });
    expect(tagged.acceptsFailure()).toBe(true);
    expect(
      acceptsPhoneMediaArtworkEvent(tagged, { mediaGeneration: 40 }, false),
    ).toBe(false);
    expect(acceptsPhoneMediaArtworkEvent(tagged, {}, true)).toBe(true);
    tagged.rejectCurrentArtwork();
    expect(tagged.acceptsArtwork({ mediaGeneration: 41 })).toBe(false);
    expect(tagged.acceptsFailure()).toBe(false);

    const legacy = createMediaGenerationCorrelator();
    legacy.recordMetadata({});
    expect(legacy.acceptsFailure()).toBe(true);
    legacy.rejectCurrentArtwork();
    expect(legacy.acceptsArtwork({})).toBe(false);
    expect(legacy.acceptsFailure()).toBe(false);
  });

  it("drops every pending cover when its phone context is rejected", () => {
    const pendingKeys = getPendingSpotifyArtworkKeys([
      "spotify:pending:Casual",
      "spotify:track:canonical",
      "spotify:pending:Another Track",
    ]);
    expect(pendingKeys).toEqual([
      "spotify:pending:Casual",
      "spotify:pending:Another Track",
    ]);

    const pendingPlayback = {
      ...canonicalPcPlayback,
      item: {
        ...canonicalPcPlayback.item,
        uri: "spotify:pending:Casual",
        album: { images: [{ url: "blob:old-cover" }] },
      },
    };
    const pendingAlbum = {
      id: "pending-album",
      images: [{ url: "blob:old-cover" }],
    };
    const replaced = replaceDiscardedPendingArtwork(
      pendingPlayback,
      pendingAlbum,
      pendingKeys,
    );
    expect(replaced.playback.item.album.images[0].url).toBe(
      "/images/not-playing.webp",
    );
    expect(replaced.album.images[0].url).toBe("/images/not-playing.webp");

    const canonical = replaceDiscardedPendingArtwork(
      canonicalPcPlayback,
      pendingAlbum,
      pendingKeys,
    );
    expect(canonical.playback).toBe(canonicalPcPlayback);
    expect(canonical.album).toBe(pendingAlbum);
  });

  it("does not let a sparse same-track poll reset advancing progress", () => {
    const incoming = {
      ...canonicalPcPlayback,
      progress_ms: 0,
      timestamp: 105_000,
    };

    const reconciled = reconcilePolledPlaybackTiming(
      incoming,
      canonicalPcPlayback,
      105_000,
    );

    expect(reconciled.progress_ms).toBe(47_000);
    expect(reconciled.timestamp).toBe(105_000);
  });

  it("accepts real restarts, pauses, and track changes from polling", () => {
    const nearEnd = {
      ...canonicalPcPlayback,
      progress_ms: 98_000,
      timestamp: 100_000,
      item: { ...canonicalPcPlayback.item, duration_ms: 100_000 },
    };
    const restarted = {
      ...nearEnd,
      progress_ms: 0,
      timestamp: 102_000,
    };
    expect(reconcilePolledPlaybackTiming(restarted, nearEnd, 102_000)).toBe(
      restarted,
    );

    const paused = { ...restarted, is_playing: false };
    expect(reconcilePolledPlaybackTiming(paused, nearEnd, 102_000)).toBe(
      paused,
    );

    const changed = {
      ...restarted,
      item: { ...restarted.item, uri: "spotify:track:next" },
    };
    expect(reconcilePolledPlaybackTiming(changed, nearEnd, 102_000)).toBe(
      changed,
    );
  });

  it("binds pushed Spotify artwork to its active smartphone device", () => {
    const canonicalItem = { uri: "spotify:track:casual" };
    const localItem = { uri: "spotify:local:Artist:Album:Track:180" };

    expect(
      canUsePhonePushedArtwork(
        canonicalItem,
        { id: "pc", type: "COMPUTER" },
        "phone",
      ),
    ).toBe(false);
    expect(
      canUsePhonePushedArtwork(
        localItem,
        { id: "pc", type: "COMPUTER" },
        "phone",
      ),
    ).toBe(false);
    expect(
      canUsePhonePushedArtwork(
        canonicalItem,
        { id: "phone", type: "SMARTPHONE" },
        "phone",
      ),
    ).toBe(true);
    expect(
      canUsePhonePushedArtwork(
        canonicalItem,
        { id: "other-phone", type: "SMARTPHONE" },
        "phone",
      ),
    ).toBe(false);
    expect(
      canUsePhonePushedArtwork(
        canonicalItem,
        { id: "unknown-route", type: "UNKNOWN" },
        "unknown-route",
      ),
    ).toBe(true);
    expect(
      canUsePhonePushedArtwork(
        localItem,
        { id: "unknown-route", type: " UNKNOWN " },
        "unknown-route",
      ),
    ).toBe(true);
    expect(
      canUsePhonePushedArtwork(
        localItem,
        { id: "other-route", type: "UNKNOWN" },
        "unknown-route",
      ),
    ).toBe(false);
  });
});

describe("phone media timing normalization", () => {
  it("accepts native iAP2 duration and elapsed-time fields", () => {
    expect(
      normalizePhoneMediaTiming(
        { MediaItemDuration: 180_000 },
        {
          PlaybackElapsedTimeInMilliseconds: 42_500,
          PlaybackRate: 1.25,
        },
        123_456,
      ),
    ).toEqual({
      durationMs: 180_000,
      progressMs: 42_500,
      playbackRate: 1.25,
      timestamp: 123_456,
    });
  });

  it("preserves an exact zero Android position", () => {
    const timing = normalizePhoneMediaTiming(
      { MediaItemPlaybackDurationInMilliseconds: 60_000 },
      { PlaybackElapsedTimeInMilliseconds: 0, PlaybackRate: 1 },
      123_456,
    );

    expect(timing.progressMs).toBe(0);
    expect(timing.durationMs).toBe(60_000);
  });

  it("normalizes MFi playback speed hundredths", () => {
    expect(
      normalizePhoneMediaTiming(
        { MediaItemDuration: 60_000 },
        { PlaybackElapsedTime: 1_000, PlaybackSpeed: 150 },
        123_456,
      ).playbackRate,
    ).toBe(1.5);
  });

  it("does not manufacture progress for an unknown timeline", () => {
    const timing = normalizePhoneMediaTiming({}, {}, 123_456);

    expect(timing.durationMs).toBe(0);
    expect(timing.progressMs).toBeNull();
    expect(timing.playbackRate).toBe(1);
  });

  it("gives same-title media from different apps distinct progress identities", () => {
    const youtubeId = getPhoneMediaTrackId(
      "YouTube",
      "Episode",
      "Creator",
      "Episode",
    );
    const musicId = getPhoneMediaTrackId(
      "YouTube Music",
      "Episode",
      "Creator",
      "Episode",
    );

    expect(youtubeId).not.toBe(musicId);
  });
});

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

  it("targets a same-title canonical item for phone artwork", () => {
    const item = {
      uri: "spotify:track:current",
      name: "Current Track",
    };

    expect(getPushedArtworkTargetUri(item, " current track ")).toBe(item.uri);
    expect(isPendingSpotifyTrackChange(item, " current track ")).toBe(false);
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

  it("targets same-title local artwork at the real local URI", () => {
    const localFile = {
      uri: "spotify:local:glaive:album:tiziana:201",
      name: "tiziana",
    };

    expect(isSpotifyLocalItem(localFile)).toBe(true);
    expect(isCanonicalSpotifyItem(localFile)).toBe(false);
    expect(isResolvedSpotifyItem(localFile)).toBe(true);
    expect(getPushedArtworkTargetUri(localFile, " Tiziana ")).toBe(
      localFile.uri,
    );
  });
});

describe("local file playback normalization", () => {
  it("turns raw JPEG metadata artwork into a browser-safe data URL", () => {
    const rawArtwork = "/9j/4AAQSkZJRgABAQEAYABgAAD/2Q==";

    expect(normalizeImageUrl(rawArtwork)).toBe(
      `data:image/jpeg;base64,${rawArtwork}`,
    );
  });

  const localImage = "spotify:localfileimage:%2Fvar%2Fmobile%2Ftrack.mp3";

  it("uses the not-playing asset instead of fetching a local image URI", () => {
    expect(normalizeImageUrl(localImage)).toBe("/images/not-playing.webp");
    expect(normalizeImageUrl(`https://${localImage}`)).toBe(
      "/images/not-playing.webp",
    );
  });

  it("derives an artist from the local URI when the response name is blank", () => {
    const item = reconcilePlaybackItem(
      {
        uri: "spotify:local:Tyler%2C+The+Creator:album:track:123",
        artists: [{ id: "", name: "", uri: "" }],
      },
      null,
    );

    expect(item.is_local).toBe(true);
    expect(item.artists[0].name).toBe("Tyler, The Creator");
  });

  it("preserves richer artists from the same track across sparse polls", () => {
    const previous = {
      uri: "spotify:local:glaive:album:tiziana:201",
      artists: [{ name: "glaive" }],
    };
    const item = reconcilePlaybackItem(
      {
        uri: previous.uri,
        artists: [{ id: "glaive", name: "", uri: "spotify:local:glaive" }],
      },
      previous,
    );

    expect(item.artists).toEqual(previous.artists);
  });

  it("preserves pending phone metadata when the local URI resolves", () => {
    const previous = {
      uri: "spotify:pending:tiziana",
      name: "tiziana",
      artists: [{ name: "glaive" }],
      is_spotify_pending: true,
    };
    const item = reconcilePlaybackItem(
      {
        uri: "spotify:local:glaive:album:tiziana:201",
        name: "tiziana",
        artists: [{ name: "" }],
      },
      previous,
    );

    expect(item.artists).toEqual(previous.artists);
  });

  it("does not leak artists across local track changes", () => {
    const item = reconcilePlaybackItem(
      {
        uri: "spotify:local:new+artist:album:new+track:456",
        artists: [{ name: "" }],
      },
      {
        uri: "spotify:local:old+artist:album:old+track:123",
        artists: [{ name: "Old Artist" }],
      },
    );

    expect(item.artists[0].name).toBe("new artist");
  });

  it("keeps a populated incoming artist list", () => {
    const artists = [{ id: "new", name: "New Artist" }];
    const item = reconcilePlaybackItem(
      { uri: "spotify:local:new:album:track:456", artists },
      {
        uri: "spotify:local:new:album:track:456",
        artists: [{ name: "Old Artist" }],
      },
    );

    expect(item.artists).toEqual(artists);
  });

  it("keeps a more complete same-track artist list", () => {
    const previous = {
      uri: "spotify:local:one+and+two:album:track:456",
      artists: [{ name: "Artist One" }, { name: "Artist Two" }],
    };
    const item = reconcilePlaybackItem(
      {
        uri: previous.uri,
        artists: [{ name: "Artist One" }, { name: "" }],
      },
      previous,
    );

    expect(item.artists).toEqual(previous.artists);
  });

  it("preserves pushed artwork for sparse same-URI local polls", () => {
    expect(
      shouldPreservePushedArtwork(
        {
          uri: "spotify:local:glaive:album:tiziana:201",
          name: "tiziana",
          album: { images: [{ url: "blob:phone-artwork" }] },
        },
        {
          uri: "spotify:local:glaive:album:tiziana:201",
          name: "",
        },
      ),
    ).toBe(true);
  });

  it("preserves pushed artwork for sparse same-URI Spotify polls", () => {
    expect(
      shouldPreservePushedArtwork(
        {
          uri: "spotify:track:current",
          album: { images: [{ url: "blob:phone-artwork" }] },
        },
        { uri: "spotify:track:current", name: "" },
      ),
    ).toBe(true);
  });

  it("does not preserve pushed artwork across local URI changes", () => {
    expect(
      shouldPreservePushedArtwork(
        { uri: "spotify:local:old:album:track:1", name: "track" },
        { uri: "spotify:local:new:album:track:2", name: "track" },
      ),
    ).toBe(false);
  });

  it("does not promote local artwork into a canonical track with the same transitional title", () => {
    expect(
      shouldPreserveDealerBlobArtwork(
        {
          uri: "spotify:local:artist:album:local-track:1",
          name: "Canonical Track",
          is_local: true,
          album: { images: [{ url: "blob:local-artwork" }] },
        },
        {
          uri: "spotify:track:canonical-track",
          name: "Canonical Track",
        },
      ),
    ).toBe(false);
  });

  it("keeps correlated artwork for the same resolved local URI", () => {
    const localUri = "spotify:local:artist:album:local-track:1";
    expect(
      shouldPreserveDealerBlobArtwork(
        {
          uri: localUri,
          name: "Local Track",
          is_local: true,
          album: { images: [{ url: "blob:local-artwork" }] },
        },
        { uri: localUri, name: "Local Track" },
      ),
    ).toBe(true);
  });

  it("attaches pushed artwork when the local item has no album metadata", () => {
    expect(
      attachPushedArtwork(
        { uri: "spotify:local:glaive:album:tiziana:201" },
        "blob:phone-artwork",
      ).album.images,
    ).toEqual([{ url: "blob:phone-artwork" }]);
  });

  it("uses scalar Dealer metadata when its artist array is blank", () => {
    expect(
      getDealerArtists({
        artists: [{ id: "glaive", name: "", uri: "spotify:local:glaive" }],
        artist_name: "glaive",
      }),
    ).toEqual([
      {
        id: undefined,
        uri: undefined,
        name: "glaive",
        type: "artist",
      },
    ]);
  });
});

describe("periodic artist reconciliation", () => {
  it("preserves named artists when a same-URI poll returns no names", () => {
    const previous = {
      uri: "spotify:track:current",
      artists: [
        { id: "one", name: "Artist One" },
        { id: "two", name: "Artist Two" },
      ],
    };
    const item = reconcilePlaybackItem(
      {
        uri: previous.uri,
        artists: [{ id: "one", name: "" }],
      },
      previous,
    );

    expect(item.artists).toEqual(previous.artists);
  });

  it("never carries canonical artists into a different URI", () => {
    const item = reconcilePlaybackItem(
      { uri: "spotify:track:new", artists: [] },
      {
        uri: "spotify:track:old",
        artists: [{ name: "Old Artist" }],
      },
    );

    expect(item.artists).toEqual([]);
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

  it("suppresses artwork for rejected metadata until the next update", () => {
    const correlator = createMediaGenerationCorrelator();
    correlator.recordMetadata({ mediaGeneration: 21 });
    correlator.rejectCurrentArtwork();

    expect(correlator.acceptsArtwork({ mediaGeneration: 21 })).toBe(false);

    correlator.recordMetadata({ mediaGeneration: 22 });
    expect(correlator.acceptsArtwork({ mediaGeneration: 22 })).toBe(true);
  });

  it("suppresses the next legacy artwork after legacy metadata is rejected", () => {
    const correlator = createMediaGenerationCorrelator();
    correlator.recordMetadata({});
    correlator.rejectCurrentArtwork();

    expect(correlator.acceptsArtwork({})).toBe(false);
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

  it("protects playing local files and rejects their ignored legacy artwork", () => {
    const playingLocalFile = {
      is_playing: true,
      item: { uri: "spotify:local:Artist:Album:Track:180" },
    };
    const correlator = createMediaGenerationCorrelator();

    expect(
      shouldIgnoreInactiveForeignMedia(playingLocalFile, "YouTube", "stopped"),
    ).toBe(true);

    correlator.rejectCurrentArtwork();
    expect(correlator.acceptsArtwork({})).toBe(false);

    correlator.recordMetadata({});
    expect(correlator.acceptsArtwork({})).toBe(true);
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

describe("cleared phone media updates", () => {
  it("clears displayed phone media when the phone's media slot empties", () => {
    expect(
      shouldClearDisplayedMediaForEmptyUpdate(
        { uri: "local:media:Old Video", is_phone_media: true },
        true,
      ),
    ).toBe(true);
  });

  it("clears a pending Spotify placeholder when the phone's media slot empties", () => {
    expect(
      shouldClearDisplayedMediaForEmptyUpdate(
        { uri: "spotify:pending:Song", is_spotify_pending: true },
        true,
      ),
    ).toBe(true);
  });

  it("never clears canonical Spotify playback", () => {
    expect(
      shouldClearDisplayedMediaForEmptyUpdate(
        { uri: "spotify:track:current" },
        true,
      ),
    ).toBe(false);
  });

  it("ignores non-empty updates and missing items", () => {
    expect(
      shouldClearDisplayedMediaForEmptyUpdate(
        { uri: "local:media:Old Video", is_phone_media: true },
        false,
      ),
    ).toBe(false);
    expect(shouldClearDisplayedMediaForEmptyUpdate(null, true)).toBe(false);
  });
});
