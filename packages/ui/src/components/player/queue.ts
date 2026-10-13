export const QUEUE_SHEET_EXIT_MS = 260;

export interface QueueEntry {
  key: string;
  uid: string | null;
  uri: string;
  name: string;
  subtitle: string;
  imageUrl: string | null;
  explicit: boolean;
}

interface RawQueueItem {
  uid?: unknown;
  uri?: unknown;
  id?: unknown;
  name?: unknown;
  artist_name?: unknown;
  artists?: unknown;
  album_name?: unknown;
  image_url?: unknown;
  album?: { name?: unknown; images?: unknown } | null;
  explicit?: unknown;
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const joinArtistNames = (artists: unknown): string | null => {
  if (!Array.isArray(artists)) return null;
  const names = artists
    .map((artist) =>
      artist && typeof artist === "object"
        ? nonEmptyString((artist as { name?: unknown }).name)
        : null,
    )
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(", ") : null;
};

const SPOTIFY_IMAGE_CDN = "https://i.scdn.co/image/";

export const normalizeQueueImageUrl = (url: string): string => {
  const stripped = url.replace(/^https?:\/\//, "");
  if (stripped.startsWith("spotify:image:")) {
    return SPOTIFY_IMAGE_CDN + stripped.slice("spotify:image:".length);
  }
  if (stripped.startsWith("i.scdn.co/")) return `https://${stripped}`;
  return url;
};

const firstImageUrl = (images: unknown): string | null => {
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    const url =
      image && typeof image === "object"
        ? nonEmptyString((image as { url?: unknown }).url)
        : null;
    if (url) return normalizeQueueImageUrl(url);
  }
  return null;
};

export const normalizeQueueResponse = (response: unknown): QueueEntry[] => {
  const queue =
    response && typeof response === "object"
      ? (response as { queue?: unknown }).queue
      : null;
  if (!Array.isArray(queue)) return [];

  return queue.flatMap((value: unknown, index): QueueEntry[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as RawQueueItem;
    const uri = nonEmptyString(item.uri);
    if (!uri) return [];
    const uid = nonEmptyString(item.uid);
    const imageUrl = nonEmptyString(item.image_url);

    return [
      {
        key: uid ?? `${uri}-${index}`,
        uid,
        uri,
        name: nonEmptyString(item.name) ?? "Unknown Track",
        subtitle:
          nonEmptyString(item.artist_name) ??
          joinArtistNames(item.artists) ??
          nonEmptyString(item.album_name) ??
          nonEmptyString(item.album?.name) ??
          "",
        imageUrl: imageUrl
          ? normalizeQueueImageUrl(imageUrl)
          : firstImageUrl(item.album?.images),
        explicit: item.explicit === true,
      },
    ];
  });
};

export const getQueueSkipParams = (
  entry: Pick<QueueEntry, "uid">,
  contextUri: string | null | undefined,
): { uid: string; context_uri?: string } | null => {
  if (!entry.uid) return null;
  return contextUri
    ? { uid: entry.uid, context_uri: contextUri }
    : { uid: entry.uid };
};

export interface NowPlayingSwipeActions {
  up: "showLyrics" | "hideLyrics" | null;
  down: "openQueue" | null;
}

export const getNowPlayingSwipeActions = ({
  showLyrics,
  canShowLyrics,
  canShowQueue,
  lyricsGestureEnabled,
  queueGestureEnabled,
}: {
  showLyrics: boolean;
  canShowLyrics: boolean;
  canShowQueue: boolean;
  lyricsGestureEnabled: boolean;
  queueGestureEnabled: boolean;
}): NowPlayingSwipeActions => ({
  up:
    canShowLyrics && lyricsGestureEnabled
      ? showLyrics
        ? "hideLyrics"
        : "showLyrics"
      : null,
  down: canShowQueue && queueGestureEnabled ? "openQueue" : null,
});

export const NOW_PLAYING_ROW_INDEX = 0;

export const stepQueueSelection = (
  current: number,
  direction: 1 | -1,
  rowCount: number,
): number => {
  if (rowCount <= 0) return -1;
  if (current < 0) {
    return direction > 0 ? Math.min(1, rowCount - 1) : NOW_PLAYING_ROW_INDEX;
  }
  return Math.min(
    rowCount - 1,
    Math.max(NOW_PLAYING_ROW_INDEX, current + direction),
  );
};

export const QUEUE_DRAG_DISMISS_FRACTION = 0.25;
export const QUEUE_DRAG_FLING_VELOCITY = 0.5;

export const getQueueDragOffset = (deltaY: number) => Math.min(0, deltaY);

export const shouldDismissQueueDrag = (
  offset: number,
  velocity: number,
  sheetHeight: number,
) =>
  -offset >= sheetHeight * QUEUE_DRAG_DISMISS_FRACTION ||
  (velocity <= -QUEUE_DRAG_FLING_VELOCITY && offset < 0);

export const createCubicBezierEasing = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => {
  const sample = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;

  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    let t = progress;
    for (let i = 0; i < 8; i++) {
      const error = sample(t, x1, x2) - progress;
      if (Math.abs(error) < 1e-5) break;
      const derivative = slope(t, x1, x2);
      if (Math.abs(derivative) < 1e-6) break;
      t = Math.min(1, Math.max(0, t - error / derivative));
    }
    return sample(t, y1, y2);
  };
};

export const getQueueScrollTarget = (
  rowOffsetTop: number,
  scrollHeight: number,
  clientHeight: number,
) => Math.max(0, Math.min(rowOffsetTop, scrollHeight - clientHeight));
