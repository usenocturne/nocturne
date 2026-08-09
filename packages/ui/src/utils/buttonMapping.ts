import type { ButtonMappingValues } from "./presetStorage";

type ButtonMappingInput = {
  contentId?: unknown;
  contentType?: unknown;
  contentImage?: unknown;
  contentName?: unknown;
  trackUris?: unknown;
};

const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

const asNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const getTrackUris = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (uri): uri is string =>
          typeof uri === "string" && uri.startsWith("spotify:track:"),
      )
    : [];

export const buildButtonMapping = ({
  contentId,
  contentType,
  contentImage,
  contentName,
  trackUris,
}: ButtonMappingInput): ButtonMappingValues | null => {
  const type = asNonEmptyString(contentType);
  const id =
    type === "liked-songs" ? "liked-songs" : asNonEmptyString(contentId);

  if (!id || !type) return null;

  let image = asNonEmptyString(contentImage);
  if (id === DJ_PLAYLIST_ID) {
    image = "/images/radio-cover/dj.webp";
  } else if (type === "liked-songs") {
    image = "/images/liked-songs.webp";
  }

  const mapping: ButtonMappingValues = {
    id,
    type,
    image,
    name:
      type === "liked-songs" ? "Liked Songs" : asNonEmptyString(contentName),
  };
  const normalizedTrackUris = getTrackUris(trackUris);

  if (
    (type === "mix" || type === "liked-songs") &&
    normalizedTrackUris.length > 0
  ) {
    mapping.tracks = JSON.stringify(normalizedTrackUris);
  }

  return mapping;
};
