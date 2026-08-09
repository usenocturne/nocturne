export type SpotifyQuickAccessContentType =
  "playlist" | "album" | "artist" | "show" | "liked-songs";

export type NormalizedSpotifyContext = {
  contentId: string;
  contentType: SpotifyQuickAccessContentType;
  uri: string;
};

type SpotifyContextInput =
  | string
  | {
      uri?: unknown;
    }
  | null
  | undefined;

type SpotifyPlaylistInput = {
  id?: unknown;
  uri?: unknown;
};

const CANONICAL_CONTEXT_TYPES = new Set<SpotifyQuickAccessContentType>([
  "playlist",
  "album",
  "artist",
  "show",
]);

const getContextUri = (context: SpotifyContextInput) => {
  if (typeof context === "string") return context.trim();
  if (!context || typeof context !== "object") return "";
  return typeof context.uri === "string" ? context.uri.trim() : "";
};

const isLikedSongsUri = (parts: string[]) => {
  const collectionIndex = parts.indexOf("collection");
  if (collectionIndex === -1) return false;

  const hasSupportedPrefix =
    collectionIndex === 1 ||
    (collectionIndex === 3 && parts[1] === "user" && !!parts[2]);
  if (!hasSupportedPrefix) return false;

  const suffix = parts.slice(collectionIndex + 1);
  return (
    suffix.length === 0 ||
    (suffix.length === 1 &&
      (suffix[0] === "tracks" || suffix[0] === "your-music"))
  );
};

export const normalizeSpotifyContext = (
  context: SpotifyContextInput,
): NormalizedSpotifyContext | null => {
  const rawUri = getContextUri(context);
  if (!rawUri) return null;

  const rawParts = rawUri.split(":");
  const parts = rawParts.map((part) => part.toLowerCase());
  if (parts[0] !== "spotify") return null;

  if (isLikedSongsUri(parts)) {
    return {
      contentId: "liked-songs",
      contentType: "liked-songs",
      uri: "spotify:collection:your-music",
    };
  }

  const canonicalType = parts[1] as SpotifyQuickAccessContentType | undefined;
  if (canonicalType && CANONICAL_CONTEXT_TYPES.has(canonicalType)) {
    const contentId = rawParts[2];
    if (!contentId) return null;
    return {
      contentId,
      contentType: canonicalType,
      uri: `spotify:${canonicalType}:${contentId}`,
    };
  }

  if (parts[1] === "user" && parts[3] === "playlist") {
    const contentId = rawParts[4];
    if (!contentId) return null;
    return {
      contentId,
      contentType: "playlist",
      uri: `spotify:playlist:${contentId}`,
    };
  }

  return null;
};

export const normalizeSpotifyPlaylist = <T extends SpotifyPlaylistInput>(
  playlist: T,
): T & { id?: string; uri?: string } => {
  const context = normalizeSpotifyContext(
    typeof playlist.uri === "string" ? playlist.uri : null,
  );

  if (context?.contentType === "playlist") {
    return {
      ...playlist,
      id: context.contentId,
      uri: context.uri,
    };
  }

  if (typeof playlist.id === "string" && playlist.id) {
    return {
      ...playlist,
      id: playlist.id,
      uri: `spotify:playlist:${playlist.id}`,
    };
  }

  return { ...playlist };
};
