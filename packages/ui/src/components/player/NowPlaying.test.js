import { describe, expect, it } from "bun:test";
import { getNowPlayingLeadingControl } from "./NowPlaying";

describe("Now Playing leading control", () => {
  it("keeps the like button visible for Spotify local files", () => {
    expect(getNowPlayingLeadingControl("track", false)).toBe("like");
  });

  it("keeps podcast and phone-media controls unchanged", () => {
    expect(getNowPlayingLeadingControl("episode", false)).toBe("speed");
    expect(getNowPlayingLeadingControl("track", true)).toBe("spacer");
  });
});
