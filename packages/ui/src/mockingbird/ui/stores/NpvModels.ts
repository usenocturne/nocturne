import type { TouchEvent } from "react";
import type { NpvStore } from "./stubs";
import type { SwipeHandlerClass } from "../components/Views/Npv/SwipeHandler/SwipeHandler";

export type NowPlayingItem = {
  uid: string;
  uri: string;
  image_uri: string;
  name?: string;
  artist_name?: string;
};
export interface PlayingInfoState {
  currentItem: NowPlayingItem;
  title: string;
  subtitle: string;
  contextHeaderTitle: string;
  handlePlayingInfoHeaderClick(): void;
  swipeHandler: Pick<
    SwipeHandlerClass,
    | "swipeDirection"
    | "handleSwipedLeft"
    | "handleSwipedRight"
    | "setSwipeDirection"
  >;
  handleArtistClick(): void;
  handleArtworkClick(): void;
  loadPrevAndNextImage(): void;
  previousItem: NowPlayingItem | null;
  nextItem: NowPlayingItem | null;
  showWindLevelIcon: boolean;
  isPlayingSpotify: boolean;
  onRepeat: boolean;
  onRepeatOnce: boolean;
  readonly isMicMuted?: boolean;
  showSettings?: () => void;
}
export interface VolumeUiState {
  parentStore?: NpvStore;
  volumeTimeoutId: number | undefined;
  carMode: string | null;
  isPlayingSpotify: boolean;
  displayVolume: number;
  volume: number;
  isVolumeAbove0: boolean;
  readonly colorChannels: number[];
  shouldShowVolume: boolean;
  resetShowVolumeTimer(): void;
  clearVolumeTimer(): void;
}
export interface ScrubbingUiState {
  parentStore?: NpvStore;
  isScrubbing: boolean;
  isScrubbingEnabled: boolean;
  readonly colorChannels: number[];
  trackPlayedPercent: number;
  trackPlayedTime: string;
  trackLeftTime: string;
  scrubbingTimeoutId: number | null;
  startScrubbing(): void;
  stopScrubbing(): void;
  resetScrubbingViewTimer(): void;
  resetScrubbingCommitTimer(): void;
  handleScrubberClick(): void;
  handleOnTouchMove(event: TouchEvent): void;
}

export interface ControlButtonsState {
  controlButtonSet: string;
  showOtherMediaControls: boolean;
  showPodcastControls: boolean;
  isPlaying: boolean;
  isSaved: boolean;
  isShuffled: boolean;
  canSeek: boolean;
  isPlayingAd: boolean;
  podcastSpeed: number;
  handlePlayClick(): void;
  handlePauseClick(): void;
  handleSkipNextClick(): void;
  handleSkipPrevClick(): void;
  handleLikeClick(): void;
  handleUnlikeClick(): void;
  handleShuffleClick(): void;
  handleUnshuffleClick(): void;
  handleSeekBackClick(): void;
  handleSeekForwardClick(): void;
  handleAddToSavedEpisodesClick(): void;
  handleRemoveFromSavedEpisodesClick(): void;
  handleBlockClick(): void;
  handlePodcastSpeedClick(): void;
  handleRepeatClick?: () => void;
}
