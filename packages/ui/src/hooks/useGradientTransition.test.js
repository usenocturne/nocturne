import { describe, expect, it } from "bun:test";
import { createGradientRequestTracker } from "./useGradientTransition";

describe("gradient request ordering", () => {
  it("rejects a late local-art completion after canonical art starts", () => {
    const tracker = createGradientRequestTracker();
    const localRequest = tracker.begin("nowPlaying");
    const canonicalRequest = tracker.begin("nowPlaying");

    expect(tracker.isCurrent(canonicalRequest)).toBe(true);
    expect(tracker.isCurrent(localRequest)).toBe(false);
  });

  it("tracks unrelated sections independently", () => {
    const tracker = createGradientRequestTracker();
    const recentsRequest = tracker.begin("recents");
    tracker.begin("nowPlaying");

    expect(tracker.isCurrent(recentsRequest)).toBe(true);
  });
});
