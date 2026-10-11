import { describe, expect, test } from "bun:test";
import {
  createCubicBezierEasing,
  getNowPlayingSwipeActions,
  getQueueScrollTarget,
  getQueueDragOffset,
  shouldDismissQueueDrag,
  getQueueSkipParams,
  normalizeQueueResponse,
  NOW_PLAYING_ROW_INDEX,
  stepQueueSelection,
} from "./queue";

describe("Now Playing queue", () => {
  test("normalizes the companion queue shape", () => {
    expect(
      normalizeQueueResponse({
        queue: [
          {
            uid: "uid-1",
            uri: "spotify:track:one",
            name: "One",
            explicit: true,
            album_name: "Album",
            image_url: "https://i.scdn.co/image/one",
          },
        ],
      }),
    ).toEqual([
      {
        key: "uid-1",
        uid: "uid-1",
        uri: "spotify:track:one",
        name: "One",
        subtitle: "Album",
        imageUrl: "https://i.scdn.co/image/one",
        explicit: true,
      },
    ]);
  });

  test("prefers artist names over the album fallback", () => {
    const [withArtistName, withArtists] = normalizeQueueResponse({
      queue: [
        { uri: "spotify:track:a", artist_name: "Solo", album_name: "X" },
        {
          uri: "spotify:track:b",
          artists: [{ name: "First" }, { name: "" }, { name: "Second" }],
          album: { name: "Y", images: [{ url: "https://img/b" }] },
        },
      ],
    });

    expect(withArtistName.subtitle).toBe("Solo");
    expect(withArtists.subtitle).toBe("First, Second");
    expect(withArtists.imageUrl).toBe("https://img/b");
  });

  test("drops malformed entries and keeps keys unique without uids", () => {
    const entries = normalizeQueueResponse({
      queue: [
        null,
        { name: "No uri" },
        { uri: "spotify:track:dup" },
        { uri: "spotify:track:dup" },
      ],
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "spotify:track:dup-2",
      "spotify:track:dup-3",
    ]);
    expect(entries[0].uid).toBeNull();
    expect(entries[0].name).toBe("Unknown Track");
  });

  test("treats unexpected responses as an empty queue", () => {
    expect(normalizeQueueResponse(null)).toEqual([]);
    expect(normalizeQueueResponse({})).toEqual([]);
    expect(normalizeQueueResponse({ queue: "nope" })).toEqual([]);
  });

  test("skips to a queue item by uid with its playback context", () => {
    expect(getQueueSkipParams({ uid: "uid-1" }, "spotify:album:a")).toEqual({
      uid: "uid-1",
      context_uri: "spotify:album:a",
    });
    expect(getQueueSkipParams({ uid: "uid-1" }, null)).toEqual({
      uid: "uid-1",
    });
  });

  test("never sends a uid-less skip, which would only skip one track", () => {
    expect(getQueueSkipParams({ uid: null }, "spotify:album:a")).toBeNull();
  });

  test("swipe down opens the queue even while lyrics are showing", () => {
    const base = {
      showLyrics: true,
      canShowLyrics: true,
      canShowQueue: true,
      lyricsGestureEnabled: false,
      queueGestureEnabled: true,
    };

    expect(getNowPlayingSwipeActions(base).down).toBe("openQueue");
    expect(
      getNowPlayingSwipeActions({ ...base, lyricsGestureEnabled: true }).down,
    ).toBe("openQueue");
  });

  test("swipe down needs an available queue and the queue gesture", () => {
    const base = {
      showLyrics: false,
      canShowLyrics: true,
      canShowQueue: true,
      lyricsGestureEnabled: false,
      queueGestureEnabled: true,
    };

    expect(
      getNowPlayingSwipeActions({ ...base, canShowQueue: false }).down,
    ).toBeNull();
    expect(
      getNowPlayingSwipeActions({ ...base, queueGestureEnabled: false }).down,
    ).toBeNull();
  });

  test("swipe up toggles lyrics both ways when the lyrics gesture is on", () => {
    const base = {
      showLyrics: false,
      canShowLyrics: true,
      canShowQueue: true,
      lyricsGestureEnabled: true,
      queueGestureEnabled: true,
    };

    expect(getNowPlayingSwipeActions(base).up).toBe("showLyrics");
    expect(getNowPlayingSwipeActions({ ...base, showLyrics: true }).up).toBe(
      "hideLyrics",
    );
    expect(
      getNowPlayingSwipeActions({ ...base, lyricsGestureEnabled: false }).up,
    ).toBeNull();
    expect(
      getNowPlayingSwipeActions({ ...base, canShowLyrics: false }).up,
    ).toBeNull();
  });
});

describe("queue dial selection", () => {
  test("first tick down lands on the next track, up on now playing", () => {
    expect(stepQueueSelection(-1, 1, 5)).toBe(1);
    expect(stepQueueSelection(-1, -1, 5)).toBe(NOW_PLAYING_ROW_INDEX);
    expect(stepQueueSelection(-1, 1, 1)).toBe(NOW_PLAYING_ROW_INDEX);
  });

  test("scrolling back up reaches the now playing row and stops there", () => {
    let index = -1;
    for (let i = 0; i < 4; i++) index = stepQueueSelection(index, 1, 5);
    expect(index).toBe(4);
    for (let i = 0; i < 10; i++) index = stepQueueSelection(index, -1, 5);
    expect(index).toBe(NOW_PLAYING_ROW_INDEX);
  });

  test("every tick moves exactly one row and clamps at the end", () => {
    expect(stepQueueSelection(2, 1, 5)).toBe(3);
    expect(stepQueueSelection(4, 1, 5)).toBe(4);
    expect(stepQueueSelection(0, -1, 5)).toBe(0);
    expect(stepQueueSelection(3, 1, 0)).toBe(-1);
  });
});

describe("queue drag to dismiss", () => {
  test("the sheet follows upward drags and never moves below its rest position", () => {
    expect(getQueueDragOffset(-120)).toBe(-120);
    expect(getQueueDragOffset(80)).toBe(0);
  });

  test("dismisses past a quarter of the sheet", () => {
    expect(shouldDismissQueueDrag(-119, 0, 480)).toBe(false);
    expect(shouldDismissQueueDrag(-120, 0, 480)).toBe(true);
  });

  test("an upward fling dismisses even from a short drag", () => {
    expect(shouldDismissQueueDrag(-40, -0.8, 480)).toBe(true);
    expect(shouldDismissQueueDrag(-40, -0.2, 480)).toBe(false);
    expect(shouldDismissQueueDrag(0, -0.8, 480)).toBe(false);
  });

  test("a slow drag that reverses springs back", () => {
    expect(shouldDismissQueueDrag(-60, 0.3, 480)).toBe(false);
  });
});

describe("queue dial scrolling", () => {
  const easing = createCubicBezierEasing(0.16, 1, 0.3, 1);

  test("matches the home carousel easing endpoints and shape", () => {
    expect(easing(0)).toBe(0);
    expect(easing(1)).toBe(1);
    expect(easing(0.5)).toBeGreaterThan(0.9);
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = easing(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  test("a linear curve is the identity", () => {
    const linear = createCubicBezierEasing(0, 0, 1, 1);
    expect(linear(0.25)).toBeCloseTo(0.25, 4);
    expect(linear(0.7)).toBeCloseTo(0.7, 4);
  });

  test("aligns the selected row to the top within the scroll range", () => {
    expect(getQueueScrollTarget(330, 1400, 290)).toBe(330);
    expect(getQueueScrollTarget(1300, 1400, 290)).toBe(1110);
    expect(getQueueScrollTarget(0, 1400, 290)).toBe(0);
    expect(getQueueScrollTarget(200, 250, 290)).toBe(0);
  });
});
