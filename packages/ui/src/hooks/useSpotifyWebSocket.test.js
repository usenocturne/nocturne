import { describe, expect, it } from "bun:test";
import {
  getSpotifyImageFetchFallback,
  isMetadataOnlyLyricsRequest,
  isSpotifyCommandSessionReady,
} from "./useSpotifyWebSocket";

const readyState = (overrides = {}) => ({
  wsConnected: true,
  appReady: true,
  spotifyAuthenticated: true,
  spotifySkipped: false,
  appSubscribed: true,
  appHasLifetime: false,
  platform: "ios",
  ...overrides,
});

describe("Spotify image fetch boundary", () => {
  it("returns a local fallback for unresolvable local-file artwork", () => {
    const localImage = "spotify:localfileimage:%2Fprivate%2Ftrack.mp3";

    expect(getSpotifyImageFetchFallback(localImage)).toBe(
      "/images/not-playing.webp",
    );
    expect(getSpotifyImageFetchFallback(`https://${localImage}`)).toBe(
      "/images/not-playing.webp",
    );
    expect(getSpotifyImageFetchFallback("https://i.scdn.co/image/cover")).toBe(
      null,
    );
  });
});

describe("Spotify command session readiness", () => {
  it("does not treat a generic Bluetooth connection as app readiness", () => {
    expect(
      isSpotifyCommandSessionReady(
        readyState({ appReady: false, deviceConnected: true }),
      ),
    ).toBe(false);
  });

  it("allows iOS and Android only after app.ready", () => {
    expect(isSpotifyCommandSessionReady(readyState())).toBe(true);
    expect(
      isSpotifyCommandSessionReady(readyState({ platform: "android" })),
    ).toBe(true);
  });

  it("requires the browser socket, Spotify auth, and access", () => {
    expect(
      isSpotifyCommandSessionReady(readyState({ wsConnected: false })),
    ).toBe(false);
    expect(
      isSpotifyCommandSessionReady(readyState({ spotifyAuthenticated: false })),
    ).toBe(false);
    expect(
      isSpotifyCommandSessionReady(readyState({ spotifySkipped: true })),
    ).toBe(false);
    expect(
      isSpotifyCommandSessionReady(
        readyState({ appSubscribed: false, appHasLifetime: false }),
      ),
    ).toBe(false);
  });

  it("preserves the connector access exception after app.ready", () => {
    expect(
      isSpotifyCommandSessionReady(
        readyState({
          appSubscribed: false,
          appHasLifetime: false,
          platform: "web",
        }),
      ),
    ).toBe(true);
  });
});

describe("metadata lyrics command", () => {
  it("allows only metadata-complete lyrics requests without a Spotify id", () => {
    expect(
      isMetadataOnlyLyricsRequest("spotify.track.lyrics", {
        trackName: "Song",
        artistName: "Artist",
      }),
    ).toBe(true);
    expect(
      isMetadataOnlyLyricsRequest("spotify.track.lyrics", {
        contentId: "track-id",
        trackName: "Song",
        artistName: "Artist",
      }),
    ).toBe(false);
    expect(
      isMetadataOnlyLyricsRequest("spotify.track.lyrics", {
        trackName: "Song",
      }),
    ).toBe(false);
    expect(
      isMetadataOnlyLyricsRequest("spotify.player.state", {
        trackName: "Song",
        artistName: "Artist",
      }),
    ).toBe(false);
  });
});
