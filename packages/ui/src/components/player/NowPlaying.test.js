import { describe, expect, it } from "bun:test";
import {
  getNowPlayingProgressPresentation,
  getNowPlayingLeadingControl,
} from "./NowPlaying";

describe("Now Playing leading control", () => {
  it("keeps the like button visible for Spotify local files", () => {
    expect(getNowPlayingLeadingControl("track", false)).toBe("like");
  });

  it("keeps podcast and phone-media controls unchanged", () => {
    expect(getNowPlayingLeadingControl("episode", false)).toBe("speed");
    expect(getNowPlayingLeadingControl("track", true)).toBe("spacer");
  });
});

describe("Now Playing progress visibility", () => {
  it("shows known phone-media timelines", () => {
    expect(getNowPlayingProgressPresentation(true, 180_000, 42_500)).toEqual({
      visible: true,
      timelineKnown: true,
    });
  });

  it("keeps the bar visible while a new phone timeline is loading", () => {
    expect(getNowPlayingProgressPresentation(true, 0, 42_500)).toEqual({
      visible: true,
      timelineKnown: false,
    });
    expect(getNowPlayingProgressPresentation(true, 180_000, null)).toEqual({
      visible: true,
      timelineKnown: false,
    });
  });

  it("preserves Spotify progress behavior", () => {
    expect(getNowPlayingProgressPresentation(false, 0, null)).toEqual({
      visible: true,
      timelineKnown: true,
    });
  });
});
