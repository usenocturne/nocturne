import type { SpotifyImage } from "../../../types";
const normalizeUrl = (url: string | null | undefined) => {
  if (!url) return url;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("/")
  ) {
    return url;
  }
  return `https://${url}`;
};

export const getOptimalImageUrl = (
  images: SpotifyImage[] | null | undefined,
  displaySize: number,
) => {
  if (!images || !Array.isArray(images) || images.length === 0) {
    return null;
  }

  const needsLargeImage = displaySize > 100;

  if (needsLargeImage) {
    const target = images.find(
      (img) =>
        typeof img.width === "number" && img.width >= 240 && img.width <= 320,
    );
    return normalizeUrl(
      target?.url || images[images.length - 1]?.url || images[0]?.url,
    );
  } else {
    return normalizeUrl(images[images.length - 1]?.url || images[0]?.url);
  }
};

export const getShelfImageUrl = (images: SpotifyImage[] | null | undefined) =>
  getOptimalImageUrl(images, 248);

export const getNpvImageUrl = (images: SpotifyImage[] | null | undefined) =>
  getOptimalImageUrl(images, 248);

export const getThumbnailImageUrl = (
  images: SpotifyImage[] | null | undefined,
) => getOptimalImageUrl(images, 96);

export const getPresetImageUrl = (images: SpotifyImage[] | null | undefined) =>
  getOptimalImageUrl(images, 168);

export const getGradientImageUrl = (
  images: SpotifyImage[] | null | undefined,
) => getOptimalImageUrl(images, 150);
