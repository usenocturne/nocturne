/// <reference types="vite/client" />

type UiLooseIndex = {
  [key: string]: UiLooseData;
  [index: number]: UiLooseData;
  (...args: unknown[]): UiLooseData;
} & {
  length: number;
  map<T>(callback: (value: UiLooseData, index: number) => T): T[];
  filter(
    callback: (value: UiLooseData, index: number) => boolean,
  ): UiLooseData[];
  find(
    callback: (value: UiLooseData, index: number) => boolean,
  ): UiLooseData | undefined;
  some(callback: (value: UiLooseData, index: number) => boolean): boolean;
  every(callback: (value: UiLooseData, index: number) => boolean): boolean;
  forEach(callback: (value: UiLooseData, index: number) => void): void;
  slice(start?: number, end?: number): UiLooseData[];
  push(...items: UiLooseData[]): number;
  startsWith(searchString: string): boolean;
  includes(searchString: string): boolean;
  split(separator: string | RegExp): string[];
  replace(searchValue: string | RegExp, replaceValue: string): string;
  toLowerCase(): string;
  toString(): string;
};
type UiContentItem = import("./types").SpotifyContent & Record<string, unknown>;
type UiUnknownRecord = Record<string, unknown>;
type UiLooseData = UiLooseIndex &
  import("./types").WsResponse &
  import("./types").SpotifyPlayback &
  import("./types").SpotifyAlbum &
  import("./types").SpotifyArtist &
  import("./types").SpotifyPlaylist &
  import("./types").SpotifyShow &
  import("./types").SpotifyTrack & {
    action?: string;
    albums?: { items?: UiContentItem[] };
    authenticated?: boolean | number | string;
    contextUriToPlay?: string | null;
    current?: string;
    datetime?: string;
    imagePath?: string | null;
    item?: UiContentItem | null;
    items?: UiContentItem[];
    loading?: boolean;
    needsAuthorization?: boolean | number | string;
    next?: string | null;
    offset?: number;
    ota?: string;
    payload?: UiLooseData;
    releaseNotes?: string | null;
    result?: UiLooseData;
    skipped?: boolean;
    stage?: string;
    title?: string;
    total?: number;
    trackUriToPlay?: string | null;
    urisToPlay?: string[] | null;
    version?: string;
    MediaItemTitle?: string;
    MediaItemArtist?: string;
    MediaItemAlbumName?: string;
    MediaItemPlaybackDurationInMilliseconds?: number;
    PlaybackShuffleMode?: number | string;
    PlaybackRepeatMode?: number | string;
    PlaybackStatus?: number | string;
    PlaybackRate?: number;
  };

type UiCallback = {
  bivarianceHack(...args: unknown[]): unknown;
}["bivarianceHack"];
type UiComponentProps = Record<string, unknown> & {
  accessToken?: string | null;
  activeButton?: string | null;
  activeSection?: string;
  aiResponse?: string;
  albumId?: string;
  artistId?: string;
  children?: import("react").ReactNode;
  className?: string;
  contentId?: string;
  contentType?: string;
  currentPlayback?: import("./types").SpotifyPlayback | null;
  currentlyPlayingAlbum?: import("./types").SpotifyAlbum | null;
  currentlyPlayingAlbumId?: string | null;
  currentlyPlayingId?: string | null;
  currentlyPlayingTrackUri?: string | null;
  currentVersion?: string | null;
  description?: string;
  deviceName?: string | null;
  error?: string | null;
  expanded?: boolean;
  href?: string;
  icon?: import("react").ReactNode;
  isActive?: boolean;
  isConnectionLost?: boolean;
  isConnecting?: boolean;
  isError?: boolean;
  isLoading?: boolean | Record<string, boolean>;
  isSpotifySkipped?: boolean;
  notification?: import("./types").AppNotification;
  onAccept?: UiCallback;
  onBackToStart?: UiCallback;
  onBrightnessToggle?: UiCallback;
  onCardClick?: UiCallback;
  onChange?: UiCallback;
  onClose?: UiCallback;
  onConnectionRestored?: UiCallback;
  onDismiss?: UiCallback;
  onItemSelect?: UiCallback;
  onNavigateToAlbum?: UiCallback;
  onNavigateToArtist?: UiCallback;
  onNavigateToNowPlaying?: UiCallback;
  onOpenContent?: UiCallback;
  onOpenDeviceSwitcher?: UiCallback;
  openBluetoothPairing?: boolean;
  onPlayDJMix?: UiCallback;
  onReboot?: UiCallback;
  onRefreshNeeded?: UiCallback;
  onReject?: UiCallback;
  onSelect?: UiCallback;
  onShutdown?: UiCallback;
  phase?: string;
  pin?: string;
  playbackProgress?: import("./types").PlaybackProgress;
  playingStateMap?: Record<string, boolean>;
  radioMixes?: import("./types").SpotifyPlaylist[];
  recentAlbums?: import("./types").SpotifyAlbum[];
  reconnectionExhausted?: boolean;
  refreshData?: UiCallback;
  refreshPlaybackState?: UiCallback;
  renderItem?: UiCallback;
  setActiveSection?: UiCallback;
  setIgnoreNextRelease?: UiCallback;
  show?: boolean;
  suppressed?: boolean;
  text?: string;
  title?: string;
  topArtists?: import("./types").SpotifyArtist[];
  updateGradientColors?: import("./types").UpdateGradientColors;
  userPlaylists?: import("./types").SpotifyPlaylist[];
  userShows?: import("./types").SpotifyShow[];
  visible?: boolean;
  volumeTarget?: number | null;
};

interface Window {
  carThingRootStore?: UiLooseData;
  testShelf?: UiLooseData;
  testPresets?: UiLooseData;
  showPresets?: UiLooseData;
  testHardware?: UiLooseData;
  umami?: {
    track?: (event: string, data?: Record<string, unknown>) => void;
  };
  scrubbingHardwareDialHandler?: ((delta: string | number) => void) | null;
  scrubbingTimeoutShouldSeek?: boolean;
  scrubbingProgressValue?: number | null;
  scrubbingPlaybackProgress?: {
    duration?: number;
    durationMs?: number;
    progressMs?: number;
  };
  scrubbingOnSeek?: (positionMs: number) => void | Promise<void>;
  carThingSkipNext?: () => void | Promise<void>;
  carThingSkipPrev?: () => void | Promise<void>;
}

interface Document {
  rootStore?: UiLooseData;
}

declare module "*.module.scss" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.scss";

declare module "swiper/css";
declare module "swiper/scss";
declare module "swiper/scss/*";
