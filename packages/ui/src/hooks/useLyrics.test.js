import { describe, expect, it } from "bun:test";
import {
  buildLyricsRequestParams,
  canFetchLyricsForItem,
  getLyricsTrackKey,
  isMetadataOnlyLyricsItem,
  isLyricsRequestCurrent,
} from "./useLyrics";

describe("phone media lyrics lookup", () => {
  it("builds a metadata-only request for phone media", () => {
    expect(
      buildLyricsRequestParams({
        id: "local-media-youtube:song:artist:album",
        name: "Song",
        artists: [{ name: "Artist" }],
        phone_media_album_name: "Album",
        duration_ms: 200000,
        is_phone_media: true,
      }),
    ).toEqual({
      trackName: "Song",
      artistName: "Artist",
    });
  });

  it("preserves the Spotify content id for Spotify playback", () => {
    expect(
      buildLyricsRequestParams({
        id: "spotify-track-id",
        name: "Song",
        artists: [{ name: "Artist" }],
        album: { name: "Album" },
        duration_ms: 200000,
      }),
    ).toEqual({
      contentId: "spotify-track-id",
      trackName: "Song",
      artistName: "Artist",
    });
  });

  it("builds a metadata-only request for Spotify local files", () => {
    const localFile = {
      id: "local-track-id",
      uri: "spotify:local:Artist:Album:Song:200",
      name: "Song",
      artists: [{ name: "Artist" }],
      album: { name: "Album" },
      duration_ms: 200000,
    };

    expect(isMetadataOnlyLyricsItem(localFile)).toBe(true);
    expect(buildLyricsRequestParams(localFile)).toEqual({
      trackName: "Song",
      artistName: "Artist",
    });
  });

  it("recognizes local files even when is_local is omitted", () => {
    expect(
      isMetadataOnlyLyricsItem({
        uri: "spotify:local:Artist:Album:Song:200",
      }),
    ).toBe(true);
  });

  it("recognizes local files from is_local without a local URI", () => {
    expect(
      buildLyricsRequestParams({
        id: "local-track-id",
        uri: "spotify:track:placeholder",
        is_local: true,
        name: "Song",
        artists: [{ name: "Artist" }],
      }),
    ).not.toHaveProperty("contentId");
  });

  it("keeps local-file requests behind Spotify session readiness", () => {
    const item = {
      uri: "spotify:local:Artist:Album:Song:200",
      is_local: true,
    };

    expect(
      canFetchLyricsForItem(item, {
        wsConnected: true,
        appReady: true,
        isSpotifyReady: false,
      }),
    ).toBe(false);
    expect(
      canFetchLyricsForItem(item, {
        wsConnected: true,
        appReady: true,
        isSpotifyReady: true,
      }),
    ).toBe(true);
  });

  it("uses the full phone item identity instead of its title-only URI", () => {
    const base = {
      id: "local-media-youtube:stay:artist-one:album",
      uri: "local:media:Stay",
      name: "Stay",
      artists: [{ name: "Artist One" }],
      phone_media_album_name: "Album",
      duration_ms: 180000,
      is_phone_media: true,
    };

    expect(getLyricsTrackKey(base)).not.toBe(
      getLyricsTrackKey({
        ...base,
        id: "local-media-youtube:stay:artist-two:album",
        artists: [{ name: "Artist Two" }],
      }),
    );
  });

  it("rejects responses from an older request generation or track", () => {
    expect(isLyricsRequestCurrent(4, 3, "new-track", "old-track")).toBe(false);
    expect(isLyricsRequestCurrent(4, 4, "new-track", "old-track")).toBe(false);
    expect(isLyricsRequestCurrent(4, 4, "new-track", "new-track")).toBe(true);
  });
});
