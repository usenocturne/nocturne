import type {
  SpotifyAlbum,
  SpotifyEpisode,
  SpotifyPaging,
  SpotifyTrack,
} from "../../../types";

export type RawTrack = SpotifyTrack & {
  track?: RawTrack;
  image_url?: string;
  explicit?: boolean;
  track_number?: number;
  disc_number?: number;
  album?: SpotifyAlbum & { image_url?: string };
};
export type RawEpisode = SpotifyEpisode & {
  explicit?: boolean;
  release_date?: string;
};
export type PageResult<T> = SpotifyPaging<T> | T[];
export function pageItems<T>(page: PageResult<T> | null | undefined): T[] {
  return Array.isArray(page) ? page : (page?.items ?? []);
}
export function pageTotal<T>(
  page: PageResult<T> | null | undefined,
): number | undefined {
  return Array.isArray(page) ? undefined : page?.total;
}
export function pageNext<T>(
  page: PageResult<T> | null | undefined,
): string | null | undefined {
  return Array.isArray(page) ? undefined : page?.next;
}
export type TracklistContext = {
  uri: string;
  title: string;
  image_id?: string | null;
};
export type TracklistItem = {
  uri: string;
  uid?: string;
  title: string;
  subtitle: string;
  image_id?: string | null;
  available_offline: boolean;
  isTrailer?: boolean;
  metadata?: {
    duration_ms?: number;
    explicit?: boolean;
    track_number?: number;
    disc_number?: number;
    album?: string;
    release_date?: string;
    description?: string;
    progress_percentage?: number;
    is_played?: boolean;
  };
};
