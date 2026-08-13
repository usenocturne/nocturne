import { describe, expect, it } from "bun:test";
import {
  imageDataStringToSource,
  normalizeInlineImageSource,
} from "./imageSource";

describe("image source normalization", () => {
  it("turns raw JPEG artwork into a data URL instead of an HTTP path", () => {
    const rawArtwork = "/9j/4AAQSkZJRgABAQEAYABgAAD/2Q==";

    expect(normalizeInlineImageSource(rawArtwork)).toBe(
      `data:image/jpeg;base64,${rawArtwork}`,
    );
    expect(imageDataStringToSource(rawArtwork)).toBe(
      `data:image/jpeg;base64,${rawArtwork}`,
    );
  });

  it("recognizes other common pushed artwork formats", () => {
    expect(normalizeInlineImageSource("iVBORw0KGgoAAAANSUhEUg==")).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    );
    expect(normalizeInlineImageSource("R0lGODlhAQABAIAAAA==")).toBe(
      "data:image/gif;base64,R0lGODlhAQABAIAAAA==",
    );
    expect(normalizeInlineImageSource("UklGRiIAAABXRUJQVlA=")).toBe(
      "data:image/webp;base64,UklGRiIAAABXRUJQVlA=",
    );
  });

  it("leaves app assets and remote URLs unchanged", () => {
    expect(imageDataStringToSource("/images/not-playing.webp")).toBe(
      "/images/not-playing.webp",
    );
    expect(imageDataStringToSource("https://i.scdn.co/image/cover")).toBe(
      "https://i.scdn.co/image/cover",
    );
  });
});
