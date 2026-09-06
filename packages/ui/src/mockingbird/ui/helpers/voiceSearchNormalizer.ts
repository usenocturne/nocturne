import type { VoiceShelfItem } from "../stores/ShelfModels";

const MAX_VOICE_ITEMS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSpotifySearchResult(
  result: unknown,
): VoiceShelfItem[] {
  if (!isRecord(result)) return [];
  const items: VoiceShelfItem[] = [];
  const seenUris = new Set<string>();
  const categories: Array<{
    field: string;
    kind: VoiceShelfItem["kind"];
    subtitle: string;
    artist: boolean;
  }> = [
    { field: "artists", kind: "artist", subtitle: "Artist", artist: false },
    { field: "albums", kind: "album", subtitle: "Album", artist: true },
    { field: "tracks", kind: "track", subtitle: "", artist: true },
    {
      field: "playlists",
      kind: "playlist",
      subtitle: "Playlist",
      artist: false,
    },
  ];
  for (const category of categories) {
    for (const item of records(result[category.field])) {
      if (items.length >= MAX_VOICE_ITEMS) return items;
      const uri = text(item.uri);
      if (!uri || seenUris.has(uri)) continue;
      seenUris.add(uri);
      items.push({
        uri,
        title: text(item.name),
        subtitle: category.artist
          ? text(item.artist, category.subtitle)
          : category.subtitle,
        image_url: text(item.image_url),
        kind: category.kind,
      });
    }
  }
  return items;
}

export function isEmptyVoiceResult(result: unknown): boolean {
  if (!isRecord(result)) return true;
  return ["tracks", "artists", "albums", "playlists"].every(
    (key) => records(result[key]).length === 0,
  );
}

export function normalizeRecentlyPlayedResult(
  result: unknown,
): VoiceShelfItem[] {
  if (!isRecord(result)) return [];
  const items: VoiceShelfItem[] = [];
  const seenUris = new Set<string>();
  for (const album of records(result.albums)) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    const uri = text(album.uri);
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    const firstArtist = records(album.artists)[0];
    const firstImage = records(album.images)[0];
    items.push({
      uri,
      title: text(album.name),
      subtitle: text(firstArtist?.name) || "Album",
      image_url: text(firstImage?.url),
      kind: "album",
    });
  }
  return items;
}

export function isEmptyRecentlyPlayedResult(result: unknown): boolean {
  return !isRecord(result) || records(result.albums).length === 0;
}
