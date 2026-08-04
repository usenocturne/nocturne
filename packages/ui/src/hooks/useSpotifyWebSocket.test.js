import { describe, expect, it } from "bun:test";
import { isSpotifyCommandSessionReady } from "./useSpotifyWebSocket";

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
