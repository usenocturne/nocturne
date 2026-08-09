import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { buildButtonMapping } from "./buttonMapping";
import { getButtonMappingValue, setButtonMapping } from "./presetStorage";

const createStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
};

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

beforeEach(() => {
  globalThis.localStorage = createStorage();
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("buildButtonMapping", () => {
  it("creates a canonical Liked Songs mapping before tracks load", () => {
    expect(
      buildButtonMapping({
        contentId: "liked",
        contentType: "liked-songs",
        contentImage: "https://example.com/stale-playlist.jpg",
        contentName: "Stale Playlist",
      }),
    ).toEqual({
      id: "liked-songs",
      type: "liked-songs",
      image: "/images/liked-songs.webp",
      name: "Liked Songs",
    });
  });

  it("stores only valid Spotify track URIs as a fallback", () => {
    expect(
      buildButtonMapping({
        contentId: "liked",
        contentType: "liked-songs",
        trackUris: [
          "spotify:track:first",
          null,
          "spotify:album:not-a-track",
          "spotify:track:second",
        ],
      }),
    ).toEqual({
      id: "liked-songs",
      type: "liked-songs",
      image: "/images/liked-songs.webp",
      name: "Liked Songs",
      tracks: JSON.stringify(["spotify:track:first", "spotify:track:second"]),
    });
  });

  it("keeps the DJ artwork override", () => {
    expect(
      buildButtonMapping({
        contentId: "37i9dQZF1EYkqdzj48dyYq",
        contentType: "playlist",
        contentImage: "https://example.com/cover.jpg",
        contentName: "DJ",
      }),
    ).toEqual({
      id: "37i9dQZF1EYkqdzj48dyYq",
      type: "playlist",
      image: "/images/radio-cover/dj.webp",
      name: "DJ",
    });
  });
});

describe("setButtonMapping", () => {
  it("replaces the complete slot and clears a stale track fallback", () => {
    const deviceId = "AA:BB:CC:DD:EE:FF";
    setButtonMapping(
      1,
      {
        id: "old-mix",
        type: "mix",
        image: "",
        name: "Old Mix",
        tracks: JSON.stringify(["spotify:track:stale"]),
      },
      deviceId,
    );

    setButtonMapping(
      1,
      {
        id: "liked-songs",
        type: "liked-songs",
        image: "/images/liked-songs.webp",
        name: "Liked Songs",
      },
      deviceId,
    );

    expect(getButtonMappingValue(1, "Id", deviceId)).toBe("liked-songs");
    expect(getButtonMappingValue(1, "Type", deviceId)).toBe("liked-songs");
    expect(getButtonMappingValue(1, "Tracks", deviceId)).toBeNull();
  });
});
