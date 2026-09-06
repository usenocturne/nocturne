import { describe, expect, it } from "bun:test";
import {
  getRemoteArtworkLoadAction,
  shouldReuseLoadedArtwork,
} from "./SpotifyImage";

describe("SpotifyImage remote artwork transitions", () => {
  const fallbackSrc = "/images/not-playing.webp";

  it("loads canonical artwork during repeated phone update windows", () => {
    const action = getRemoteArtworkLoadAction({
      disableSpotifyFetch: false,
      skipFetchWhenNowPlaying: true,
      isReceivingNowPlayingUpdates: true,
      currentSrc: fallbackSrc,
      fallbackSrc,
      isCurrentArtworkLoaded: false,
    });

    expect(action).toBe("load");
  });

  it("clears stale artwork once, then loads the canonical image", () => {
    const transition = {
      disableSpotifyFetch: false,
      skipFetchWhenNowPlaying: true,
      isReceivingNowPlayingUpdates: true,
      fallbackSrc,
      isCurrentArtworkLoaded: false,
    };

    expect(
      getRemoteArtworkLoadAction({
        ...transition,
        currentSrc: "blob:local-artwork",
      }),
    ).toBe("clear-stale");
    expect(
      getRemoteArtworkLoadAction({
        ...transition,
        currentSrc: fallbackSrc,
        isCurrentArtworkLoaded: false,
      }),
    ).toBe("load");
  });

  it("still disables Spotify fetching for phone and pending media", () => {
    expect(
      getRemoteArtworkLoadAction({
        disableSpotifyFetch: true,
        skipFetchWhenNowPlaying: true,
        isReceivingNowPlayingUpdates: false,
        currentSrc: fallbackSrc,
        fallbackSrc,
        isCurrentArtworkLoaded: false,
      }),
    ).toBe("disable");
  });

  it("does not clear canonical artwork after it finishes loading", () => {
    expect(
      getRemoteArtworkLoadAction({
        disableSpotifyFetch: false,
        skipFetchWhenNowPlaying: true,
        isReceivingNowPlayingUpdates: true,
        currentSrc: "data:image/jpeg;base64,canonical",
        fallbackSrc,
        isCurrentArtworkLoaded: true,
      }),
    ).toBe("load");
  });

  it("does not restart a request after the requested artwork is displayed", () => {
    expect(
      shouldReuseLoadedArtwork({
        imageUrl: "https://i.scdn.co/image/cover",
        loadedUrl: "https://i.scdn.co/image/cover",
        currentSrc: "data:image/jpeg;base64,cover",
        fallbackSrc,
      }),
    ).toBe(true);
    expect(
      shouldReuseLoadedArtwork({
        imageUrl: "https://i.scdn.co/image/cover",
        loadedUrl: "https://i.scdn.co/image/cover",
        currentSrc: fallbackSrc,
        fallbackSrc,
      }),
    ).toBe(false);
  });
});
