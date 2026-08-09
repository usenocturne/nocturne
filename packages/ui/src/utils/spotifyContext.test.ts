import { describe, expect, it } from "bun:test";
import {
  normalizeSpotifyContext,
  normalizeSpotifyPlaylist,
} from "./spotifyContext";

describe("normalizeSpotifyContext", () => {
  it.each([
    "spotify:collection",
    "spotify:collection:tracks",
    "spotify:collection:your-music",
    "spotify:user:listener:collection",
    "spotify:user:listener:collection:tracks",
  ])("normalizes the Liked Songs context %s", (uri) => {
    expect(normalizeSpotifyContext({ uri })).toEqual({
      contentId: "liked-songs",
      contentType: "liked-songs",
      uri: "spotify:collection:your-music",
    });
  });

  it("normalizes a personalized yearly playlist with a legacy user URI", () => {
    expect(
      normalizeSpotifyContext(
        "spotify:user:spotify:playlist:37i9dQZF1EUMDoJuT8yJsl",
      ),
    ).toEqual({
      contentId: "37i9dQZF1EUMDoJuT8yJsl",
      contentType: "playlist",
      uri: "spotify:playlist:37i9dQZF1EUMDoJuT8yJsl",
    });
  });

  it.each([
    ["spotify:playlist:playlist-id", "playlist", "playlist-id"],
    ["spotify:album:album-id", "album", "album-id"],
    ["spotify:artist:artist-id", "artist", "artist-id"],
    ["spotify:show:show-id", "show", "show-id"],
  ])("keeps canonical %s contexts", (uri, contentType, contentId) => {
    expect(normalizeSpotifyContext(uri)).toEqual({
      contentId,
      contentType,
      uri,
    });
  });

  it.each([
    "spotify:collection:your-episodes",
    "spotify:collection:albums",
    "spotify:user:listener",
    "spotify:search:wrapped",
    "spotify:queue",
    "spotify:playlist-recommended:playlist-id",
    "https://open.spotify.com/playlist/playlist-id",
    "",
  ])("rejects unsupported context %s", (uri) => {
    expect(normalizeSpotifyContext(uri)).toBeNull();
  });
});

describe("normalizeSpotifyPlaylist", () => {
  it("repairs the owner ID extracted from a legacy yearly playlist URI", () => {
    expect(
      normalizeSpotifyPlaylist({
        id: "spotify",
        uri: "spotify:user:spotify:playlist:yearly-playlist-id",
        name: "Your Top Songs 2018",
      }),
    ).toEqual({
      id: "yearly-playlist-id",
      uri: "spotify:playlist:yearly-playlist-id",
      name: "Your Top Songs 2018",
    });
  });

  it("builds a canonical URI when a playlist response has only an ID", () => {
    expect(normalizeSpotifyPlaylist({ id: "playlist-id" })).toEqual({
      id: "playlist-id",
      uri: "spotify:playlist:playlist-id",
    });
  });
});
