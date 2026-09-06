import type { MouseEvent } from "react";
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyPlaylist,
  PlayerControls,
} from "../../../types";
import { getErrorMessage } from "../../../utils/helpers";
import type PlayerStore from "./PlayerStore";
import type QueueStore from "./QueueStore";
import {
  pageItems,
  pageTotal,
  pageNext,
  type PageResult,
  type RawTrack,
  type RawEpisode,
  type TracklistItem,
  type TracklistContext,
} from "./TracklistModels";
import type { RootStore } from "./RootStore";
import type { InterappActions, MiddlewareActions } from "./StoreContracts";
import { makeAutoObservable, runInAction, action } from "mobx";
import { getThumbnailImageUrl } from "../helpers/ImageSizeHelper";
import { sendNocturneWsRequest } from "../../../hooks/useNocturned";
import { normalizeSpotifyContext } from "../../../utils/spotifyContext";

/** @typedef {import("@schema/spotify").SpotifyAlbumGetRequest} SpotifyAlbumGetRequest */
/** @typedef {import("@schema/spotify").SpotifyAlbumTracksRequest} SpotifyAlbumTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyArtistGetRequest} SpotifyArtistGetRequest */
/** @typedef {import("@schema/spotify").SpotifyArtistTopTracksRequest} SpotifyArtistTopTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyMeTracksRequest} SpotifyMeTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyPlaylistGetRequest} SpotifyPlaylistGetRequest */
/** @typedef {import("@schema/spotify").SpotifyPlaylistTracksRequest} SpotifyPlaylistTracksRequest */
/** @typedef {import("@schema/spotify").SpotifyShowEpisodesRequest} SpotifyShowEpisodesRequest */

type AbortFlag = { abort: boolean };

const INITIAL_FETCH_SIZE = 30;
const BACKGROUND_FETCH_SIZE = 50;
const BACKGROUND_FETCH_DELAY = 300;

export const isSupportedUriType = (uri: string | null | undefined) => {
  if (!uri) return false;

  return !(
    uri.includes("track:") ||
    uri.includes("episode:") ||
    uri.includes("search:") ||
    uri.includes("playlist-recommended:")
  );
};

class TracklistUiState {
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  rootStore: RootStore;
  declare playTrack: PlayerControls["playTrack"];
  declare addToQueue: ((uri: string) => void) | undefined;
  declare likeAlbumOrPlaylist:
    | ((uri: string, liked: boolean) => void)
    | undefined;
  contextItem: TracklistContext = { uri: "", title: "" };
  selectedItem: TracklistItem | undefined = undefined;
  animateSliding = false;
  showAddToQueueSuccess = false;
  confirmationTimeoutId: ReturnType<typeof setTimeout> | undefined = undefined;
  tracksData: TracklistItem[] = [];
  totalTracksInContext = 0;
  _isLoading = false;
  _loadingMore = false;
  _bgLoadAbort: AbortFlag | null = null;

  constructor(rootStore: RootStore) {
    makeAutoObservable(this, {
      rootStore: false,
      animateSliding: false,
      confirmationTimeoutId: false,
      _bgLoadAbort: false,
    });
    this.rootStore = rootStore;

    if (rootStore.playerStore && rootStore.playerStore.onContextChange) {
      rootStore.playerStore.onContextChange((uri) => {
        if (uri) {
          this.onPlayerStoreUriUpdated(uri);
        }
      });
    }

    if (rootStore.playerStore && rootStore.playerStore.onTrackChange) {
      rootStore.playerStore.onTrackChange(() => this.handleTrackChange());
    }
  }

  reset() {
    if (this._bgLoadAbort) {
      this._bgLoadAbort.abort = true;
      this._bgLoadAbort = null;
    }
    this.contextItem = { uri: "", title: "" };
    this.selectedItem = undefined;
    this.animateSliding = false;
    this.tracksData = [];
    this.totalTracksInContext = 0;
    this._isLoading = false;
    this._loadingMore = false;
  }

  initializeTracklist(contextItem: TracklistContext) {
    const normalizedUri =
      normalizeSpotifyContext(contextItem.uri)?.uri || contextItem.uri;
    const normalizedContextItem =
      normalizedUri === contextItem.uri
        ? contextItem
        : { ...contextItem, uri: normalizedUri };

    if (normalizedContextItem.uri === this.contextUri) {
      this.updateSelectedItem(this.currentlyPlayingTrackOrFirst, false);
      return;
    }

    this.reset();
    this.animateSliding = false;
    this.contextItem = normalizedContextItem;

    if (this.initiallySelectedItem) {
      this.updateSelectedItem(this.initiallySelectedItem, false);
      return;
    }

    if (this.rootStore.savedStore && this.rootStore.savedStore.loadSavedState) {
      this.rootStore.savedStore.loadSavedState(normalizedContextItem.uri);
    }
    this.loadInitialItems(normalizedContextItem.uri);
  }

  get shouldShowLatestPlayedEpisode() {
    return (
      this.isPodcastContext &&
      this.rootStore.podcastStore &&
      this.rootStore.podcastStore.shouldShowLatestPlayedEpisode &&
      this.rootStore.podcastStore.shouldShowLatestPlayedEpisode(this.contextUri)
    );
  }

  get latestPlayedEpisode() {
    if (!this.isPodcastContext || !this.rootStore.podcastStore)
      return undefined;

    const latestPlayedUri =
      this.rootStore.podcastStore.getLatestPlayedUri &&
      this.rootStore.podcastStore.getLatestPlayedUri(this.contextUri);

    return this.tracksList.find(
      (trackItem) => trackItem.uri === latestPlayedUri,
    );
  }

  get initiallySelectedItem() {
    return this.tracksList[0];
  }

  async loadInitialItems(uri: string) {
    if (this.isStationUri(uri)) {
      return;
    }

    this._isLoading = true;

    try {
      if (this.isCollectionUri(uri)) {
        await this.loadLikedSongs();
      } else if (this.isShowUri(uri)) {
        await this.loadPodcastEpisodes(uri);
      } else if (this.isAlbumUri(uri)) {
        await this.loadAlbumTracks(uri);
      } else if (this.isPlaylistUri(uri)) {
        await this.loadPlaylistTracks(uri);
      } else if (this.isArtistUri(uri)) {
        await this.loadArtistTopTracks(uri);
      }
    } catch (error) {
      console.error("Error loading tracklist items:", error);
    }

    runInAction(() => {
      this._isLoading = false;
      this.updateSelectedItem(this.initiallySelectedItem, false);
    });
  }

  _parseAlbumItems(items: RawTrack[]): TracklistItem[] {
    return (Array.isArray(items) ? items : []).map((track) => ({
      uri: track.uri ?? "",
      title: track.name ?? "",
      subtitle: track.artists?.map((artist) => artist.name).join(", ") || "",
      image_id: null,
      metadata: {
        duration_ms: track.duration_ms,
        explicit: track.explicit,
        track_number: track.track_number,
        disc_number: track.disc_number,
      },
      available_offline: false,
    }));
  }

  async loadAlbumTracks(albumUri: string) {
    const albumId = albumUri.replace("spotify:album:", "");

    if (this._bgLoadAbort) {
      this._bgLoadAbort.abort = true;
    }
    const abortToken = { abort: false };
    this._bgLoadAbort = abortToken;

    try {
      /** @type {SpotifyAlbumTracksRequest} */
      const params = {
        contentId: albumId,
        limit: INITIAL_FETCH_SIZE,
        offset: 0,
      };
      const data = await sendNocturneWsRequest<PageResult<RawTrack>>(
        "spotify.album.tracks",
        params,
        {
          timeoutMs: 8000,
        },
      );

      if (abortToken.abort) return;

      const items = pageItems(data);
      const total = pageTotal(data) || items.length;
      const parsed = this._parseAlbumItems(items);

      runInAction(() => {
        this.tracksData = parsed;
        this.totalTracksInContext = total;
      });

      if (total > parsed.length && !abortToken.abort) {
        this._backgroundLoadAlbum(albumId, parsed.length, total, abortToken);
      }
    } catch (error) {
      console.error("Error loading album tracks:", error);
    }
  }

  async _backgroundLoadAlbum(
    albumId: string,
    loadedCount: number,
    total: number,
    abortToken: AbortFlag,
  ) {
    runInAction(() => {
      this._loadingMore = true;
    });
    let offset = loadedCount;

    while (offset < total && !abortToken.abort) {
      await new Promise((r) => setTimeout(r, BACKGROUND_FETCH_DELAY));
      if (abortToken.abort) break;

      try {
        /** @type {SpotifyAlbumTracksRequest} */
        const params = {
          contentId: albumId,
          limit: BACKGROUND_FETCH_SIZE,
          offset,
        };
        const data = await sendNocturneWsRequest<PageResult<RawTrack>>(
          "spotify.album.tracks",
          params,
          {
            timeoutMs: 10000,
          },
        );

        if (abortToken.abort) break;

        const items = pageItems(data);
        if (items.length === 0) break;

        const parsed = this._parseAlbumItems(items);
        const existingUris = new Set(this.tracksData.map((t) => t.uri));
        const newTracks = parsed.filter((t) => !existingUris.has(t.uri));

        runInAction(() => {
          this.tracksData = [...this.tracksData, ...newTracks];
        });

        offset += items.length;
        if (!pageNext(data) && items.length < BACKGROUND_FETCH_SIZE) break;
      } catch (error) {
        console.warn(
          "Background album load error, stopping:",
          getErrorMessage(error),
        );
        break;
      }
    }

    runInAction(() => {
      this._loadingMore = false;
    });
  }

  _parseLikedSongItems(items: RawTrack[]): TracklistItem[] {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item.track || item.uri)
      .map((rawItem) => {
        const track = rawItem.track || rawItem;
        const trackImage =
          track.image_url ||
          track.album?.image_url ||
          getThumbnailImageUrl(track.album?.images);
        return {
          uri: track.uri ?? "",
          title: track.name ?? "",
          subtitle:
            track.artists?.map((artist) => artist.name).join(", ") || "",
          image_id: trackImage || "",
          metadata: {
            duration_ms: track.duration_ms,
            explicit: track.explicit,
            album: track.album?.name,
          },
          available_offline: false,
        };
      });
  }

  async loadLikedSongs() {
    if (this._bgLoadAbort) {
      this._bgLoadAbort.abort = true;
    }
    const abortToken = { abort: false };
    this._bgLoadAbort = abortToken;

    try {
      /** @type {SpotifyMeTracksRequest} */
      const params = {
        limit: INITIAL_FETCH_SIZE,
        offset: 0,
      };
      const data = await sendNocturneWsRequest<PageResult<RawTrack>>(
        "spotify.me.tracks",
        params,
        {
          timeoutMs: 10000,
        },
      );

      if (abortToken.abort) return;

      const items = pageItems(data);
      const total = pageTotal(data) || 0;
      const parsed = this._parseLikedSongItems(items);

      runInAction(() => {
        this.tracksData = parsed;
        this.totalTracksInContext = total;
      });

      if (total > parsed.length && !abortToken.abort) {
        this._backgroundLoadLikedSongs(parsed.length, total, abortToken);
      }
    } catch (error) {
      console.error("Error loading liked songs:", error);
    }
  }

  async _backgroundLoadLikedSongs(
    loadedCount: number,
    total: number,
    abortToken: AbortFlag,
  ) {
    runInAction(() => {
      this._loadingMore = true;
    });
    let offset = loadedCount;

    while (offset < total && !abortToken.abort) {
      await new Promise((r) => setTimeout(r, BACKGROUND_FETCH_DELAY));
      if (abortToken.abort) break;

      try {
        /** @type {SpotifyMeTracksRequest} */
        const params = {
          limit: BACKGROUND_FETCH_SIZE,
          offset,
        };
        const data = await sendNocturneWsRequest<PageResult<RawTrack>>(
          "spotify.me.tracks",
          params,
          {
            timeoutMs: 10000,
          },
        );

        if (abortToken.abort) break;

        const items = pageItems(data);
        if (items.length === 0) break;

        const parsed = this._parseLikedSongItems(items);
        const existingUris = new Set(this.tracksData.map((t) => t.uri));
        const newTracks = parsed.filter((t) => !existingUris.has(t.uri));

        runInAction(() => {
          this.tracksData = [...this.tracksData, ...newTracks];
        });

        offset += items.length;
        if (!pageNext(data) && items.length < BACKGROUND_FETCH_SIZE) break;
      } catch (error) {
        console.warn(
          "Background liked songs load error, stopping:",
          getErrorMessage(error),
        );
        break;
      }
    }

    runInAction(() => {
      this._loadingMore = false;
    });
  }

  _parsePlaylistItems(
    items: RawTrack[],
    playlistImage: string | null,
  ): TracklistItem[] {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item.track || item.uri)
      .map((rawItem) => {
        const track = rawItem.track || rawItem;
        const trackImage =
          track.image_url ||
          track.album?.image_url ||
          getThumbnailImageUrl(track.album?.images);
        return {
          uri: track.uri ?? "",
          title: track.name ?? "",
          subtitle:
            track.artists?.map((artist) => artist.name).join(", ") || "",
          image_id: trackImage || playlistImage,
          metadata: {
            duration_ms: track.duration_ms,
            explicit: track.explicit,
            album: track.album?.name,
          },
          available_offline: false,
        };
      });
  }

  async loadPlaylistTracks(playlistUri: string) {
    const playlistId = playlistUri.replace("spotify:playlist:", "");

    if (this._bgLoadAbort) {
      this._bgLoadAbort.abort = true;
    }
    const abortToken = { abort: false };
    this._bgLoadAbort = abortToken;

    try {
      const [data, playlistInfo] = await Promise.allSettled([
        sendNocturneWsRequest<PageResult<RawTrack>>(
          "spotify.playlist.tracks",
          /** @type {SpotifyPlaylistTracksRequest} */ {
            contentId: playlistId,
            limit: INITIAL_FETCH_SIZE,
            offset: 0,
            mockingbird: true,
          },
          { timeoutMs: 8000 },
        ),
        sendNocturneWsRequest<SpotifyPlaylist & { image_url?: string }>(
          "spotify.playlist.get",
          /** @type {SpotifyPlaylistGetRequest} */ { contentId: playlistId },
          { timeoutMs: 5000 },
        ),
      ]);

      if (abortToken.abort) return;

      const result = data.status === "fulfilled" ? data.value : null;
      const info =
        playlistInfo.status === "fulfilled" ? playlistInfo.value : null;
      const items = pageItems(result);
      const total = pageTotal(result) || 0;
      const playlistImage =
        info?.image_url || getThumbnailImageUrl(info?.images) || null;

      const parsed = this._parsePlaylistItems(items, playlistImage);

      runInAction(() => {
        this.tracksData = parsed;
        this.totalTracksInContext = total;
      });

      if (total > parsed.length && !abortToken.abort) {
        this._backgroundLoadPlaylist(
          playlistId,
          parsed.length,
          total,
          playlistImage,
          abortToken,
        );
      }
    } catch (error) {
      console.error("Error loading playlist tracks:", error);
    }
  }

  async _backgroundLoadPlaylist(
    playlistId: string,
    loadedCount: number,
    total: number,
    playlistImage: string | null,
    abortToken: AbortFlag,
  ) {
    runInAction(() => {
      this._loadingMore = true;
    });
    let offset = loadedCount;

    while (offset < total && !abortToken.abort) {
      await new Promise((r) => setTimeout(r, BACKGROUND_FETCH_DELAY));
      if (abortToken.abort) break;

      try {
        /** @type {SpotifyPlaylistTracksRequest} */
        const params = {
          contentId: playlistId,
          limit: BACKGROUND_FETCH_SIZE,
          offset,
          mockingbird: true,
        };
        const data = await sendNocturneWsRequest<PageResult<RawTrack>>(
          "spotify.playlist.tracks",
          params,
          {
            timeoutMs: 10000,
          },
        );

        if (abortToken.abort) break;

        const items = pageItems(data);
        if (items.length === 0) break;

        const parsed = this._parsePlaylistItems(items, playlistImage);
        const existingUris = new Set(this.tracksData.map((t) => t.uri));
        const newTracks = parsed.filter((t) => !existingUris.has(t.uri));

        runInAction(() => {
          this.tracksData = [...this.tracksData, ...newTracks];
        });

        offset += items.length;
        if (!pageNext(data) && items.length < BACKGROUND_FETCH_SIZE) break;
      } catch (error) {
        console.warn(
          "Background playlist load error, stopping:",
          getErrorMessage(error),
        );
        break;
      }
    }

    runInAction(() => {
      this._loadingMore = false;
    });
  }

  async loadArtistTopTracks(artistUri: string) {
    const artistId = artistUri.replace("spotify:artist:", "");

    try {
      const [tracksResult, artistResult] = await Promise.allSettled([
        sendNocturneWsRequest<{ tracks?: RawTrack[] } | RawTrack[]>(
          "spotify.artist.top_tracks",
          /** @type {SpotifyArtistTopTracksRequest} */ {
            contentId: artistId,
            mockingbird: true,
          },
          { timeoutMs: 8000 },
        ),
        sendNocturneWsRequest<SpotifyArtist & { image_url?: string }>(
          "spotify.artist.get",
          /** @type {SpotifyArtistGetRequest} */ { contentId: artistId },
          { timeoutMs: 8000 },
        ),
      ]);

      const data =
        tracksResult.status === "fulfilled" ? tracksResult.value : null;
      const artistInfo =
        artistResult.status === "fulfilled" ? artistResult.value : null;
      const tracks = Array.isArray(data) ? data : data?.tracks || [];
      const artistImage =
        artistInfo?.image_url || getThumbnailImageUrl(artistInfo?.images);
      const tracksArr = Array.isArray(tracks) ? tracks : [];
      const missingAlbumEntries = tracksArr
        .map((track) => track.album)
        .filter(
          (album): album is SpotifyAlbum & { uri: string } =>
            !album?.name?.trim() &&
            typeof album?.uri === "string" &&
            album.uri.startsWith("spotify:album:"),
        )
        .map((album): [string, string] => [
          album.uri,
          album.uri.replace("spotify:album:", ""),
        ]);
      const uniqueMissingAlbums = [...new Map(missingAlbumEntries).entries()];
      const albumResults = await Promise.allSettled(
        uniqueMissingAlbums.map(async ([uri, contentId]) => {
          const album = await sendNocturneWsRequest<
            SpotifyAlbum & { image_url?: string }
          >(
            "spotify.album.get",
            /** @type {SpotifyAlbumGetRequest} */ { contentId },
            { timeoutMs: 5000 },
          );
          return [uri, album] as const;
        }),
      );
      const albumFallbacks = new Map<
        string,
        SpotifyAlbum & { image_url?: string }
      >();

      albumResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          albumFallbacks.set(result.value[0], result.value[1]);
          return;
        }

        console.warn(
          `Failed to load album metadata for ${uniqueMissingAlbums[index][0]}:`,
          result.reason,
        );
      });

      runInAction(() => {
        this.tracksData = tracksArr.map((track) => {
          const fallbackAlbum = albumFallbacks.get(track.album?.uri ?? "");
          const albumImage =
            track.album?.image_url ||
            getThumbnailImageUrl(track.album?.images) ||
            fallbackAlbum?.image_url ||
            getThumbnailImageUrl(fallbackAlbum?.images);
          const albumName =
            track.album?.name?.trim() || fallbackAlbum?.name || "";
          return {
            uri: track.uri ?? "",
            title: track.name ?? "",
            subtitle: albumName,
            image_id: albumImage || artistImage,
            metadata: {
              duration_ms: track.duration_ms,
              explicit: track.explicit,
              album: albumName,
            },
            available_offline: false,
          };
        });
      });
    } catch (error) {
      console.error("Error loading artist top tracks:", error);
    }
  }

  _parseEpisodeItems(items: RawEpisode[]): TracklistItem[] {
    return (Array.isArray(items) ? items : []).map((episode) => ({
      uri: episode.uri ?? "",
      title: episode.name ?? "",
      subtitle: episode.description
        ? episode.description.substring(0, 100) + "..."
        : episode.release_date || "",
      image_id: getThumbnailImageUrl(episode.images),
      metadata: {
        duration_ms: episode.duration_ms,
        explicit: episode.explicit,
        release_date: episode.release_date,
        description: episode.description,
      },
      available_offline: false,
    }));
  }

  async loadPodcastEpisodes(showUri: string) {
    const showId = showUri.replace("spotify:show:", "");

    if (this._bgLoadAbort) {
      this._bgLoadAbort.abort = true;
    }
    const abortToken = { abort: false };
    this._bgLoadAbort = abortToken;

    try {
      /** @type {SpotifyShowEpisodesRequest} */
      const params = {
        contentId: showId,
        limit: INITIAL_FETCH_SIZE,
        offset: 0,
      };
      const data = await sendNocturneWsRequest<PageResult<RawEpisode>>(
        "spotify.show.episodes",
        params,
        {
          timeoutMs: 8000,
        },
      );

      if (abortToken.abort) return;

      const items = pageItems(data);
      const total = pageTotal(data) || 0;
      const parsed = this._parseEpisodeItems(items);

      runInAction(() => {
        this.tracksData = parsed;
        this.totalTracksInContext = total;
      });

      if (total > parsed.length && !abortToken.abort) {
        this._backgroundLoadEpisodes(showId, parsed.length, total, abortToken);
      }
    } catch (error) {
      console.error("Error loading podcast episodes:", error);
    }
  }

  async _backgroundLoadEpisodes(
    showId: string,
    loadedCount: number,
    total: number,
    abortToken: AbortFlag,
  ) {
    runInAction(() => {
      this._loadingMore = true;
    });
    let offset = loadedCount;

    while (offset < total && !abortToken.abort) {
      await new Promise((r) => setTimeout(r, BACKGROUND_FETCH_DELAY));
      if (abortToken.abort) break;

      try {
        /** @type {SpotifyShowEpisodesRequest} */
        const params = {
          contentId: showId,
          limit: BACKGROUND_FETCH_SIZE,
          offset,
        };
        const data = await sendNocturneWsRequest<PageResult<RawEpisode>>(
          "spotify.show.episodes",
          params,
          {
            timeoutMs: 10000,
          },
        );

        if (abortToken.abort) break;

        const items = pageItems(data);
        if (items.length === 0) break;

        const parsed = this._parseEpisodeItems(items);
        const existingUris = new Set(this.tracksData.map((t) => t.uri));
        const newEps = parsed.filter((t) => !existingUris.has(t.uri));

        runInAction(() => {
          this.tracksData = [...this.tracksData, ...newEps];
        });

        offset += items.length;
        if (!pageNext(data) && items.length < BACKGROUND_FETCH_SIZE) break;
      } catch (error) {
        console.warn(
          "Background episode load error, stopping:",
          getErrorMessage(error),
        );
        break;
      }
    }

    runInAction(() => {
      this._loadingMore = false;
    });
  }

  get isLoading() {
    if (this.isStationUri(this.contextUri)) {
      return false;
    }
    return this._isLoading;
  }

  get isLoadingMore() {
    return this._loadingMore;
  }

  get isError() {
    if (this.isStationUri(this.contextUri)) {
      return false;
    }
    return this.isPodcastContext
      ? this.rootStore.podcastStore &&
          this.rootStore.podcastStore.isError &&
          this.rootStore.podcastStore.isError(this.contextUri)
      : this.rootStore.childItemStore &&
          this.rootStore.childItemStore.isError &&
          this.rootStore.childItemStore.isError(this.contextUri);
  }

  get isNowPlayingContext() {
    return (
      this.contextUri ===
      (this.rootStore.playerStore && this.rootStore.playerStore.contextUri)
    );
  }

  get totalInContext() {
    if (
      this.isPodcastContext &&
      this.rootStore.podcastStore &&
      this.rootStore.podcastStore.getTotalNumberOfItems
    ) {
      return this.rootStore.podcastStore.getTotalNumberOfItems(this.contextUri);
    }
    if (
      this.rootStore.childItemStore &&
      this.rootStore.childItemStore.getTotal
    ) {
      return this.rootStore.childItemStore.getTotal(this.contextUri);
    }
    return this.totalTracksInContext > 0
      ? this.totalTracksInContext
      : this.tracksList.length;
  }

  get tracksList() {
    if (this.isStationUri(this.contextUri)) {
      return this.rootStore.radioStore &&
        this.rootStore.radioStore.currentRadioTracks
        ? this.rootStore.radioStore.currentRadioTracks
        : [];
    }

    return this.tracksData || [];
  }

  get currentlyPlayingItemSelected() {
    const currentTrack =
      this.rootStore.playerStore && this.rootStore.playerStore.currentTrack;
    if (!currentTrack) return false;

    const currentlyPlayingTrackIndex = this.tracksList.findIndex(
      (item) => item.uri === currentTrack.uri,
    );
    return (
      currentlyPlayingTrackIndex >= 0 &&
      currentlyPlayingTrackIndex === this.selectedItemIndex
    );
  }

  get browsingCurrentContext() {
    return (
      this.contextUri ===
      (this.rootStore.playerStore && this.rootStore.playerStore.contextUri)
    );
  }

  get currentTrackInTracklist() {
    const currentTrack =
      this.rootStore.playerStore && this.rootStore.playerStore.currentTrack;
    if (!currentTrack) return false;

    return !!this.tracksList.find((item) => item.uri === currentTrack.uri);
  }

  isStationAndNotCurrentlyPlaying(contextUri: string) {
    return (
      this.isStationUri(contextUri) &&
      contextUri !==
        (this.rootStore.playerStore && this.rootStore.playerStore.contextUri)
    );
  }

  loadCurrentContext() {
    const { playerStore, shelfStore, queueStore } = this.rootStore;
    if (!playerStore) return;

    let imageId = playerStore.currentImageId;
    const items =
      shelfStore && shelfStore.getItemsByCategory
        ? shelfStore.getItemsByCategory("HOME_IDENTIFIER")
        : [];

    if (items.length > 0) {
      const firstItem = items[0];
      if (
        firstItem.image_id &&
        this.isShowUri(playerStore.contextUri) &&
        firstItem.uri === playerStore.contextUri
      ) {
        imageId = firstItem.image_id;
      }
    }

    this.handleSupportedTracklists({
      uri: playerStore.contextUri,
      title: this.titleBasedOnType(playerStore, queueStore),
      image_id: imageId,
    });
  }

  handleSupportedTracklists(contextItem: TracklistContext) {
    const { overlayController, viewStore } = this.rootStore;
    const contextUri = contextItem.uri;

    if (this.isStationAndNotCurrentlyPlaying(contextItem.uri)) {
      if (overlayController && overlayController.maybeShowNotSupportedType) {
        overlayController.maybeShowNotSupportedType(true);
      }
    } else if (this.isTrackUri(contextUri) || this.isSearchUri(contextUri)) {
      if (viewStore && viewStore.showNpv) {
        viewStore.showNpv();
      }
      return;
    } else {
      this.initializeTracklist(contextItem);
    }
  }

  get contextTitle() {
    return this.contextItem.title;
  }

  get contextUri() {
    return this.contextItem.uri;
  }

  get contextImage() {
    return this.contextItem.image_id;
  }

  get contextType() {
    if (!this.contextUri) return "";
    if (this.contextUri.includes("album:")) return "album";
    if (this.contextUri.includes("show:")) return "show";
    if (this.contextUri.includes("playlist:")) return "playlist";
    return "";
  }

  get isAlbumContext() {
    return this.contextType === "album";
  }

  get isPodcastContext() {
    return this.isShowUri(this.contextUri);
  }

  get isPlayListContext() {
    return this.contextUri.includes("playlist:");
  }

  get isPodcastOrAlbum() {
    return this.contextType === "album" || this.contextType === "show";
  }

  get rightItem() {
    if (
      this.selectedItemIndex === this.tracksList.length - 1 ||
      this.selectedItemIndex < 0
    ) {
      return this.selectedItem;
    }
    return this.tracksList[this.selectedItemIndex + 1];
  }

  get leftItem() {
    if (this.selectedItemIndex <= 0) {
      return this.selectedItem;
    }
    return this.tracksList[this.selectedItemIndex - 1];
  }

  get currentPlayingTrackUri() {
    return (
      this.rootStore.playerStore && this.rootStore.playerStore.currentTrackUri
    );
  }

  get currentPlayingTrackUid() {
    return (
      this.rootStore.playerStore && this.rootStore.playerStore.currentTrackUid
    );
  }

  get currentPlayingImageId() {
    return (
      this.rootStore.playerStore && this.rootStore.playerStore.currentImageId
    );
  }

  get colors() {
    return this.rootStore.imageStore && this.rootStore.imageStore.colors;
  }

  get isDialPressed() {
    return (
      this.rootStore.hardwareStore && this.rootStore.hardwareStore.dialPressed
    );
  }

  get shouldShowQueueConfirmation() {
    return this.showAddToQueueSuccess;
  }

  get selectedItemIndex() {
    return this.getIndexOfItem(this.selectedItem);
  }

  get isSelectingFirst() {
    return this.selectedItemIndex === 0;
  }

  get smallHeader() {
    return this.tracksList.length > 0 && !this.isSelectingFirst;
  }

  get currentlyPlayingTrackOrFirst() {
    if (!this.tracksList.length) return undefined;

    const currentTrack =
      this.rootStore.playerStore && this.rootStore.playerStore.currentTrack;
    if (currentTrack && this.browsingCurrentContext) {
      const currentItem = this.tracksList.find(
        (item) => item.uri === currentTrack.uri,
      );
      if (currentItem) return currentItem;
    }

    return this.tracksList[0];
  }

  getIndexOfItem(item: TracklistItem | undefined) {
    if (!item) return -1;
    return this.tracksList.findIndex((trackItem) => trackItem.uri === item.uri);
  }

  updateSelectedItem(item: TracklistItem | undefined, animate = true) {
    if (!item) return;

    this.selectedItem = item;
    this.animateSliding = animate;
  }

  handleDraggedToIndex = action((newIndex: number) => {
    if (newIndex >= 0 && newIndex < this.tracksList.length) {
      this.updateSelectedItem(this.tracksList[newIndex], false);
    }
  });

  handleItemSelected = action(
    (item: TracklistItem | undefined, logId?: number | string) => {
      if (!item) return;

      this.updateSelectedItem(item, false);

      if (this.playTrack) {
        this.playTrack(item.uri, this.contextUri);

        if (this.rootStore.viewStore && this.rootStore.viewStore.showNpv) {
          setTimeout(() => {
            this.rootStore.viewStore.showNpv();
          }, 100);
        }
      }
    },
  );

  handleTrackChange() {
    if (this.browsingCurrentContext && this.currentTrackInTracklist) {
      const currentTrack =
        this.rootStore.playerStore && this.rootStore.playerStore.currentTrack;
      if (currentTrack) {
        const currentItem = this.tracksList.find(
          (item) => item.uri === currentTrack.uri,
        );
        if (currentItem) {
          this.updateSelectedItem(currentItem, false);
        }
      }
    }
  }

  onPlayerStoreUriUpdated(uri: string) {
    if (this.contextUri === uri && this.currentTrackInTracklist) {
      this.handleTrackChange();
    }
  }

  setShouldShowAddToQueueBanner(show: boolean) {
    this.showAddToQueueSuccess = show;

    if (show) {
      if (this.confirmationTimeoutId) {
        clearTimeout(this.confirmationTimeoutId);
      }
      this.confirmationTimeoutId = setTimeout(() => {
        this.showAddToQueueSuccess = false;
      }, 4000);
    }
  }

  clickAddToQueue = action((event: MouseEvent, item: TracklistItem) => {
    event.stopPropagation();

    if (this.addToQueue) {
      this.addToQueue(item.uri);
      this.setShouldShowAddToQueueBanner(true);
    }
  });

  logContextImpression() {}

  logContextItemImpression(item: TracklistItem) {}

  logTrackRowClicked(item: TracklistItem) {
    return Date.now();
  }

  logRemoveLike() {}

  get shouldShowHeart() {
    return (
      !this.isCollectionUri(this.contextUri) &&
      !this.isStationUri(this.contextUri)
    );
  }

  get isLiked() {
    return (
      this.rootStore.savedStore &&
      this.rootStore.savedStore.isSaved &&
      this.rootStore.savedStore.isSaved(this.contextUri)
    );
  }

  setIsSaved = action((isSaved: boolean) => {
    if (this.contextType === "album" || this.contextType === "playlist") {
      if (this.likeAlbumOrPlaylist) {
        this.likeAlbumOrPlaylist(this.contextUri, isSaved);
      }
    } else if (
      this.rootStore.savedStore &&
      this.rootStore.savedStore.setSaved
    ) {
      this.rootStore.savedStore.setSaved(this.contextUri, isSaved);
    }
  });

  isCollectionUri(uri: string | null | undefined) {
    return uri && uri.includes(":collection");
  }

  titleBasedOnType(playerStore: PlayerStore, queueStore: QueueStore) {
    if (!playerStore) return "Unknown";

    return (
      playerStore.contextTitle ||
      playerStore.currentTrack?.album?.name ||
      "Unknown Context"
    );
  }

  isTrackOrEpisode(uri: string | null | undefined) {
    return uri && (uri.includes("track:") || uri.includes("episode:"));
  }

  isShowUri(uri: string | null | undefined) {
    return uri && uri.includes("show:");
  }

  isTrackUri(uri: string | null | undefined) {
    return uri && uri.includes("track:");
  }

  isSearchUri(uri: string | null | undefined) {
    return uri && uri.includes("search:");
  }

  isStationUri(uri: string | null | undefined) {
    return uri && uri.includes("station:");
  }

  isAlbumUri(uri: string | null | undefined) {
    return uri && uri.includes("album:");
  }

  isPlaylistUri(uri: string | null | undefined) {
    return uri && uri.includes("playlist:");
  }

  isArtistUri(uri: string | null | undefined) {
    return uri && uri.includes("artist:");
  }
}

export class TracklistStore {
  declare tracklistUiState: TracklistUiState;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    this.tracklistUiState = new TracklistUiState(rootStore);
    makeAutoObservable(this, { rootStore: false });
  }

  reset() {
    this.tracklistUiState.reset();
  }
}

export default TracklistStore;
