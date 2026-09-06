import type { SpotifyTrack, SpotifyShow, SpotifyDevice } from "../../../types";
import type { RootStore } from "./RootStore";
import type {
  InterappActions,
  MiddlewareActions,
  MiddlewareSocket,
} from "./StoreContracts";
import { makeAutoObservable } from "mobx";
import { getNpvImageUrl } from "../helpers/ImageSizeHelper";

export type PlayerItem = SpotifyTrack & { show?: SpotifyShow; uid?: string };
type PlayerState = {
  context_uri: string;
  is_playing: boolean;
  progress_ms: number;
  track: PlayerItem | null;
  device: SpotifyDevice | null;
  currently_active_application: string | null;
};

class PlayerStore {
  declare state: PlayerState;
  declare socket: MiddlewareSocket;
  declare contextTitle: string | undefined;
  declare currentTrackUri: string | undefined;
  declare currentTrackUid: string | undefined;
  declare currentTrackPosition: number | undefined;
  declare onContextChange:
    | ((callback: (uri: string) => void) => () => void)
    | undefined;
  declare skipToIndex: (index: number, uid?: string) => void;
  declare setPlaying: (playing: boolean) => void;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(
    rootStore: RootStore,
    interappActions: InterappActions,
    socket: MiddlewareSocket,
  ) {
    this.rootStore = rootStore;
    this.interappActions = interappActions;
    this.socket = socket;

    makeAutoObservable(this, {
      rootStore: false,
      interappActions: false,
      socket: false,
    });

    this.state = this.getInitialState();
  }

  getInitialState(): PlayerState {
    return {
      context_uri: "",
      is_playing: false,
      progress_ms: 0,
      track: null,
      device: null,
      currently_active_application: null,
    };
  }

  get contextUri() {
    return this.state.context_uri || "";
  }

  get currentTrack(): PlayerItem {
    return this.state.track || {};
  }

  get currentContextItem() {
    return {
      uri: this.contextUri,
      title: this.currentTrack?.name || "",
    };
  }

  get currentImageId() {
    const imageId =
      getNpvImageUrl(this.currentTrack?.album?.images) ||
      getNpvImageUrl(this.currentTrack?.images) ||
      "";
    return imageId;
  }

  get isPlayingSpotify() {
    return !this.isOtherMediaPlaying;
  }

  get isOtherMediaPlaying() {
    return (
      !!this.state.currently_active_application ||
      !!this.state.track?.is_phone_media
    );
  }

  get otherActiveApp() {
    return this.state.currently_active_application;
  }

  get canPlay() {
    return true;
  }

  get canPause() {
    return true;
  }

  get canSkipPrev() {
    return true;
  }

  get canSkipNext() {
    return true;
  }

  get canLike() {
    return true;
  }

  get canUnlike() {
    return true;
  }

  get canToggleShuffle() {
    return true;
  }

  setContextUri(contextUri: string) {
    this.state.context_uri = contextUri;
  }

  play() {
    console.log(
      "PlayerStore.play() called but not connected to Spotify integration yet",
    );
  }

  pause() {
    console.log(
      "PlayerStore.pause() called but not connected to Spotify integration yet",
    );
  }

  onTrackChange(callback: () => void) {
    return () => {};
  }

  reset() {
    this.state = this.getInitialState();
  }
}

export default PlayerStore;
