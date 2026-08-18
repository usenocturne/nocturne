import { describe, expect, it } from "bun:test";
import {
  getPlaybackLikeTarget,
  shouldUsePhoneHidControls,
} from "./useSpotifyPlayerControls";

describe("offline Spotify phone controls", () => {
  const phonePlayback = {
    device: { type: " smartphone " },
  };

  it("uses HID controls when the active Spotify device is an offline phone", () => {
    expect(shouldUsePhoneHidControls(phonePlayback, "disconnected")).toBe(true);
  });

  it("waits for an explicit disconnected state", () => {
    expect(shouldUsePhoneHidControls(phonePlayback, "unknown")).toBe(false);
    expect(shouldUsePhoneHidControls(phonePlayback, "connected")).toBe(false);
  });

  it("accepts a cached smartphone device for sparse playback state", () => {
    expect(
      shouldUsePhoneHidControls({ device: null }, "disconnected", "SMARTPHONE"),
    ).toBe(true);
  });

  it("does not route non-phone Spotify devices through HID", () => {
    expect(
      shouldUsePhoneHidControls(
        { device: { type: "COMPUTER" } },
        "disconnected",
      ),
    ).toBe(false);
    expect(
      shouldUsePhoneHidControls(
        { device: { type: "COMPUTER" } },
        "disconnected",
        "SMARTPHONE",
      ),
    ).toBe(false);
  });
});

describe("playback like targets", () => {
  it("uses the complete Spotify local URI", () => {
    const uri = "spotify:local:Artist:Album:Song:200";
    expect(
      getPlaybackLikeTarget({
        item: { id: "Artist", uri },
      }),
    ).toEqual({ source: "spotify_local", reference: uri, liked: false });
  });

  it("routes phone media independently of Spotify IDs", () => {
    expect(
      getPlaybackLikeTarget({
        item: {
          id: "local-media-youtube-track",
          is_phone_media: true,
          is_liked: true,
        },
      }),
    ).toEqual({
      source: "phone_media",
      reference: "local-media-youtube-track",
      liked: true,
    });
  });

  it("preserves canonical Spotify track IDs", () => {
    expect(getPlaybackLikeTarget({ item: { id: "abc123" } })).toEqual({
      source: "spotify",
      reference: "abc123",
      liked: false,
    });
  });
});
