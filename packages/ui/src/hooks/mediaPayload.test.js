import { describe, expect, test } from "bun:test";
import {
  normalizeDealerCluster,
  normalizePhoneMediaAttributes,
} from "./mediaPayload";
import { normalizeSpotifyDevices } from "./spotifyResponses";
import { normalizeLyricLines } from "./useLyrics";

describe("media response boundaries", () => {
  test("retains valid phone metadata, zero anchors, and correlation fields", () => {
    expect(
      normalizePhoneMediaAttributes({
        MediaItemTitle: "Song",
        MediaItemArtist: "Artist",
        MediaItemDuration: 100,
        PlaybackElapsedTimeInMilliseconds: 0,
        MediaItemLiked: false,
        media_generation: 12,
      }),
    ).toMatchObject({
      MediaItemTitle: "Song",
      MediaItemArtist: "Artist",
      MediaItemDuration: 100,
      PlaybackElapsedTimeInMilliseconds: 0,
      MediaItemLiked: false,
      media_generation: 12,
    });
    expect(normalizePhoneMediaAttributes(null)).toBeNull();
    expect(normalizePhoneMediaAttributes([])).toBeNull();
  });
  test("does not let malformed media values become UI text or timing anchors", () => {
    const media = normalizePhoneMediaAttributes({
      MediaItemTitle: {},
      PlaybackRate: NaN,
      MediaItemDuration: "unknown",
    });
    expect(media.MediaItemTitle).toBeUndefined();
    expect(media.PlaybackRate).toBeUndefined();
    expect(media.MediaItemDuration).toBeUndefined();
  });
  test("normalizes Dealer numeric aliases and keeps the active device identity", () => {
    const cluster = normalizeDealerCluster({
      payloads: [
        {
          cluster: {
            active_device_id: "device",
            devices: { device: { name: "Desktop", volume: 32768 } },
            player_state: {
              is_paused: 0,
              timestamp: 123,
              position_as_of_timestamp: "45",
              track: {
                uri: "spotify:track:track",
                metadata: {
                  title: "Song",
                  artist_name: "Artist",
                  artists: [{ name: "Named" }, { name: {} }],
                },
              },
              options: { shuffling_context: 1, repeating_context: true },
            },
          },
        },
      ],
    });
    expect(cluster.devices.device.device_id).toBe("device");
    expect(cluster.player_state).toMatchObject({
      is_paused: false,
      timestamp: "123",
      position_as_of_timestamp: "45",
      options: { shuffling_context: true, repeating_context: true },
      track: { metadata: { title: "Song", artists: [{ name: "Named" }] } },
    });
    expect(normalizeDealerCluster({ payloads: [] })).toBeNull();
  });
  test("retains both Spotify device aliases and derives IDs from device maps", () => {
    expect(
      normalizeSpotifyDevices({
        devices: {
          abc: { name: "Desktop", device_type: "COMPUTER", is_active: true },
        },
      }),
    ).toMatchObject([
      {
        id: "abc",
        device_id: "abc",
        name: "Desktop",
        type: "COMPUTER",
        device_type: "COMPUTER",
        is_active: true,
      },
    ]);
    expect(
      normalizeSpotifyDevices({
        devices: [{ id: "phone", type: "SMARTPHONE", name: "Phone" }, {}],
      }),
    ).toHaveLength(1);
  });
  test("accepts numeric lyric timestamps without retaining malformed lines", () => {
    expect(
      normalizeLyricLines([
        { startTimeMs: 0, words: "" },
        { startTimeMs: "1000", words: "Line" },
        { startTimeMs: {}, words: "bad" },
        null,
      ]),
    ).toEqual([
      { startTimeMs: "0", words: "" },
      { startTimeMs: "1000", words: "Line" },
    ]);
  });
});
