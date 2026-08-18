import { describe, expect, it } from "bun:test";
import {
  canShowLyricsForItem,
  canSeekFromLyrics,
  getNowPlayingProgressPresentation,
  getNowPlayingLeadingControl,
} from "./NowPlaying";

describe("Now Playing lyrics availability", () => {
  it("shows lyrics for Spotify local files", () => {
    expect(
      canShowLyricsForItem({
        type: "track",
        is_local: true,
        uri: "spotify:local:Artist:Album:Song:200",
      }),
    ).toBe(true);
  });

  it("keeps lyrics unavailable for episodes", () => {
    expect(canShowLyricsForItem({ type: "episode" })).toBe(false);
  });
});

describe("Now Playing leading control", () => {
  it("keeps the like button visible for Spotify local files", () => {
    expect(getNowPlayingLeadingControl("track", false)).toBe("like");
  });

  it("keeps podcast speed and shows the heart for phone media", () => {
    expect(getNowPlayingLeadingControl("episode", false)).toBe("speed");
    expect(getNowPlayingLeadingControl("track", true)).toBe("like");
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

describe("Now Playing lyric seeking", () => {
  it("keeps phone lyrics display-only", () => {
    expect(canSeekFromLyrics(true, true)).toBe(false);
  });

  it("preserves seeking for synchronized Spotify lyrics", () => {
    expect(canSeekFromLyrics(true, false)).toBe(true);
    expect(canSeekFromLyrics(false, false)).toBe(false);
  });
});
