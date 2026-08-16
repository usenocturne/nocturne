import { describe, expect, it } from "bun:test";
import { shouldUsePhoneHidControls } from "./useSpotifyPlayerControls";

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
