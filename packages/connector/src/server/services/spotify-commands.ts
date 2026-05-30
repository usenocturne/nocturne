import type { SpotifyService } from "./spotify-service";
import {
  filterRecursively,
  filterDeviceResponse,
  filterLyricsResponse,
} from "./spotify-filters";
import { createLogger } from "../utils/logger";

const log = createLogger("SpotifyCommands");

type CommandHandler = (params: any) => Promise<any>;

export class SpotifyCommandDispatcher {
  private handlers = new Map<string, CommandHandler>();

  constructor(private spotify: SpotifyService) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const s = this.spotify;

    this.register("spotify.player.play", (p) => s.handlePlay(p));
    this.register("spotify.player.pause", () => s.handlePause());
    this.register("spotify.player.next", (p) => s.handleNext(p));
    this.register("spotify.player.previous", () => s.handlePrevious());
    this.register("spotify.player.seek", (p) => s.handleSeek(p));
    this.register("spotify.player.volume", (p) => s.handleVolume(p));
    this.register("spotify.player.shuffle", (p) => s.handleShuffle(p));
    this.register("spotify.player.repeat", (p) => s.handleRepeat(p));

    this.register("spotify.player.state", () => s.handleGetPlaybackState().then(filterRecursively));
    this.register("spotify.player.queue", () => s.handleGetQueue());
    this.register("spotify.player.queue.add", (p) => s.handleAddToQueue(p));
    this.register("spotify.devices", () => s.handleGetDevices());
    this.register("spotify.player.transfer", (p) => s.handleTransferPlayback(p));

    this.register("spotify.me.playlists", (p) => s.handleGetUserPlaylists(p).then(filterRecursively));
    this.register("spotify.me.tracks", (p) => s.handleGetSavedTracks(p).then(filterRecursively));
    this.register("spotify.me.tracks.save", (p) => s.handleSaveTracks(p));
    this.register("spotify.me.tracks.remove", (p) => s.handleRemoveTracks(p));
    this.register("spotify.me.tracks.contains", (p) => s.handleCheckSavedTracks(p));
    this.register("spotify.me.shows", (p) => s.handleGetSavedShows(p).then(filterRecursively));
    this.register("spotify.me.shows.save", (p) => s.handleSaveShows(p));
    this.register("spotify.me.shows.remove", (p) => s.handleRemoveShows(p));
    this.register("spotify.me.shows.contains", (p) => s.handleCheckSavedShows(p));

    this.register("spotify.artist.get", (p) => s.handleGetArtist(p).then(filterRecursively));
    this.register("spotify.artist.topTracks", (p) => s.handleGetArtistTopTracks(p).then(filterRecursively));
    this.register("spotify.album.get", (p) => s.handleGetAlbum(p).then(filterRecursively));
    this.register("spotify.album.tracks", (p) => s.handleGetAlbumTracks(p).then(filterRecursively));
    this.register("spotify.playlist.get", (p) => s.handleGetPlaylist(p).then(filterRecursively));
    this.register("spotify.playlist.tracks", (p) => s.handleGetPlaylistTracks(p).then(filterRecursively));
    this.register("spotify.show.get", (p) => s.handleGetShow(p).then(filterRecursively));
    this.register("spotify.show.episodes", (p) => s.handleGetShowEpisodes(p).then(filterRecursively));

    this.register("spotify.me.profile", () => s.handleGetUserProfile());
    this.register("spotify.me.topArtists", (p) => s.handleGetTopArtists(p).then(filterRecursively));
    this.register("spotify.me.topTracks", (p) => s.handleGetTopTracks(p).then(filterRecursively));
    this.register("spotify.me.recentlyPlayed", (p) => s.handleGetRecentlyPlayed(p));

    this.register("spotify.radio.mixes", () => s.handleGetRadioMixes());
    this.register("spotify.radio.playlist", (p) => s.handleGetRadioPlaylist(p));
    this.register("spotify.radio.topMix", () => s.handleGetRadioTopMix());
    this.register("spotify.radio.discoveries", () => s.handleGetRadioDiscoveries());

    this.register("spotify.track.lyrics", (p) => s.handleGetLyrics(p).then(filterLyricsResponse));
    this.register("spotify.player.speed", (p) => s.handleSetPlaybackSpeed(p));
    this.register("spotify.dj.start", (p) => s.handleDjStart(p));
    this.register("spotify.dj.signal", (p) => s.handleDjSignal(p));
    this.register("spotify.image.fetch", (p) => s.handleFetchImage(p));

    this.register("spotify.search", (p) => s.handleSearch(p));
  }

  private register(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }

  async dispatch(command: string, params: any): Promise<any> {
    const handler = this.handlers.get(command);
    if (!handler) throw new Error(`Unknown Spotify command: ${command}`);

    try {
      return await handler(params);
    } catch (err: any) {
      log.error(`Command ${command} failed: ${err.message}`);
      throw err;
    }
  }

  supports(command: string): boolean {
    return this.handlers.has(command);
  }

  get supportedCommands(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}
