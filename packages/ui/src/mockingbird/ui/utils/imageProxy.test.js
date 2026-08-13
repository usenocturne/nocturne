import { describe, expect, it } from "bun:test";
import { getCachedImageUrl, resolveImageUrl } from "./imageProxy";

describe("Mockingbird local file artwork", () => {
  it("renders raw JPEG metadata as a data URL", async () => {
    const rawArtwork = "/9j/4AAQSkZJRgABAQEAYABgAAD/2Q==";

    expect(await resolveImageUrl(rawArtwork)).toBe(
      `data:image/jpeg;base64,${rawArtwork}`,
    );
    expect(getCachedImageUrl(rawArtwork)).toBe(
      `data:image/jpeg;base64,${rawArtwork}`,
    );
  });

  const localFileImage = "spotify:localfileimage:%2Fvar%2Fmobile%2Ftrack.mp3";

  it("uses the not-playing image without proxying Spotify's local URI", async () => {
    await expect(resolveImageUrl(localFileImage)).resolves.toBe(
      "/images/not-playing.webp",
    );
    await expect(resolveImageUrl(`https://${localFileImage}`)).resolves.toBe(
      "/images/not-playing.webp",
    );
    expect(getCachedImageUrl(localFileImage)).toBe("/images/not-playing.webp");
  });
});
