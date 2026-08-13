import { describe, expect, it } from "bun:test";
import { reconcilePhoneMediaPausePosition } from "./usePlaybackProgress";

describe("phone media pause anchors", () => {
  it("freezes at the live position instead of jumping to an old pause", () => {
    const result = reconcilePhoneMediaPausePosition({
      previousIsPlaying: true,
      incomingIsPlaying: false,
      expectedPositionMs: 42_000,
      incomingPositionMs: 11_000,
      nowMs: 100_000,
      guard: null,
    });

    expect(result.positionMs).toBe(42_000);
    expect(result.rejectedStaleAnchor).toBe(true);
    expect(result.guard).toEqual({
      floorMs: 42_000,
      expiresAtMs: 103_000,
    });
  });

  it("accepts the corrected paused position and clears the guard", () => {
    const result = reconcilePhoneMediaPausePosition({
      previousIsPlaying: false,
      incomingIsPlaying: false,
      expectedPositionMs: 42_000,
      incomingPositionMs: 42_350,
      nowMs: 100_500,
      guard: { floorMs: 42_000, expiresAtMs: 103_000 },
    });

    expect(result).toEqual({
      positionMs: 42_350,
      guard: null,
      rejectedStaleAnchor: false,
    });
  });

  it("accepts ordinary callback latency without manufacturing a jump", () => {
    const result = reconcilePhoneMediaPausePosition({
      previousIsPlaying: true,
      incomingIsPlaying: false,
      expectedPositionMs: 42_000,
      incomingPositionMs: 40_750,
      nowMs: 100_000,
      guard: null,
    });

    expect(result.positionMs).toBe(40_750);
    expect(result.rejectedStaleAnchor).toBe(false);
    expect(result.guard).toBeNull();
  });

  it("lets a deliberate paused seek through after the short guard expires", () => {
    const result = reconcilePhoneMediaPausePosition({
      previousIsPlaying: false,
      incomingIsPlaying: false,
      expectedPositionMs: 42_000,
      incomingPositionMs: 11_000,
      nowMs: 103_001,
      guard: { floorMs: 42_000, expiresAtMs: 103_000 },
    });

    expect(result).toEqual({
      positionMs: 11_000,
      guard: null,
      rejectedStaleAnchor: false,
    });
  });
});
