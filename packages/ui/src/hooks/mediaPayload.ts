import type { SpotifyArtist } from "../types";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const numericText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function normalizePhoneMediaAttributes(value: unknown) {
  const data = record(value);
  if (!data) return null;
  return {
    ...data,
    MediaItemTitle: text(data.MediaItemTitle),
    MediaItemArtist: text(data.MediaItemArtist),
    MediaItemAlbumName: text(data.MediaItemAlbumName),
    MediaItemAlbum: text(data.MediaItemAlbum),
    MediaItemDuration: number(data.MediaItemDuration),
    MediaItemPlaybackDurationInMilliseconds: number(
      data.MediaItemPlaybackDurationInMilliseconds,
    ),
    PlaybackAppName: text(data.PlaybackAppName),
    PlaybackStatus: text(data.PlaybackStatus),
    PlaybackShuffleMode: text(data.PlaybackShuffleMode),
    PlaybackRepeatMode: text(data.PlaybackRepeatMode),
    PlaybackRate: number(data.PlaybackRate),
    PlaybackSpeed: number(data.PlaybackSpeed),
    PlaybackElapsedTime: number(data.PlaybackElapsedTime),
    PlaybackElapsedTimeInMilliseconds: number(
      data.PlaybackElapsedTimeInMilliseconds,
    ),
  };
}
export type PhoneMediaAttributes = NonNullable<
  ReturnType<typeof normalizePhoneMediaAttributes>
>;

function artistList(value: unknown): SpotifyArtist[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item: unknown) => {
    const artist = record(item);
    if (!artist || typeof artist.name !== "string") return [];
    return [
      {
        ...artist,
        id: text(artist.id),
        uri: text(artist.uri),
        name: artist.name,
        type: text(artist.type),
      },
    ];
  });
}

export function normalizeDealerCluster(value: unknown) {
  const payloads = record(value)?.payloads;
  const cluster = record(
    record(Array.isArray(payloads) ? payloads[0] : null)?.cluster,
  );
  if (!cluster) return null;
  const devices: Record<
    string,
    { device_id: string; name?: string; device_type?: string; volume: number }
  > = {};
  for (const [id, raw] of Object.entries(record(cluster.devices) ?? {})) {
    const device = record(raw);
    if (device)
      devices[id] = {
        device_id: text(device.device_id) || id,
        name: text(device.name),
        device_type: text(device.device_type),
        volume: number(device.volume) ?? 0,
      };
  }
  const state = record(cluster.player_state);
  const track = record(state?.track);
  const uri = text(track?.uri);
  const metadata = record(track?.metadata) ?? {};
  const options = record(state?.options) ?? {};
  return {
    active_device_id: text(cluster.active_device_id),
    devices,
    player_state: state
      ? {
          is_paused: state.is_paused !== false && state.is_paused !== 0,
          timestamp: numericText(state.timestamp),
          position_as_of_timestamp: numericText(state.position_as_of_timestamp),
          duration: numericText(state.duration),
          context_uri: text(state.context_uri),
          track: uri
            ? {
                uri,
                metadata: {
                  ...metadata,
                  title: text(metadata.title),
                  album_title: text(metadata.album_title),
                  album_uri: text(metadata.album_uri),
                  image_url: text(metadata.image_url),
                  is_narration: text(metadata.is_narration),
                  album_artist_name: text(metadata.album_artist_name),
                  artist_name: text(metadata.artist_name),
                  artist_uri: text(metadata.artist_uri),
                  artist: text(metadata.artist),
                  artists: artistList(metadata.artists),
                },
              }
            : null,
          options: {
            shuffling_context:
              options.shuffling_context === true ||
              options.shuffling_context === 1,
            repeating_track:
              options.repeating_track === true || options.repeating_track === 1,
            repeating_context:
              options.repeating_context === true ||
              options.repeating_context === 1,
            playback_speed: number(options.playback_speed) ?? 1,
          },
        }
      : null,
  };
}
