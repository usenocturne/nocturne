import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyDevice,
  SpotifyEpisode,
  SpotifyPaging,
  SpotifyPlaybackState,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyShowEntry,
  SpotifyTrack,
} from "../types";

export interface SpotifyTrackEntry extends SpotifyTrack {
  track?: SpotifyTrack | null;
  added_at?: string;
}

export interface SpotifyPlayerResponse extends SpotifyPlaybackState {
  result?: SpotifyPlayerResponse;
  player_state?: unknown;
}

export interface SpotifyMethodResponses {
  "spotify.player.state": SpotifyPlayerResponse;
  "spotify.devices": {
    devices?: SpotifyDevice[] | Record<string, SpotifyDevice>;
  };
  "spotify.me.profile": Record<string, unknown>;
  "spotify.me.playlists": SpotifyPaging<SpotifyPlaylist>;
  "spotify.me.top_tracks": SpotifyPaging<SpotifyTrack>;
  "spotify.me.top_artists": SpotifyPaging<SpotifyArtist>;
  "spotify.me.tracks": SpotifyPaging<SpotifyTrackEntry>;
  "spotify.me.shows": SpotifyPaging<SpotifyShowEntry>;
  "spotify.me.recently_played": { albums?: SpotifyAlbum[] };
  "spotify.me.tracks.contains":
    | { results?: Array<boolean | number> }
    | Array<boolean | number>;
  "spotify.artist.get": SpotifyArtist;
  "spotify.artist.top_tracks": { tracks?: SpotifyTrack[] };
  "spotify.album.get": SpotifyAlbum;
  "spotify.album.tracks": SpotifyPaging<SpotifyTrack>;
  "spotify.playlist.get": SpotifyPlaylist;
  "spotify.playlist.tracks": SpotifyPaging<SpotifyTrackEntry>;
  "spotify.show.get": SpotifyShow & { total_episodes?: number };
  "spotify.show.episodes": SpotifyPaging<SpotifyEpisode>;
  "spotify.image.fetch": {
    data?: string | ArrayBuffer | Uint8Array | null;
    content_type?: string;
  };
  "spotify.track.lyrics": { lyrics?: { lines?: unknown } };
  "spotify.radio.mixes": {
    sections?: Array<{
      items?: Array<{
        uri: string;
        name: string;
        format?: string;
        image_url?: string;
      }>;
    }>;
  };
  "spotify.radio.topMix": { tracks?: SpotifyTrack[] } | SpotifyTrack[];
  "spotify.radio.top_mix": { tracks?: SpotifyTrack[] } | SpotifyTrack[];
  "spotify.radio.discoveries": { tracks?: SpotifyTrack[] } | SpotifyTrack[];
}

export interface SpotifyConnectedDevice extends SpotifyDevice {
  id: string;
  device_id: string;
  name: string;
  type: string;
  device_type: string;
  is_active: boolean;
}

export function normalizeSpotifyDevices(
  value: unknown,
): SpotifyConnectedDevice[] {
  if (!value || typeof value !== "object" || !("devices" in value)) return [];
  const devices = value.devices;
  if (!devices || typeof devices !== "object") return [];
  const isArray = Array.isArray(devices);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return Object.entries(devices).flatMap(([key, entry]: [string, unknown]) => {
    if (!entry || typeof entry !== "object") return [];
    const device = entry as Record<string, unknown>;
    const id =
      text(device.device_id) || text(device.id) || (isArray ? "" : key);
    if (!id) return [];
    const type = text(device.device_type) || text(device.type) || "Unknown";
    return [
      {
        ...device,
        id,
        device_id: id,
        type,
        device_type: type,
        name: text(device.name) || "Unknown Device",
        is_active: device.is_active === true,
        is_private_session: device.is_private_session === true,
        is_restricted: device.is_restricted === true,
        volume_percent:
          typeof device.volume_percent === "number"
            ? device.volume_percent
            : null,
        connected: device.connected === true,
        address:
          typeof device.address === "string" ? device.address : undefined,
      },
    ];
  });
}
