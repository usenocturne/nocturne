import { makeAutoObservable } from "mobx";
import { getNpvImageUrl } from "../helpers/ImageSizeHelper";

class PlayerStore {
  constructor(rootStore, interappActions, socket) {
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

  getInitialState() {
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

  get currentTrack() {
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

  setContextUri(contextUri) {
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

  onTrackChange(callback) {
    return () => {};
  }

  reset() {
    this.state = this.getInitialState();
  }
}

export default PlayerStore;
