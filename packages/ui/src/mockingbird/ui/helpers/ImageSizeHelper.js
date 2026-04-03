/**
 * Helper functions for selecting appropriate image sizes from Spotify API image arrays.
 * Based on the original superbird implementation which used two scales:
 * - SMALL (96px) for thumbnails
 * - BIG (248px) for larger displays
 */

/**
 * Gets the optimal image URL for a given display size
 * @param {Array} images - Array of image objects from Spotify API (sorted largest to smallest)
 * @param {number} displaySize - The size the image will be displayed at in pixels
 * @returns {string|null} - The optimal image URL or null if no images available
 */
const normalizeUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('/')) {
    return url;
  }
  return `https://${url}`;
};

export const getOptimalImageUrl = (images, displaySize) => {
  if (!images || !Array.isArray(images) || images.length === 0) {
    return null;
  }

  // Original superbird logic: size > 100 ? BIG (248px) : SMALL (96px)
  const needsLargeImage = displaySize > 100;

  if (needsLargeImage) {
    // For 248px displays, find image closest to 248px
    const target = images.find(img => img.width >= 240 && img.width <= 320);
    return normalizeUrl(target?.url ||
      images[images.length - 1]?.url ||
      images[0]?.url);
  } else {
    // For small displays (thumbnails), use the smallest available image
    return normalizeUrl(images[images.length - 1]?.url || images[0]?.url);
  }
};

/**
 * Specific helpers for common use cases
 */

// For shelf items (240px display) - use 248px images to match original superbird
export const getShelfImageUrl = (images) => getOptimalImageUrl(images, 248);

// For NPV artwork (248px display) - use 248px images
export const getNpvImageUrl = (images) => getOptimalImageUrl(images, 248);

// For queue/tracklist thumbnails (96px display) - use small images
export const getThumbnailImageUrl = (images) => getOptimalImageUrl(images, 96);

// For preset buttons (168px display) - use medium images
export const getPresetImageUrl = (images) => getOptimalImageUrl(images, 168);

// For gradient/background color extraction - can use smaller images
export const getGradientImageUrl = (images) => getOptimalImageUrl(images, 150);