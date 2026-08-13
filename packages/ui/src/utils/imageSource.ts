const INLINE_IMAGE_SIGNATURES = [
  ["/9j/", "image/jpeg"],
  ["iVBORw0KGgo", "image/png"],
  ["R0lGOD", "image/gif"],
  ["UklGR", "image/webp"],
] as const;

export const normalizeInlineImageSource = (
  source: string | null | undefined,
): string | null | undefined => {
  if (!source) return source;

  const trimmedSource = source.trim();
  if (trimmedSource.startsWith("data:") || trimmedSource.startsWith("blob:")) {
    return trimmedSource;
  }

  const signature = INLINE_IMAGE_SIGNATURES.find(([prefix]) =>
    trimmedSource.startsWith(prefix),
  );
  if (!signature) return source;

  return `data:${signature[1]};base64,${trimmedSource}`;
};

export const imageDataStringToSource = (imageData: string): string => {
  const normalizedSource = normalizeInlineImageSource(imageData);
  if (
    normalizedSource !== imageData ||
    imageData.startsWith("data:") ||
    imageData.startsWith("blob:") ||
    imageData.startsWith("http://") ||
    imageData.startsWith("https://") ||
    imageData.startsWith("/images/")
  ) {
    return normalizedSource || imageData;
  }

  return `data:image/jpeg;base64,${imageData}`;
};
