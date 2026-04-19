const MAX_VOICE_ITEMS = 12;

/**
 * Normalizes the REAL flattened search response shape emitted by
 * SpotifyService.transformSearchResponse after T1 enrichment.
 *
 * Input:  { tracks?, artists?, albums?, playlists? }
 *   each item: { name, artist?, uri, image_url }
 *
 * Output: VoiceItem[] = [{ uri, title, subtitle, image_url, kind }]
 *   kind ∈ "track" | "artist" | "album" | "playlist"
 */
export function normalizeSpotifySearchResult(result) {
  if (!result || typeof result !== "object") return [];

  const items = [];
  const seenUris = new Set();

  function addItem(item) {
    if (!item.uri || seenUris.has(item.uri)) return;
    seenUris.add(item.uri);
    items.push(item);
  }

  // Artists first (matches user "artist icon" intuition)
  for (const a of result.artists ?? []) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    addItem({
      uri: a.uri ?? "",
      title: a.name ?? "",
      subtitle: "Artist",
      image_url: a.image_url ?? "",
      kind: "artist",
    });
  }

  // Albums
  for (const a of result.albums ?? []) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    addItem({
      uri: a.uri ?? "",
      title: a.name ?? "",
      subtitle: a.artist ?? "Album",
      image_url: a.image_url ?? "",
      kind: "album",
    });
  }

  // Tracks
  for (const t of result.tracks ?? []) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    addItem({
      uri: t.uri ?? "",
      title: t.name ?? "",
      subtitle: t.artist ?? "",
      image_url: t.image_url ?? "",
      kind: "track",
    });
  }

  // Playlists
  for (const p of result.playlists ?? []) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    addItem({
      uri: p.uri ?? "",
      title: p.name ?? "",
      subtitle: "Playlist",
      image_url: p.image_url ?? "",
      kind: "playlist",
    });
  }

  return items;
}

/**
 * Returns true when all four type arrays are absent or empty.
 */
export function isEmptyVoiceResult(result) {
  if (!result || typeof result !== "object") return true;
  return (
    (!result.tracks || result.tracks.length === 0) &&
    (!result.artists || result.artists.length === 0) &&
    (!result.albums || result.albums.length === 0) &&
    (!result.playlists || result.playlists.length === 0)
  );
}

/**
 * Normalizes spotify_get_recently_played result into VoiceItem[].
 * Input: { albums: [{ uri, id, name, images:[{url,height,width}], artists:[{name,uri,id}] }] }
 */
export function normalizeRecentlyPlayedResult(result) {
  if (!result || typeof result !== "object") return [];
  const items = [];
  const seenUris = new Set();
  for (const a of result.albums ?? []) {
    if (items.length >= MAX_VOICE_ITEMS) break;
    const uri = a.uri ?? "";
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    const firstArtist =
      Array.isArray(a.artists) && a.artists.length > 0
        ? (a.artists[0]?.name ?? "")
        : "";
    const firstImage =
      Array.isArray(a.images) && a.images.length > 0
        ? (a.images[0]?.url ?? "")
        : "";
    items.push({
      uri,
      title: a.name ?? "",
      subtitle: firstArtist || "Album",
      image_url: firstImage,
      kind: "album",
    });
  }
  return items;
}

/**
 * Returns true when the albums array is absent or empty.
 */
export function isEmptyRecentlyPlayedResult(result) {
  if (!result || typeof result !== "object") return true;
  return !result.albums || result.albums.length === 0;
}
